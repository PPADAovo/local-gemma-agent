param([string]$AppPath=(Join-Path (Split-Path $PSScriptRoot) '로컬 Gemma.exe'),[string]$PreviewPath='')
$ErrorActionPreference='Stop'
$fx=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$exe=Join-Path ([IO.Path]::GetTempPath()) ('ChatMenu-'+[guid]::NewGuid().ToString('N')+'.exe')
try {
 & "$fx\csc.exe" /nologo /codepage:65001 "/out:$exe" "/r:$fx\WPF\PresentationFramework.dll" "/r:$fx\WPF\PresentationCore.dll" "/r:$fx\WPF\WindowsBase.dll" "/r:$fx\System.Xaml.dll" (Join-Path $PSScriptRoot 'ChatMenu.cs')
 if($LASTEXITCODE){throw 'Menu test compilation failed'}
 if($PreviewPath){& $exe (Resolve-Path -LiteralPath $AppPath).Path $PreviewPath}else{& $exe (Resolve-Path -LiteralPath $AppPath).Path}
 if($LASTEXITCODE){throw 'Menu tests failed'}
} finally {if(Test-Path -LiteralPath $exe){Remove-Item -LiteralPath $exe -Force}}
