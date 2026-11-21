param([string]$Binary='Gemma-copy-ready.exe')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
$a=[Reflection.Assembly]::LoadFrom((Join-Path (Split-Path $PSScriptRoot) $Binary))
$t=$a.GetType('DesktopChat'); $flags=[Reflection.BindingFlags]'Instance,NonPublic'
$obj=[Runtime.Serialization.FormatterServices]::GetUninitializedObject($t)
$pf=$t.GetField('prefs',$flags); $prefs=[Activator]::CreateInstance($pf.FieldType,$true)
$pf.FieldType.GetProperty('motion').SetValue($prefs,$false,$null); $pf.SetValue($obj,$prefs)
$panel=[Windows.Controls.StackPanel]::new()
foreach($label in @('first log','second log',"third log`r`ncontinued")){
 $argsList=[object[]]::new(2); $argsList[0]=$panel; $argsList[1]=$label
 $t.GetMethod('LogLine',$flags).Invoke($obj,$argsList)|Out-Null
}
if($panel.Children.Count -ne 1 -or $panel.Children[0] -isnot [Windows.Controls.RichTextBox]){throw 'Logs do not share a single selection surface'}
$detail=$panel.Children[0]; $detail.SelectAll()
foreach($line in @('first log','second log','third log','continued')){if(!$detail.Selection.Text.Contains($line)){throw "Selection missing $line"}}
if(!$detail.IsReadOnly){throw 'Log must remain read only'}
'PASS: one selection includes all log entries and multiline content'
