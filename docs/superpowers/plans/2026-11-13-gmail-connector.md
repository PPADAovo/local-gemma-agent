# Gmail 연결·상세 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex의 실제 Gmail 연결 상태와 계정 정보를 보여 주고, 첫 연결 안내 및 채팅에 요청 작성이 가능한 상세 화면을 추가한다.

**Architecture:** `gemma-plugins.mjs`가 명시적 요청 출처에 따라 Codex app-server와 기존 로컬 서비스 관리자를 분리한다. Gmail 프로필은 명시적으로 상세 화면을 열 때만 `gmail.get_profile`로 읽고, WPF 화면은 실제 상태·메타데이터를 표시하며 OAuth URL과 기존 채팅 작성 흐름을 호출한다.

**Tech Stack:** Node.js ES modules, `node:test`, C# WPF, .NET Framework `csc.exe`.

**Spec:** `docs/superpowers/specs/2026-11-13-gmail-connector.md`

## Global Constraints

- Gmail만 우선 구현하고, 기존 Codex app-server 인증 및 OAuth 연결을 재사용한다.
- 메일 주소는 Gmail 상세 화면을 열어 `gmail.get_profile`이 실제 반환한 값이 있을 때만 표시한다.
- OAuth를 마치고 돌아온 뒤 연결 상태를 다시 조회하며, 성공을 추측하지 않는다.
- 추천 요청은 채팅 입력란에만 작성하고 메일을 자동 조회·전송하지 않는다.
- 실제 서버 기능이 없는 연결 해제·삭제 버튼은 만들지 않는다.
- 사용자에게 표시되는 문구는 한국어로 작성한다.

## Review Focus

- Codex app-server가 꺼져 있거나 추가 승인이 필요한 경우: 실패를 연결 완료로 바꾸지 않고 오류와 재시도 경로를 보인다. (Task 1)
- Gmail이 미연결·비활성 상태이거나 app-list에서 숨겨진 경우: 플러그인 카탈로그로 Gmail 항목을 찾고 공급자 HTTPS 연결 경로를 제공한 뒤 복귀 후 상태를 재조회한다. (Task 1, Task 3)
- 프로필 조회가 실패하거나 계정 식별자가 없는 경우: 계정명을 추측하지 않고 계정 정보 미확인으로 표시한다. (Task 2, Task 3)
- 사용자가 추천 요청을 선택했을 때: Gmail 도구를 호출하지 않고 채팅 입력란만 채운다. (Task 3)
- 연결 해제 API가 없는 경우: 삭제·해제처럼 보이는 버튼을 표시하지 않는다. (Task 1, Task 3)

---

### Task 1: Codex 플러그인 요청 라우팅과 상세 상태

**Files:**
- Modify: `gemma-plugins.mjs`
- Test: `tests/gmail-connector.mjs`

**Interfaces:**
- Consumes: `managePlugins(request)`의 `source: "codex"`, `tab`, `slug: "gmail"`, `action` 요청.
- Produces: Codex 요청은 ID가 있어도 `localManager`가 아닌 app-server에 도달한다. 앱 목록에 접근 불가 Gmail이 없으면 실제 플러그인 카탈로그에서 항목을 보충한다. Gmail 상세 조회는 실제 플러그인 메타데이터, 활성 상태, 도구 목록, 공급자 HTTPS 연결 URL을 반환하며 미지원 필드는 생략한다.

- [ ] **Step 1: 실패 테스트 작성**

  `managePlugins`에 주입 가능한 app-server runner로 다음 동작을 검사한다.
  - `source: "codex"`와 `slug: "gmail"`의 `details` 요청이 `plugin/read` 및 실제 도구 상태를 조회한다. 로컬 서비스 처리기 오류가 발생하지 않는다.
  - 앱 목록에서 Gmail이 접근 불가로 누락된 경우에도 실제 플러그인 카탈로그를 통해 연결 항목을 반환한다.
  - 비활성 또는 도구 미노출 상태를 연결 완료로 표시하지 않는다.
  - 유효하지 않은 연결 URL을 외부 실행 대상으로 반환하지 않는다.
  - app-server 오류가 성공 결과로 바뀌지 않고 호출자에게 전달된다.

- [ ] **Step 2: 테스트가 의도한 이유로 실패하는지 확인**

  실행: `node --test tests/gmail-connector.mjs`

  예상: 현재 ID 요청이 로컬 서비스 관리자로 가는 문제 또는 Codex 요청 경로 부재로 실패한다.

- [ ] **Step 3: 최소 구현**

  `managePlugins`에서 `source === "codex"`를 로컬 탭/ID 분기보다 먼저 처리한다. `slug`로 app-server의 `plugin/list`에서 Gmail을 찾고, `plugin/read` 및 `mcpServerStatus/list`로 상세 상태를 구성한다. 앱 목록에 Gmail이 없으면 같은 실제 카탈로그에서 항목을 보충한다. 테스트는 실제 프로세스를 띄우지 않도록 app-server runner를 주입한다.

- [ ] **Step 4: 집중 테스트 통과 확인**

  실행: `node --test tests/gmail-connector.mjs`

  예상: Gmail ID가 Codex 경로를 타고 연결/비활성/오류 상태를 구별한다.

### Task 2: 실제 Gmail 프로필을 사용하는 연결 확인

**Files:**
- Create: `gmail-connector.mjs`
- Modify: `agent.mjs`
- Test: `tests/gmail-connector.mjs`

**Interfaces:**
- Consumes: Gmail 도구 호출 함수와 `gmail.get_profile`의 JSON 응답.
- Produces: `readGmailProfile(callTool)`은 검증된 프로필 객체를 반환하고, 잘못된 응답·호출 오류는 명시적으로 전달한다. `gmailDetailData(callTool)`은 프로필에서 실제 계정 식별자만 골라 `account`로 반환하고, 연결 전에도 쓸 수 있는 `suggestions`를 함께 제공한다. `gmailConnection` RPC는 이 응답을 돌려준다.

- [ ] **Step 1: 실패 테스트 작성**

  `readGmailProfile`이 실제 `gmail.get_profile` 도구를 호출하는지, 응답의 실제 계정 식별자만 보존하는지, 잘못된 JSON·도구 오류를 숨기지 않는지 검사한다. 테스트에 합성 프로필만 사용한다.

- [ ] **Step 2: 테스트가 의도한 이유로 실패하는지 확인**

  실행: `node --test tests/gmail-connector.mjs`

  예상: 현재 연결 확인 RPC가 라벨 개수만 반환하고 계정 정보·추천 요청을 구성하지 않아 실패한다.

- [ ] **Step 3: 최소 구현**

  `gmail-connector.mjs`에서 `gmail.get_profile`을 호출하고 JSON 객체를 검증한다. `gmailDetailData(callTool)`은 `emailAddress` 또는 `email` 필드가 실제 문자열일 때만 계정으로 노출한다. `agent.mjs`의 `gmailConnection` RPC가 이 함수를 사용하며 원본 프로필 전체를 화면으로 전달하지 않는다.

- [ ] **Step 4: 집중 테스트 통과 확인**

  실행: `node --test tests/gmail-connector.mjs`

  예상: 프로필 성공, 식별자 누락, malformed 응답, 도구 오류 사례가 구별된다.

### Task 3: Gmail 상세 화면과 첫 연결 안내

**Files:**
- Modify: `DesktopRailPages.cs`
- Test: `node --test tests/gmail-connector.mjs`

**Interfaces:**
- Consumes: Task 1의 Gmail 상세 상태와 Task 2의 `gmailConnection` 프로필 응답.
- Produces: Gmail 항목에서 상세 화면을 열어 실제 연결 상태, 제공되는 계정·앱 정보, 도구, OAuth 연결/계정 관리 경로를 본다. 추천 요청은 `ComposeRail`로 채팅 입력란에 작성한다. 연결 상태와 계정 조회 오류는 구별해 표시한다.

- [ ] **Step 1: 실패 테스트 또는 검증 가능한 동작 작성**

  Gmail 상세 데이터의 추천 요청이 연결 전에도 제공되고, 프로필에 계정 주소가 없으면 `account: null`임을 기존 테스트로 고정한다. 추천 요청 UI는 `ComposeRail`만 호출하고 Gmail 도구는 직접 실행하지 않는다.

- [ ] **Step 2: 테스트가 의도한 이유로 실패하는지 확인**

  실행: `node --test tests/gmail-connector.mjs`

  예상: 현재 일반 알림만 보여 주는 상세 흐름에 필요한 실제 메타데이터·상태가 테스트에서 누락되어 실패한다.

- [ ] **Step 3: 최소 UI 구현**

  Gmail 앱 항목을 상세 화면으로 연결한다. 연결되지 않은 경우에만 공급자가 반환한 HTTPS URL을 여는 연결 버튼을 보이고, 복귀 후 새로고침으로 상태를 재확인한다. 연결된 경우 계정은 실제 프로필 응답이 있을 때만 표시한다. 추천 요청은 입력란에 작성하며 지원되지 않는 연결 해제 버튼은 추가하지 않는다.

- [ ] **Step 4: 전체 검증**

  실행: `node --test tests/gmail-connector.mjs`

  예상: Gmail 연결·상태·프로필 테스트 통과.

  실행: `node --test`

  예상: 전체 Node 테스트 결과를 확인하고 기존 실패도 이름과 함께 기록한다.

  실행: `.\build-desktop.ps1`

  예상: WPF 데스크톱 앱 컴파일 성공.

  수동 확인: Gmail 상세 화면에서 연결 상태와 실제로 제공되는 계정만 표시되고, OAuth 안내·복귀 후 새로고침·추천 요청 입력이 동작한다.
