param([string]$Exe,[string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationCore,PresentationFramework,WindowsBase
$assembly=[Reflection.Assembly]::LoadFrom($Exe)
$type=$assembly.GetType('DesktopChat',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$chat=[Runtime.Serialization.FormatterServices]::GetUninitializedObject($type)
$stream=$assembly.GetManifestResourceStream('Desktop.xaml')
$win=[Windows.Markup.XamlReader]::Load($stream);$stream.Dispose()
$type.GetField('window',$flags).SetValue($chat,$win)
$type.GetField('status',$flags).SetValue($chat,$win.FindName('Status'))
$type.GetField('showBrowser',$flags).SetValue($chat,[Action]{ $script:opened=$true })
$card=[Collections.Generic.Dictionary[string,object]]::new();$card.Add('askId','ui-test');$card.Add('kind','login');$card.Add('title','YouTube 로그인 또는 계정 선택이 필요합니다');$card.Add('question','로그인 창에서 사용할 계정을 선택하고 필요한 인증을 마쳐 주세요. 끝나면 아래 로그인 완료를 눌러 주세요.');$card.Add('showBrowser',$true);$card.Add('choicesOnly',$true);$card.Add('options',[string[]]@('로그인 완료','작업 중지'))
$type.GetMethod('ShowAsk',$flags).Invoke($chat,@($card))
$panel=$win.FindName('AskPanel');if($panel.Visibility -ne 'Visible' -or $panel.Children.Count -ne 1){throw 'Login card not visible'}
$body=$panel.Children[0].Child;$login=$body.Children|Where-Object {$_.Content -eq '로그인 창 열기'};if(!$login){throw 'Login window action missing'};$login.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent));if(!$script:opened){throw 'Login action not connected'}
$element=$panel.Children[0];$panel.Children.Remove($element)
$frame=[Windows.Controls.Border]::new();$frame.Background=[Windows.Media.Brushes]::White;$frame.Padding=[Windows.Thickness]::new(10);$frame.Child=$element
$frame.Measure([Windows.Size]::new(650,1000));$h=[math]::Ceiling($frame.DesiredSize.Height)
$frame.Arrange([Windows.Rect]::new(0,0,650,$h));$frame.UpdateLayout()
$bitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new(650,$h,96,96,[Windows.Media.PixelFormats]::Pbgra32);$bitmap.Render($frame)
$encoder=[Windows.Media.Imaging.PngBitmapEncoder]::new();$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap));$file=[IO.File]::Create($Output);try{$encoder.Save($file)}finally{$file.Close()}
$type.GetMethod('HideAsk',$flags).Invoke($chat,@('ui-test'));if($panel.Visibility -ne 'Collapsed'){throw 'Card did not dismiss'}
'PASS shipped WPF login card: visible, tab button dispatched, dismissed'
