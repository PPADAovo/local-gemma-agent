param([ValidateSet('www.youtube.com','www.google.com','www.naver.com','mail.google.com')][string]$Site)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
$chrome=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe")|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
if(!$chrome){throw 'Chrome is not installed.'}
$root=[Windows.Automation.AutomationElement]::RootElement
$class=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Chrome_WidgetWin_1')
$before=@($root.FindAll('Children',$class)|ForEach-Object {$_.Current.NativeWindowHandle})
Start-Process $chrome -ArgumentList '--new-window',("https://"+$Site+"/")
$bar=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Edit)
for($i=0;$i -lt 50;$i++){
 foreach($w in $root.FindAll('Children',$class)){
 if($w.Current.NativeWindowHandle -in $before -or (Get-Process -Id $w.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName -ne 'chrome'){continue}
 foreach($e in $w.FindAll('Descendants',$bar)){
 if($e.Current.Name -notmatch '주소|address|omnibox'){continue}
 try{$v=$e.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
 if($v -match ('^(?:https://)?(?:www\.)?'+[regex]::Escape(($Site -replace '^www\.',''))+'(?:/|$)')){return (@{pid=$w.Current.ProcessId;handle=$w.Current.NativeWindowHandle;site=$Site;side=$true}|ConvertTo-Json -Compress)}
 }catch{}
 }}
 Start-Sleep -Milliseconds 180
}
throw 'Chrome 주소창에서 요청한 사이트를 확인하지 못했습니다.'
