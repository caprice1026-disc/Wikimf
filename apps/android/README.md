# Android Reader

Kotlin/Compose reader for Japanese and English Wikipedia. The Wikipedia WebView remains mounted while Search or Account is shown. Local article navigation history and cloud recording each require a separate opt-in; guest navigation is available without linking. Google/GitHub login and destructive account operations open the Dashboard in a separate browser.

Pinned toolchain: JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, Android API 35, minSdk 26. These are reproducible adopted versions, not a claim that they are the latest release. `org.wikimf.reader` is a development application ID; publication and release signing require the operator's final identifier/key.

```powershell
python apps/android/bootstrap.py
powershell -ExecutionPolicy Bypass -File apps/android/build.ps1
```

`bootstrap.py` installs tools under ignored `.tooling` only, presents/accepts the Android SDK license, and preserves global installations. Existing `JAVA_HOME` and `ANDROID_HOME` can be used. Node must be available for the shared tracker bundle. Build output: `app/build/outputs/apk/debug/app-debug.apk`. Unit reports: `app/build/reports/tests/testDebugUnitTest`; lint: `app/build/reports/lint-results-debug.html`. Debug signing keys stay in `.tooling` and are never release keys.

## Implementation decisions

Native SQLiteOpenHelper transactions provide the proposed Room persistence contract without an additional code-generation plugin. Queue rows bind permanently to the creating owner/device, preserve an immutable payload once pending article resolution is finalized, and remove only item ACKs. Credential storage is separate, encrypted with an Android Keystore AES-GCM key. Failed, expired and deleted-generation events are quarantined with visible counts. A 10 MiB queue stops new recording instead of overwriting existing records. Seven-day expiration is visible quarantine, rather than silent eviction.

Only exact Japanese/English HTTPS origins receive the AndroidX WebKit observation bridge. Each message is checked again for main-frame origin, payload size/rate, native-issued session ID, increasing sequence, interval/chunk validity and immutable document metadata. No token/user ID goes to Wikipedia JS. Older WebViews without the safe bridge retain Reader functionality and explain that measurement is unavailable. Tracker injection occurs after page readiness and never backfills missed time. Same-page anchors preserve the document session.

Search calls Wikipedia directly, with 300 ms debounce, IME composition suppression, actual HTTP cancellation and request generation checks. Only articles actually opened enter the local search history. Search errors, empty results and loading are separate; HTML excerpts render as text.

Foreground saves use WorkManager as a durable retry trigger, not a ten-second background guarantee. ACKs handle partial success, 413 splits, 422 quarantine, Retry-After and jittered backoff; 401/403 wait for explicit re-linking. Current recording controls are fetched before replay so epoch/article deletion markers reject old pending rows. Statistics and the three reading states use the server's owner-checked responses; manual state and privacy controls link to Dashboard.

## Emulator / ST checks

Build and JVM checks alone do not prove WebView lifecycle or actual provider login. With an API 35 emulator/device connected, run:

```powershell
powershell -ExecutionPolicy Bypass -File apps/android/build.ps1 -Tasks connectedDebugAndroidTest
# For a restricted desktop host where Gradle UTP cannot collect results:
powershell -ExecutionPolicy Bypass -File apps/android/test-device.ps1
```

Instrumentation checks real SQLite reopen/immutability/account isolation/deletion epoch and Keystore encryption. For the complete smoke test, install the debug APK, enter the real HTTPS `/api/v1` URL in Account, approve the displayed device code through Google and GitHub in a browser, return and confirm linking, enable Dashboard collection plus native cloud consent, and read an article actively for at least 30 seconds. Verify its owner, intervals, time and state in Dashboard. Repeat offline recovery, Account/Search/background pause, article/full deletion with a saved old queue, and unlink/re-link to a different account. Inspect only synthetic accounts and redact credentials from evidence. Real provider registration, HTTPS service reachability and final release signing remain operator prerequisites.

Debug builds alone permit HTTP to `10.0.2.2`, `127.0.0.1` and `localhost` for local integration tests. Release builds require HTTPS. No arbitrary external cleartext API is accepted.
