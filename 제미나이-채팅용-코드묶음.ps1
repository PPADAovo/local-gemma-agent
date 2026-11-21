# 제미나이 일반 채팅(gemini.google.com)에 올릴 코드 묶음 파일을 만듭니다.
# CLI 한도가 다 됐을 때 씁니다. 개인 기록 없는 코드 파일만 한 파일로 묶고, 붙여 넣을 요청문도 함께 만듭니다.
$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$names=@('agent-loop.mjs','agent.mjs','conversation.mjs','completion-check.mjs','compaction.mjs','permission-policy.mjs','file-approval.mjs','task-approval.mjs','human-handoff.mjs','manual-handoff.mjs','first-setup.mjs','filefind.mjs','computer.ps1','overlay.ps1')
$sb=New-Object Text.StringBuilder
[void]$sb.AppendLine('# 로컬 Gemma 에이전트 코드 묶음 (검사용)')
[void]$sb.AppendLine('Windows용 로컬 AI 에이전트. 각 파일은 "=== 파일: 이름 ===" 줄로 시작하고, 줄마다 앞에 줄번호가 붙어 있습니다.')
foreach($n in $names){
  $f=Join-Path $here $n; if(!(Test-Path $f)){continue}
  [void]$sb.AppendLine(''); [void]$sb.AppendLine('=== 파일: '+$n+' ===')
  $i=0; foreach($line in [IO.File]::ReadAllLines($f,[Text.Encoding]::UTF8)){ $i++; [void]$sb.AppendLine(('{0,5}| {1}' -f $i,$line)) }
}
$bundle=Join-Path $here '제미나이-검사용-코드묶음.txt'
[IO.File]::WriteAllText($bundle,$sb.ToString(),(New-Object Text.UTF8Encoding($false)))
$ask=Join-Path $here '제미나이-검사-요청문.txt'
@'
첨부한 "제미나이-검사용-코드묶음.txt"는 Windows용 로컬 AI 에이전트 앱의 코드입니다(줄번호 포함).
찾을 것: (1) 실제 버그 (2) 무한 반복·멈춤 가능성 (3) 승인 없이 위험한 동작이 실행될 수 있는 곳 (4) 실제로 안 했는데 완료라고 보고할 수 있는 곳 (5) 불필요하게 느린 곳.
각 항목을 "파일명:줄번호 — 문제 — 실제로 일어나는 상황 — 고치는 방법" 형식으로, 심각한 것부터 한국어로 써 주세요. 확실하지 않은 것은 '추정'이라고 표시해 주세요.
'@ | Set-Content -LiteralPath $ask -Encoding UTF8
'{0} ({1:N0}KB)' -f $bundle,((Get-Item $bundle).Length/1KB)
$ask
