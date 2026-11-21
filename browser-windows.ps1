param([Parameter(Mandatory)][string]$Browser,[int]$OnlyProcess=0)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type 'using System; using System.Runtime.InteropServices; public class GemmaWinClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l); }'
$names=switch -Regex ($Browser) {
 '^(크롬|chrome)$' {'chrome';break}
 '^(엣지|edge)$' {'msedge';break}
 '^(파이어폭스|firefox)$' {'firefox';break}
 '^(인터넷|브라우저)$' {'chrome','msedge','firefox';break}
 default {throw '브라우저 이름을 확인하세요.'}
}
function Targets {
 $list=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)
 foreach($w in $list){try{
   $x=$w.Current
   if($x.ClassName -notin 'Chrome_WidgetWin_1','MozillaWindowClass'){continue}
   if($OnlyProcess -and $x.ProcessId -ne $OnlyProcess){continue}
   if((Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue).ProcessName -in $names){[IntPtr]$x.NativeWindowHandle}
 }catch [Windows.Automation.ElementNotAvailableException]{}}
}
$initial=@(Targets)
if(!$initial.Count){'대상 브라우저 창이 0개입니다.';return}
foreach($h in $initial){[void][GemmaWinClose]::PostMessage($h,16,[IntPtr]::Zero,[IntPtr]::Zero)}
for($i=0;$i -lt 24;$i++){
 Start-Sleep -Milliseconds 200
 $left=@(Targets)
 if(!$left.Count){"닫기 전 $($initial.Count)개 · 닫은 뒤 0개 확인 ($($names -join ', '))";return}
}
throw "닫기 전 $($initial.Count)개 · 현재 $($left.Count)개 남았습니다. 브라우저의 확인 대화상자를 확인하세요."
