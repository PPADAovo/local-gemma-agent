param([string]$AppPath=(Join-Path (Split-Path $PSScriptRoot) '로컬 Gemma.exe'))
$ErrorActionPreference='Stop'
$fx=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$exe=Join-Path ([IO.Path]::GetTempPath()) ('MarkdownLayout-'+[guid]::NewGuid().ToString('N')+'.exe')
try {
    & "$fx\csc.exe" /nologo /codepage:65001 "/out:$exe" "/r:$fx\WPF\PresentationFramework.dll" "/r:$fx\WPF\PresentationCore.dll" "/r:$fx\WPF\WindowsBase.dll" "/r:$fx\System.Xaml.dll" /r:System.Xml.Linq.dll (Join-Path $PSScriptRoot 'MarkdownLayout.cs')
    if($LASTEXITCODE){throw 'Could not compile the markdown layout check.'}
    & $exe (Resolve-Path -LiteralPath $AppPath).Path
    if($LASTEXITCODE){throw 'Markdown layout check failed.'}
} finally {if(Test-Path -LiteralPath $exe){Remove-Item -LiteralPath $exe -Force}}
