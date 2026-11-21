param([string]$Exe='로컬 Gemma.exe')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
$a=[Reflection.Assembly]::LoadFrom((Resolve-Path $Exe))
$m=$a.GetType('DesktopChat').GetMethod('ConfirmRemoval',[Reflection.BindingFlags]'Static,NonPublic')
if(!$m){throw 'ConfirmRemoval missing'}
$owner=New-Object Windows.Window
$owner.Width=650
$owner.Height=450
$owner.Show()
try {
 foreach($choice in '취소','×','채팅 삭제'){
  $timer=New-Object Windows.Threading.DispatcherTimer
  $timer.Interval=[TimeSpan]::FromMilliseconds(120)
  $timer.add_Tick({
   $timer.Stop()
   $d=@($owner.OwnedWindows)[0]
   $b=$d.Content.FindName(@{'취소'='CancelAction';'×'='CloseAction';'채팅 삭제'='ConfirmAction'}[$choice])
   $b.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
  })
  $timer.Start()
  $result=$m.Invoke($null,@($owner.psobject.BaseObject,'테스트 채팅을 삭제할까요?','이 대화 기록을 삭제합니다.','채팅 삭제'))
  if($result -ne ($choice -eq '채팅 삭제')){throw "Wrong result for $choice"}
 }
 '3 dialog actions passed'
} finally {$owner.Close()}
