# Shared Wikipedia tracker

`node packages/tracker/build.js` produces `dist/wiki-tracker.js` (classic isolated-world script) and `dist/android-tracker.js` (the same core plus the origin-restricted native adapter). There are no runtime dependencies. The source module also exports its pure measurement functions for `node:test`.

The policy is `reading-v1`: 200-code-point chunks, NFC normalization, whitespace excluded, 50% visibility bracketed by samples for two cumulative active seconds, 60-second idle grace, gaps above two seconds excluded, and snapshots every ten seconds. Reading-state inference follows the detailed design; the server remains authoritative. Covered chunks never increment twice within a session. Text lives only in memory for extraction/fingerprinting and is absent from observation payloads.

The adapter includes prose paragraphs/lists, excludes references/navigation/infoboxes/galleries, preserves structurally present collapsed body sections in the denominator, and falls back to `time_only` for empty/missing/oversize bodies. `IntersectionObserver` narrows candidates; a long paragraph measures only nearby ranges. Unusual layouts, obstructions, visual attention, audio reading, and very quiet reading are limitations of the estimate.

Android injects public `WKMF_CONTEXT={article,deviceId,epoch,sessionId,active}` and the native origin-restricted `WikimfObservation.postMessage` bridge. Tokens and account IDs never enter that context. `WKMF_NATIVE.setActive(boolean)` pauses/resumes host eligibility; `stop(reason)` ends the session. A changed extracted body emits `{kind:"document_changed"}` so native code can issue a fresh session ID. Same-context reinjection is idempotent.

Verification: `node --test --experimental-test-isolation=none packages/tracker/test/tracker.test.js`. Windows sandbox process isolation can otherwise cause `spawn EPERM`. The extension's Chrome smoke also exercises the core against real DOM fixtures.
