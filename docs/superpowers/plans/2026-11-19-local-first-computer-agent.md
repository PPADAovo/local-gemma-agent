# Local-first computer agent implementation plan

**Goal:** Make local inference, grounded execution and verification the normal route; consult a configured external AI only after a concrete local limitation.
**Architecture:** Preserve the existing executor and permission boundaries. Provider routing operates on the current inference context, never replays a completed workflow. Desktop actions require current observations and post-action inspection. Creative app capabilities are discovered locally and routed through existing tools.
**Tech Stack:** Node ES modules, Ollama, existing provider bridges, Windows PowerShell/UI Automation, C# WPF.
**Spec:** User request in this chat on 2026-11-19: audit AI interaction, planning, execution, computer use, skills/tools, and design/editing/Adobe support.

## Constraints
- Local first by default; explicit cloud-only override must remain distinguishable.
- Permission refusal, cancellation and missing authentication are not invitations to bypass controls via another AI.
- Never replay side effects when changing inference provider.
- Inspect installed/versioned app capabilities before selecting scripts or UI workflows. Do not claim all Adobe or CAD operations are supported.
- Preserve user projects and unrelated edits. Live tests use temporary fixtures and read-only service requests.
- Audit active sources; record automated inspection separately from manual review. Exclude historical backups, vendored binaries and user content from claims of source review.

## Work packages
- [x] Provider review and tested local-first fallback in conversation/model routing.
- [x] Screen review and tested observe → act → observe loop, target validity and supported gestures.
- [x] Tool/skill inventory and creative-app capability discovery, supported local routes and verification guidance.
- [x] Integrate executor bootstrap, bounded assistance escalation and creative discovery into legacy planner.
- [x] Inventory active source files; syntax/build checks, full regression tests and controlled live tests.
- [x] Cross-review changes; report completed implementation, verified behavior and unresolved limitations separately.

## Final evidence and limits
- Latest regression (excluding slow live injection test): 541 pass, 0 fail, 1 skip; live injection test separately passed during full run.
- Full run exposed manual handoff regression; fixed and included in passing latest regression.
- 169 active root sources inventoried; 121 JS/PS syntax checks, six Python AST checks, 28-file C# build and installed executable integrity pass.
- Qwen3.5:9b live read/edit/read preserved exact contents and newline; full rewrite initially lost newline and was recorded as failure.
- Sub-Gemini live synthetic response succeeded in 8,886ms. Blender saved/reopened test .blend and verified dimensions [2,3,4].
- Created local creative-apps and local-first-recovery skills; existing connectors reused.
- Built executable installed with prior executable preserved in app backup directory. Existing GUI was not terminated.
- Actual autonomous Premiere UI editing, uninstalled Adobe/CAD products, and every provider's long-running multimodal behavior remain unverified; no claim of universal mastery.

## Review focus
- Current selected cloud provider must not skip a local attempt by default.
- External fallback must retain original request, observations, and prior execution receipts.
- Two actions in one model response must not reuse a stale screenshot.
- File export alone is not proof of native editable project completion.
- Empty tool results, invalid schemas, repeated failed actions and unavailable tools must not produce false completion.
