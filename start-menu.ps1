$d=$PSScriptRoot
$lnk=Join-Path ([Environment]::GetFolderPath('Programs')) '로컬 Gemma.lnk'
$s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath=Join-Path $d '로컬 Gemma.exe'
$s.WorkingDirectory=$d
$ico=Join-Path $d '로컬Gemma.ico'; if(Test-Path -LiteralPath $ico){$s.IconLocation=$ico}
$s.Description='로컬 Gemma'
$s.Save()
if(Test-Path -LiteralPath $lnk){Write-Host ('시작 메뉴에 등록했습니다: '+$lnk)}else{Write-Host '등록에 실패했습니다.'}
