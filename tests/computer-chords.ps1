$ErrorActionPreference='Stop'
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\computer.ps1') -Raw -Encoding UTF8
$tok=$null;$err=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tok,[ref]$err)
if($err.Count){throw 'Parse error'}
$table=$ast.Find({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$keyNames'},$true)
Invoke-Expression $table.Extent.Text
foreach($name in @('Parse-Chord','Guard-Chord')){$f=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);Invoke-Expression $f.Extent.Text}
foreach($keys in @('windows+l','control+alt+delete','control+shift+esc','win + L','alt+f4')){$blocked=$false;try{Guard-Chord $keys}catch{$blocked=$true};if(!$blocked){throw "Unsafe chord accepted: $keys"}}
foreach($keys in @('ctrl+c','control+v','alt+tab','shift+left')){Guard-Chord $keys;if(!(Parse-Chord $keys)){throw 'Empty chord'}}
'Keyboard aliases: 9 cases passed, no input sent'
