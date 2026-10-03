param([string[]]$Tasks = @('testDebugUnitTest', 'assembleDebug', 'lintDebug'))
$ErrorActionPreference = 'Stop'
$androidRoot = $PSScriptRoot
if (-not $env:JAVA_HOME) {
    $jdkDirectory = Get-ChildItem (Join-Path $androidRoot '.tooling/jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdkDirectory) { $env:JAVA_HOME = $jdkDirectory.FullName }
}
if (-not $env:JAVA_HOME) { throw 'JDK 17 is required. Set JAVA_HOME or run python apps/android/bootstrap.py.' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $androidRoot '.tooling/sdk' }
$env:ANDROID_USER_HOME = Join-Path $androidRoot '.tooling/android-user'
$env:GRADLE_USER_HOME = Join-Path $androidRoot '.tooling/gradle-user'
$debugKeystore = Join-Path $androidRoot '.tooling/debug.keystore'
if (-not (Test-Path -LiteralPath $debugKeystore)) {
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $debugKeystore -storepass android -keypass android -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -validity 10950 -keyalg RSA -keysize 2048
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated debug keystore.' }
}
$sdkProperty = $env:ANDROID_HOME.Replace('\', '/')
Set-Content -LiteralPath (Join-Path $androidRoot 'local.properties') -Value "sdk.dir=$sdkProperty" -Encoding ascii
$gradleExecutable = Join-Path $androidRoot '.tooling/gradle-8.9/bin/gradle.bat'
if (-not (Test-Path -LiteralPath $gradleExecutable)) { $gradleExecutable = (Get-Command gradle -ErrorAction Stop).Source }
& $gradleExecutable -p $androidRoot @Tasks --no-daemon
exit $LASTEXITCODE
