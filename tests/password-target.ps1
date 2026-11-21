# Unit test the actual password guard without interacting with any real window.
$ErrorActionPreference='Stop'
$source=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\computer.ps1')
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'PowerShell parse failed'}
$guard=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Guard-PasswordFocus'},$true)
if(!$guard){throw 'Password focus guard missing'}
Add-Type 'public class FakeFocus { public static object FocusedElement; }'
function Window-Info($handle){@{pid=12}}
Invoke-Expression ($guard.Extent.Text.Replace('[Windows.Automation.AutomationElement]','[FakeFocus]'))
$cases=@(@{pid=12;password=$true;allow=$true},@{pid=13;password=$true;allow=$false},@{pid=12;password=$false;allow=$false})
foreach($case in $cases){
 [FakeFocus]::FocusedElement=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=$case.pid;IsPassword=$case.password;NativeWindowHandle=0;ClassName='Edit'}}
 $allowed=$true
 try{Guard-PasswordFocus ([IntPtr]7)}catch{$allowed=$false}
 if($allowed -ne $case.allow){throw 'Incorrect password target decision'}
}
Write-Output 'Password target guard: 3/3 passed (no UI input)'
