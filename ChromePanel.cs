using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

using System.Web.Script.Serialization;
using System.Collections.Generic;

sealed class ChromePanel : Panel {
    delegate bool WindowVisitor(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor visitor, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window,int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr window,int index,int value);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetParent(IntPtr child,IntPtr parent);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
    IntPtr chrome;
    IntPtr detached;
    int originalStyle;
    public bool RestorePanel(){
        if(chrome!=IntPtr.Zero && GetParent(chrome)==Handle)return true;
        if(detached==IntPtr.Zero)return false;

        int pid;
        GetWindowThreadProcessId(detached,out pid);
        if(pid!=detachedPid)return false;
        SetWindowLong(detached,Style,(originalStyle & ~unchecked((int)0x80CF0000)) | 0x40000000);
        SetParent(detached,Handle);
        if(GetParent(detached)!=Handle){SetWindowLong(detached,Style,originalStyle);return false;}
        chrome=detached;detached=IntPtr.Zero;Fit();return true;
    }
    int detachedPid;
    const int Style=-16;
    public void Detach(){
        if(chrome==IntPtr.Zero)return;
        var r=Screen.FromHandle(Handle).WorkingArea;
        SetParent(chrome,IntPtr.Zero);
        if(GetParent(chrome)==Handle)throw new InvalidOperationException("Chrome 창을 분리하지 못했습니다.");
        SetWindowLong(chrome,Style,originalStyle);
        SetWindowPos(chrome,IntPtr.Zero,r.Left+30,r.Top+30,Math.Min(1000,r.Width-60),Math.Min(800,r.Height-60),0x60);
        detached=chrome;GetWindowThreadProcessId(detached,out detachedPid);
        chrome=IntPtr.Zero;
    }
    void ClosePage(){
        if(chrome!=IntPtr.Zero && GetParent(chrome)==Handle)PostMessage(chrome,0x10,IntPtr.Zero,IntPtr.Zero);
        chrome=IntPtr.Zero;
    }
    protected override void Dispose(bool disposing){if(disposing)ClosePage();base.Dispose(disposing);}
    protected override void OnResize(EventArgs e){base.OnResize(e);Fit();}
        [StructLayout(LayoutKind.Sequential)]
    struct WindowRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out WindowRect rect);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string className,string title);
    readonly Timer layoutTimer=new Timer{Interval=200};
    public ChromePanel(){
        layoutTimer.Tick+=(s,e)=>Fit();
        VisibleChanged+=(s,e)=>layoutTimer.Enabled=Visible;
        Disposed+=(s,e)=>layoutTimer.Dispose();
    }
    void Fit(){
        if(chrome==IntPtr.Zero || !IsHandleCreated || GetParent(chrome)!=Handle)return;
        WindowRect frame,host,viewport;
        if(!GetWindowRect(chrome,out frame)||!GetWindowRect(Handle,out host))return;
        var renderer=FindWindowEx(chrome,IntPtr.Zero,"Chrome_RenderWidgetHostHWND",null);
        int inset=0;
        if(renderer!=IntPtr.Zero && GetWindowRect(renderer,out viewport) && viewport.Bottom>viewport.Top)
            inset=Math.Max(0,Math.Min(300,viewport.Top-frame.Top));
        int height=ClientSize.Height+inset;
        if(frame.Left==host.Left && frame.Top==host.Top-inset &&
           frame.Right-frame.Left==ClientSize.Width && frame.Bottom-frame.Top==height)return;
        SetWindowPos(chrome,IntPtr.Zero,0,-inset,ClientSize.Width,height,0x34);
    }
    public void NavigateCommand(int command){if(chrome!=IntPtr.Zero)PostMessage(chrome,0x0319,chrome,new IntPtr(command<<16));}
    public async Task Open(Uri url){
        string exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe");
        if(!File.Exists(exe))throw new FileNotFoundException("Chrome을 찾지 못했습니다.");
        string state=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","User Data","Local State");
        var json=new JavaScriptSerializer{MaxJsonLength=int.MaxValue};
        var data=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(state));
        var profiles=(Dictionary<string,object>)data["profile"];
        string profile=Convert.ToString(profiles["last_used"]);
        if(string.IsNullOrEmpty(profile)||profile.IndexOfAny(Path.GetInvalidFileNameChars())>=0||profile=="."||profile=="..")throw new InvalidDataException("Chrome 프로필을 확인할 수 없습니다.");
        string marker="Gemma-"+Guid.NewGuid().ToString("N");
        string file=Path.Combine(Path.GetTempPath(),marker+".html");
        File.WriteAllText(file,"<!doctype html><meta charset=utf-8><title>"+marker+"</title><meta http-equiv=refresh content=1>");
        IntPtr found=IntPtr.Zero;
        try{
            Process.Start(exe,"--profile-directory=\""+profile+"\" "+"--new-window "+"\""+new Uri(file).AbsoluteUri+"\"");
            for(int i=0;i<120 && found==IntPtr.Zero;i++){
                await Task.Delay(100);
                EnumWindows(delegate(IntPtr w,IntPtr unused){
                    var title=new StringBuilder(256);GetWindowText(w,title,title.Capacity);
                    if(!title.ToString().StartsWith(marker,StringComparison.Ordinal))return true;
                    int pid;GetWindowThreadProcessId(w,out pid);
                    using(var p=Process.GetProcessById(pid)){if(p.ProcessName!="chrome")return true;}
                    found=w;return false;
                },IntPtr.Zero);
            }
            if(found==IntPtr.Zero)throw new TimeoutException("Chrome 작업 창을 찾지 못했습니다.");
            ClosePage();
            originalStyle=GetWindowLong(found,Style);
            SetWindowLong(found,Style,(originalStyle & ~unchecked((int)0x80CF0000)) | 0x40000000);
            SetParent(found,Handle);
            if(GetParent(found)!=Handle){SetWindowLong(found,Style,originalStyle);PostMessage(found,0x10,IntPtr.Zero,IntPtr.Zero);throw new InvalidOperationException("Chrome 창을 패널에 연결하지 못했습니다.");}
            chrome=found;

            Fit();
            File.WriteAllText(file,"<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=\"0;url="+System.Net.WebUtility.HtmlEncode(url.AbsoluteUri)+"\">");
            for(int i=0;i<50;i++){
                await Task.Delay(100);
                var title=new StringBuilder(256);GetWindowText(found,title,title.Capacity);
                if(!title.ToString().Contains(marker))break;
            }
        }finally{try{File.Delete(file);}catch(IOException){}}
    }
}
