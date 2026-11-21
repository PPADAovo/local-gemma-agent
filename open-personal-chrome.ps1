param([Parameter(Mandatory)][uri]$Url)
$ErrorActionPreference='Stop'
if($Url.Scheme -notin 'http','https'){throw 'HTTP(S) URL required'}
$shortcut=Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Google Chrome.lnk'
$arguments='"'+$Url.AbsoluteUri+'"'
if(Test-Path -LiteralPath $shortcut){
  $link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $exe=$link.TargetPath
  if([IO.Path]::GetFileName($exe) -ne 'chrome.exe'){throw 'Invalid Chrome shortcut'}
  $arguments=$link.Arguments+' '+$arguments
}else{
  $exe=@($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA) | ForEach-Object {Join-Path $_ 'Google\Chrome\Application\chrome.exe'} | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
}
Start-Process -FilePath $exe -ArgumentList $arguments
