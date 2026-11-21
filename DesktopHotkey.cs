using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;

// 4단계: Esc로 중지 — 작업 중에는 어느 창이 앞에 있어도 진짜 키보드의 Esc를 누르면 멈춥니다.
// AI가 보내는 Esc(가짜 입력, LLKHF_INJECTED)는 무시해서, AI가 Esc를 눌러도 작업이 끊기지 않습니다.
partial class DesktopChat {
    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError=true)] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string lpModuleName);
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    const int WH_KEYBOARD_LL=13, WM_KEYDOWN=0x0100, VK_ESCAPE=0x1B; const uint LLKHF_INJECTED=0x10;
    IntPtr escHook=IntPtr.Zero;
    LowLevelKeyboardProc escProc; // 가비지 컬렉션 방지용으로 붙잡아 둠
    bool voiceInputConfirmed;
    void BeginVoiceInput(Func<bool> confirm,Func<bool> focusComposer,Action start){
        if(!voiceInputConfirmed && !confirm())return;
        voiceInputConfirmed=true;
        if(!focusComposer())return;
        try{start();}catch(Exception e){status.Text="Windows 음성 입력을 열지 못했어요. "+e.Message;}
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,InputEvent[] events,int size);
    [StructLayout(LayoutKind.Sequential)] struct KeyboardPacket {public ushort Key,Scan;public uint Flags,Time;public IntPtr Extra;}
    [StructLayout(LayoutKind.Sequential)] struct MousePacket {public int X,Y;public uint Data,Flags,Time;public IntPtr Extra;}
    [StructLayout(LayoutKind.Explicit)] struct InputPayload {
        [FieldOffset(0)] public MousePacket Mouse;
        [FieldOffset(0)] public KeyboardPacket Keyboard;
    }
    [StructLayout(LayoutKind.Sequential)] struct InputEvent {public uint Type;public InputPayload Payload;}
    static InputEvent VoiceKey(ushort key,bool up){
        return new InputEvent{Type=1,Payload=new InputPayload{Keyboard=new KeyboardPacket{Key=key,Flags=(up?2u:0u)|(key==0x5B?1u:0u)}}};
    }
    void OpenWindowsVoiceInput(){
        var events=new[]{VoiceKey(0x5B,false),VoiceKey(0x48,false),VoiceKey(0x48,true),VoiceKey(0x5B,true)};
        IntPtr owner=new System.Windows.Interop.WindowInteropHelper(window).Handle;
        if(owner==IntPtr.Zero || GetForegroundWindow()!=owner || !input.IsKeyboardFocused)return;
        if(System.Windows.Input.Keyboard.Modifiers!=System.Windows.Input.ModifierKeys.None){status.Text="보조 키를 놓고 음성 입력을 다시 눌러 주세요.";return;}
        if(SendInput((uint)events.Length,events,Marshal.SizeOf(typeof(InputEvent)))!=events.Length)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    Window controlNotice;
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd,int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd,int index,int value);
    void ShowControlNotice(){
        if(controlNotice!=null || !busy || stopping)return;
        var blue=System.Windows.Media.Brushes.DodgerBlue;
        var panel=new System.Windows.Controls.Grid();
        panel.Children.Add(new System.Windows.Controls.Border{BorderBrush=blue,BorderThickness=new Thickness(3)});
        var label=new System.Windows.Controls.TextBlock{
            Text=escHook!=IntPtr.Zero?"젬마가 컴퓨터를 조작 중입니다   ·   Esc로 취소":"젬마가 컴퓨터를 조작 중입니다   ·   앱에서 작업 중지",
            Foreground=System.Windows.Media.Brushes.White,FontSize=14,FontWeight=FontWeights.SemiBold};
        panel.Children.Add(new System.Windows.Controls.Border{Child=label,Background=System.Windows.Media.Brushes.MidnightBlue,
            Padding=new Thickness(14,6,14,6),Margin=new Thickness(0,10,0,0),CornerRadius=new CornerRadius(6),
            HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Top});
        var notice=new Window{WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,AllowsTransparency=true,
            Background=System.Windows.Media.Brushes.Transparent,Topmost=true,ShowInTaskbar=false,ShowActivated=false,
            Focusable=false,IsHitTestVisible=false,Left=0,Top=0,Width=SystemParameters.PrimaryScreenWidth,
            Height=SystemParameters.PrimaryScreenHeight,Content=panel};
        notice.SourceInitialized+=(s,e)=>{
            IntPtr hwnd=new System.Windows.Interop.WindowInteropHelper(notice).Handle;
            const int extendedStyle=-20, transparent=0x20, noActivate=0x08000000, toolWindow=0x80;
            SetWindowLong(hwnd,extendedStyle,GetWindowLong(hwnd,extendedStyle)|transparent|noActivate|toolWindow);
        };
        controlNotice=notice;
        notice.Show();
    }
    void StartEscWatch(){
        if(escHook!=IntPtr.Zero)return;
        escProc=EscHookCallback;
        try{ using(var cur=Process.GetCurrentProcess()) using(var mod=cur.MainModule) escHook=SetWindowsHookEx(WH_KEYBOARD_LL,escProc,GetModuleHandle(mod.ModuleName),0); }catch{ escHook=IntPtr.Zero; }
    }
    void StopEscWatch(){
        if(controlNotice!=null){controlNotice.Close();controlNotice=null;}
        if(escHook==IntPtr.Zero)return;
        try{UnhookWindowsHookEx(escHook);}catch{}
        escHook=IntPtr.Zero;
    }
    IntPtr EscHookCallback(int nCode,IntPtr wParam,IntPtr lParam){
        try{
            if(nCode>=0 && wParam==(IntPtr)WM_KEYDOWN){
                var k=(KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam,typeof(KBDLLHOOKSTRUCT));
                if(k.vkCode==VK_ESCAPE && (k.flags&LLKHF_INJECTED)==0 && busy && !stopping){
                    window.Dispatcher.BeginInvoke(new Action(()=>{ if(busy&&!stopping&&(controlNotice!=null || !(window.IsActive&&composingText))){ Stop(); status.Text="Esc를 눌러 작업을 멈췄어요."; } }));
                }
            }
        }catch{}
        return CallNextHookEx(escHook,nCode,wParam,lParam);
    }
}
