# Exercise the real pre-overlay encoder using only an in-memory test bitmap.
$ErrorActionPreference='Stop'
$source=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\computer.ps1')
$block=[regex]::Match($source,'(?s)    \$g.Flush\(\)\r?\n.*?finally\{\$cleanStream.Dispose\(\)\}').Value
if(!$block){throw 'Clean image encoding block missing'}
Add-Type -AssemblyName System.Drawing
$small=New-Object Drawing.Bitmap 200,120
$g=[Drawing.Graphics]::FromImage($small)
$g.Clear([Drawing.Color]::White)
Invoke-Expression $block
$g.FillRectangle([Drawing.Brushes]::Black,20,20,80,80)
$g.Flush()
$stream=[IO.MemoryStream]::new([Convert]::FromBase64String($cleanImage))
$decoded=[Drawing.Bitmap]::new($stream)
try{
 if($decoded.Width -ne 200 -or $decoded.Height -ne 120){throw 'Clean image dimensions changed'}
 if($decoded.GetPixel(50,50).R -lt 240 -or $small.GetPixel(50,50).R -gt 10){throw 'Clean image contains later annotations'}
}finally{$decoded.Dispose();$stream.Dispose();$g.Dispose();$small.Dispose()}
Write-Output 'Clean image: dimensions and pre-overlay pixels passed (memory bitmap only)'
