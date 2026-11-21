# Compile the actual native input class with fake clipboard/window/input boundaries.
# No clipboard, native window, or SendInput API is called by this test.
$ErrorActionPreference='Stop'
$source=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\computer.ps1')
$code=[regex]::Match($source,"(?s)agentInputSource=@'\r?\n(.*?)\r?\n'@").Groups[1].Value
if(!$code){throw 'Native input class missing'}
$code=$code.Replace('[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();','public static IntPtr GetForegroundWindow() { return FakeInput.Foreground; }')
$code=$code.Replace('[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);','public static uint GetWindowThreadProcessId(IntPtr h, out uint pid) { pid=12; return 1; }')
$code=$code.Replace('[DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern short VkKeyScanW(char c);','static short VkKeyScanW(char c) { return -1; }')
$code=$code.Replace('[DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();','static uint GetClipboardSequenceNumber() { return FakeClipboard.Sequence; }')
$code=$code.Replace('static void Send(INPUT[] a) { if (SendInput((uint)a.Length, a, Size()) != a.Length) throw new System.ComponentModel.Win32Exception(); }','static void Send(INPUT[] a) { FakeInput.Packets.AddRange(a); if(FakeInput.Fail) throw new InvalidOperationException("fake input failure"); if(FakeInput.ChangeClipboard) FakeClipboard.SetText("new user copy"); if(FakeInput.SwitchWindow) FakeInput.Foreground=new IntPtr(8); }')
$code=$code.Replace('System.Windows.Forms.Clipboard','FakeClipboard')
$fake=@'
public class FakeInput {
  public static IntPtr Foreground=new IntPtr(7);
  public static System.Collections.Generic.List<AgentInput.INPUT> Packets=new System.Collections.Generic.List<AgentInput.INPUT>();
  public static bool Fail,ChangeClipboard,SwitchWindow;
  public static void Reset(){Packets.Clear();Fail=false;ChangeClipboard=false;SwitchWindow=false;Foreground=new IntPtr(7);FakeClipboard.Reset();}
}
public class FakeClipboard {
  public static System.Windows.Forms.IDataObject Current;
  public static uint Sequence;
  public static int Writes;
  public static string PastedText;
  public static void Reset(){Current=null;Sequence=0;Writes=0;PastedText=null;}
  public static System.Windows.Forms.IDataObject GetDataObject(){return Current;}
  public static void SetDataObject(object value,bool persist){Current=(System.Windows.Forms.IDataObject)value;Sequence++;Writes++;}
  public static void SetText(string text){var d=new System.Windows.Forms.DataObject();d.SetText(text);Current=d;PastedText=text;Sequence++;Writes++;}
  public static void Clear(){Current=null;Sequence++;Writes++;}
}
'@
Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition ($code+"`n"+$fake)
function Assert($condition,$message){if(!$condition){throw $message}}
function Invoke-Literal([string]$text,[bool]$secret=$false){
 if([AgentInput].GetMethod('LiteralText')){[AgentInput]::LiteralText($text,[IntPtr]7,$secret)}else{[AgentInput]::Text($text,[IntPtr]7)}
}

[FakeInput]::Reset()
$prior=New-Object Windows.Forms.DataObject
$prior.SetData('custom-test',$false,'custom value');$prior.SetText('original')
[FakeClipboard]::Current=$prior
Invoke-Literal "첫 줄`r`nsecond line`n{ENTER}"
Assert (!([FakeInput]::Packets | Where-Object {$_.u.ki.wVk -eq 13})) 'Literal text emitted VK_RETURN and could submit a chat'
Assert ([FakeClipboard]::PastedText -eq "첫 줄`r`nsecond line`r`n{ENTER}") 'Multiline content was not pasted literally'
Assert ([FakeClipboard]::Current.GetData('custom-test',$false) -eq 'custom value') 'Original custom clipboard format lost'
Assert ([FakeClipboard]::Current.GetData('UnicodeText') -eq 'original') 'Original clipboard text lost'

[FakeInput]::Reset();Invoke-Literal "line1`nline2"
Assert ($null -eq [FakeClipboard]::Current) 'Empty clipboard was not restored'
[FakeInput]::Reset();[FakeClipboard]::Current=$prior;[FakeInput]::Fail=$true
try{Invoke-Literal "line1`nline2";throw 'Expected fake input failure'}catch{Assert ($_.Exception.Message -match 'fake input failure') 'Unexpected failure'}
Assert ([FakeClipboard]::Current.GetData('UnicodeText') -eq 'original') 'Clipboard was not restored on failure'

[FakeInput]::Reset();[FakeInput]::ChangeClipboard=$true;Invoke-Literal "line1`nline2"
Assert ([FakeClipboard]::Current.GetData('UnicodeText') -eq 'new user copy') 'A concurrent user copy was overwritten'
[FakeInput]::Reset();Invoke-Literal 'secret123' $true
Assert ([FakeClipboard]::Writes -eq 0) 'Password touched the clipboard'
Assert ([FakeInput]::Packets.Count -gt 0) 'Single-line password was not typed'
[FakeInput]::Reset();[FakeInput]::SwitchWindow=$true
$blocked=$false;try{Invoke-Literal 'secret123' $true}catch{$blocked=$true}
Assert $blocked 'A same-process window switch during typing must stop before the next character'
Assert ([FakeInput]::Packets.Count -eq 2) 'Typing continued after the target changed'
[FakeInput]::Reset();$script:focusChecks=0
[AgentInput]::ValidateTextTarget=[Action]{$script:focusChecks++;if($script:focusChecks -gt 1){throw 'password field changed'}}
$blocked=$false;try{Invoke-Literal 'secret123' $true}catch{$blocked=$true}finally{[AgentInput]::ValidateTextTarget=$null}
Assert $blocked 'A changed password field must stop text input'
Assert ([FakeInput]::Packets.Count -eq 2) 'Typing continued after field validation failed'
[FakeInput]::Reset()
try{Invoke-Literal "secret`nvalue" $true;throw 'Expected multiline password rejection'}catch{Assert ($_.Exception.Message -notmatch 'Expected multiline') 'Multiline password was accepted'}
Assert ([FakeClipboard]::Writes -eq 0 -and [FakeInput]::Packets.Count -eq 0) 'Multiline password leaked before rejection'
[FakeInput]::Reset();[FakeInput]::Foreground=[IntPtr]8
try{Invoke-Literal "line1`nline2";throw 'Expected focus rejection'}catch{Assert ($_.Exception.Message -notmatch 'Expected focus') 'Wrong foreground accepted'}
Assert ([FakeInput]::Packets.Count -eq 0 -and [FakeClipboard]::Writes -eq 0) 'Wrong window received multiline text'
Write-Output 'Literal text: 9/9 scenarios passed (fake clipboard/input only)'
