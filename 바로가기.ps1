# 바탕화면과 시작 메뉴에 "로컬 Gemma" 바로가기(아이콘)를 만듭니다.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here '로컬 Gemma.exe'
if (!(Test-Path -LiteralPath $exe)) { Write-Host '로컬 Gemma.exe를 찾지 못했습니다. 먼저 빌드하기.cmd를 실행하세요.'; exit 1 }
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if (!$dir) { continue }
  $path = Join-Path $dir '로컬 Gemma.lnk'
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $here
  $ico = Join-Path $here '로컬Gemma.ico'
  $lnk.IconLocation = $(if (Test-Path -LiteralPath $ico) { "$ico,0" } else { "$exe,0" })
  $lnk.Description = '로컬 Gemma AI 에이전트'
  $lnk.Save()
  Write-Host ('만들었습니다: ' + $path)
}
