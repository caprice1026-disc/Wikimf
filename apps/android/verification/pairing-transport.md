# Android pairing transport — Issue #14

The explicit `PairingTransportIntegrationTest` passed on the API 35 emulator in 6.646 seconds, using the actual Android `Api`, local FastAPI/PostgreSQL service, device-code hash verification, token exchange and authenticated `/me` request. [native-pairing-suite.txt](native-pairing-suite.txt) and [pairing-transport.json](pairing-transport.json) retain the result separately from the earlier eight-test privacy suite.

The Android start response supplied its confirmation code only to the originating device. The host helper verified that authenticated Web GET contained no code, approved the private ephemeral code with the QA Web cookie and CSRF token, and checked that native exchange authenticated the same QA owner with source `android_reader`. The new test device was revoked after verification. All existing device revocation states were unchanged; native credentials and article history stayed in their original credential-protected realm. The test used isolated device-protected storage and reset its temporary link afterward.

To reproduce against the local synthetic QA service and existing emulator:

```powershell
& apps/android/build.ps1 -Tasks @('assembleDebug', 'assembleDebugAndroidTest', 'lintDebug')
& apps/android/.tooling/sdk/platform-tools/adb.exe -s emulator-5554 install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
& apps/android/.tooling/sdk/platform-tools/adb.exe -s emulator-5554 install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
python apps/android/verify-pairing.py .tmp/backend-smoke.json
```

The ignored private QA fixture must contain `api_origin`, `user_id`, `cookie` (`name`/`value`) and `csrf`. The helper accepts only a host loopback API origin and maps it to emulator `10.0.2.2`. Credentials and the ephemeral code are read internally and never printed. The native device secret stays in memory. Only sanitized results are saved in verification files.

The instrumentation requires the explicit `native_pairing_smoke=true` flag set by the helper. Its default skip is not a passing test. This confirms real pairing transport using an already issued synthetic QA Web session; live Google/GitHub OAuth, HTTPS deployment and physical-device verification remain ST. Production source and the previously verified debug/release APKs were unchanged by this added test.
