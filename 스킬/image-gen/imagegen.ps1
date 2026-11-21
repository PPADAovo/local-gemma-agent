param([Parameter(Mandatory)][string]$Prompt,[int]$Width=1024,[int]$Height=1024,[string]$Negative='lowres, blurry, watermark, text')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$cfg=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$body=@{prompt=$Prompt;negative_prompt=$Negative;width=$Width;height=$Height;steps=[int]$cfg.steps} | ConvertTo-Json
try{ $r=Invoke-RestMethod -Method Post -Uri ($cfg.url.TrimEnd('/')+'/sdapi/v1/txt2img') -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json' -TimeoutSec 600 }
catch{ throw ('이미지 생성 프로그램에 연결하지 못했습니다 ('+$cfg.url+'). WebUI를 --api 옵션으로 실행했는지 확인하세요.') }
$out=Join-Path (Split-Path (Split-Path $PSScriptRoot)) '작업공간\이미지'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$f=Join-Path $out ('image-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.png')
[IO.File]::WriteAllBytes($f,[Convert]::FromBase64String($r.images[0]))
'저장: '+$f
