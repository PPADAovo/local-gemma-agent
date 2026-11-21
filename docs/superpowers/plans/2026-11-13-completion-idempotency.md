# 완료 결과 후 불필요한 반복 방지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 성공한 부작용 작업과 생성 결과를 한 번만 실행·기록하고, 충분한 근거가 있으면 체크리스트와 검증을 통과해 종료한다.

**Architecture:** `agent-loop.mjs`에서 성공 이벤트를 결과물·증거·완료 단계와 일관되게 연결하고, 비멱등 작업은 성공 또는 불확실한 실행 뒤 중복 호출을 차단한다. `agent.mjs`와 `external-media-tools.mjs`에서는 화면 녹화의 작업공간 경계와 실제 Windows 바탕화면 경로를 명시적으로 분리한다.

**Tech Stack:** Node.js ES modules, `node:test`, PowerShell/Windows known-folder APIs.

**Spec:** `docs/superpowers/specs/2026-11-13-completion-idempotency.md`

## Global Constraints

- 모든 사용자 안내와 계획 문구는 한국어로 작성한다.
- 성공을 도구 결과로 확인하지 못하면 완료라고 보고하지 않는다.
- 성공했거나 성공 여부가 불명확한 비멱등 부작용은 자동으로 반복하지 않는다.
- 실제 화면 녹화·메일 발송·외부 서비스 호출은 테스트에서 수행하지 않는다.
- 경로 검증을 유지하고 임의 절대 경로 허용으로 작업공간 경계를 우회하지 않는다.
- 기존 작업공간·파일 검증과 사용자 승인 동작은 보존한다.

## Review Focus

- 자연어 녹화 요청에 `정도`, `녹화해서`, `바탕화면에 저장`이 포함된 경우: 녹화 도구 한 번, 실제 Desktop 경로, 한 개의 결과 파일. (Task 1)
- 저장 경로의 상위 폴더가 없거나 Desktop이 OneDrive로 리디렉션된 경우: 실제 알려진 폴더에 안전하게 저장하거나 분명한 오류. (Task 1)
- 성공한 단일 도구 결과가 여러 부정확한 체크리스트 단계를 만족하는 경우: 관찰 근거가 있는 단계만 완료하고 불필요한 도구 재호출은 없음. (Task 2)
- `record_screen`·`browser_capture`가 실제 경로를 결과값에만 반환하는 경우: 파일이 대화 아티팩트에 등록되고 추가 생성을 요구하지 않음. 같은 페이지의 `browser_capture` 재제안도 한 번만 실행. (Task 2, 3)
- 화면 캡처 분기에서 파일 저장 단계가 계획에 있는 경우: 캡처 경로로 증거를 확인하고, 갱신된 체크리스트를 다음 모델 응답에 전달. (Task 2)
- 성공 여부가 불확실한 일반 `plugin_call` 뒤 검증이 실패하는 경우: 같은 부작용을 재실행하지 않고 조회 또는 사용자 확인으로 전환. (Task 3)
- 동일한 PowerShell 명령·Gmail 도구 검색·잘못된 서비스 인자가 반복 제안되는 경우: 이전 결과를 사용하거나 실행 전에 중단. (Task 3)
- Gmail 첨부 스킬 이름이 `plugin_call.path`로 제안되는 경우: 실제 Gmail 검색으로 복구하며, 스크린샷 메일은 저장된 캡처 확인 전 검색·발송을 실행하지 않는다. 캡처 저장 실패 시 중단한다. (Task 3)
- 화면 UI 검사는 차단됐어도 이미지와 캡처 경로가 정상 저장됐으면 파일 첨부만 진행하고, 차단된 창과 상호작용하지 않는다. (Task 3)
- 예약 등록 결과가 중복을 표시하는 경우: 기존 중복 방지 결과를 보존하고 새 예약으로 오인하지 않음. (Task 3)

---

### Task 1: 자연어 녹화 의도와 안전한 Desktop 출력 경로

**Files:**
- Modify: `agent-loop.mjs`
- Modify: `agent.mjs`
- Modify: `external-media-tools.mjs`
- Test: `tests/record-screen.mjs`

**Interfaces:**
- Produces: 녹화 요청 파서는 초 단위 시간과 “바탕화면” 목적지를 구분해 전달한다. Desktop 목적지는 확인된 Windows 사용자 Desktop 폴더로만 해석하며, 필요한 상위 디렉터리를 생성한 뒤 `{file, bytes, seconds}`를 반환한다.
- Interface: `parseRecordingRequest(input)`은 `{seconds, destination}` 또는 `null`을 반환한다. `destination`은 `desktop` 또는 `workspace`이며, 녹화 도구 전달에는 `target: "desktop"`을 사용한다. 절대 경로 문자열을 모델이 임의 생성하지 않는다.

- [x] **Step 1: 실패 테스트 작성**

  `tests/record-screen.mjs`에서 실제 FFmpeg 대신 녹화 실행기를 주입해 다음을 고정한다.
  - `"화면을 10초정도 녹화해서 바탕화면에 저장해"`는 명세 모델을 거치지 않고 `record_screen` 한 번으로 `text: "10"`, `target: "desktop"`을 전달한다.
  - Desktop 디렉터리가 없어도 부모 폴더 생성 뒤 결과 파일 경로와 0보다 큰 크기를 반환한다.
  - `..` 및 임의 드라이브 경로는 거부하고 Desktop 별칭만 알려진 Desktop 경로로 해석한다.

- [x] **Step 2: 테스트가 의도한 이유로 실패하는지 확인**

  실행: `node --test tests/record-screen.mjs`

  예상: 현재 표현은 `directRecording`에 매치되지 않고, `target()`은 바탕화면 절대 경로를 거부하며, 녹화기는 출력 디렉터리를 만들지 않아 실패한다.

- [x] **Step 3: 최소 구현**

  `parseRecordingRequest(input)`을 `agent-loop.mjs`에 추가해 시간을 정수 초로 제한한다. `record_screen` 실행부는 `target === "desktop"`일 때만 Windows Known Folder의 Desktop 경로를 해석하고 그 외에는 기존 `target()`을 사용한다. `recordScreen(output, seconds, {findFfmpeg, runCommand}={})`은 출력 폴더를 만든 뒤 임시 MP4를 생성하고 검증·복사한다. 테스트는 실행기 의존성을 주입하고 실제 녹화는 하지 않는다.

- [x] **Step 4: 집중 테스트 통과 확인**

  실행: `node --test tests/record-screen.mjs`

  예상: 자연어 요청은 녹화 호출 1회, 지정 시간, 실제 Desktop 경로를 사용하며 경로 오류는 명시적으로 반환한다.

### Task 2: 성공 결과·아티팩트와 체크리스트 완료를 연결

**Files:**
- Modify: `agent-loop.mjs`
- Test: `tests/completion-idempotency.mjs`
- Test: `tests/recovery-stall.mjs`

**Interfaces:**
- Consumes: `record(action, ok, text, args)`의 성공 도구 결과와 `todo` 단계.
- Produces: `record_screen`·`browser_capture` 결과의 실제 파일 경로, 크기 및 해당 도구의 확인값을 이벤트 증거 및 아티팩트로 보존한다. 독립 검증 가능한 도구 결과로만 해당 단계를 완료하고, `record_screen` 완료 뒤 일반 화면 확인을 강제하지 않는다.

- [x] **Step 1: 실패 테스트 작성**

  성공한 가짜 결과를 사용해 다음을 검증한다.
  - `record_screen`이 `{file, bytes, seconds}`를 반환하고 인자 `path`가 비어 있어도 실제 파일이 `result.artifacts`에 포함된다.
  - `browser_capture`가 경로를 문자열로 반환하면 그 파일이 `result.artifacts`에 포함된다.
  - `record_screen` 한 번의 결과가 녹화 시작·대기·종료·저장으로 쪼개진 체크리스트 단계를 실제 증거로 만족할 때 도구를 재호출하지 않는다.
  - 성공한 파일 결과 뒤 `fileNudged`가 두 번째 생성을 요구하지 않는다.
  - `write` 성공 뒤 필수인 같은 경로의 `read` 검증만 수행하고, 원본 파일을 다시 쓰지 않는다.
  - 녹화 도구 직후 `look`를 강제하지 않는다.

- [x] **Step 2: 테스트가 의도한 이유로 실패하는지 확인**

  실행: `node --test tests/completion-idempotency.mjs tests/recovery-stall.mjs`

  예상: 현재 결과물 맵은 `record_screen` 반환 경로를 누락하고, `verifyObservedAnswer`와 `lastAct` 완료 정책은 녹화 결과를 일반 부작용 완료로 다루지 않는다.

- [x] **Step 3: 최소 구현**

  성공 결과 객체에서 도구별 실제 파일 경로와 검증값을 추출해 이벤트 경로·관찰·아티팩트에 기록한다. `browser_capture`의 문자열 결과는 해당 도구의 생성 파일로 등록한다. 화면 캡처 분기에서 저장된 경로와 일치하는 체크리스트 단계를 `stepEvidence()`로 확인하고, 갱신된 체크리스트를 다음 모델 메시지에 포함한다. `verifyObservedAnswer`를 단순 도구명 추가로 완화하지 않는다. `lastAct` 화면 확인에서는 결과 자체가 최종 증거인 비-UI 녹화를 제외한다.

- [x] **Step 4: 집중 테스트 통과 확인**

  실행: `node --test tests/completion-idempotency.mjs tests/recovery-stall.mjs`

  예상: 한 번의 성공 결과가 정확한 증거·아티팩트로 기록되고 같은 녹화·파일 생성이 반복되지 않는다.

### Task 3: 검증 실패 후 비멱등 부작용 재실행 차단

**Files:**
- Modify: `agent-loop.mjs`
- Modify: `agent.mjs`
- Test: `tests/completion-idempotency.mjs`
- Test: `tests/mail-routing.mjs`

**Interfaces:**
- Produces: 성공 또는 실행 결과가 불확실한 비멱등 작업은 같은 요청 루프에서 재호출되지 않는다. 외부 상태 조회가 가능하면 그 결과로 확인하고, 확인할 수 없으면 작업 미완료와 확인 방법을 사용자에게 반환한다.

- [x] **Step 1: 실패 테스트 작성**

  부작용 실행기를 모의해 성공 결과 뒤 검증 실패 또는 같은 `plugin_call`·`schedule_add`·녹화 호출이 제안되어도 두 번째 외부 호출이 발생하지 않는지 확인한다. 실패가 호출 전에 확정된 경우에만 안전한 재시도가 가능해야 한다.
  같은 브라우저 상태에서 `browser_capture`가 재제안되어도 캡처는 한 번만 수행한다. 현재 페이지 상태가 바뀌면 다른 키로 처리되어 새 캡처를 허용한다.

- [x] **Step 2: 테스트가 의도한 이유로 실패하는지 확인**

  실행: `node --test tests/completion-idempotency.mjs tests/mail-routing.mjs`

  예상: 현재 일반 `plugin_call` 및 도구 결과가 불명확한 후속 검증 경로에서 같은 비멱등 요청을 다시 호출할 수 있다.

- [x] **Step 3: 최소 구현**

  부작용 호출 시도 상태를 작업 루프에 보존한다. 같은 `run` 명령, `plugin_search` 조회, 외부 부작용의 재제안은 이전 결과를 반환하고 다시 실행하지 않는다. 동일한 잘못된 도구 인자는 복구 경로를 한 번만 허용하고 반복되면 도구 호출 전에 중단한다. 검색하지 않은 Gmail 스킬 이름이 `plugin_call.path`로 제안되면 Gmail 검색을 자동으로 대기열에 넣는다. 스크린샷 이메일은 실제 Gmail 검색·발송 전에 캡처한다. UI 검사가 차단된 경우에도 실제 이미지와 저장 경로가 있으면 첨부에 사용하되, 저장 경로를 확인할 수 없으면 발송을 중단한다. `browser_capture`는 현재 페이지 상태로 중복 키를 만들어 같은 화면 캡처를 막고 페이지 변경 시 새 캡처를 허용한다. Gmail 첨부의 기존 멱등성 처리와 예약 중복 방지 동작을 유지한다.

- [x] **Step 4: 집중 테스트 통과 확인**

  실행: `node --test tests/completion-idempotency.mjs tests/mail-routing.mjs`

  예상: 동일 요청의 일반 비멱등 `plugin_call`은 성공 또는 결과 불명 후 한 번만 실행되고, 동일 페이지의 `browser_capture`와 녹화도 중복되지 않으며, 첨부 Gmail의 기존 영수증 캐시와 예약 중복 방지 동작은 보존된다.

### Task 4: 전체 회귀 검사와 기존 실패 구분

**Files:**
- Test: 모든 `tests/*.mjs`

- [x] **Step 1: 변경 파일 구문 검사**

  실행: `node --check agent-loop.mjs; node --check agent.mjs; node --check external-media-tools.mjs`

  예상: 모든 명령이 종료 코드 0으로 끝난다.

- [x] **Step 2: 전체 Node 테스트 실행**

  실행: PowerShell에서 `tests`의 모든 `.mjs` 파일을 `node --test`에 전달한다.

  결과: 157개 중 145개 통과, 12개 실패. 실패 테스트: `checklist-completion.mjs` (2), `general-route.mjs`, `long-task-continuation.mjs`, `loop-guards.mjs`, `mail-routing.mjs` (3), `photo-question.mjs`, `recovery-stall.mjs` (2), `work-progress.mjs`. 이전 전체 실행과 같은 실패 테스트들이며, 이번에 추가한 Gmail 경로 복구·차단된 화면의 저장 캡처 첨부 회귀 테스트는 통과했다.
