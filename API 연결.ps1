Add-Type -AssemblyName PresentationFramework,System.Security
$ErrorActionPreference='Stop'
$window=New-Object Windows.Window
$window.Title='로컬 Gemma · API 연결'
$window.Width=480;$window.SizeToContent='Height';$window.WindowStartupLocation='CenterScreen'
$panel=New-Object Windows.Controls.StackPanel;$panel.Margin=20;$window.Content=$panel
$inputs=@{}
$links=@{gemini='https://aistudio.google.com/apikey';gpt='https://platform.openai.com/api-keys';claude='https://platform.claude.com/settings/keys'}
foreach($pair in @(@('gemini','Google Gemini API 키'),@('gpt','OpenAI API 키'),@('claude','Anthropic API 키'))){
 $link=New-Object Windows.Controls.Button;$link.Content=($pair[1]+' 발급 페이지');$link.Tag=$links[$pair[0]];$link.Margin='0,0,0,4'
 $link.Add_Click({param($sender,$eventArgs) Start-Process $sender.Tag});$panel.Children.Add($link)|Out-Null
 $label=New-Object Windows.Controls.TextBlock;$label.Text=$pair[1];$panel.Children.Add($label)|Out-Null
 $box=New-Object Windows.Controls.PasswordBox;$box.Margin='0,4,0,12';$box.Padding=5;$inputs[$pair[0]]=$box;$panel.Children.Add($box)|Out-Null
}
$verify=New-Object Windows.Controls.CheckBox;$verify.Content='저장 후 입력한 서비스에 연결 확인 요청 보내기 (API 요금 발생 가능)';$verify.Margin='0,0,0,10';$panel.Children.Add($verify)|Out-Null
$button=New-Object Windows.Controls.Button;$button.Content='내 Windows 계정에 키 저장';$button.Padding=7;$panel.Children.Add($button)|Out-Null
$msg=New-Object Windows.Controls.TextBlock;$msg.Margin='0,8,0,0';$msg.TextWrapping='Wrap';$msg.Text='이 Windows 사용자 계정으로 암호화해 저장합니다. 연결 확인 시 입력한 서비스마다 짧은 API 요청을 보냅니다.';$panel.Children.Add($msg)|Out-Null
$dir=Join-Path $env:LOCALAPPDATA 'LocalGemmaDesktop'
$check=Join-Path $PSScriptRoot 'test-provider-connection.mjs'
$button.Add_Click({
 $jobs=@();$saved=0
 try{
 foreach($provider in @('gemini','gpt','claude')){
  $value=$inputs[$provider].Password.Trim()
  if(!$value){continue}
  $target=Join-Path $dir ($provider+'.dpapi')
  [IO.Directory]::CreateDirectory($dir)|Out-Null
  $temp=Join-Path $dir ([guid]::NewGuid().ToString())
  [IO.File]::WriteAllBytes($temp,[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
  if([IO.File]::Exists($target)){[IO.File]::Replace($temp,$target,$null)}else{[IO.File]::Move($temp,$target)}
  $inputs[$provider].Clear();$saved++
  if(!$verify.IsChecked){continue}
  $info=New-Object Diagnostics.ProcessStartInfo('node.exe',('"'+$check+'" '+$provider));$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.StandardErrorEncoding=[Text.Encoding]::UTF8
  $jobs+=@{name=$provider;process=[Diagnostics.Process]::Start($info)}
 }
 if(!$jobs.Count){$msg.Text=if($saved){'키를 저장했습니다.'}else{'저장할 키를 입력하세요.'};return}
 $button.IsEnabled=$false;$msg.Text='서비스 응답을 기다리는 중…'
 $timer=New-Object Windows.Threading.DispatcherTimer;$timer.Interval=[TimeSpan]::FromMilliseconds(500)
 $handler={
  if(@($jobs|Where-Object {!$_.process.HasExited}).Count){return}
  $timer.Stop()
  $msg.Text=($jobs|ForEach-Object {if($_.process.ExitCode -eq 0){$_.name+' 연결 성공 · '+$_.process.StandardOutput.ReadToEnd().Trim()}else{$_.name+' · '+$_.process.StandardError.ReadToEnd().Trim()}}) -join [Environment]::NewLine
  $button.IsEnabled=$true
 }.GetNewClosure()
 $timer.Add_Tick($handler);$timer.Start()
 }catch{$button.IsEnabled=$true;$msg.Text='키 저장 또는 연결 확인 프로그램 실행에 실패했습니다.'}
})
$null=$window.ShowDialog()
