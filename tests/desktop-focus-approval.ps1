$ErrorActionPreference='Stop'
$source=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\computer.ps1')
$ast=[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$null)
$check=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Check-App'},$true)
Add-Type 'public class FakeDesktop { public static System.IntPtr Current=(System.IntPtr)8; public static System.IntPtr GetForegroundWindow(){return Current;} public static bool Focus(System.IntPtr h){Current=h;return true;} }'
function Window-Info($h){@{process='TestApp';pid=12;handle=$h.ToInt64()}}
function Get-Process {param($Id,$ErrorAction) [pscustomobject]@{Path=''}}
function In-Selection($h){$h.ToInt64() -in 7,8}
$policy=@{disabledApps=@();allowedPrograms=@()};$req=@{action='click';selectedHandle=7;selectedPid=12}
$approvedHandles=@{};$approvedPids=@{}
$body=$check.Extent.Text.Replace('[AgentInput]','[FakeDesktop]').Replace('[Console]::ReadLine()',"'approve'")
Invoke-Expression $body
Check-App ([IntPtr]7)
if([FakeDesktop]::Current.ToInt64() -ne 8){throw 'App approval stole focus from the already active child window'}
Write-Output 'Approval preserves active child window: passed (no UI input)'
[FakeDesktop]::Current=[IntPtr]8
$approvedHandles=@{};$approvedPids=@{}
function Read-Approval {[FakeDesktop]::Current=[IntPtr]99;return 'approve'}
Invoke-Expression ($check.Extent.Text.Replace('[AgentInput]','[FakeDesktop]').Replace('[Console]::ReadLine()','(Read-Approval)'))
Check-App ([IntPtr]7)
if([FakeDesktop]::Current.ToInt64() -ne 8){throw 'Manual approval restored main window instead of original child'}
Write-Output 'Manual approval restores original child window: passed (no UI input)'
