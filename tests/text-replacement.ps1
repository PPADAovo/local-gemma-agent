$ErrorActionPreference='Stop'
$source=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\computer.ps1')
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
$guard=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-TextReplacementTarget'},$true)
if(!$guard){throw 'Replacement guard missing'}
Invoke-Expression $guard.Extent.Text
function Assert($ok,$message){if(!$ok){throw $message}}
$expected=@{window=7;pid=12;id='1,2,3'}
foreach($difference in @(@{},@{window=8},@{pid=99},@{focusPid=99},@{id='1,2,4'},@{editable=$false},@{password=$true},@{id=''})){
  $current=@{window=7;pid=12;focusPid=12;id='1,2,3';editable=$true;password=$false}
  foreach($key in $difference.Keys){$current[$key]=$difference[$key]}
  $accepted=$true;try{Assert-TextReplacementTarget $expected $current}catch{$accepted=$false}
  Assert ($accepted -eq ($difference.Count -eq 0)) 'Replacement accepted a changed or noneditable target'
}
$unsupported=@{window=7;pid=12;focusPid=12;id='1,2,3';editable=$false;password=$false;role='Edit';class='OS_EditText';valuePattern=$false;readOnly=$null;value='PRIVATE_FIELD_TEXT';name='PRIVATE_NAME'}
$diagnostic='';try{Assert-TextReplacementTarget $expected $unsupported}catch{$diagnostic=$_.Exception.Message}
Assert ($diagnostic -match 'unsupported_editable_control' -and $diagnostic -match 'OS_EditText') 'Unsupported input failure lacks actionable metadata'
Assert ($diagnostic -notmatch 'PRIVATE_FIELD_TEXT|PRIVATE_NAME') 'Replacement diagnostic leaked input values'
$unsupported.id='new-focus'
$diagnostic='';try{Assert-TextReplacementTarget $expected $unsupported}catch{$diagnostic=$_.Exception.Message}
Assert ($diagnostic -match 'focus_changed') 'Replacement failure did not distinguish a changed focused input'
$code=[regex]::Match($source,"(?s)agentInputSource=@'\r?\n(.*?)\r?\n'@").Groups[1].Value
$code=$code.Replace('[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();','public static IntPtr GetForegroundWindow() { return FakeInput.Foreground; }')
$code=$code.Replace('[DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern short VkKeyScanW(char c);','static short VkKeyScanW(char c) { return -1; }')
$code=$code.Replace('static void Send(INPUT[] a) { if (SendInput((uint)a.Length, a, Size()) != a.Length) throw new System.ComponentModel.Win32Exception(); }','static void Send(INPUT[] a) { FakeInput.Packets.AddRange(a); if(FakeInput.SwitchWindow) FakeInput.Foreground=new IntPtr(8); if(FakeInput.SwitchFocus) FakeInput.FocusChanged=true; }')
$fake=@'
public class FakeInput {
 public static IntPtr Foreground=new IntPtr(7);
 public static bool SwitchWindow,SwitchFocus,FocusChanged;
 public static System.Collections.Generic.List<AgentInput.INPUT> Packets=new System.Collections.Generic.List<AgentInput.INPUT>();
 public static void Reset(){Foreground=new IntPtr(7);SwitchWindow=false;SwitchFocus=false;FocusChanged=false;Packets.Clear();AgentInput.ValidateTextTarget=()=>{if(FocusChanged)throw new InvalidOperationException("focus changed");};}
}
'@
Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition ($code+"`n"+$fake)
Assert ([AgentInput].GetMethod('ReplaceText') -ne $null) 'Explicit replacement input method missing'
[FakeInput]::Reset();[AgentInput]::LiteralText('new',[IntPtr]7,$false)
Assert ([FakeInput]::Packets.Count -eq 6) 'Default insertion gained extra key events'
Assert (!([FakeInput]::Packets | Where-Object {$_.u.ki.wVk -eq 0x11})) 'Default insertion selected existing content'
[FakeInput]::Reset();[AgentInput]::ReplaceText('new',[IntPtr]7)
Assert ([FakeInput]::Packets.Count -eq 10) 'Replacement must select once then type'
Assert ([FakeInput]::Packets[0].u.ki.wVk -eq 0x11 -and [FakeInput]::Packets[1].u.ki.wVk -eq 0x41) 'Replacement did not begin with Ctrl+A'
foreach($change in @('SwitchWindow','SwitchFocus')){
 [FakeInput]::Reset();if($change -eq 'SwitchWindow'){[FakeInput]::SwitchWindow=$true}else{[FakeInput]::SwitchFocus=$true}
 $blocked=$false;try{[AgentInput]::ReplaceText('new',[IntPtr]7)}catch{$blocked=$true}
 Assert $blocked 'Replacement continued after Ctrl+A changed its target'
 Assert ([FakeInput]::Packets.Count -eq 4) 'Text was sent after the selected target changed'
}
[FakeInput]::Reset();[FakeInput]::Foreground=[IntPtr]8
$blocked=$false;try{[AgentInput]::ReplaceText('new',[IntPtr]7)}catch{$blocked=$true}
Assert ($blocked -and [FakeInput]::Packets.Count -eq 0) 'Wrong window received Ctrl+A'
[FakeInput]::Reset();[AgentInput]::ValidateTextTarget=[Action]{throw 'not editable'}
$blocked=$false;try{[AgentInput]::ReplaceText('new',[IntPtr]7)}catch{$blocked=$true}
Assert ($blocked -and [FakeInput]::Packets.Count -eq 0) 'Invalid input received Ctrl+A'
[FakeInput]::Reset();[AgentInput]::ReplaceText('',[IntPtr]7)
Assert ([FakeInput]::Packets.Count -eq 6 -and [FakeInput]::Packets[4].u.ki.wVk -eq 8) 'Empty replacement did not delete the selected text'
'replacement guard and input scenarios passed (synthetic window/input only)'
