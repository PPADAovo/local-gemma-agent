# 컴퓨터 사용 도구: 화면 보기(번호 표시), 마우스, 키보드, 스크롤, 창 목록/전환
# 입력: base64(JSON) 하나. 출력: JSON 한 줄.
# -Daemon: 상주 모드. 표준입력으로 base64(JSON)를 한 줄씩 받아 결과를 '@daemonResult <base64>' 한 줄로 돌려줍니다.
#          (호출마다 powershell.exe를 새로 띄우고 어셈블리를 불러오는 0.5~1초를 아낍니다. 요청별 상태는 매번 초기화합니다.)
param([string]$Payload='',[switch]$Daemon)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if(!$Daemon -and !$Payload){throw 'Payload가 필요합니다.'}
function Set-Request([string]$encoded){
    $script:req=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
}
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,WindowsBase,UIAutomationClient,UIAutomationTypes
if(!('AgentInput' -as [type])){
$agentInputSource=@'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AgentInput {
  public static Action ValidateTextTarget;
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  static int Size() { return Marshal.SizeOf(typeof(INPUT)); }
  static void Send(INPUT[] a) { if (SendInput((uint)a.Length, a, Size()) != a.Length) throw new System.ComponentModel.Win32Exception(); }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(System.Drawing.Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
  // Send movement through the same input stream as button down/up so ink apps receive the trajectory.
  static void MovePointer(System.Drawing.Point p, System.Drawing.Rectangle desktop) {
    INPUT[] packet = new INPUT[1];
    packet[0].u.mi.dx = (int)Math.Floor((p.X-desktop.Left+0.5)*65536/desktop.Width);
    packet[0].u.mi.dy = (int)Math.Floor((p.Y-desktop.Top+0.5)*65536/desktop.Height);
    packet[0].u.mi.dwFlags = 0x8000 | 0x4000 | 0x2000 | 1; // absolute, virtual desktop, no coalescing, move
    Send(packet);
  }
  static void ButtonEvent(uint flags) {
    INPUT[] packet = new INPUT[1];
    packet[0].u.mi.dwFlags = flags;
    Send(packet);
  }
  static void GuardStroke(IntPtr window, uint pid, RECT bounds, System.Drawing.Point point) {
    RECT now; uint currentPid;
    GetWindowThreadProcessId(window, out currentPid);
    if (GetForegroundWindow()!=window || currentPid!=pid || !GetWindowRect(window,out now)
        || now.Left!=bounds.Left || now.Top!=bounds.Top || now.Right!=bounds.Right || now.Bottom!=bounds.Bottom)
      throw new InvalidOperationException("대상 창이 바뀌었습니다. 화면을 다시 확인하세요.");
    if (GetAncestor(WindowFromPoint(point),2)!=window)
      throw new InvalidOperationException("획이 대상 창을 벗어나거나 다른 창에 가려졌습니다.");
  }
  public static void Stroke(IntPtr window, uint pid, RECT bounds, System.Drawing.Point[] vertices) {
    if (vertices.Length<2 || vertices.Length>64) throw new ArgumentException("한 획에 2~64개 점이 필요합니다.");
    var samples = new System.Collections.Generic.List<System.Drawing.Point>();
    samples.Add(vertices[0]);
    for (int i=1;i<vertices.Length;i++) {
      var start=vertices[i-1];var end=vertices[i];
      double dx=(double)end.X-start.X,dy=(double)end.Y-start.Y;
      double count=Math.Ceiling(Math.Max(Math.Abs(dx),Math.Abs(dy))/8);
      if (samples.Count+count>2500) throw new ArgumentException("획을 더 짧게 나누세요.");
      for (int j=1;j<=count;j++)
        samples.Add(new System.Drawing.Point(start.X+(int)Math.Round(dx*j/count),start.Y+(int)Math.Round(dy*j/count)));
    }
    if (samples.Count<2) throw new ArgumentException("서로 다른 두 점이 필요합니다.");
    foreach (var p in samples) GuardStroke(window,pid,bounds,p);
    var desktop = System.Windows.Forms.SystemInformation.VirtualScreen; MovePointer(samples[0],desktop);
    System.Threading.Thread.Sleep(20);
    GuardStroke(window,pid,bounds,samples[0]);
    ButtonEvent(0x0002);
    try {
      for(int j=1;j<samples.Count;j++) {
        var p=samples[j];
        GuardStroke(window,pid,bounds,p);
        MovePointer(p,desktop);
        System.Threading.Thread.Sleep(16);
      }
    } finally { ButtonEvent(0x0004); }
  }
  public static void Mouse(uint down, uint up, int clicks) {
    for (int i = 0; i < clicks; i++) {
      INPUT[] a = new INPUT[2];
      a[0].type = 0; a[0].u.mi.dwFlags = down;
      a[1].type = 0; a[1].u.mi.dwFlags = up;
      Send(a);
      System.Threading.Thread.Sleep(60);
    }
  }
  public static void Wheel(int amount, bool horizontal) {
    INPUT[] a = new INPUT[1];
    a[0].type = 0; a[0].u.mi.dwFlags = horizontal ? 0x1000u : 0x0800u; a[0].u.mi.mouseData = (uint)amount;
    Send(a);
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern short VkKeyScanW(char c);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  public static void ReplaceText(string text, IntPtr expected) {
    if(ValidateTextTarget==null)throw new InvalidOperationException("입력칸 교체 검증이 필요합니다.");
    if(GetForegroundWindow()!=expected)throw new InvalidOperationException("입력 대상 창이 바뀌었습니다.");
    ValidateTextTarget();
    Chord(new ushort[]{0x11,0x41});
    System.Threading.Thread.Sleep(80);
    if(GetForegroundWindow()!=expected)throw new InvalidOperationException("전체 선택 중 입력 대상 창이 바뀌었습니다.");
    ValidateTextTarget();
    if(text.Length==0)Chord(new ushort[]{0x08});
    else LiteralText(text,expected,false);
  }
  public static void LiteralText(string text, IntPtr expected, bool secret) {
    if (secret || (text.IndexOf('\n')<0 && text.IndexOf('\r')<0)) { Text(text,expected); return; }
    if (System.Threading.Thread.CurrentThread.GetApartmentState()!=System.Threading.ApartmentState.STA)
      throw new InvalidOperationException("여러 줄 입력에는 STA 실행이 필요합니다.");
    if (GetForegroundWindow()!=expected) throw new InvalidOperationException("입력 대상 창이 바뀌었습니다.");
    // Snapshot every original format before replacing the clipboard. If a
    // format cannot be read, fail before changing it rather than losing data.
    var original=System.Windows.Forms.Clipboard.GetDataObject();
    System.Windows.Forms.DataObject backup=null;
    if(original!=null) {
      backup=new System.Windows.Forms.DataObject();
      foreach(string format in original.GetFormats(false)) {
        object value=original.GetData(format,false);
        if(value==null) throw new InvalidOperationException("클립보드 원본을 보존할 수 없어 여러 줄 입력을 중지했습니다.");
        backup.SetData(format,false,value);
      }
    }
    uint ownSequence=0; bool replaced=false;
    try {
      System.Windows.Forms.Clipboard.SetText(text.Replace("\r\n","\n").Replace("\r","\n").Replace("\n","\r\n"));
      ownSequence=GetClipboardSequenceNumber(); replaced=true;
      if (GetForegroundWindow()!=expected) throw new InvalidOperationException("입력 대상 창이 바뀌었습니다.");
      if(ValidateTextTarget!=null)ValidateTextTarget();
      Chord(new ushort[]{0x11,0x56}); // paste text; never synthesize Enter from content
      System.Threading.Thread.Sleep(250);
    } finally {
      // Preserve a newer copy made by the user/application while paste ran.
      if(replaced && GetClipboardSequenceNumber()==ownSequence) {
        if(backup==null) System.Windows.Forms.Clipboard.Clear();
        else System.Windows.Forms.Clipboard.SetDataObject(backup,true);
      }
    }
  }
  public static bool PreferVirtualKeys;
  public static void Text(string text, IntPtr expected) {
    // This path includes protected secrets and must never submit a form or
    // put credentials on the clipboard. Reject before typing even a prefix.
    if(text.IndexOf('\n')>=0 || text.IndexOf('\r')>=0)
      throw new ArgumentException("키 입력 경로는 여러 줄을 허용하지 않습니다. 비밀번호에는 줄바꿈을 넣지 마세요.");
    foreach (char c in text) {
      IntPtr now=GetForegroundWindow();
      if(now!=expected)throw new InvalidOperationException("입력 대상 창이 바뀌었습니다. 새 창을 확인하고 다시 입력하세요.");
      if(ValidateTextTarget!=null)ValidateTextTarget();
      // Blender처럼 유니코드 키 패킷을 무시하는 앱은 영문자·공백도 가상 키로 칩니다(평소에는 한글 입력기 변환을 피하려고 유니코드로 보냄).
      if(c>=' ' && c<='~' && (PreferVirtualKeys || !char.IsLetter(c)) && (PreferVirtualKeys || c!=' ')){
        short mapped=VkKeyScanW(c);
        if(mapped>=0 && (mapped>>8)<=1){
          ushort key=(ushort)(mapped & 255);
          Chord((mapped>>8)==1 ? new ushort[]{0x10,key} : new ushort[]{key});
          System.Threading.Thread.Sleep(35); continue;
        }
      }
      INPUT[] a = new INPUT[2];
      a[0].type = 1; a[0].u.ki.wScan = c; a[0].u.ki.dwFlags = 4;
      a[1].type = 1; a[1].u.ki.wScan = c; a[1].u.ki.dwFlags = 6;
      Send(a);
      System.Threading.Thread.Sleep(8);
    }
  }
  // Raw Input으로 키보드를 읽는 앱(Blender 등)은 스캔 코드가 0이면 키를 버립니다. 가상 키와 함께 실제 스캔 코드를 넣습니다.
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  public static void Chord(ushort[] keys) {
    INPUT[] a = new INPUT[keys.Length * 2];
    for (int i = 0; i < keys.Length; i++) { a[i].type = 1; a[i].u.ki.wVk = keys[i]; a[i].u.ki.wScan = (ushort)MapVirtualKey(keys[i], 0); a[i].u.ki.dwFlags = Extended(keys[i]); }
    for (int i = 0; i < keys.Length; i++) { int j = keys.Length + i; ushort k = keys[keys.Length - 1 - i]; a[j].type = 1; a[j].u.ki.wVk = k; a[j].u.ki.wScan = (ushort)MapVirtualKey(k, 0); a[j].u.ki.dwFlags = 2u | Extended(k); }
    Send(a);
  }
  static uint Extended(ushort vk) {
    return (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B ? 1u : 0u;
  }
  public static string Title(IntPtr h) {
    int n = GetWindowTextLength(h); if (n <= 0) return "";
    StringBuilder s = new StringBuilder(n + 1); GetWindowText(h, s, s.Capacity); return s.ToString();
  }
  public static string WindowClass(IntPtr h) {
    var name=new StringBuilder(256);
    return GetClassName(h,name,name.Capacity)>0?name.ToString():"";
  }
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    System.Threading.Thread.Sleep(200);
    return GetForegroundWindow() == h;
  }
  public static System.Collections.Generic.List<IntPtr> TopWindows() {
    var list = new System.Collections.Generic.List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr p) { if (IsWindowVisible(h) && GetWindowTextLength(h) > 0) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
'@
# 화면 조작용 C# 코드는 한 번만 컴파일해 DLL로 저장하고 다음부터 그 DLL을 불러옵니다(예전에는 클릭·키 입력마다 1~2초씩 다시 컴파일).
$agentInputHash=[BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($agentInputSource))).Replace("-","").Substring(0,16)
$agentInputDll=Join-Path ([IO.Path]::GetTempPath()) ("gemma-agentinput-"+$agentInputHash+".dll")
if(!(Test-Path -LiteralPath $agentInputDll)){ try{ Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition $agentInputSource -OutputAssembly $agentInputDll -OutputType Library -ErrorAction Stop }catch{ Remove-Item -LiteralPath $agentInputDll -ErrorAction SilentlyContinue } }
if(Test-Path -LiteralPath $agentInputDll){ try{ Add-Type -LiteralPath $agentInputDll -ErrorAction Stop }catch{ Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition $agentInputSource } } else { Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition $agentInputSource }
}
[void][AgentInput]::SetProcessDPIAware()
try{[void][AgentInput]::SetThreadDpiAwarenessContext([IntPtr](-4))}catch{}

function Window-Info([IntPtr]$h){
    $procId=[uint32]0; [void][AgentInput]::GetWindowThreadProcessId($h,[ref]$procId)
    $name=''; try{$name=(Get-Process -Id $procId -ErrorAction Stop).ProcessName}catch{}
    $bounds=New-Object AgentInput+RECT;[void][AgentInput]::GetWindowRect($h,[ref]$bounds)
    @{rect=@($bounds.Left,$bounds.Top,$bounds.Right,$bounds.Bottom);handle=$h.ToInt64();title=[AgentInput]::Title($h);process=$name;pid=[int]$procId;class=[AgentInput]::WindowClass($h);owner=[AgentInput]::GetWindow($h,4).ToInt64()}
}
function Assert-ObservationCurrent($captured,$current,[long]$foreground){
    if(!$captured -or !$current -or !$captured.handle -or !$captured.pid -or
       $captured.handle -ne $current.handle -or $captured.pid -ne $current.pid -or
       $foreground -ne $captured.handle -or @($captured.rect).Count -ne 4 -or @($current.rect).Count -ne 4 -or
       ($captured.rect -join ',') -ne ($current.rect -join ',')){
        throw '화면을 읽는 동안 대상 창이나 위치가 바뀌었습니다. look으로 새 화면을 확인하세요.'
    }
}
function Self-Window([IntPtr]$h){
    $t=[AgentInput]::Title($h)
    return ($t -eq '로컬 Gemma' -or $t -like '*로컬 Gemma*')
}
# 다른 AI 앱(Claude, ChatGPT/Codex)은 절대 조작하지 않습니다.
function Blocked-Window([IntPtr]$h){
    $i=Window-Info $h
    return ($i.process -match '^(claude|chatgpt|codex)' -or $i.title -match '^(Claude|ChatGPT|Codex)$')
}
function In-Selection([IntPtr]$h){
    $selected=[IntPtr]([long]$req.selectedHandle)
    if((Window-Info $selected).pid -ne $req.selectedPid){return $false}
    $start=$h
    for($i=0;$i -lt 16 -and $h -ne [IntPtr]::Zero;$i++){
        if($h -eq $selected){return $true}
        $h=[AgentInput]::GetWindow($h,4)
    }
    # 같은 프로그램이 새로 띄운 창(채팅방, 대화 상자 등)은 선택한 앱의 일부로 봅니다. 그래야 앱이 연 새 창을 따라가며 작업할 수 있습니다.
    # 한 프로세스가 서로 무관한 창을 여럿 가지는 프로그램(브라우저, 탐색기 등)은 제외합니다.
    if($start -ne [IntPtr]::Zero){
        $cur=Window-Info $start
        if($cur.pid -eq $req.selectedPid -and $cur.process -notmatch '^(explorer|chrome|msedge|firefox|whale|brave|opera|ApplicationFrameHost|Code|WindowsTerminal)$'){return $true}
    }
    return $false
}
$policyFile=Join-Path $(if($env:GEMMA_DATA_DIR){$env:GEMMA_DATA_DIR}else{Join-Path $env:LOCALAPPDATA 'LocalGemmaDesktop'}) 'preferences.json'
# 요청마다 설정을 새로 읽고 승인 기록을 비웁니다(상주 모드에서도 이전 호출의 승인이 다음 호출로 넘어가지 않게).
function Reset-RequestState{
    $script:policy=if(Test-Path -LiteralPath $policyFile){Get-Content -Raw -Encoding UTF8 -LiteralPath $policyFile | ConvertFrom-Json}else{$null}
    if($script:req.action -ne 'restore' -and $script:policy.computerUse -eq $false){throw '설정에서 컴퓨터 사용이 꺼져 있습니다.'}
    $script:approvedHandles=@{}
    # 같은 프로그램이 띄운 팝업(프로필 창, 검색 창 등)마다 다시 묻지 않도록 프로세스 단위로도 기억합니다(이 호출 한 번 동안만).
    $script:approvedPids=@{}
    $script:hidSelf=$false
    [AgentInput]::PreferVirtualKeys=$false
}
function Check-App([IntPtr]$handle){
    $info=Window-Info $handle
    if($policy.disabledApps -contains $info.process){throw ('앱 제어가 꺼져 있습니다: '+$info.process)}
    # 브라우저·엑셀·워드는 다른 승인 경로가 있어 창 허용 카드를 건너뛰지만, '승인 요청' 모드에서는 이 앱들도 창마다 묻습니다.
    if(($info.process -in 'chrome','msedge','excel','winword' -and $policy.approval -ne 'confirm') -or $approvedHandles.ContainsKey($handle) -or $approvedPids.ContainsKey([int]$info.pid)){return}
    $exe=(Get-Process -Id $info.pid -ErrorAction Stop).Path
    if($exe -and $policy.allowedPrograms -contains $exe){return}
    $beforeApproval=[AgentInput]::GetForegroundWindow()
    [Console]::Error.WriteLine('@appApproval '+(@{process=$info.process;title=$info.title;action=$req.action;pid=$info.pid;handle=$info.handle}|ConvertTo-Json -Compress))
    if([Console]::ReadLine() -ne 'approve'){throw '앱 제어가 승인되지 않았습니다.'}
    if((Window-Info $handle).pid -ne $info.pid){throw '승인 중 대상 창이 변경되었습니다.'}
    $approvedHandles[$handle]=$true; $approvedPids[[int]$info.pid]=$true
    # 사용자가 승인 카드를 누르면 대화창이 앞으로 나옵니다. 승인 뒤에는 대상 창을 다시 앞으로 가져와야
    # 입력이 "대상 창이 바뀌었습니다"로 끊기거나 클릭이 대화창에 들어가지 않습니다.
    # Auto approval does not move focus. Keep an already active chat/dialog instead
    # of unconditionally returning to the selected main window.
    if([AgentInput]::GetForegroundWindow() -ne $beforeApproval){
        $resume=$handle
        if($req.selectedHandle -and (In-Selection $beforeApproval)){$resume=$beforeApproval}
        [void][AgentInput]::Focus($resume); Start-Sleep -Milliseconds 200
    }
}
function Guard-PasswordFocus([IntPtr]$window){
    $focused=[Windows.Automation.AutomationElement]::FocusedElement
    if(!$focused -or $focused.Current.ProcessId -ne (Window-Info $window).pid){throw '비밀번호 입력 대상이 바뀌었습니다. 잠금 화면을 다시 확인하세요.'}
    $password=$focused.Current.IsPassword
    $native=[IntPtr]$focused.Current.NativeWindowHandle
    if(!$password -and $native -ne [IntPtr]::Zero -and $focused.Current.ClassName -match '(?i)edit'){
        $password=([AgentInput]::GetWindowLong($native,-16) -band 0x20) -ne 0
    }
    if(!$password){throw '보안 비밀번호 입력 칸을 확인하지 못해 입력하지 않았습니다. 잠금 해제 입력 칸을 확인하거나 직접 잠금을 풀어 주세요.'}
}
function Text-FocusState{
    $window=[AgentInput]::GetForegroundWindow()
    $focused=[Windows.Automation.AutomationElement]::FocusedElement
    $state=@{window=$window.ToInt64();pid=(Window-Info $window).pid;focusPid=0;id='';editable=$false;password=$true;role='none';class='';enabled=$false;valuePattern=$false;readOnly=$null;nativeEdit=$false}
    if(!$focused){return $state}
    $current=$focused.Current
    $state.focusPid=$current.ProcessId;$state.id=$focused.GetRuntimeId() -join ',';$state.password=$current.IsPassword
    $state.role=$current.ControlType.ProgrammaticName -replace '^ControlType\.',''
    $state.class=([string]$current.ClassName -replace '[\r\n\t]',' ').Substring(0,[Math]::Min(80,([string]$current.ClassName).Length))
    $state.enabled=$current.IsEnabled
    $native=[IntPtr]$current.NativeWindowHandle
    $nativeEdit=$native -ne [IntPtr]::Zero -and $current.ClassName -match '(?i)(^|\.)(edit|richedit[^.]*)(\.|$)'
    $state.nativeEdit=[bool]$nativeEdit
    $style=if($nativeEdit){[AgentInput]::GetWindowLong($native,-16)}else{0}
    if($nativeEdit -and ($style -band 0x20) -ne 0){$state.password=$true}
    $kind=$current.ControlType.ProgrammaticName -replace '^ControlType\.',''
    if($current.IsEnabled -and !$state.password -and ($kind -in 'Edit','Document','ComboBox' -or $nativeEdit)){
        $pattern=$null
        if($focused.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$state.valuePattern=$true;$state.readOnly=$pattern.Current.IsReadOnly;$state.editable=!$state.readOnly}
        elseif($nativeEdit){$state.readOnly=($style -band 0x800) -ne 0;$state.editable=!$state.readOnly}
    }
    return $state
}
function Assert-TextReplacementTarget($expected,$current){
    if(!$expected.id -or !$expected.pid -or !$current -or $current.window -ne $expected.window -or
       $current.pid -ne $expected.pid -or $current.focusPid -ne $expected.pid -or
       $current.id -cne $expected.id -or !$current.editable -or $current.password){
        $reason=if(!$expected.id -or !$expected.pid){'missing_target_identity'}elseif(!$current){'no_focused_control'}elseif($current.window -ne $expected.window){'foreground_changed'}elseif($current.pid -ne $expected.pid -or $current.focusPid -ne $expected.pid){'process_changed'}elseif($current.id -cne $expected.id){'focus_changed'}elseif($current.password){'password_control'}elseif($current.readOnly -eq $true){'read_only_control'}else{'unsupported_editable_control'}
        # Include control capability/identity metadata, never Name/Value/text.
        $diagnostic=[ordered]@{role=$current.role;class=$current.class;readOnly=$current.readOnly;valuePattern=$current.valuePattern;nativeEdit=$current.nativeEdit;enabled=$current.enabled;pid=$current.pid;focusPid=$current.focusPid;windowMatches=($current.window -eq $expected.window);focusMatches=($current.id -ceq $expected.id)}
        throw ('입력칸 교체 중지: '+$reason+' '+($diagnostic|ConvertTo-Json -Compress))
    }
}
function Assert-PointerTarget($observed,$hit,[long]$foreground){
    $sameWindow=$hit.handle -eq $observed.handle -and $hit.pid -eq $observed.pid
    # Native popup menus keep their owning application's foreground window.
    # Same PID alone is insufficient: reject dialogs and unrelated app windows.
    # WinUI 3 앱(새 그림판 등)의 드롭다운·플라이아웃은 같은 프로세스가 소유한 PopupWindowSiteBridge 창에 뜹니다.
    $ownedMenu=$hit.class -cin '#32768','Microsoft.UI.Content.PopupWindowSiteBridge' -and $hit.pid -eq $observed.pid -and $hit.owner -eq $observed.handle
    if(!$observed.handle -or !$observed.pid -or $foreground -ne $observed.handle -or (!$sameWindow -and !$ownedMenu)){
        $detail=[ordered]@{observed=$observed.handle;hit=$hit.handle;class=$hit.class;pid=$hit.pid;owner=$hit.owner;foreground=$foreground}
        throw ('클릭 대상 불일치: '+($detail|ConvertTo-Json -Compress)+'. look으로 현재 창을 확인하세요.')
    }
}
function Element-Matches($element){
    $current=$element.Current
    $type=$current.ControlType.ProgrammaticName -replace '^ControlType\.',''
    if($type -eq 'Pane' -and $current.ClassName -match '(?i)(^|\.)(edit|button)(\.|$)'){$type=$Matches[2]}
    return ((!$req.elementName -or $current.Name -ceq $req.elementName -or $current.HelpText -ceq $req.elementName) -and (!$req.elementType -or $type -eq $req.elementType))
}
# 관찰한 창 안에서 이름이 같은 요소 중 화면에 보이고 영역이 (x,y)를 덮는 것이 있으면 참입니다.
function Named-ElementCovers([int]$x,[int]$y){
    $handle=if($req.observedHandle){[IntPtr]([long]$req.observedHandle)}else{[AgentInput]::GetAncestor([AgentInput]::WindowFromPoint([Drawing.Point]::new($x,$y)),2)}
    if($handle -eq [IntPtr]::Zero){return $false}
    try{
        $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
        $byName=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,[string]$req.elementName)
        return (Element-Covers $x $y @($root.FindAll([Windows.Automation.TreeScope]::Descendants,$byName)))
    }catch{return $false}
}
function Element-Covers([int]$x,[int]$y,$candidates){
    foreach($candidate in $candidates){
        $r=$candidate.Current.BoundingRectangle
        if($candidate.Current.IsOffscreen -or $r.IsEmpty){continue}
        if($x -ge $r.Left -and $x -lt $r.Right -and $y -ge $r.Top -and $y -lt $r.Bottom -and (Element-Matches $candidate)){return $true}
    }
    return $false
}
# 관찰한 창을 실제로 맞혔는데 앞 창만 잠깐 다른 경우(창 전환 중 0, 승인 판단 중 다른 창이 앞으로 옴)에는
# 관찰한 창을 한 번 다시 앞으로 가져온 뒤의 앞 창을 돌려줍니다. 맞힌 창이 다르면 그대로 돌려줘 거절되게 둡니다.
function Pointer-Foreground($observed,$hit){
    $fg=[AgentInput]::GetForegroundWindow().ToInt64()
    if($fg -ne $observed.handle -and $hit.handle -eq $observed.handle -and $hit.pid -eq $observed.pid){
        [void][AgentInput]::Focus([IntPtr]([long]$observed.handle)); Start-Sleep -Milliseconds 150
        $fg=[AgentInput]::GetForegroundWindow().ToInt64()
    }
    return $fg
}
# Blender처럼 마우스 아래 영역에 단축키를 보내는 앱은 커서가 창 밖(예: 대화창 위)에 있으면 키가 먹지 않습니다.
# 커서가 대상 창 위에 없을 때만 창 가운데(Blender라면 3D 뷰포트)로 옮깁니다(2026-11-20 블렌더 x 키가 무시됨).
function Hover-ForShortcuts([IntPtr]$fg){
    $info=Window-Info $fg
    if($info.process -notmatch '^(blender)$'){return}
    [AgentInput]::PreferVirtualKeys=$true
    $cursor=[Windows.Forms.Cursor]::Position
    $under=[AgentInput]::GetAncestor([AgentInput]::WindowFromPoint([Drawing.Point]::new($cursor.X,$cursor.Y)),2)
    if($under -eq $fg){return}
    $r=$info.rect
    [void][AgentInput]::SetCursorPos([int](($r[0]+$r[2])/2),[int](($r[1]+$r[3])/2)); Start-Sleep -Milliseconds 80
}
function Check-Point([int]$x,[int]$y){

    $hit=[AgentInput]::WindowFromPoint([Drawing.Point]::new($x,$y))
    $root=[AgentInput]::GetAncestor($hit,2)
    if($req.observedHandle){$observed=Window-Info ([IntPtr]([long]$req.observedHandle));$hitInfo=Window-Info $root;Assert-PointerTarget $observed $hitInfo (Pointer-Foreground $observed $hitInfo)}
    if($req.selectedHandle -and !(In-Selection $root)){throw '선택한 창 밖의 좌표입니다. 화면을 다시 확인하세요.'}
    Check-App $root
    if([AgentInput]::GetAncestor([AgentInput]::WindowFromPoint([Drawing.Point]::new($x,$y)),2) -ne $root){throw '승인 중 좌표의 창이 바뀌었습니다. 다시 확인하세요.'}
    if($req.observedHandle){$observed=Window-Info ([IntPtr]([long]$req.observedHandle));$hitInfo=Window-Info $root;Assert-PointerTarget $observed $hitInfo (Pointer-Foreground $observed $hitInfo)}
}
function Target-Window{
    $fg=[AgentInput]::GetForegroundWindow()
    if($req.selectedHandle){
        $selected=[IntPtr]([long]$req.selectedHandle)
        if(!(In-Selection $selected) -or (Blocked-Window $selected) -or (Self-Window $selected)){throw '선택한 대상 창을 사용할 수 없습니다.'}
        Check-App $selected
        if(!(In-Selection $fg)){
            $resume=$selected
            if($req.observedHandle){
                $observed=[IntPtr]([long]$req.observedHandle)
                if(!(In-Selection $observed) -or (Window-Info $observed).pid -ne $req.selectedPid -or (Blocked-Window $observed) -or (Self-Window $observed)){
                    throw '관찰한 입력 대상 창을 다시 사용할 수 없습니다. look으로 현재 창을 확인하세요.'
                }
                Check-App $observed
                $resume=$observed
            }
            [void][AgentInput]::Focus($resume);$fg=[AgentInput]::GetForegroundWindow()
        }
        if(!(In-Selection $fg)){throw '선택한 창을 앞으로 가져오지 못했습니다.'}
        return $fg
    }
    # 작업 대상 앱이 정해져 있으면 그 창을 앞으로 가져옵니다.
    $want=[string]$req.expect
    if($want){
        $cur=Window-Info $fg
        if($cur.process -ne $want){
            $matchingWindows=@(foreach($h in [AgentInput]::TopWindows()){
                $i=Window-Info $h
                if($i.process -eq $want -and !(Self-Window $h) -and !(Blocked-Window $h)){$i}
            })
            if($req.observedHandle){
                $matchingWindows=@($matchingWindows | Where-Object {$_.handle -eq [long]$req.observedHandle})
            }
            if($matchingWindows.Count -ne 1){throw ('대상 창을 특정할 수 없습니다: '+$want+'. windows 목록을 다시 보고 focus로 선택하세요.')}
            $candidate=[IntPtr]$matchingWindows[0].handle
            Check-App $candidate
            if(![AgentInput]::Focus($candidate)){throw ('대상 창으로 전환하지 못했습니다: '+$matchingWindows[0].title)}
            $fg=[AgentInput]::GetForegroundWindow()
            if($fg -ne $candidate){throw '창이 다시 바뀌었습니다. windows 목록을 확인하세요.'}
        }
    }
    Check-App $fg
    return $fg
}
function Guard-Input([IntPtr]$fg){
    if($req.observedHandle -and $fg.ToInt64() -ne [long]$req.observedHandle){throw '화면 확인 이후 입력 대상 창이 바뀌었습니다. look으로 다시 확인하세요.'}
    if(Self-Window $fg){throw '대화창이 앞에 있습니다. 작업할 앱을 먼저 지정하세요.'}
    if(Blocked-Window $fg){ throw ('앞에 있는 창이 다른 AI 앱('+(Window-Info $fg).process+')이라 조작하지 않았습니다. focus로 작업할 앱을 먼저 앞으로 가져오세요.') }
    $want=[string]$req.expect
    if($want -and (Window-Info $fg).process -ne $want){ throw ('작업 대상('+$want+') 창이 앞에 없습니다. 지금 앞 창: '+(Window-Info $fg).title) }
}
$script:hidSelf=$false
$keyNames=@{
    'ctrl'=0x11;'control'=0x11;'shift'=0x10;'alt'=0x12;'win'=0x5B;'windows'=0x5B;
    'enter'=0x0D;'return'=0x0D;'esc'=0x1B;'escape'=0x1B;'tab'=0x09;'space'=0x20;'backspace'=0x08;'delete'=0x2E;'del'=0x2E;
    'up'=0x26;'down'=0x28;'left'=0x25;'right'=0x27;'home'=0x24;'end'=0x23;'pageup'=0x21;'pagedown'=0x22;'insert'=0x2D;
    'f1'=0x70;'f2'=0x71;'f3'=0x72;'f4'=0x73;'f5'=0x74;'f6'=0x75;'f7'=0x76;'f8'=0x77;'f9'=0x78;'f10'=0x79;'f11'=0x7A;'f12'=0x7B
}
function Parse-Chord([string]$text){
    $codes=New-Object System.Collections.Generic.List[uint16]
    foreach($part in ($text.ToLowerInvariant() -split '\+')){
        $p=$part.Trim()
        if($keyNames.ContainsKey($p)){$codes.Add([uint16]$keyNames[$p])}
        elseif($p -match '^[a-z0-9]$'){$codes.Add([uint16][char]$p.ToUpperInvariant())}
        else{throw "알 수 없는 키: $p"}
    }
    if($codes.Count -eq 0){throw '키가 비어 있습니다.'}
    ,$codes.ToArray()
}
# key에 단축키가 아닌 글자("1234*56=", "*")가 오면 글자 입력으로 처리합니다(2026-11-20 계산기: "알 수 없는 키"로 10번 실패).
# 조합 키 이름(ctrl·alt·shift·win)이 들어 있거나 이미 단축키로 해석되는 값은 그대로 단축키입니다.
function Plain-KeyText([string]$text){
    if(!$text -or $text.Length -gt 200 -or $text -match '[\r\n]'){return $null}
    if($text -match '(?i)\b(ctrl|control|alt|shift|win|windows)\b'){return $null}
    try{[void](Parse-Chord $text);return $null}catch{return $text}
}
# 위험한 단축키는 막습니다(창 강제 종료·로그아웃·잠금).
function Guard-Chord([string]$text){
    $codes=@(Parse-Chord $text | ForEach-Object {$_} | Sort-Object -Unique)
    $signature=$codes -join ','
    if($signature -in '18,115','17,18,46','76,91','16,17,27'){throw "보안상 이 단축키는 사용할 수 없습니다: $text"}
}

# Windows 내장 OCR(설치된 언어, 한국어 우선)로 비트맵의 글자 줄과 중심 좌표를 읽습니다.
function Read-ScreenText([Drawing.Bitmap]$bitmap){
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
    $null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
    $null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
    $asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
    $await={param($op,[Type]$t) $task=$asTask.MakeGenericMethod($t).Invoke($null,@($op)); if(!$task.Wait(8000)){throw 'OCR 시간 초과'}; $task.Result}
    $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ko'))
    if(!$engine){$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()}
    if(!$engine){throw 'Windows OCR 엔진을 만들지 못했습니다(설정 > 시간 및 언어 > 언어에서 한국어 언어 팩의 광학 문자 인식 설치 필요).'}
    # 작은 글자는 잘못 읽으므로 가능한 만큼 키워서 읽습니다(최대 2.5배, OCR 엔진 한도 안에서).
    $limit=[int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    $zoom=[Math]::Min(2.5,[Math]::Min($limit/[double]$bitmap.Width,$limit/[double]$bitmap.Height))
    if($zoom -lt 0.2){return @()}
    $big=New-Object Drawing.Bitmap ([int]($bitmap.Width*$zoom)),([int]($bitmap.Height*$zoom))
    $bg=[Drawing.Graphics]::FromImage($big)
    $bg.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $bg.DrawImage($bitmap,0,0,$big.Width,$big.Height); $bg.Dispose()
    $ms=New-Object IO.MemoryStream
    $big.Save($ms,[Drawing.Imaging.ImageFormat]::Png); $big.Dispose(); [void]$ms.Seek(0,'Begin')
    $stream=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $decoder=& $await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $soft=& $await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result=& $await ($engine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
    $ms.Dispose()
    $out=New-Object System.Collections.ArrayList
    foreach($line in $result.Lines){
        # 한 줄 안에서도 멀리 떨어진 낱말(탭 이름, 버튼)은 서로 다른 항목으로 나눕니다.
        $group=New-Object System.Collections.ArrayList; $prev=$null
        $flush={
            if($group.Count){
                $l=($group | ForEach-Object {$_.BoundingRect.X} | Measure-Object -Minimum).Minimum
                $t=($group | ForEach-Object {$_.BoundingRect.Y} | Measure-Object -Minimum).Minimum
                $r=($group | ForEach-Object {$_.BoundingRect.X+$_.BoundingRect.Width} | Measure-Object -Maximum).Maximum
                $b2=($group | ForEach-Object {$_.BoundingRect.Y+$_.BoundingRect.Height} | Measure-Object -Maximum).Maximum
                # 한국어 OCR은 글자마다 띄어 읽는 경우가 있어 한글 사이 공백은 붙입니다.
                $text=((($group | ForEach-Object {$_.Text}) -join ' ') -replace '(?<=[가-힣]) (?=[가-힣])','').Trim()
                if($text -match '[가-힣A-Za-z0-9]{2,}'){[void]$out.Add([pscustomobject]@{text=$text;x=[int]((($l+$r)/2)/$zoom);y=[int]((($t+$b2)/2)/$zoom);top=[int]($t/$zoom)})}
                $group.Clear()
            }
        }
        foreach($word in $line.Words){
            $rect=$word.BoundingRect
            if($prev -and ($rect.X-($prev.X+$prev.Width)) -gt [Math]::Max($rect.Height,$prev.Height)*1.3){& $flush}
            [void]$group.Add($word); $prev=$rect
        }
        & $flush
    }
    ,$out.ToArray()
}
function Invoke-Request{
switch($req.action){
  'look' {
    $fg=Target-Window
    $observedWindow=Window-Info $fg
    $screen=[Windows.Forms.Screen]::FromHandle($fg)
    $b=$screen.Bounds
    if($req.selectedHandle){
      $windowBounds=[Drawing.Rectangle]::FromLTRB($observedWindow.rect[0],$observedWindow.rect[1],$observedWindow.rect[2],$observedWindow.rect[3])
      $b=[Drawing.Rectangle]::Intersect($b,$windowBounds)
      if($b.IsEmpty -or $b.Width -lt 1 -or $b.Height -lt 1){throw '선택한 창이 화면 밖에 있습니다.'}
    }
    $bmp=New-Object Drawing.Bitmap $b.Width,$b.Height
    $g=[Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size)
    $g.Dispose()
    $max=[int]$(if($req.maxWidth){$req.maxWidth}else{1280})
    $scale=[Math]::Min(1.0,$max/[double]$b.Width)
    $w=[int]($b.Width*$scale); $h=[int]($b.Height*$scale)
    $small=New-Object Drawing.Bitmap $w,$h
    $g=[Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($bmp,0,0,$w,$h)
    # 앞 창의 클릭 가능한 요소에 번호를 붙입니다(UI Automation).
    $elements=New-Object System.Collections.ArrayList
    $texts=New-Object System.Collections.ArrayList
    $editorValues=New-Object System.Collections.ArrayList
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $blocked=(Blocked-Window $fg) -or (Self-Window $fg)
    if(!(Self-Window $fg) -and !$blocked){
      try{
        $root=[Windows.Automation.AutomationElement]::FromHandle($fg)
        if((Window-Info $fg).process -eq 'mspaint'){
          $imageId=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'image')
          $surface=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$imageId)
          if($surface -and !$surface.Current.IsOffscreen){
            $rect=$surface.Current.BoundingRectangle
            if(!$rect.IsEmpty -and $rect.Width -gt 1 -and $rect.Height -gt 1){
              $canvas=@{left=[int]$rect.Left;top=[int]$rect.Top;width=[int]$rect.Width;height=[int]$rect.Height}
            }
          }
        }
        $types=@('Button','Edit','Hyperlink','ListItem','MenuItem','TabItem','CheckBox','RadioButton','ComboBox','TreeItem','Document','SplitButton','DataItem','Pane')
        $conds=foreach($t in $types){New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::$t)}
        $cond=New-Object Windows.Automation.OrCondition(,[Windows.Automation.Condition[]]$conds)
        $found=$root.FindAll([Windows.Automation.TreeScope]::Descendants,$cond)
        # 화면에 보이는 글자(계산 결과, 상태 문구 등)도 함께 읽습니다.
        try{
          $tcond=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Text)
          foreach($t in $root.FindAll([Windows.Automation.TreeScope]::Descendants,$tcond)){
            if($texts.Count -ge 25 -or $watch.ElapsedMilliseconds -gt 4000){break}
            try{$tc=$t.Current; if(!$tc.IsOffscreen -and $tc.Name){$n=$tc.Name; if($n.Length -gt 80){$n=$n.Substring(0,80)}; [void]$texts.Add($n)}}catch{}
          }
        }catch{}
        # 같은 자리(4px 안)에 겹친 껍데기 요소(목록 항목 안의 버튼 등)는 한 번만 넣어 상한을 아낍니다.
        $seenCenters=@{}
        foreach($el in $found){
          if($elements.Count -ge 110 -or $watch.ElapsedMilliseconds -gt 6000){break}
          try{
            $c=$el.Current
            if($c.IsOffscreen -or !$c.IsEnabled){continue}
            $r=$c.BoundingRectangle
            if($r.IsEmpty -or $r.Width -lt 6 -or $r.Height -lt 6){continue}
            $cx=[int]($r.X+$r.Width/2); $cy=[int]($r.Y+$r.Height/2)
            if($cx -lt $b.Left -or $cy -lt $b.Top -or $cx -ge $b.Right -or $cy -ge $b.Bottom){continue}
            $label=$c.Name; if(!$label){$label=$c.HelpText}
            $typeName=$c.ControlType.ProgrammaticName -replace '^ControlType\.',''
            if($typeName -in 'Document','Edit' -and !$c.IsPassword -and $texts.Count -lt 30){
                try{
                    $pattern=$null
                    if($el.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){
                        $raw=$pattern.DocumentRange.GetText(12001)
                        if($raw.Length -le 12000 -and $raw.Length -gt 0){[void]$editorValues.Add($raw)}
                        $visible=$pattern.GetVisibleRanges() | Select-Object -First 1
                        if($visible){$value=$visible.GetText(200);if($value){[void]$texts.Add($value)}}
                    }
                }catch{}
            }
            if($typeName -eq 'Pane'){
                if($c.ClassName -match '(?i)(^|\.)edit(\.|$)'){$typeName='Edit'}
                elseif($c.ClassName -match '(?i)(^|\.)button(\.|$)'){$typeName='Button'}
                elseif($c.ClassName -match '(?i)(^|\.)static(\.|$)'){
                    if($label -and $texts.Count -lt 30){[void]$texts.Add($label.Substring(0,[Math]::Min(200,$label.Length)))}
                    continue
                }
                else{continue}
            }
            if(!$label -and $typeName -notin 'Edit','Document'){continue}
            $centerKey=[string][int][Math]::Floor($cx/4)+','+[int][Math]::Floor($cy/4)
            if($seenCenters.ContainsKey($centerKey)){continue}
            $seenCenters[$centerKey]=$true
            $id=$elements.Count+1
            [void]$elements.Add(@{id=$id;name=$label;type=$typeName;x=$cx;y=$cy;ix=[int](($cx-$b.Left)*$scale);iy=[int](($cy-$b.Top)*$scale)})
          }catch{}
        }
      }catch{}
    }
    # 앱 구성 읽기(OCR): 카카오톡처럼 UI Automation으로 버튼 이름이 거의 안 잡히는 앱은 화면 글자를 읽어
    # 글자 줄마다 위치를 가진 요소(type=OcrText)로 추가합니다. 모델이 그림만 보고 좌표를 짐작하지 않게 합니다.
    # 이름 있는 요소가 조금(12개 미만)만 잡히는 앱은 껍데기만 보이는 경우가 많아 글자도 읽습니다.
    $ocrError=''
    $named=@($elements | Where-Object {$_.name -and $_.name -notmatch '광고'}).Count
    if($named -lt 12 -and $req.ocr -ne $false){
      try{
        $ocrLines=Read-ScreenText $bmp
        foreach($l in $ocrLines){
          if($elements.Count -ge 130){break}
          $cx=[int]($b.Left+$l.x); $cy=[int]($b.Top+$l.y)
          $label=[string]$l.text; if($label.Length -gt 40){$label=$label.Substring(0,40)}
          [void]$elements.Add(@{id=$elements.Count+1;name=$label;type='OcrText';x=$cx;y=$cy;ix=[int](($cx-$b.Left)*$scale);iy=[int](($cy-$b.Top)*$scale);itop=[int]($l.top*$scale)})
        }
      }catch{ $ocrError=[string]$_.Exception.Message }
    }
    $bmp.Dispose()
    # Normalized-coordinate grounding must see the app pixels without the
    # planner's pixel grid or element labels, which use a different scale.
    $g.Flush()
    $cleanStream=New-Object IO.MemoryStream
    try{
      $small.Save($cleanStream,[Drawing.Imaging.ImageFormat]::Jpeg)
      $cleanImage=[Convert]::ToBase64String($cleanStream.ToArray())
    }finally{$cleanStream.Dispose()}
    # 1단계: 좌표 격자 (번호표가 없는 곳도 정확히 누를 수 있게, 캡처 이미지 좌표를 100px마다 표시)
    if($req.grid -ne $false){
      $gpen=New-Object Drawing.Pen([Drawing.Color]::FromArgb(50,0,170,255),1)
      $gfont=New-Object Drawing.Font('Arial',9,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
      $gbg=New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(150,0,60,120))
      for($gx=100;$gx -lt $w;$gx+=100){ $g.DrawLine($gpen,$gx,0,$gx,$h); $g.FillRectangle($gbg,$gx+1,0,24,11); $g.DrawString([string]$gx,$gfont,[Drawing.Brushes]::White,$gx+1,0) }
      for($gy=100;$gy -lt $h;$gy+=100){ $g.DrawLine($gpen,0,$gy,$w,$gy); $g.FillRectangle($gbg,0,$gy+1,24,11); $g.DrawString([string]$gy,$gfont,[Drawing.Brushes]::White,0,$gy+1) }
      $gpen.Dispose();$gfont.Dispose();$gbg.Dispose()
    }
    $font=New-Object Drawing.Font('Arial',11,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
    $pen=New-Object Drawing.Pen([Drawing.Color]::FromArgb(230,255,40,40),2)
    $bg=New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(220,200,0,0))
    foreach($e in $elements){
      $txt=[string]$e.id
      $sz=$g.MeasureString($txt,$font)
      # 글자에서 읽은 항목은 글자를 가리지 않게 번호만 글자 바로 위에 붙입니다.
      if($e.type -eq 'OcrText'){ $ty=[Math]::Max(0,$e.itop-$sz.Height+2); $g.FillRectangle($bg,$e.ix-$sz.Width/2,$ty,$sz.Width,$sz.Height); $g.DrawString($txt,$font,[Drawing.Brushes]::White,$e.ix-$sz.Width/2,$ty); continue }
      $g.DrawEllipse($pen,$e.ix-4,$e.iy-4,8,8)
      $g.FillRectangle($bg,$e.ix+5,$e.iy-7,$sz.Width,$sz.Height)
      $g.DrawString($txt,$font,[Drawing.Brushes]::White,$e.ix+5,$e.iy-7)
    }
    $g.Dispose()
    $ms=New-Object IO.MemoryStream
    $codec=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.MimeType -eq 'image/jpeg'}
    $ep=New-Object Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0]=New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality,[long]80)
    $small.Save($ms,$codec,$ep)
    $small.Dispose()
    $list=@($elements | ForEach-Object {@{id=$_.id;name=$_.name;type=$_.type;x=$_.x;y=$_.y}})
    # UIA/OCR may take seconds. Do not attach newer window geometry to older
    # pixels, or let a changed foreground/PID make a stale frame actionable.
    $focusState=try{Text-FocusState}catch{@{available=$false;reason='focus_metadata_unavailable'}}
    Assert-ObservationCurrent $observedWindow (Window-Info $fg) ([AgentInput]::GetForegroundWindow().ToInt64())
    @{ocrError=$ocrError;focus=$focusState;editorValues=@($editorValues);canvas=$canvas;blocked=$blocked;texts=@($texts);hidSelf=$script:hidSelf;window=$observedWindow;left=$b.Left;top=$b.Top;width=$b.Width;height=$b.Height;scale=$scale;imageWidth=$w;imageHeight=$h;elements=$list;cleanImage=$cleanImage;image=[Convert]::ToBase64String($ms.ToArray())} | ConvertTo-Json -Compress -Depth 5
  }
  'drag' {
    $fg=Target-Window
    Guard-Input $fg
    $frame=$req.frameWindow
    if(!$frame -or $fg.ToInt64() -ne $frame.handle -or (Self-Window $fg)){throw '드래그할 창을 다시 확인하세요.'}
    if($req.selectedHandle -and !(In-Selection $fg)){throw '선택한 창이 바뀌었습니다.'}
    $rect=New-Object AgentInput+RECT
    if($frame.rect.Count -ne 4){throw '창의 범위가 없습니다. 화면을 다시 확인하세요.'}
    $rect.Left=$frame.rect[0];$rect.Top=$frame.rect[1];$rect.Right=$frame.rect[2];$rect.Bottom=$frame.rect[3]
    $points=@(foreach($p in $req.points){[Drawing.Point]::new([int]$p.x,[int]$p.y)})
    [AgentInput]::Stroke($fg,[uint32]$frame.pid,$rect,[Drawing.Point[]]$points)
    @{ok=$true;points=$points.Count;window=(Window-Info $fg)} | ConvertTo-Json -Depth 4 -Compress
  }
  'click' {
    Guard-Input (Target-Window)
    $x=[int]$req.x; $y=[int]$req.y
    $vs=[Windows.Forms.SystemInformation]::VirtualScreen
    if($x -lt $vs.Left -or $y -lt $vs.Top -or $x -ge $vs.Right -or $y -ge $vs.Bottom){throw '화면 밖 좌표입니다.'}
    # 사람이 움직이는 것처럼 마우스를 부드럽게 이동시켜 사용자가 따라볼 수 있게 합니다.
    $from=[Windows.Forms.Cursor]::Position
    # 커서 이동은 보이되 짧게(예전 15단계·270ms + 120ms → 8단계·96ms + 60ms)
    for($k=1;$k -le 8;$k++){
      $t=$k/8.0; $e=1-[Math]::Pow(1-$t,3)
      [void][AgentInput]::SetCursorPos([int]($from.X+($x-$from.X)*$e),[int]($from.Y+($y-$from.Y)*$e))
      Start-Sleep -Milliseconds 12
    }
    [void][AgentInput]::SetCursorPos($x,$y)
    Start-Sleep -Milliseconds 60
    Check-Point $x $y
    if($req.observedRect -and ((Window-Info ([IntPtr]([long]$req.observedHandle))).rect -join ',') -ne ($req.observedRect -join ',')){throw '화면 확인 이후 창 위치나 크기가 바뀌었습니다. look으로 다시 확인하세요.'}
    if(($req.elementName -or $req.elementType) -and $req.elementType -ne 'OcrText'){
      $hit=[Windows.Automation.AutomationElement]::FromPoint([Windows.Point]::new($x,$y))
      $match=$false
      for($i=0;$hit -and $i -lt 5;$i++){
        if(Element-Matches $hit){$match=$true;break}
        $hit=[Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($hit)
      }
      # WinUI 3 앱(새 그림판 등)은 FromPoint가 버튼 대신 "DesktopChildSiteBridge" 껍데기만 돌려주고,
      # 마우스를 올리면 뜨는 도움말 창이 좌표를 가리기도 합니다. 그럴 때는 대상 창 안에서 같은 이름·종류의
      # 요소를 찾아 그 영역이 클릭 좌표를 실제로 덮는지 확인합니다(2026-11-20 그림판 클릭이 매번 이 검사에서 거절됨).
      if(!$match -and $req.elementName){$match=Named-ElementCovers $x $y}
      if(!$match){throw '현재 좌표의 요소가 관찰한 대상과 다릅니다. 화면을 다시 확인하세요.'}
    }
    $clicks=$(if($req.double){2}else{1})
    if($req.button -eq 'right'){[AgentInput]::Mouse(0x0008,0x0010,1)}else{[AgentInput]::Mouse(0x0002,0x0004,$clicks)}
    Start-Sleep -Milliseconds 250
    @{ok=$true;x=$x;y=$y;window=(Window-Info ([AgentInput]::GetForegroundWindow()))} | ConvertTo-Json -Compress
  }
  'type' {
    $fg=Target-Window
    Guard-Input $fg
    # 비밀번호는 명령줄이 아니라 환경 변수로 받습니다(결과에도 글자 수만 남김).
    if($req.secretText){Guard-PasswordFocus $fg}
    if(!$req.secretText){Hover-ForShortcuts $fg}
    $typeText=if($req.secretText){[string]$env:GEMMA_SECRET_TYPE}else{[string]$req.text}
    # 입력 칸에 커서가 없는데 글자를 치면 목록이나 버튼이 받아서 엉뚱한 항목(다른 채팅방 등)이 열립니다.
    # 창에 입력 칸이 있는데 키보드 포커스가 창·목록·버튼에 있으면 치지 않고, 칸을 먼저 클릭하라고 알려 줍니다.
    if(!$req.secretText -and $req.requireInputFocus -ne $false){
      $blockType=$false
      try{
        $focused=[Windows.Automation.AutomationElement]::FocusedElement
        $ftype=if($focused){$focused.Current.ControlType.ProgrammaticName -replace '^ControlType.',''}else{'Window'}
        $fclass=if($focused){[string]$focused.Current.ClassName}else{''}
        if($ftype -in 'Window','Pane','List','ListItem','Button','Tab','TabItem','Hyperlink','Image','MenuItem','TitleBar' -and $fclass -notmatch '(?i)edit|text|input|scintilla'){
          $rootElement=[Windows.Automation.AutomationElement]::FromHandle($fg)
          $inputs=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Edit)
          if($rootElement.FindFirst([Windows.Automation.TreeScope]::Descendants,$inputs)){$blockType=$true}
        }
      }catch{}
      if($blockType){throw '입력 칸에 커서가 없어서 글자를 치지 않았습니다. 글자를 넣을 칸(검색창이나 메시지 입력칸)을 먼저 클릭한 뒤 다시 type을 쓰세요.'}
    }
    $typingFocus=[Windows.Automation.AutomationElement]::FocusedElement
    $typingFocusId=if($typingFocus){$typingFocus.GetRuntimeId() -join ','}else{''}
    if($req.replace -eq $true -and $req.secretText){throw '비밀번호에는 일반 입력칸 전체 교체를 사용할 수 없습니다.'}
    $replacementTarget=@{window=$fg.ToInt64();pid=(Window-Info $fg).pid;id=$typingFocusId}
    [AgentInput]::ValidateTextTarget=[Action]{
      if($req.replace -eq $true){Assert-TextReplacementTarget $replacementTarget (Text-FocusState)}
      if($req.secretText){Guard-PasswordFocus $fg}
      if($typingFocusId){
        $nowFocus=[Windows.Automation.AutomationElement]::FocusedElement
        if(!$nowFocus -or ($nowFocus.GetRuntimeId() -join ',') -ne $typingFocusId){throw '입력 칸이 바뀌어 입력을 멈췄습니다. 새 대상을 확인하세요.'}
      }
    }
    try{
      if($req.replace -eq $true){[AgentInput]::ReplaceText($typeText,$fg)}
      else{[AgentInput]::LiteralText($typeText,$fg,[bool]$req.secretText)}
    }catch{
      # The host reads the first stderr line. Write the actual target/capability
      # reason before PowerShell wraps it in a truncated method-call exception.
      $failure=$_.Exception
      while($failure.InnerException){$failure=$failure.InnerException}
      [Console]::Error.WriteLine($failure.Message)
      throw
    }finally{[AgentInput]::ValidateTextTarget=$null}
    @{ok=$true;typed=$typeText.Length;window=(Window-Info $fg)} | ConvertTo-Json -Compress
  }
  'key' {
    $plain=Plain-KeyText ([string]$req.keys)
    if($plain -and !$req.requirePasswordFocus){
      $fg=Target-Window
      Guard-Input $fg
      Hover-ForShortcuts $fg
      [AgentInput]::LiteralText($plain,$fg,$false)
      Start-Sleep -Milliseconds 150
      @{ok=$true;typed=$plain.Length;asText=$true;window=(Window-Info ([AgentInput]::GetForegroundWindow()))} | ConvertTo-Json -Compress
      break
    }
    Guard-Chord $req.keys
    $fg=Target-Window
    Guard-Input $fg
    Hover-ForShortcuts $fg
    if($req.requirePasswordFocus){Guard-PasswordFocus $fg}
    [AgentInput]::Chord((Parse-Chord $req.keys))
    Start-Sleep -Milliseconds 200
    @{ok=$true;keys=$req.keys;window=(Window-Info ([AgentInput]::GetForegroundWindow()))} | ConvertTo-Json -Compress
  }
  'scroll' {
    if($req.x -ne $null -and $req.y -ne $null){[void][AgentInput]::SetCursorPos([int]$req.x,[int]$req.y)}
    $amount=[int]$(if($req.amount){$req.amount}else{5})
    $dir=[string]$req.direction
    $scrollTarget=Target-Window
    Guard-Input $scrollTarget
    # 위치를 주지 않았고 마우스가 대상 창 밖에 있으면 대상 창 가운데로 옮겨서 스크롤합니다.
    if($req.x -eq $null -or $req.y -eq $null){
      $cursor=[Windows.Forms.Cursor]::Position
      $under=[AgentInput]::GetAncestor([AgentInput]::WindowFromPoint([Drawing.Point]::new($cursor.X,$cursor.Y)),2)
      if($under -ne $scrollTarget){$sr=(Window-Info $scrollTarget).rect; [void][AgentInput]::SetCursorPos([int](($sr[0]+$sr[2])/2),[int](($sr[1]+$sr[3])/2)); Start-Sleep -Milliseconds 80}
    }
    $point=[Windows.Forms.Cursor]::Position;Check-Point $point.X $point.Y
    $delta=120*$amount
    if($dir -eq 'down' -or $dir -eq 'left'){$delta=-$delta}
    [AgentInput]::Wheel($delta,($dir -in 'left','right'))
    @{ok=$true} | ConvertTo-Json -Compress
  }
  'windows' {
    $list=foreach($h in [AgentInput]::TopWindows()){
      $info=Window-Info $h
      if($info.process -in 'TextInputHost','ShellExperienceHost','SearchHost','StartMenuExperienceHost'){continue}
      if($info.title -in 'Program Manager','Windows 입력 환경','Microsoft Text Input Application'){continue}
      # WinUI 3 앱은 보이지 않는 도움말·팝업 호스트 창("팝업 호스트")을 수십 개 띄워 둡니다. 목록과 창 고르기에서 뺍니다.
      if($info.class -ceq 'Microsoft.UI.Content.PopupWindowSiteBridge'){continue}
      $info
    }
    @{foreground=(Window-Info ([AgentInput]::GetForegroundWindow()));windows=@($list | Select-Object -First 40)} | ConvertTo-Json -Compress -Depth 4
  }
  'focus' {
    if($req.selectedHandle){$fg=Target-Window;@{ok=$true;window=(Window-Info $fg)} | ConvertTo-Json -Compress;break}
    $q=([string]$req.text).Trim()
    if(!$q){throw '전환할 창 제목이나 핸들을 지정하세요.'}
    $cands=@(foreach($h in [AgentInput]::TopWindows()){
      $i=Window-Info $h
      if((Self-Window $h) -or (Blocked-Window $h)){continue}
      if($i.class -ceq 'Microsoft.UI.Content.PopupWindowSiteBridge' -and $q -ne ('HWND:'+$i.handle)){continue}
      if($q -eq ('HWND:'+$i.handle) -or $i.title.IndexOf($q,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $i.process.IndexOf($q,[StringComparison]::OrdinalIgnoreCase) -ge 0){$i}
    })
    $exact=@($cands | Where-Object {$_.title -eq $q -or $q -eq ('HWND:'+$_.handle)})
    if($exact.Count){$cands=$exact}
    if($cands.Count -eq 0){throw "'$q' 창을 찾지 못했습니다. windows 도구로 창 목록을 확인하세요."}
    if($cands.Count -gt 1){
      $choices=($cands | Select-Object -First 8 | ForEach-Object {$_.title+' (HWND:'+$_.handle+')'}) -join ', '
      throw ("여러 창이 일치합니다. 정확한 제목이나 HWND:번호로 선택하세요. "+$choices)
    }
    $t=$cands[0]
    Check-App ([IntPtr]$t.handle)
    $ok=[AgentInput]::Focus([IntPtr]$t.handle)
    if(!$ok){Start-Sleep -Milliseconds 300; $ok=[AgentInput]::Focus([IntPtr]$t.handle)}
    if(!$ok){throw ("창 전환에 실패했습니다: "+$t.title)}
    @{ok=$true;window=$t;others=@($cands | Select-Object -Skip 1 -First 5 | ForEach-Object {$_.title})} | ConvertTo-Json -Compress -Depth 4
  }
  'restore' {
    $done=$false
    foreach($h in [AgentInput]::TopWindows()){ if((Self-Window $h) -and [AgentInput]::Title($h) -eq '로컬 Gemma'){ if([AgentInput]::IsIconic($h)){[void][AgentInput]::ShowWindow($h,9)}; [void][AgentInput]::Focus($h);$done=$true} }
    @{ok=$done} | ConvertTo-Json -Compress
  }
  default { throw "지원하지 않는 동작: $($req.action)" }
}
}
if($Daemon){
    # 입력이 닫히면(에이전트 프로세스 종료) 루프가 끝나고 이 프로세스도 끝납니다.
    while($null -ne ($line=[Console]::In.ReadLine())){
        if(!$line.Trim()){continue}
        try{
            Set-Request $line.Trim()
            Reset-RequestState
            $text=(@(Invoke-Request) | ForEach-Object {[string]$_}) -join "`n"
            [Console]::Out.WriteLine('@daemonResult '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
        }catch{
            [Console]::Out.WriteLine('@daemonError '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.Exception.Message)))
        }finally{
            [AgentInput]::ValidateTextTarget=$null
            [Console]::Out.Flush()
        }
    }
}else{
    Set-Request $Payload
    Reset-RequestState
    Invoke-Request
}
