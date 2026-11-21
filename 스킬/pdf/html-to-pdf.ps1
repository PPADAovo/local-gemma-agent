# HTML 파일을 PDF로 저장합니다(설치된 Chrome 또는 Edge 사용).
# 사용: & html-to-pdf.ps1 <입력.html> <출력.pdf>
param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
if(!(Test-Path -LiteralPath $Source)){Write-Output "오류: 입력 파일이 없습니다: $Source";exit 1}
$sourcePath=(Resolve-Path -LiteralPath $Source).Path
if([IO.Path]::IsPathRooted($Target)){$targetPath=[IO.Path]::GetFullPath($Target)}else{$targetPath=[IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Target))}
if(Test-Path -LiteralPath $targetPath){Write-Output "오류: 이미 있는 파일은 덮어쓰지 않습니다: $targetPath";exit 1}
$candidates=@(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$browser=$candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if(!$browser){Write-Output '오류: Chrome이나 Edge를 찾지 못했습니다.';exit 1}
$tempProfile=Join-Path $env:TEMP ('gemma-pdf-'+[Guid]::NewGuid().ToString('N'))
$url=([Uri]$sourcePath).AbsoluteUri
$arguments=@('--headless','--disable-gpu','--no-pdf-header-footer',"--user-data-dir=`"$tempProfile`"","--print-to-pdf=`"$targetPath`"","`"$url`"")
$process=Start-Process -FilePath $browser -ArgumentList $arguments -PassThru -WindowStyle Hidden
if(!$process.WaitForExit(60000)){try{$process.Kill()}catch{};Write-Output '오류: 60초 안에 끝나지 않았습니다.';exit 1}
try{Remove-Item -LiteralPath $tempProfile -Recurse -Force -ErrorAction SilentlyContinue}catch{}
if(!(Test-Path -LiteralPath $targetPath)){Write-Output '오류: PDF가 만들어지지 않았습니다.';exit 1}
$size=(Get-Item -LiteralPath $targetPath).Length
Write-Output "저장: $targetPath ($size 바이트)"
