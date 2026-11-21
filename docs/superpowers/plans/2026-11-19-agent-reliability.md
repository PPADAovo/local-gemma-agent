# Agent reliability implementation plan

**Goal:** Fix observed false completion, tool metadata failures, recovery loops, and misleading model selection descriptions.
**Architecture:** Preserve existing tool boundaries and explicit model choices. Validate evidence before checklist completion; retain structured metadata independently of abbreviated observations.
**Tech Stack:** Node.js tests, Windows WPF C#.
**Spec:** User request in this chat, 2026-11-19; observed runtime log of the same date.

## Constraints and review focus
- Never send real mail as a test; simulate external tool boundaries.
- Preserve existing Desktop changes and do not overwrite the Documents copy wholesale.
- Failed send plus unrelated successful read must not complete delivery.
- Read-only tool discovery must remain usable after repeated searches.
- Existing recording path support must be tested before further changes.
- Manual model selection remains explicit; automatic fallback must describe its actual policy.

## Ordered tasks
- [x] 1. Add regression tests in tests/reliability-regression.mjs; reject unchecked jumps and unrelated evidence in agent-loop.mjs. Run checklist/check-after tests.
- [x] 2. Preserve plugin metadata and avoid parsing failure strings; handle non-retryable service errors without encouraging blind retries. Add controlled-loop regression tests.
- [x] 3. Test existing desktopRecordingPath support and ensure original user requirements govern final completion checks.
- [x] 4. Test automatic escalation and make UI automatic-selection wording match GPU-first behavior; preserve manual preferences.
- [x] 5. Replace unsupported commercial-model equivalence labels with factual capability/measurement wording.
- [x] Run full Node test suite, review changed files, build desktop executable separately and install when safe.
