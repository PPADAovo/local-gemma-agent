param([switch]$RegisterOnly)
$ErrorActionPreference='Stop'
$base=$PSScriptRoot
$local=Join-Path $(if($env:GEMMA_DATA_DIR){$env:GEMMA_DATA_DIR}else{Join-Path $env:LOCALAPPDATA 'LocalGemmaDesktop'}) 'work-tab'
New-Item -ItemType Directory -Force $local|Out-Null
$node=(Get-Command node.exe).Source
foreach($brand in 'chrome','edge'){
 $cmd=Join-Path $local ("host-"+$brand+".cmd")
 $manifest=Join-Path $local ("host-"+$brand+".json")
 # Keep the executable wrapper ASCII even when the application path is Korean.
 $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Join-Path $base 'work-tab-host.mjs')))
 $js="import(require('node:url').pathToFileURL(Buffer.from('$encoded','base64').toString('utf8')).href)"
 [IO.File]::WriteAllText($cmd,("@echo off`r`n`""+$node+"`" -e `""+$js+"`" "+$brand+"`r`n"),[Text.Encoding]::ASCII)
 $config=@{name='com.localgemma.worktab';description='Local Gemma work tab';path=$cmd;type='stdio';allowed_origins=@('chrome-extension://bdmngkkapokdcpkenjanackopcimfhia/')}
 [IO.File]::WriteAllText($manifest,($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $vendor=if($brand -eq 'edge'){'Microsoft\Edge'}else{'Google\Chrome'}
 $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\$vendor\NativeMessagingHosts\com.localgemma.worktab")
 try{$key.SetValue('',$manifest)}finally{$key.Close()}
}
if($RegisterOnly){return}
Add-Type -AssemblyName PresentationFramework
$window=[Windows.Window]::new();$window.Title='Gemma 작업 탭 연결';$window.Width=520;$window.SizeToContent='Height';$window.WindowStartupLocation='CenterScreen'
$panel=[Windows.Controls.StackPanel]::new();$panel.Margin=22;$window.Content=$panel
$guide=[Windows.Controls.TextBlock]::new();$guide.TextWrapping='Wrap';$guide.FontSize=15;$guide.Text="1. 아래에서 폴더 경로를 복사하세요.`n2. Chrome 확장 관리에서 오른쪽 위 ‘개발자 모드’를 켜세요.`n3. ‘압축해제된 확장 프로그램을 로드’를 누르세요.`n4. 폴더 선택창에서 Ctrl+L → Ctrl+V → Enter를 누른 뒤 ‘폴더 선택’을 누르세요.`n5. ‘로컬 Gemma 작업 탭’이 표시되면 연결이 끝납니다.";$panel.Children.Add($guide)|Out-Null
$copy=[Windows.Controls.Button]::new();$copy.Content='1. 폴더 경로 복사';$copy.Margin='0,14,0,4';$copy.Padding=6;$copy.Add_Click({[Windows.Clipboard]::SetText((Join-Path $base 'work-tab'));$copy.Content='복사됨 · 폴더 선택창에 붙여넣으세요'});$panel.Children.Add($copy)|Out-Null
$open=[Windows.Controls.Button]::new();$open.Content='2. Chrome 확장 관리 열기';$open.Padding=6;$open.Add_Click({$exe=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1;if($exe){Start-Process -FilePath $exe -ArgumentList 'chrome://extensions/'}});$panel.Children.Add($open)|Out-Null
$null=$window.ShowDialog()
