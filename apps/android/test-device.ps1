$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1') -Tasks @('assembleDebug', 'assembleDebugAndroidTest')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$adbExecutable = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
& $adbExecutable install -r (Join-Path $PSScriptRoot 'app/build/outputs/apk/debug/app-debug.apk')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $adbExecutable install -r (Join-Path $PSScriptRoot 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$result = & $adbExecutable shell am instrument -w org.wikimf.reader.test/androidx.test.runner.AndroidJUnitRunner
$result | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.tooling/instrumentation-result.txt') -Encoding utf8
$result | Write-Output
if (($result -join "`n") -notmatch 'OK \(\d+ tests\)') { exit 1 }
exit 0
