param([int]$targetPid,[long]$targetWindow=0)
$ErrorActionPreference="Stop"
$p=Get-Process -Id $targetPid
if (!('FocusWin' -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusWin {
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr w,int n);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
[DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr w);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool on);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
}
$h=[FocusWin]::GetForegroundWindow()
[uint32]$owner=0
$thread=[FocusWin]::GetWindowThreadProcessId($h,[ref]$owner)
$wanted=if($targetWindow){[IntPtr]$targetWindow}else{[FocusWin]::GetLastActivePopup($p.MainWindowHandle)}
if($targetWindow){[uint32]$targetOwner=0;[void][FocusWin]::GetWindowThreadProcessId($wanted,[ref]$targetOwner);if($targetOwner -ne $targetPid){throw '선택한 창이 바뀌었습니다.'}}
if([FocusWin]::IsIconic($wanted)){[void][FocusWin]::ShowWindowAsync($wanted,9);Start-Sleep -Milliseconds 150}
if ($owner -ne $targetPid -or ($targetWindow -and $h -ne $wanted)){
 $mine=[FocusWin]::GetCurrentThreadId()
 $linked=[FocusWin]::AttachThreadInput($mine,$thread,$true)
 try{[void][FocusWin]::SetForegroundWindow($wanted)} finally{if($linked){[void][FocusWin]::AttachThreadInput($mine,$thread,$false)}}
}
$h=[FocusWin]::GetForegroundWindow()
[void][FocusWin]::GetWindowThreadProcessId($h,[ref]$owner)
if($owner -ne $targetPid -or ($targetWindow -and $h -ne $wanted)){throw '대상 창에 포커스가 없습니다.'}
$h.ToInt64().ToString()



