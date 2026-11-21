param([string]$Mode,[long]$Handle,[int]$OwnerPid)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationTypes,UIAutomationClient
$a=[Windows.Automation.AutomationElement]
$scope=[Windows.Automation.TreeScope]
$type=[Windows.Automation.ControlType]
function ByType($x){[Windows.Automation.PropertyCondition]::new($a::ControlTypeProperty,$x)}
function Address($win){
 foreach($edit in $win.FindAll($scope::Descendants,(ByType $type::Edit))){
  if($edit.Current.Name -notmatch '주소|address|omnibox' -or $edit.Current.IsPassword){continue}
  try{$v=$edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value;if($v -notmatch '^https?://'){$v='https://'+$v};return [uri]$v}catch{}
 }
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class GemmaWorkWindow {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetProp(IntPtr hwnd,string name,IntPtr value);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr hwnd,string name);
}
"@
$tag="LocalGemma.Work."+$env:GEMMA_WINDOW_TAG
if($Mode -eq 'reuse'){
 $class=[Windows.Automation.PropertyCondition]::new($a::ClassNameProperty,'Chrome_WidgetWin_1')
 foreach($win in $a::RootElement.FindAll($scope::Children,$class)){
  $h=[intptr]$win.Current.NativeWindowHandle
  if([GemmaWorkWindow]::GetProp($h,$tag) -eq [intptr]1 -and (Get-Process -Id $win.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName -eq 'chrome'){
   $u=Address $win
   if($u.Host -eq 'accounts.google.com' -or ($u.Host -in 'www.youtube.com','youtube.com' -and $u.AbsolutePath -eq '/feed/channels')){
    @{handle=$h.ToInt64();pid=$win.Current.ProcessId}|ConvertTo-Json -Compress;return
   }
  }
 }
 '{"handle":0}';return
}
if($Mode -eq 'open'){
 $chrome=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
 if(!$chrome){throw 'Chrome missing'}
 $class=[Windows.Automation.PropertyCondition]::new($a::ClassNameProperty,'Chrome_WidgetWin_1')
 $before=@($a::RootElement.FindAll($scope::Children,$class)|ForEach-Object {$_.Current.NativeWindowHandle})
 Start-Process -FilePath $chrome -WindowStyle Minimized -ArgumentList '--new-window','--start-minimized',$env:GEMMA_YOUTUBE_ENTRY
 for($i=0;$i -lt 60 -and !$Handle;$i++){
  foreach($win in $a::RootElement.FindAll($scope::Children,$class)){
   if($win.Current.NativeWindowHandle -in $before -or (Get-Process -Id $win.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName -ne 'chrome'){continue}
   $url=Address $win
   if($url.Host -in 'accounts.google.com','www.youtube.com','youtube.com'){$Handle=$win.Current.NativeWindowHandle;$OwnerPid=$win.Current.ProcessId;break}
  }
  if(!$Handle){Start-Sleep -Milliseconds 200}
 }
}
if(!$Handle){throw 'Window not found'}
$w=$a::FromHandle([intptr]$Handle)
if($w.Current.ProcessId -ne $OwnerPid -or (Get-Process -Id $OwnerPid).ProcessName -ne 'chrome'){throw 'Window closed'}
if($Mode -eq 'open' -and $env:GEMMA_WINDOW_TAG){[void][GemmaWorkWindow]::SetProp([intptr]$Handle,$tag,[intptr]1)}
$url=Address $w
$result=@{handle=$Handle;pid=$OwnerPid;state='loading'}
if($url.Host -eq 'accounts.google.com'){
 $result.state=if($url.AbsolutePath -match '/rejected|deniedsigninrejected'){'blocked'}else{'login'}
}elseif($url.Host -in 'www.youtube.com','youtube.com' -and $url.AbsolutePath -eq '/feed/channels'){
 $doc=$w.FindFirst($scope::Descendants,(ByType $type::Document))
 if($doc){
  $links=$doc.FindAll($scope::Descendants,(ByType $type::Hyperlink))
  $rows=@()
  foreach($link in $links){
   $name=$link.Current.Name
   try{$href=$link.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value}catch{continue}
   if($link.Current.ClassName -match 'ytd-channel-renderer' -and $name -and $href -match '^https://www\.youtube\.com/(?:@[^/?#]+|channel/[^/?#]+)/?$'){$rows+=($name+' '+$href);$lastChannel=$link}
  }
  $sign=$doc.FindFirst($scope::Descendants,[Windows.Automation.OrCondition]::new([Windows.Automation.PropertyCondition]::new($a::NameProperty,'로그인'),[Windows.Automation.PropertyCondition]::new($a::NameProperty,'Sign in')))
  if($sign -and !$rows.Count){if($Mode -eq 'signin'){$sign.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()};$result.state='signin-required'}
  elseif($rows.Count){
   $scroll=$null
   foreach($node in @($doc)+@($doc.FindAll($scope::Descendants,[Windows.Automation.PropertyCondition]::new($a::IsScrollPatternAvailableProperty,$true)))){
    try{$p=$node.GetCurrentPattern([Windows.Automation.ScrollPattern]::Pattern);if($p.Current.VerticallyScrollable){$scroll=$p;break}}catch{}
   }
   if($Mode -eq 'top' -and $scroll){$scroll.SetScrollPercent(-1,0)}
   if($Mode -eq 'scroll' -and $scroll){$scroll.Scroll([Windows.Automation.ScrollAmount]::NoAmount,[Windows.Automation.ScrollAmount]::LargeIncrement)}
   if($Mode -eq 'scroll' -and !$scroll -and $lastChannel){try{$lastChannel.GetCurrentPattern([Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()}catch{}}
   $result.state='ready';$result.rows=$rows;$result.position=if($scroll){$scroll.Current.VerticalScrollPercent}else{'unknown'}
  }
 }
}elseif($url -and $url.Host -notin 'www.youtube.com','accounts.youtube.com','about'){$result.state='left'}
$result|ConvertTo-Json -Compress
