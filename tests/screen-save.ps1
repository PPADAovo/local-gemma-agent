$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
$folder=Join-Path $env:TEMP ('screen-agent-'+[guid]::NewGuid())
[void](New-Item -ItemType Directory $folder)
$exe=Join-Path $folder 'ScreenEditor.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /codepage:65001 /target:winexe /utf8output "/out:$exe" (Join-Path $PSScriptRoot 'ScreenEditor.cs')
if ($LASTEXITCODE) {throw '시험 편집기 컴파일 실패'}
$expected='로컬 화면 검증 '+(Get-Random -Minimum 1000 -Maximum 9999)
$app=Start-Process $exe -ArgumentList ('"'+$folder+'"') -PassThru
try {
    for ($i=0;$i -lt 50 -and !(Test-Path (Join-Path $folder 'handle'));$i++){Start-Sleep -Milliseconds 100}
    $env:LOCAL_AGENT_TEST_WINDOW=Get-Content (Join-Path $folder 'handle') -Raw
    $goal = "화면에 보이는 메모 편집기의 흰 입력란을 직접 클릭하고 '$expected'만 입력해. 그다음 파일 저장 버튼을 마우스로 클릭하고 저장 완료가 보이면 끝내."
    $request = @{method='ask';id=[guid]::NewGuid().ToString();text=$goal;targetWindow=$env:LOCAL_AGENT_TEST_WINDOW;targetPid=$app.Id}
    $reply = ($request | ConvertTo-Json -Compress) | node (Join-Path $root 'agent.mjs') --rpc
    if ($LASTEXITCODE){throw '에이전트 실패'}
    if(($reply | ConvertFrom-Json).events[0].tool -ne 'desktop'){throw '화면 도구를 사용하지 않았습니다.'}
    $file=Join-Path $folder 'saved.txt'
    $actual=[IO.File]::ReadAllText($file)
    if ($actual -cne $expected){throw '저장 내용 불일치'}
    $events=[IO.File]::ReadAllText((Join-Path $folder 'events.txt'))
    if ($events -notmatch '(?s)editor mouse down.*text changed.*save mouse down.*saved'){throw '화면 입력 순서 불일치'}
    "검증 통과: $file / $actual"
} finally {
    Remove-Item Env:LOCAL_AGENT_TEST_WINDOW -ErrorAction SilentlyContinue
    if (!$app.HasExited){$app.Kill()}
}


