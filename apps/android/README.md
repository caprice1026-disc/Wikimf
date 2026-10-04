# Android Reader

Kotlin/Compose reader for Japanese and English Wikipedia. The Wikipedia WebView remains mounted while Search or Account is shown. Local article navigation history and cloud recording each require a separate opt-in; guest navigation is available without linking. Google/GitHub login and destructive account operations open the Dashboard in a separate browser.

Pinned toolchain: JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, Android API 35, minSdk 26. These are reproducible adopted versions, not a claim that they are the latest release. `org.wikimf.reader` is a development application ID; publication and release signing require the operator's final identifier/key.

```powershell
python apps/android/bootstrap.py
powershell -ExecutionPolicy Bypass -File apps/android/build.ps1
```

`bootstrap.py` installs tools under ignored `.tooling` only, presents/accepts the Android SDK license, and preserves global installations. Existing `JAVA_HOME` and `ANDROID_HOME` can be used. Node must be available for the shared tracker bundle. Build output: `app/build/outputs/apk/debug/app-debug.apk`. Unit reports: `app/build/reports/tests/testDebugUnitTest`; lint: `app/build/reports/lint-results-debug.html`. Debug signing keys stay in `.tooling` and are never release keys.

## Implementation decisions

Native SQLiteOpenHelper transactions provide the proposed Room persistence contract without an additional code-generation plugin. Queue rows bind permanently to the creating owner/device, preserve an immutable payload once pending article resolution is finalized, and remove only item ACKs. Terminal rejection, seven-day expiration, old recording epochs and article deletion remove the full payload and pending URL, leaving only event ID, owner, safe code and timestamp in a separate diagnostic table capped at 100 rows across the device. SQLite secure deletion is enabled. Database version 2 migrates existing quarantine rows to these bounded diagnostics while preserving active queue rows and article history. The 10 MiB limit counts only active queue payloads and stops new recording instead of overwriting records.

Credential storage is separate, encrypted with an Android Keystore AES-GCM key. Changing the API URL clears credentials and cloud consent before publishing the new destination, while preserving the old owner's queue. A request holding an earlier device credential is refused before HTTP if it differs from the current linked device. Setting the same URL, including a trailing slash, preserves the link.

Only exact Japanese/English HTTPS origins receive the AndroidX WebKit observation bridge. Each message is checked again for main-frame origin, payload size/rate, native-issued session ID, increasing sequence, interval/chunk validity and immutable document metadata. No token/user ID goes to Wikipedia JS. Older WebViews without the safe bridge retain Reader functionality and explain that measurement is unavailable. Tracker injection occurs after page readiness and never backfills missed time. Same-page anchors preserve the document session.

Search calls Wikipedia directly, with 300 ms debounce, IME composition suppression, actual HTTP cancellation and request generation checks. HTTP 429 establishes a process-wide, per-wiki monotonic deadline using Retry-After seconds or HTTP-date; invalid/missing values use 30 seconds. Cancellable retries and reopening Search respect the deadline, and only the latest query generation continues. Only articles actually opened enter the local search history. Search errors, empty results and loading are separate; HTML excerpts render as text.

Foreground saves use WorkManager as a durable retry trigger, not a ten-second background guarantee. ACKs handle partial success, 413 splits, 422 diagnostics, Retry-After and jittered backoff; 401/403 wait for explicit re-linking. Current recording controls are fetched before replay so epoch/article deletion markers remove old queue payloads locally. When cloud consent or server collection is OFF, control cleanup remains allowed and pending URL resolution and event batches are suppressed. Reader resolution refreshes the same control immediately before sending the URL; control failure keeps the Wikipedia page available and suppresses resolution. A shared API guard rechecks permission before every resolve/batch request. Account explains that unsent rows remain local until reconsent and server collection are enabled, and provides an OFF-state discard action. Statistics and the three reading states use the server's owner-checked responses; manual state and privacy controls link to Dashboard.

Browser management links use the public `dashboard_url` returned by anonymous `GET /api/v1/config`. The validated origin is cached for the configured API; changing the API clears that cache. Offline/older servers retain the cached origin or use the API's origin. Overview, article/library and privacy paths are `/app`, `/app/articles/{id}` or `/app/library`, and `/app/settings/privacy`. Pairing URLs must match the configured Dashboard origin and displayed grant. Only a debug emulator configured with API host `10.0.2.2` maps the server's loopback Dashboard host to `10.0.2.2`; HTTPS release URLs retain their declared host.

## Emulator / ST checks

Build and JVM checks alone do not prove WebView lifecycle or actual provider login. With an API 35 emulator/device connected, run:

```powershell
powershell -ExecutionPolicy Bypass -File apps/android/build.ps1 -Tasks connectedDebugAndroidTest
# For a restricted desktop host where Gradle UTP cannot collect results:
powershell -ExecutionPolicy Bypass -File apps/android/test-device.ps1
```

Instrumentation checks real SQLite reopen/immutability/account isolation/deletion epoch and Keystore encryption. Privacy regressions migrate an actual v1 database and use an emulator loopback HTTP server to verify control-only traffic while OFF and resolve/batch replay after reconsent. They use a separate device-protected storage realm, preserving the actual Reader account. For the complete smoke test, install the debug APK, enter the real HTTPS `/api/v1` URL in Account, approve the displayed device code through Google and GitHub in a browser, return and confirm linking, enable Dashboard collection plus native cloud consent, and read an article actively for at least 30 seconds. Verify its owner, intervals, time and state in Dashboard. Repeat offline recovery, Account/Search/background pause, article/full deletion with a saved old queue, and unlink/re-link to a different account. Inspect only synthetic accounts and redact credentials from evidence. Real provider registration, HTTPS service reachability and final release signing remain operator prerequisites.

The live-page focus regression runs only when explicitly enabled against an already linked synthetic account with cloud recording enabled:

```powershell
adb -s emulator-5554 shell am instrument -w -e native_smoke true -e class org.wikimf.reader.ReaderFocusRegressionTest org.wikimf.reader.test/androidx.test.runner.AndroidJUnitRunner
adb -s emulator-5554 shell am instrument -w -e native_dashboard_smoke true -e class org.wikimf.reader.DashboardLinkIntegrationTest org.wikimf.reader.test/androidx.test.runner.AndroidJUnitRunner
```

The second command exercises the real Compose management buttons against the local API at `10.0.2.2:8000` with Dashboard origin `localhost:5173`. It captures the browser intents without signing in or accepting browser terms. Without their explicit flags, these external-service tests are skipped; the default runner's total is not evidence that they passed. [VERIFICATION.md](VERIFICATION.md) records the actual emulator run and its limits. An unsigned release APK can be built with `build.ps1 -Tasks assembleRelease`; the final release identifier, HTTPS API address and signing key must be supplied before distribution.

Debug builds alone permit HTTP to `10.0.2.2`, `127.0.0.1` and `localhost` for local integration tests. Release builds require HTTPS. No arbitrary external cleartext API is accepted.
