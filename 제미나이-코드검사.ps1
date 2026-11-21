# 제미나이(Gemini CLI, agy)에게 코드 검사를 맡깁니다. 더블클릭은 "제미나이-코드검사.cmd".
# - 개인 기록이 없는 복사본 폴더("로컬 Gemma 첫사용")에서 실행하므로 기억·대화기록·작업로그는 보내지 않습니다.
# - 읽기 전용 모드(--mode plan)라 파일을 고치지 않습니다. 결과는 이 폴더의 "제미나이-코드검사-결과.md"에 저장됩니다.
param([string]$Focus='')
$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$clean=Join-Path (Split-Path -Parent $here) '로컬 Gemma 첫사용'
$agy=Join-Path $env:USERPROFILE '.gemini\bin\agy.exe'
if(!(Test-Path $agy)){Write-Host 'Gemini CLI(agy)가 없습니다. "제미나이-연결.cmd"를 먼저 실행하세요.';exit 1}
if(!(Test-Path $clean)){Write-Host ('검사용 복사본 폴더가 없습니다: '+$clean);exit 1}
# 최신 코드를 복사본에 맞춥니다(코드 파일만, 개인 폴더 제외).
Get-ChildItem $here -File | Where-Object { $_.Extension -in '.mjs','.ps1','.cs','.xaml' -and $_.Name -notmatch '\.bak$|^\.review|before' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $clean -Force }
$out=Join-Path $here '제미나이-코드검사-결과.md'
$prompt=@"
이 폴더는 Windows용 로컬 AI 에이전트 앱의 코드입니다(Node.js .mjs, PowerShell .ps1, C# WPF .cs).
핵심 파일: agent-loop.mjs(작업 흐름·계획·도구 선택·반복 방지·완료 확인), agent.mjs(도구 실행·승인 카드), conversation.mjs(모델 호출),
completion-check.mjs, compaction.mjs, permission-policy.mjs, file-approval.mjs, task-approval.mjs, computer.ps1(클릭·입력·화면), Desktop*.cs(앱 화면).
파일을 직접 열어 읽고 검사하세요. 파일을 고치지 마세요. 사용자데이터·라이브러리 폴더는 보지 마세요.
찾을 것: (1) 실제 버그 (2) 무한 반복·멈춤 가능성 (3) 승인 없이 위험한 동작이 실행될 수 있는 곳 (4) 실제로 안 했는데 완료라고 보고할 수 있는 곳 (5) 불필요하게 느린 곳.
$Focus
각 항목은 "파일명:줄번호 — 문제 — 실제로 일어나는 상황 — 고치는 방법" 형식으로, 심각한 것부터 한국어로 쓰세요. 확실하지 않은 것은 '추정'이라고 표시하세요.
"@
# Windows PowerShell 5.1은 프로그램에 넘기는 글 안의 큰따옴표(")에서 인자를 잘라 버립니다. 홑따옴표로 바꾸고 줄바꿈은 공백으로.
$prompt=($prompt -replace '"',"'") -replace '\r?\n',' '
Write-Host '제미나이가 코드를 읽고 검사하는 중입니다. 몇 분 걸릴 수 있어요...'
Push-Location $clean
try{
  # 읽기 전용 명령만 허용합니다(모든 명령 자동 승인 옵션은 쓰지 않음). 샌드박스로 터미널도 제한합니다.
  # 목록 보기·검색·정렬처럼 읽기만 하는 명령. 파이프(|)로 이어 쓰는 표시용 명령도 포함해야 막히지 않습니다.
  $allow=@('rg','dir','ls','findstr','type','cat','Get-Content','Get-ChildItem','Select-String','Select-Object','Where-Object','Sort-Object','Measure-Object','Format-Table','Format-List') | ForEach-Object { 'command('+$_+')' }
  $settingsFile=Join-Path $env:TEMP 'gemini-review-settings.json'
  [IO.File]::WriteAllText($settingsFile,(@{permissions=@{allow=$allow}} | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  $prompt=$prompt+' 파일은 파일 읽기 도구로만 읽고, 명령은 꼭 필요할 때 읽기 전용 검색(rg, findstr, Get-Content)만 쓰세요. 파일을 만들거나 바꾸는 명령은 쓰지 마세요.'
  # plan 모드는 '수정 계획서'를 쓰는 모드라 쓰지 않습니다. 기본 모드에서 파일 수정은 승인이 필요한데, 이 실행은 승인을 물을 수 없어 자동 거부됩니다(=읽기 전용).
  $result=& $agy --sandbox --settings $settingsFile --model gemini-3.8-flash-medium -p $prompt 2>&1 | Out-String
}finally{Pop-Location}
[IO.File]::WriteAllText($out,"# 제미나이 코드 검사 결과`n`n"+(Get-Date -Format 'yyyy-MM-dd HH:mm')+"`n`n"+$result,(New-Object Text.UTF8Encoding($true)))
Write-Host ('끝났습니다. 결과: '+$out)
