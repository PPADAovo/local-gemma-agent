param([string]$Payload)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$task=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient
function Wait-Editor($file) {
    $title=[IO.Path]::GetFileName($file)
    for ($i=0;$i -lt 60;$i++){
        $app=Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle.StartsWith($title+' -') } | Select-Object -First 1
        if ($app) {return $app}
        Start-Sleep -Milliseconds 150
    }
    throw "편집기를 찾지 못했습니다: $title"
}
function Open-Editor($file) {
    Start-Process notepad.exe -ArgumentList ('"'+$file+'"')
    Wait-Editor $file
}
function Read-Editor($app) {
    $root=[Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $cond=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Document)
    $doc=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$cond)
    if (!$doc) {throw '문서 본문을 읽지 못했습니다.'}
    $doc.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1)
}
function Send-Editor($app,$handle,$action,$value) {
    if ((& "$PSScriptRoot/notepad-focus.ps1" $app.Id) -ne $handle){throw '입력 대상 창이 바뀌었습니다.'}
    if ($action -eq 'type') {$value=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value))}
    & "$PSScriptRoot/desktop.ps1" $action -Keys $value -ExpectedWindow $handle
    Start-Sleep -Milliseconds 250
}
function Confirm-Body($app,$expected) {
    $body=Read-Editor $app
    # UI Automation providers can append a paragraph terminator.
    if ($body -cne $expected -and $body -cne ($expected+"`r") -and $body -cne ($expected+"`r`n")){throw '편집기 본문 불일치'}
}
if ($task.action -eq 'verify') {
    $app=Open-Editor $task.file
    Confirm-Body $app $task.body
    return
}
$seed=$task.seed
$app=Open-Editor $seed
$handle=[string]$app.MainWindowHandle.ToInt64()
Confirm-Body $app ''
Send-Editor $app $handle type $task.body
Confirm-Body $app $task.body
Send-Editor $app $handle keys '^+s'
for ($i=0;$i -lt 20;$i++){
    $dialog=& "$PSScriptRoot/notepad-focus.ps1" $app.Id
    if ($dialog -ne $handle){break}
    Start-Sleep -Milliseconds 150
}
if($dialog -eq $handle){throw '다른 이름으로 저장 창을 찾지 못했습니다.'}
$element=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$dialog))
if($element.Current.Name -notmatch '다른 이름으로 저장|Save As'){throw '저장 대화상자 확인 실패'}
Send-Editor $app $dialog keys '^a'
Send-Editor $app $dialog type $task.file
if ([IO.File]::Exists($task.file)){throw '대상 파일이 이미 있습니다.'}
Send-Editor $app $dialog keys '{ENTER}'
$app=Wait-Editor $task.file
if([IO.File]::ReadAllText($task.file) -cne $task.body){throw '저장한 파일 내용 불일치'}
Send-Editor $app ([string]$app.MainWindowHandle.ToInt64()) keys '^w'
for ($i=0;$i -lt 20;$i++){
    $open=Get-Process -Id $app.Id -ErrorAction SilentlyContinue
    if (!$open -or !$open.MainWindowTitle.StartsWith([IO.Path]::GetFileName($task.file)+' -')){return}
    Start-Sleep -Milliseconds 150
}
throw '저장한 탭 닫기를 확인하지 못했습니다.'

