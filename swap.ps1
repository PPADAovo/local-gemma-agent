# 빌드된 LocalGemma-build.exe를 '로컬 Gemma.exe'로 교체하고 다시 실행합니다.
$ErrorActionPreference='Continue'
$dir=$PSScriptRoot
$log=Join-Path $dir '빌드기록-교체.txt'
"시작 $(Get-Date)" | Out-File $log -Encoding utf8
Start-Sleep -Seconds 3
$names=@('로컬 Gemma.exe','LocalGemma-build.exe')
$targets=@($names | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $dir $_)) })
Get-Process | Where-Object { $_.Path -and ($targets -contains [IO.Path]::GetFullPath($_.Path)) } | Stop-Process -Force
Start-Sleep -Seconds 2
$t=Join-Path $dir '로컬 Gemma.exe'; $b=Join-Path $dir 'LocalGemma-build.exe'
if(Test-Path -LiteralPath $b){
  $arc=Join-Path $dir '이전버전'; [IO.Directory]::CreateDirectory($arc) | Out-Null
  if(Test-Path -LiteralPath $t){Copy-Item -LiteralPath $t -Destination (Join-Path $arc '로컬 Gemma-교체전.exe') -Force}
  $ok=$false
  for($i=0;$i -lt 10 -and !$ok;$i++){try{Move-Item -LiteralPath $b -Destination $t -Force -ErrorAction Stop;$ok=$true}catch{"재시도 $i : $_" | Add-Content $log -Encoding utf8;Start-Sleep -Milliseconds 700}}
  "교체 결과: $ok" | Add-Content $log -Encoding utf8
}else{"빌드 파일 없음" | Add-Content $log -Encoding utf8}
Start-Process -FilePath $t
"끝 $(Get-Date)" | Add-Content $log -Encoding utf8
