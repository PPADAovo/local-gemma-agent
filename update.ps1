# 로컬 Gemma 새 버전 빌드 → 실행 중인 앱 닫기 → 교체 → 다시 실행
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$log=Join-Path $PSScriptRoot '빌드기록.txt'
$target=Join-Path $PSScriptRoot '로컬 Gemma.exe'
$temp=Join-Path $PSScriptRoot 'LocalGemma-build.exe'
Write-Host '로컬 Gemma 새 버전을 빌드합니다. 잠시만 기다려 주세요...'
try{
  if(Test-Path $temp){Remove-Item $temp -Force}
  & (Join-Path $PSScriptRoot 'build-desktop.ps1') -OutputName 'LocalGemma-build.exe' *>&1 | Out-File $log -Encoding utf8
  if(!(Test-Path $temp)){throw '빌드 결과 파일이 만들어지지 않았습니다.'}
}catch{
  ("빌드 실패: "+$_) | Add-Content $log -Encoding utf8
  Write-Host '빌드에 실패했습니다. 빌드기록.txt를 Claude에게 보내 주세요. 기존 앱은 그대로입니다.'
  Read-Host '엔터를 누르면 닫힙니다' | Out-Null
  exit 1
}
Write-Host '빌드 성공. 실행 중인 로컬 Gemma를 닫고 새 버전으로 바꿉니다...'
$running={Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($target)) }}
& $running | ForEach-Object { [void]$_.CloseMainWindow() }
Start-Sleep -Seconds 2
& $running | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$replaced=$false
for($i=0;$i -lt 10 -and !$replaced;$i++){
  try{
    if(Test-Path $target){$archive=Join-Path $PSScriptRoot '이전버전';[IO.Directory]::CreateDirectory($archive) | Out-Null;Copy-Item -LiteralPath $target -Destination (Join-Path $archive '로컬 Gemma-이전버전.exe') -Force}
    Move-Item $temp $target -Force
    $replaced=$true
  }catch{Start-Sleep -Milliseconds 700}
}
if($replaced){
  Write-Host '완료! 새 버전을 실행합니다.'
  Start-Process $target
}else{
  Write-Host '기존 파일을 바꾸지 못해 새 버전을 LocalGemma-build.exe 이름으로 실행합니다.'
  Start-Process $temp
}
Start-Sleep -Seconds 2
