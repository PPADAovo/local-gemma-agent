$ErrorActionPreference='Stop'
# 클릭 직전 요소 확인 회귀 테스트(2026-11-20 그림판·계산기 시험에서 맞는 클릭이 거절된 두 경우).
$source=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\computer.ps1')
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
foreach($name in 'Element-Matches','Element-Covers','Pointer-Foreground','Assert-PointerTarget'){
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(!$fn){throw "$name missing"}
  Invoke-Expression $fn.Extent.Text
}
function Assert($ok,$message){if(!$ok){throw $message}}
function Fake($name,$type,$left,$top,$width,$height,[switch]$Offscreen,$class=''){
  [pscustomobject]@{Current=[pscustomobject]@{Name=$name;HelpText='';ClassName=$class;IsOffscreen=[bool]$Offscreen;
    ControlType=[pscustomobject]@{ProgrammaticName='ControlType.'+$type};
    BoundingRectangle=[pscustomobject]@{Left=$left;Top=$top;Right=$left+$width;Bottom=$top+$height;IsEmpty=($width -le 0 -or $height -le 0)}}}
}

# 1) WinUI 3 그림판: FromPoint는 껍데기(DesktopChildSiteBridge)만 주므로 이름 검색 결과로 확인합니다.
$req=[pscustomobject]@{elementName='연필';elementType='Button'}
Assert (!(Element-Matches (Fake '' 'Pane' 263 174 1769 939 -class 'Microsoft.UI.Content.DesktopChildSiteBridge'))) 'bridge pane must not match by itself'
Assert (Element-Covers 515 239 @((Fake '연필' 'Button' 499 223 32 32))) 'named button covering the point must be accepted'
# 같은 이름이라도 좌표를 덮지 않거나, 화면 밖이거나, 종류가 다르면 거절합니다.
Assert (!(Element-Covers 515 239 @((Fake '연필' 'Button' 600 223 32 32)))) 'named element elsewhere must be rejected'
Assert (!(Element-Covers 515 239 @((Fake '연필' 'Button' 499 223 32 32 -Offscreen)))) 'offscreen element must be rejected'
Assert (!(Element-Covers 515 239 @((Fake '연필' 'ListItem' 499 223 32 32)))) 'different control type must be rejected'
$req=[pscustomobject]@{elementName='빨강';elementType='ListItem'}
Assert (!(Element-Covers 515 239 @((Fake '빨강' 'ListItem' 1102 223 24 24)))) 'other named element must not authorize this point'
Assert (!(Element-Covers 515 239 @())) 'no candidates must be rejected'

# 2) 맞힌 창이 관찰한 창인데 앞 창만 잠깐 다르면(0 또는 다른 창) 관찰한 창을 다시 앞으로 가져와 통과합니다.
Add-Type -TypeDefinition @'
using System;
public static class AgentInput {
  public static IntPtr Foreground=IntPtr.Zero; public static int Focuses;
  public static IntPtr GetForegroundWindow(){return Foreground;}
  public static bool Focus(IntPtr h){Focuses++;Foreground=h;return true;}
}
'@
$observed=@{handle=459886;pid=38900;class='MSPaintApp';owner=0}
[AgentInput]::Foreground=[IntPtr]::Zero
$fg=Pointer-Foreground $observed $observed
Assert ($fg -eq 459886 -and [AgentInput]::Focuses -eq 1) 'transient foreground=0 must refocus the observed window'
Assert-PointerTarget $observed $observed $fg
# 다른 창을 맞혔으면 앞 창을 바꾸지 않고 그대로 거절합니다.
[AgentInput]::Foreground=[IntPtr]199048;[AgentInput]::Focuses=0
$other=@{handle=777;pid=1;class='Other';owner=0}
$fg=Pointer-Foreground $observed $other
Assert ($fg -eq 199048 -and [AgentInput]::Focuses -eq 0) 'a different hit window must not trigger refocus'
$rejected=$false;try{Assert-PointerTarget $observed $other $fg}catch{$rejected=$true}
Assert $rejected 'pointer on a different window must be rejected'
# 3) 그림판 드롭다운처럼 관찰한 창이 소유한 WinUI 팝업 창은 통과, 다른 프로세스나 소유자가 다른 팝업은 거절합니다.
$popup=@{handle=1376450;pid=38900;class='Microsoft.UI.Content.PopupWindowSiteBridge';owner=459886}
Assert-PointerTarget $observed $popup 459886
foreach($bad in @(@{handle=1;pid=1;class='Microsoft.UI.Content.PopupWindowSiteBridge';owner=459886},@{handle=2;pid=38900;class='Microsoft.UI.Content.PopupWindowSiteBridge';owner=5},@{handle=3;pid=38900;class='SomeDialog';owner=459886})){
  $rejected=$false;try{Assert-PointerTarget $observed $bad 459886}catch{$rejected=$true}
  Assert $rejected ('unowned or foreign popup must be rejected: '+$bad.class)
}
'click-element-check ok'
