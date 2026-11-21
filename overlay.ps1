# 5단계: 컴퓨터 제어 표시 (ChatGPT·Claude 에이전트처럼)
#  - 화면 위쪽 가운데: "● 로컬 Gemma가 이 컴퓨터를 제어하는 중 · (지금 하는 일) · Esc: 중지" 알림 (클릭 통과)
#  - 화면 가장자리: 보라→파랑으로 숨 쉬듯 빛나는 테두리 (클릭 통과)
#  - 오른쪽 아래: [■ 중지 (Esc)] 버튼 (누를 수 있음 → 에이전트 중지)
#  - 클릭 위치: 빨간 원
#  - 이 표시들은 화면 캡처에서 빠지게 설정(WDA_EXCLUDEFROMCAPTURE) → AI가 보는 화면을 가리지 않음
# 상태는 JSON 파일로 받습니다: {"text":"…","clickX":..,"clickY":..,"seq":..,"done":false}
param([Parameter(Mandatory)][string]$StatusFile,[int]$ParentPid=0,[string]$ErrorLog='')
$ErrorActionPreference='Stop'
trap { try{ [OverlayNative]::RestoreCursor() }catch{}; if($ErrorLog){ try{ ((Get-Date).ToString('s')+' '+$_.ToString()+' @ '+$_.InvocationInfo.PositionMessage) | Add-Content -LiteralPath $ErrorLog -Encoding UTF8 }catch{} }; exit 1 }
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -ReferencedAssemblies ([Windows.Forms.Form].Assembly.Location),([Drawing.Color].Assembly.Location) -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class OverlayNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadCursorFromFile(string path);
  [DllImport("user32.dll")] public static extern bool SetSystemCursor(IntPtr hcur, uint id);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint param, IntPtr vparam, uint winini);
  // 조작하는 동안 마우스 커서를 검은색으로 (Windows 기본 '검정' 커서 파일 사용)
  public static void BlackCursor(string file){
    foreach(uint id in new uint[]{32512,32649}){ IntPtr h=LoadCursorFromFile(file); if(h!=IntPtr.Zero) SetSystemCursor(h,id); }
  }
  // 원래 커서로 되돌리기 (사용자 커서 설정을 다시 불러옴)
  public static void RestoreCursor(){ SystemParametersInfo(0x57,0,IntPtr.Zero,0); }
}
// 포커스를 빼앗지 않고(NoActivate), 클릭이 통과하며(Transparent), 작업 표시줄에 안 보이는(ToolWindow) 창
public class OverlayForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x20 | 0x80000 | 0x80 | 0x8; return cp; } }
}
// 누를 수 있지만 포커스는 빼앗지 않는 창 (중지 버튼)
public class OverlayClickForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x80 | 0x8; return cp; } }
}
'@
[void][OverlayNative]::SetProcessDPIAware()

function Prep($f){
  $f.FormBorderStyle='None'; $f.ShowInTaskbar=$false; $f.TopMost=$true; $f.StartPosition='Manual'
  $f.Add_HandleCreated({ param($s,$e) try{ [void][OverlayNative]::SetWindowDisplayAffinity($s.Handle,0x11) }catch{} })
  return $f
}
$screen=[Windows.Forms.Screen]::PrimaryScreen
$sb=$screen.Bounds; $wa=$screen.WorkingArea
$purple=[Drawing.Color]::FromArgb(124,58,237); $blue=[Drawing.Color]::FromArgb(47,111,237)

# 화면 테두리 (위·아래·왼쪽·오른쪽 4개의 얇은 창)
$edge=6
$borders=@()
foreach($r in @(
  (New-Object Drawing.Rectangle($sb.Left,$sb.Top,$sb.Width,$edge)),
  (New-Object Drawing.Rectangle($sb.Left,($sb.Bottom-$edge),$sb.Width,$edge)),
  (New-Object Drawing.Rectangle($sb.Left,$sb.Top,$edge,$sb.Height)),
  (New-Object Drawing.Rectangle(($sb.Right-$edge),$sb.Top,$edge,$sb.Height)))){
  $f=Prep (New-Object OverlayForm)
  $f.Bounds=$r; $f.BackColor=$purple; $f.Opacity=0.85
  $borders+=$f
}

# 위쪽 알림: 바탕 없이 글자만 (보라→파랑 글자 + 흰 테두리로 어떤 화면에서도 읽힘)
$banner=Prep (New-Object OverlayForm)
$key=[Drawing.Color]::FromArgb(250,250,251)
$banner.BackColor=$key; $banner.TransparencyKey=$key
$bw=1000; $bh=40; $script:bw=$bw
$banner.Size=New-Object Drawing.Size($bw,$bh)
$banner.Location=New-Object Drawing.Point(($sb.Left+[int](($sb.Width-$bw)/2)),($sb.Top+$edge+4))
$script:bannerText='● 로컬 Gemma 작업 중   Esc: 중지'
$bannerFont=New-Object Drawing.FontFamily('Malgun Gothic')
$banner.Add_Paint({param($s,$e)
  $gr=$e.Graphics; $gr.SmoothingMode='AntiAlias'
  $p=New-Object Drawing.Drawing2D.GraphicsPath
  $fmt=New-Object Drawing.StringFormat; $fmt.Alignment='Center'; $fmt.LineAlignment='Center'
  $p.AddString($script:bannerText,$bannerFont,[int][Drawing.FontStyle]::Bold,19,(New-Object Drawing.RectangleF(0,0,$script:bw,$bh)),$fmt)
  $outline=New-Object Drawing.Pen([Drawing.Color]::White,4); $outline.LineJoin='Round'
  $gr.DrawPath($outline,$p)
  $br=New-Object Drawing.Drawing2D.LinearGradientBrush((New-Object Drawing.Rectangle(0,0,$script:bw,$bh)),$purple,$blue,0.0)
  $gr.FillPath($br,$p)
  $br.Dispose();$outline.Dispose();$p.Dispose()
})

# 오른쪽 아래 중지 버튼 (누르면 에이전트 프로세스를 멈춤)
$stop=Prep (New-Object OverlayClickForm)
$stop.Size=New-Object Drawing.Size(150,40)
$stop.Location=New-Object Drawing.Point(($wa.Right-170),($wa.Bottom-60))
$stop.BackColor=[Drawing.Color]::FromArgb(220,38,38)
$sp=New-Object Drawing.Drawing2D.GraphicsPath; $sp.AddArc(0,0,40,40,90,180); $sp.AddArc(110,0,40,40,270,180); $sp.CloseFigure()
$stop.Region=New-Object Drawing.Region($sp)
$btn=New-Object Windows.Forms.Label
$btn.Dock='Fill'; $btn.Text='■  중지 (Esc)'; $btn.ForeColor=[Drawing.Color]::White; $btn.TextAlign='MiddleCenter'; $btn.Cursor=[Windows.Forms.Cursors]::Hand
$btn.Font=New-Object Drawing.Font('Malgun Gothic',10,[Drawing.FontStyle]::Bold)
$btn.Add_Click({ if($ParentPid -gt 0){ try{ Stop-Process -Id $ParentPid -Force }catch{} }; [Windows.Forms.Application]::Exit() })
$stop.Controls.Add($btn)

# 클릭 표시(빨간 원)
$ring=Prep (New-Object OverlayForm)
$ring.Size=New-Object Drawing.Size(56,56); $ring.BackColor=[Drawing.Color]::Magenta; $ring.TransparencyKey=[Drawing.Color]::Magenta
$ring.Add_Paint({param($s,$e)
  $e.Graphics.SmoothingMode='AntiAlias'
  $pen=New-Object Drawing.Pen([Drawing.Color]::FromArgb(255,255,60,60),5)
  $e.Graphics.DrawEllipse($pen,5,5,45,45)
  $e.Graphics.FillEllipse([Drawing.Brushes]::Red,24,24,8,8)
})

# 표시 위치: 지금 조작하는 창(rect)이 있으면 그 창 테두리·안쪽 위에, 없으면 모니터 전체에 그립니다(보조 모니터 포함).
$script:placed=''
function Place([int]$l,[int]$t,[int]$r,[int]$b,[bool]$inside){
  $key="$l,$t,$r,$b"; if($key -eq $script:placed){return}; $script:placed=$key
  $w=$r-$l; $h=$b-$t
  $rects=@((New-Object Drawing.Rectangle($l,$t,$w,$edge)),(New-Object Drawing.Rectangle($l,($b-$edge),$w,$edge)),(New-Object Drawing.Rectangle($l,$t,$edge,$h)),(New-Object Drawing.Rectangle(($r-$edge),$t,$edge,$h)))
  for($i=0;$i -lt 4;$i++){ $borders[$i].Bounds=$rects[$i] }
  $script:bw=[Math]::Min(1000,[Math]::Max(300,$w-40)); $banner.Size=New-Object Drawing.Size($script:bw,$bh)
  $banner.Location=New-Object Drawing.Point(($l+[int](($w-$script:bw)/2)),($t+$edge+($(if($inside){34}else{4}))))
  $stop.Location=New-Object Drawing.Point(($r-170),($b-60))
  $banner.Invalidate()
}
function PlaceForStatus($st){
  if($st -and $st.rect -and $st.rect.Count -eq 4){ Place ([int]$st.rect[0]) ([int]$st.rect[1]) ([int]$st.rect[2]) ([int]$st.rect[3]) $true; return }
  $sc=[Windows.Forms.Screen]::PrimaryScreen; $wa2=$sc.WorkingArea; $b2=$sc.Bounds
  Place $b2.Left $b2.Top $b2.Right $wa2.Bottom $false
}
$script:lastSeq=-1; $script:ringUntil=[DateTime]::MinValue; $script:dots=0; $script:t=0.0; $script:topTick=0
$timer=New-Object Windows.Forms.Timer
$timer.Interval=120
$timer.Add_Tick({
 try{
  if($ParentPid -gt 0 -and !(Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)){ [Windows.Forms.Application]::Exit(); return }
  # 테두리: 보라 ↔ 파랑으로 천천히 숨 쉬기
  $script:t+=0.12; $k=(1+[Math]::Sin($script:t))/2
  $c=[Drawing.Color]::FromArgb([int](124+(47-124)*$k),[int](58+(111-58)*$k),237)
  foreach($f in $borders){ $f.BackColor=$c; $f.Opacity=0.55+0.4*$k }
  $st=$null
  try{ $st=Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json }catch{}
  if($st){
    if($st.done){ [Windows.Forms.Application]::Exit(); return }
    PlaceForStatus $st
    # 글자는 실제로 바뀔 때만 다시 그립니다(점 애니메이션으로 0.12초마다 다시 그리면 깜빡임).
    $now=[string]$st.text; if($now.Length -gt 34){$now=$now.Substring(0,34)+'…'}
    $where=if($st.title){' ['+([string]$st.title).Substring(0,[Math]::Min(18,([string]$st.title).Length))+']'}else{''}
    $nt='● 로컬 Gemma 작업 중'+$where+' · '+$now+'   Esc: 중지'
    if($nt -ne $script:bannerText){ $script:bannerText=$nt; $banner.Invalidate() }
    if($st.seq -ne $script:lastSeq){
      $script:lastSeq=$st.seq
      if($st.clickX -ne $null -and $st.clickY -ne $null){
        $ring.Location=New-Object Drawing.Point(([int]$st.clickX-28),([int]$st.clickY-28))
        if(!$ring.Visible){$ring.Show()}
        $ring.Invalidate()
        $script:ringUntil=(Get-Date).AddMilliseconds(900)
      }
    }
  }
  if($ring.Visible -and (Get-Date) -gt $script:ringUntil){$ring.Hide()}
  # 맨 위 유지는 2초마다 한 번만 다시 확인합니다(매번 하면 창이 다시 배치되며 깜빡임).
  $script:topTick=($script:topTick+1)%16
  if($script:topTick -eq 0){ $banner.TopMost=$true; $stop.TopMost=$true }
 }catch{ if($ErrorLog){ try{ ('tick '+$_.ToString()) | Add-Content -LiteralPath $ErrorLog -Encoding UTF8 }catch{} } }
})
$timer.Start()
foreach($f in $borders){ $f.Show() }
$banner.Show(); $stop.Show()
# 검은 커서 켜기 (파일이 없으면 그냥 넘어감) → 끝나면 반드시 원래대로
$blackCur=@('arrow_rl.cur','arrow_r.cur') | ForEach-Object { Join-Path $env:WINDIR ('Cursors\'+$_) } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
try{
  if($blackCur){ [OverlayNative]::BlackCursor($blackCur) }
  [Windows.Forms.Application]::Run()
} finally {
  try{ [OverlayNative]::RestoreCursor() }catch{}
}
