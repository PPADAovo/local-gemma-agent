# Agent integrity repair implementation plan

> Execute bounded component tasks with independent review and a final integrated review. User authorized implementation and both copies; no additional approval gate.

**Goal:** Resolve the 49 reviewed findings, test their failure conditions, inspect all modified code, and synchronize original and copy.

**Architecture:** Preserve the current Node/PowerShell/WPF architecture. Enforce policies at execution boundaries, preserve evidence through completion and compaction, and make desktop cancellation/lifecycle bounded. Use shared helper modules only where they make actual behavior testable.

**Tech Stack:** Node ESM, Windows PowerShell 5.1, .NET Framework WPF.

**Spec:** 보관/검사결과/에이전트-전체검토-2026-11-16.json (finding IDs 1–49).

## Constraints
- Work in Documents copy; snapshot first, synchronize only reviewed changed files to Desktop original.
- Do not modify personal settings/history or execute real outgoing messages for tests.
- No wholesale tree synchronization, secret output, or restart of an active user task.
- Preserve current tool interfaces and truthful progress/outcomes; correct prior false positives with evidence.

## Review focus
- Composite tasks: email success must preserve remaining requirements.
- In-place preservation and paginated evidence: original plus resulting observations required.
- Cancellation and delayed model/child process responses: stop without orphan work or UI freeze.
- Multiple windows and parallel child tasks: scoped mutable state and settings merges.
- Windows aliases, links, long UI names, malformed protocol JSON: fail safely and remain usable.

## Tasks
- [x] Loop/conversation: IDs 1–8,12,15,49 (loop portion). Add behavioral regression tests before changes; run loop and routing tests. Preserve proper task budgets and child evidence; constrain post-handoff tools.
- [x] Executor: IDs 16–28,47 (attachments backend),49 (executor portion). Add testable boundary functions where needed; verify project root, generated attachment chain, policies, timeouts, retained events and startup state.
- [x] Desktop: IDs 32,36–48 (Desktop parts). Add meaningful .NET harness checks; fix async lifecycle, settings merge, recovery integrity, secret entry, responsiveness. Build isolated exe before replacing copies.
- [x] Verification/policy/computer: IDs 9–11,13–14,29–31,33–35. Add failing tests for evidence, schema, compaction, approval scoping, command classification and key normalization, then implement and rerun.
- [x] Integrated verification: full Node suite, PS 5.1 parsing, WPF compile and applicable UI harnesses. Review changed source and cross-file interfaces; fix findings and rerun affected checks.
- [x] Sync reviewed source/tests/build artifacts to original and verify SHA-256. Record each of the 49 dispositions with tests and any unresolved real-environment limits.

Final evidence: 2026-11-17 installed original Node suite 452 tests, 451 passed, 0 failed, 1 skipped; Desktop integrity 32 checks passed; product source 145 files identical across both locations. See 보관/검사결과/수정검증-2026-11-17.txt for limits and restart requirement.
