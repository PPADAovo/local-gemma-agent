# Dynamic service agent implementation plan

**Goal:** Extend the existing local model agent with discovered native service tools and bounded, recoverable observations.
**Architecture:** Keep the existing model loop and executor (including account connections and permissions). Register schemas returned by service_search for the current run, map safe aliases to plugin_call, and store long observations for on-demand reading.
**Tech Stack:** Node.js ES modules and node:test; existing local model tool calling.
**Spec:** User's 2026-11-19 request to implement an agent that selects and executes multiple tools.

## Constraints and review focus
- Work in the Desktop copy; preserve unrelated concurrent edits.
- Do not change model selection, credentials, or permission policy.
- Existing generic service_call remains available for schemas not advertised.
- Invalid native arguments never reach execution; unknown aliases never run.
- Long results must be recoverable without repeating a potentially mutating call.
- Each run owns its registry and result store; no cross-chat data leakage.
- External integrations are simulated in tests; do not send messages or mutate accounts.

## Tasks
- [x] Test a search → native service tool → follow-up tool sequence in tests/dynamic-service-agent.mjs.
- [x] Add service-agent-runtime.mjs with schema registration, alias routing, basic argument validation, and paged observation storage.
- [x] Integrate discovery and result reading into simple-loop.mjs without bypassing execute.
- [x] Test invalid arguments, alias isolation, result retrieval, and unchanged permission/executor routing.
- [x] Run targeted tests and the full tests/*.mjs suite; review changes and report live-model limitations.

## Verification
- Targeted final tests: 20 passed (7 new runtime/integration tests).
- Initial full suite: 481 passed, 1 skipped; final regression rerun tracked in this chat.
- Live existing plugin bridge: 15 Calendar tools discovered, 5 events read successfully.
- Two self-review passes; no independent reviewer.
- Native service selection was tested with scripted model responses, not a live local model making the complete Calendar decision sequence.
- Existing cloud-model selection is preserved. Select a local model and the existing simple execution mode to use native service schemas.
- Input validation covers basic schema types, required fields, enums, numeric bounds, arrays and combinations, not the complete JSON Schema standard.
