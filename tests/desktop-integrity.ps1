param([string]$AppPath=(Join-Path (Split-Path $PSScriptRoot) '로컬 Gemma.exe'))
$ErrorActionPreference='Stop'
$fx=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$exe=Join-Path ([IO.Path]::GetTempPath()) ('DesktopIntegrity-'+[guid]::NewGuid().ToString('N')+'.exe')
try {
 & "$fx\csc.exe" /nologo /codepage:65001 "/out:$exe" "/r:$fx\WPF\PresentationFramework.dll" "/r:$fx\WPF\PresentationCore.dll" "/r:$fx\WPF\WindowsBase.dll" "/r:$fx\System.Xaml.dll" /r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'DesktopIntegrity.cs')
 if($LASTEXITCODE){throw 'Desktop integrity harness compilation failed'}
 & $exe (Resolve-Path -LiteralPath $AppPath).Path (Join-Path (Split-Path $PSScriptRoot) 'preferences-write-lock.mjs')
 if($LASTEXITCODE){throw 'Desktop integrity regression failed'}
} finally {if(Test-Path -LiteralPath $exe){Remove-Item -LiteralPath $exe -Force}}
