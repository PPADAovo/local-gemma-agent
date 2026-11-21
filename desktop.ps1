param([string]$Action, [int]$X, [int]$Y, [string]$Keys, [string]$ExpectedWindow,[switch]$WindowOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if (!('InputDevice' -as [type])) {
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class InputDevice {
  public struct Rect { public int left,top,right,bottom; }
  delegate bool EnumChild(System.IntPtr hwnd,System.IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(System.IntPtr h,EnumChild callback,System.IntPtr arg);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(System.IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h,out Rect rect);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(System.IntPtr h,System.Text.StringBuilder name,int size);
  public static Rect[] Boxes(System.IntPtr parent) {
    var boxes = new System.Collections.Generic.List<Rect>();
    EnumChildWindows(parent,delegate(System.IntPtr h,System.IntPtr arg) {
      Rect r;
      var name = new System.Text.StringBuilder(256);
      GetClassName(h,name,256);
      bool interactive = System.Text.RegularExpressions.Regex.IsMatch(name.ToString(),"button|edit|combobox|listbox|listview|treeview",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
      if(interactive && IsWindowVisible(h) && GetWindowRect(h,out r) && r.right-r.left>=30 && r.bottom-r.top>=18) boxes.Add(r);
      return boxes.Count<60;
    },System.IntPtr.Zero);
    return boxes.ToArray();
  }
  [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk, scan; public uint flags, time; public System.UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public System.UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Keyboard key; [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union value; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n, Input[] input,int size);
  public static void TypeText(string text, System.IntPtr expected) {
    foreach(char c in text) {
      if (GetForegroundWindow()!=expected) throw new System.Exception("Foreground window changed");
      var seq=new Input[2];
      for(int i=0;i<2;i++){ seq[i].type=1; seq[i].value.key.scan=c; seq[i].value.key.flags=(uint)(4+2*i); }
      if(SendInput(2,seq,Marshal.SizeOf(typeof(Input)))!=2) throw new System.ComponentModel.Win32Exception();
    }
  }
  [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(System.Drawing.Point p);
  [DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,System.UIntPtr extra);
}
'@ -ReferencedAssemblies System.Drawing
}
[void][InputDevice]::SetProcessDPIAware()

$active = [InputDevice]::GetForegroundWindow().ToInt64().ToString()
$bounds = [Windows.Forms.Screen]::FromHandle([IntPtr]([long]$active)).Bounds
if ($Action -in 'click','keys','type' -and (!$ExpectedWindow -or $ExpectedWindow -ne $active)) { throw 'Active window changed. Capture a fresh screen.' }
if($WindowOnly){
    if(!$ExpectedWindow -or $ExpectedWindow -ne $active){throw 'Selected window lost focus'}
    $rect=New-Object InputDevice+Rect
    if(![InputDevice]::GetWindowRect([IntPtr]([long]$active),[ref]$rect)){throw 'Window is unavailable'}
    $bounds=[Drawing.Rectangle]::Intersect($bounds,[Drawing.Rectangle]::FromLTRB($rect.left,$rect.top,$rect.right,$rect.bottom))
    if($bounds.IsEmpty){throw 'Window is not visible'}
}
switch ($Action) {
  'screen' {
    $bmp = [Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size)
    $font = [Drawing.Font]::new('Arial',[Math]::Max(13,[int]($bounds.Height/75)),[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
    $background = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(185,15,30,60))
    $targets=@{}
    foreach ($box in [InputDevice]::Boxes([IntPtr]([long]$active))) {
        $cx=[int](($box.left+$box.right)/2)-$bounds.Left
        $cy=[int](($box.top+$box.bottom)/2)-$bounds.Top
        if ($cx -lt 0 -or $cy -lt 0 -or $cx -ge $bounds.Width -or $cy -ge $bounds.Height) {continue}
        $label = 'T'+($targets.Count+1)
        $targets[$label]=@($cx,$cy)
        $size=$graphics.MeasureString($label,$font)
        $graphics.FillEllipse([Drawing.Brushes]::DeepSkyBlue,$cx-3,$cy-3,6,6)
        $graphics.FillRectangle($background,$cx+4,$cy+2,$size.Width,$size.Height)
        $graphics.DrawString($label,$font,[Drawing.Brushes]::White,$cx+4,$cy+2)
    }
    $stream = [IO.MemoryStream]::new()
    $bmp.Save($stream,[Drawing.Imaging.ImageFormat]::Jpeg)
    if ([InputDevice]::GetForegroundWindow().ToInt64().ToString() -ne $active) { throw 'Active window changed during capture.' }
    @{window=$active;width=$bounds.Width;height=$bounds.Height;targets=$targets;image=[Convert]::ToBase64String($stream.ToArray())} | ConvertTo-Json -Compress
  }
  'click' {
    if ($X -lt 0 -or $X -ge $bounds.Width -or $Y -lt 0 -or $Y -ge $bounds.Height) { throw 'Outside primary display' }
    $point = [Drawing.Point]::new($bounds.Left+$X,$bounds.Top+$Y)
    if ([InputDevice]::GetAncestor([InputDevice]::WindowFromPoint($point),2).ToInt64().ToString() -ne $active) { throw 'Target is outside the observed foreground window.' }
    [Windows.Forms.Cursor]::Position = $point
    [InputDevice]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [InputDevice]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  }
  'keys' { [Windows.Forms.SendKeys]::SendWait($Keys) }
  'type' { [InputDevice]::TypeText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Keys)),[IntPtr]([long]$active)) }
}



