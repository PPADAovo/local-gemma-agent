using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class ScreenEditor : Form {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    readonly string folder;
    readonly TextBox editor = new TextBox();
    readonly Button save = new Button();
    readonly Label status = new Label();
    readonly Label title = new Label();
    ScreenEditor(string folder) {
        this.folder = folder;
        Text = "화면 모드 검증 편집기";
        Bounds = Screen.PrimaryScreen.Bounds;
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        Font = new Font("Malgun Gothic",26);
        title.Text = "메모 편집기     /     문서 내용";
        editor.Multiline = true;
        editor.BackColor = Color.White;
        editor.Font = new Font("Malgun Gothic",32);
        save.Text = "파일 저장   Save";
        status.Text = "저장 전";
        Controls.AddRange(new Control[] { title, editor, save, status });
        title.SetBounds(Width/10,Height/12,Width*8/10,Height/10);
        editor.SetBounds(Width/10,Height/4,Width*8/10,Height/3);
        save.SetBounds(Width/4,Height*2/3,Width/2,Height/6);
        status.SetBounds(Width/4,Height*5/6,Width/2,Height/8);
        editor.MouseDown += (s,e)=>Log("editor mouse down");
        editor.TextChanged += (s,e)=>Log("text changed");
        save.MouseDown += (s,e)=>Log("save mouse down");
        save.Click += (s,e)=>{
            File.WriteAllText(Path.Combine(folder,"saved.txt"),editor.Text);
            status.Text="저장 완료  /  Saved";
            Log("saved");
        };
        var focusTimer = new Timer {Interval=150};
        focusTimer.Tick += (s,e)=>{
            if (GetForegroundWindow()==Handle) return;
            uint active = GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero);
            uint mine = GetCurrentThreadId();
            bool attached = active!=0 && active!=mine && AttachThreadInput(mine,active,true);
            try { Activate(); SetForegroundWindow(Handle); }
            finally { if(attached) AttachThreadInput(mine,active,false); }
        };
        Shown += (s,e)=>BeginInvoke(new Action(()=>{
            save.Focus();
            focusTimer.Start();
            File.WriteAllText(Path.Combine(folder,"handle"),Handle.ToInt64().ToString());
        }));
    }
    void Log(string entry) {File.AppendAllText(Path.Combine(folder,"events.txt"),entry+Environment.NewLine);}
    [STAThread] static void Main(string[] args) {
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.Run(new ScreenEditor(args[0]));
    }
}
