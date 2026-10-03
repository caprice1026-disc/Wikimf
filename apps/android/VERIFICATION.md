# Android verification — 2026-10-04 JST

The Reader was built and exercised on an actual API 35 x86_64 emulator using Windows Hypervisor Platform and WebView 124.0.6367.219. Wikipedia search and page rendering used the public English Wikipedia. Device approval/exchange, event ingestion, item ACKs, statistics and persistence used the real local FastAPI service and PostgreSQL 17.6. OAuth identity and MediaWiki metadata were synthetic test fixtures; these results do not substitute for production provider registration or HTTPS deployment.

| Check | Observed result | Evidence |
| --- | --- | --- |
| JVM boundary / Dashboard URL / search cooldown tests | 10 passed, 0 failed | `app/build/test-results/testDebugUnitTest/TEST-org.wikimf.reader.BoundaryTest.xml`, `TEST-org.wikimf.reader.DashboardUrlsTest.xml`, `TEST-org.wikimf.reader.SearchCooldownTest.xml` |
| Native persistence / Keystore | 2 passed, 0 failed | [persistence.txt](verification/persistence.txt) |
| Explicit live-page focus regression | 1 passed, 0 failed in 26.046 seconds; `native_smoke=true` | [native-smoke.txt](verification/native-smoke.txt) |
| Explicit management button / browser Intent regression | 1 passed, 0 failed in 5.356 seconds; actual Overview and Privacy `ACTION_VIEW` values captured | [dashboard-intents.txt](verification/dashboard-intents.txt), [dashboard-links.json](verification/dashboard-links.json) |
| Final APK native suite | 4 passed, 0 failed in 28.407 seconds; both external-service flags enabled; includes API destination credential boundary | [native-final-suite.txt](verification/native-final-suite.txt) |
| Debug build / lint | Build succeeded; lint 0 errors, 9 warnings | `app/build/reports/lint-results-debug.html` |
| Unsigned release build | `assembleRelease` succeeded | [Artifact size and SHA-256](verification/native-e2e.json) |
| Linked native recording / shared owner stats | Earth session accepted 120,629 ms, nonzero coverage, `partial`, no quarantine; outbox drained to 0 | [native-e2e.json](verification/native-e2e.json) |
| Account pause | Accepted time remained 44,980 ms over a 12-second observation after settling | [native-e2e.json](verification/native-e2e.json) |
| Real offline recovery | Wi-Fi/data disabled: 2 durable rows; restored: 0 rows, accepted cumulative time 81,821 ms, no quarantine | [offline-observation.json](verification/offline-observation.json) |
| Android Home / background pause | Accepted time remained 34,989 ms over 12 seconds; foreground return preserved session and position | [background-pause.json](verification/background-pause.json) |
| Reader → Search → Reader | URL, scrollY 1800, history and session preserved; WebView regained focus | [lifecycle-observations.json](verification/lifecycle-observations.json) |
| Same-page fragment | Session preserved | [lifecycle-observations.json](verification/lifecycle-observations.json) |
| Activity recreation / rotation | Moon position 1030.545 preserved in landscape and portrait; each recreation started a new session | [lifecycle-observations.json](verification/lifecycle-observations.json) |
| Native back / forward after recreation | Earth → Moon search-history navigation, back to Earth, forward to Moon; Moon position restored | [lifecycle-observations.json](verification/lifecycle-observations.json) |

The focus regression reproduced the search/native controls retaining input focus, then confirmed that Reader requests WebView focus before measuring. A `loadDataWithBaseURL` fixture with a final `about:blank` URL was rejected by the trusted-document check; successful recording used the actual Wikipedia URL. The strict main-frame/origin boundary remains enabled.

The final native passing count is four: two persistence tests, one explicit live-page focus test and one explicit management Intent test. All four ran together on the final APK after the search cooldown and credential boundary changes. Earlier individual test timings are retained in their separate logs. The ordinary instrumentation run skips the external-service tests unless explicitly enabled; skipped cases are not included in these counts. Gradle's UTP result collector failed in this restricted Windows host; the actual AndroidJUnitRunner results were obtained directly through adb and are retained separately.

The Keystore persistence test uses a separate device-protected storage realm and verifies that setting the same API URL or a trailing-slash variant preserves credentials and consent. Changing the destination clears both before publishing the new URL, preserves the old owner/device queue, and rejects an already captured old credential before any HTTP request. The actual linked test account remains in credential-protected storage and was preserved.

The three search cooldown regressions cover Retry-After seconds, HTTP-date, past dates, invalid-value fallback and overflow; independent wiki deadlines, extension and expiration; and cancellation of an earlier query while the latest generation waits for the retained deadline. An actual injected HTTP 429 UI scenario remains ST-06.

The API's public config returned `http://localhost:5173`; the debug emulator cached `http://10.0.2.2:5173` independently of its API at port 8000. Real Compose button clicks produced `http://10.0.2.2:5173/app` and `http://10.0.2.2:5173/app/settings/privacy`. A separate physical click launched Chrome with the privacy URL. Chrome remained on its first-run screen, without terms acceptance or sign-in; completed browser login/navigation remains ST. Initial automation attempts could not search Compose virtual nodes or scroll its lazy list; native-tree traversal and a touch swipe corrected the test harness. Failed attempts are not passing tests.

The remaining lint warnings concern synchronous preference persistence, intentionally pinned dependency versions and backup rules with backup disabled. Release publication still needs the final application identifier, release signing key, real HTTPS API, Google/GitHub registrations and physical-device ST. Reader renderer-crash recovery and full deletion/re-link scenarios remain part of ST, with backend/native isolation regressions covering their data boundaries locally. No account deletion or shared test-owner unlink was performed.

Tool downloads, emulator files, caches, debug keys and local database snapshots are ignored under `.tooling`. Evidence files contain no tokens, OAuth secrets, cookies or device-link secrets. Wi-Fi/data and rotation settings were restored after testing.
