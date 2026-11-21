# Browser quality gate implementation plan

**Goal:** Before completion, inspect real browser pixels, repair deficiencies, and reject unverified or regressed results.
**Architecture:** A shared per-request guard captures existing HTML before mutations, captures fresh desktop/mobile renders before completion, and returns actionable gaps to both execution loops. Browser capture and structured visual audit fail closed. Keep the original baseline through repairs; no automatic rollback of unrelated edits.
**Tech Stack:** Node.js, existing Chrome CDP preview, pngjs, node:test.
**Spec:** User request in this chat, including autonomous repair before completion.

## Constraints and review focus
- Both normal and simple execution modes must enforce the gate.
- New HTML has no baseline; existing HTML must have a pre-edit baseline.
- Relevant CSS/JS edits and detected content-writing commands invalidate prior evidence. File moves, copies, renames and read-only listings do not trigger design reviews.
- A screenshot path or source read is not visual proof. Compare actual pixels at matching viewport sizes.
- Missing capture, malformed audit, regression or incomplete requirements block success.
- Repair attempts are bounded and retain concrete unresolved gaps.

## Tasks
- [x] Add failing loop tests for repair, missing screenshot, regression and stale validation.
- [x] Implement web-quality.mjs lifecycle and browser.mjs desktop/mobile capture with layout diagnostics.
- [x] Wrap execution and gate replies in agent-loop.mjs and simple-loop.mjs.
- [x] Run node --test tests/*.mjs, inspect actual browser captures of normal and broken fixtures, and review final changes.

## Additional user requirements and observed regressions
- Ask where to create a new website before writing. Create a unique child project directory there; preserve previous files. Apply to normal and simple loops, including follow-up creation wording.
- Block unrelated image generation during file transfer. AI-generated pictures are never evidence of a completed file operation.
- Limit browser review to the actual HTML target or pages referencing an edited asset, rather than every sibling HTML.
- Compare each viewport separately, with BEFORE/AFTER labels rendered into the comparison image. A four-panel composite made the mobile preview too small for reliable local-model review.
- Real Chrome plus gemma4:12b test: broken desktop and mobile rejected; restored desktop and mobile accepted. Evidence: 복구기록/browser-quality-20261115/model-live-YJGCvC/model-verdicts.json.
- Two existing Gemini test fixtures were brought into line with their current production interfaces (selectedBrain and gemini-session); no production account/configuration changes.

## Practical scope
This gate renders local HTML and linked assets. It is not a general frontend development-server launcher or a functional interaction test. Unsupported/missing page evidence fails closed. Visual model judgments can still be imperfect; structural measurements and explicit repair limits remain enforced.

## Final verification (2026-11-15)
- Full Node suite including real Chrome: 304 passed, 0 failed, 0 skipped. Log: 복구기록/browser-quality-20261115/suite-final-304.txt.
- Additional real gemma4:12b visual review: both broken viewports rejected; both repaired viewports accepted. Log: 복구기록/browser-quality-20261115/live-model-viewport-test.txt.
- Original 4-panel visual review produced false positives for mobile. Final production audit uses one viewport per request with paired labelled screenshots and browser-measured bounds.
- Normal/simple repair loops, destination selection, no-write-before-answer, preserving original files, pure transfer exclusions, unrelated HTML exclusion and image-generation misrouting have regression coverage.
- Desktop.cs creates a new Node RPC process for each request; changes load on the next request without rebuilding the desktop executable.
