# Recovery Stall Implementation Plan

**Goal:** Fix the reported screenshot/tool recovery loop without interrupting productive long tasks.
**Architecture:** Bound failures since new substantive evidence in the shared loop; provide actual tool contracts to recovery selection. Preserve existing local execution and permission checks.
**Tech Stack:** Node.js ESM, node:test.
**Spec:** User screenshots and request to fix repeated failed routes in this conversation.

## Global Constraints
- Preserve personal data and local model configuration; back up modified source.
- Do not send mail as part of testing.

## Review Focus
- Different argument strings must not bypass the failure limit.
- Successful guide reads must not erase operation failures.
- A genuinely new successful observation must permit recovery.
- Productive long tasks must continue across step batches.
- Recovery must know screenshot, recording and service argument contracts.

## Task 1: Recovery loop
- [x] Add and run failing integration tests in tests/recovery-stall.mjs using runAgentLoop.
- [x] Modify agent-loop.mjs: enforce failure budget before choosing another route; track failures across guide reads; send TOOL_GUIDE to recovery. Validate recording/service/skill arguments before execution and retain screenshot artifacts and completion evidence.
- [x] Modify route-choice.mjs: include supplied tool contracts in the recovery prompt.
- [x] Verify new tests, existing loop/recovery tests and full Node suite; report runtime verification limits.

## Verification
- New regression tests: 10 passed. Real runAgentLoop with deterministic model and tool fixtures; not a live Gemma/Gmail run.
- Syntax checks passed for both changed modules.
- Full suite: 125 tests, 113 passed, 12 failed. See `복구기록/반복복구-9c24aaeb/tests-final.log` for exact failing test names and assertions.
- The first 11 failing tests reproduce with the original modules in `tests-baseline.log`. The additional screenshot-email tool-filter test appeared in mail-routing.mjs during this task and also fails with the original modules; see `mail-baseline-final.log`.
- Existing failures cover checklist/browser handling, window targeting, long-task continuation, rejected-reply wording, mail routing, photo questions and plan approval. No claim that these are repaired.
- Desktop.cs starts a fresh `node agent.mjs --rpc` process per request. New requests load these changes; an already running request retains the old module.
- Original modules preserved in `복구기록/반복복구-9c24aaeb`.
