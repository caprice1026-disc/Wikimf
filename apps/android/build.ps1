param([string[]]$Tasks = @('testDebugUnitTest', 'assembleDebug', 'lintDebug'), [switch]$StagingRelease)
$ErrorActionPreference = 'Stop'
$tasksExplicit = $PSBoundParameters.ContainsKey('Tasks')
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
function Get-CertificateDigest([string]$Keystore, [string]$Alias, [switch]$DebugKey) {
    $certificateArgs = @('-J-Duser.language=en', '-J-Duser.country=US', '-list', '-v', '-keystore', $Keystore, '-alias', $Alias)
    $certificateArgs += if ($DebugKey) { @('-storepass', 'android') } else { @('-storepass:env', 'WIKIMF_SIGNING_STORE_PASSWORD') }
    $certificate = (& (Join-Path $env:JAVA_HOME 'bin/keytool.exe') @certificateArgs) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect signing certificate.' }
    $certificateDigest = [regex]::Match($certificate, '(?m)^\s*SHA256:\s*([0-9A-F:]+)\s*$').Groups[1].Value.Replace(':', '').ToLowerInvariant()
    if ($certificateDigest.Length -ne 64) { throw 'Signing certificate SHA-256 was missing.' }
    return $certificateDigest
}
$signingNames = @('WIKIMF_SIGNING_KEYSTORE','WIKIMF_SIGNING_STORE_PASSWORD','WIKIMF_SIGNING_KEY_ALIAS','WIKIMF_SIGNING_KEY_PASSWORD')
$previousSigning = @{}
foreach ($signingName in $signingNames) { $previousSigning[$signingName] = [Environment]::GetEnvironmentVariable($signingName, 'Process') }
try {
    if ($StagingRelease) {
        . (Join-Path $androidRoot 'release-signing.ps1')
        if (-not $tasksExplicit) { $Tasks = @('assembleRelease', 'lintRelease') }
    }
    & $gradleExecutable -p $androidRoot @Tasks --no-daemon
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -eq 0 -and ($Tasks | Where-Object { $_ -match '(^|:)assembleRelease$' }) -and $env:WIKIMF_SIGNING_KEYSTORE) {
        $releaseApk = Join-Path $androidRoot 'app/build/outputs/apk/release/app-release.apk'
        $releaseTools = Join-Path $env:ANDROID_HOME 'build-tools/35.0.0'
        $releaseSignature = (& (Join-Path $releaseTools 'apksigner.bat') verify --verbose --print-certs $releaseApk) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw 'Release APK signature verification failed.' }
        $releaseSigners = [regex]::Matches($releaseSignature, '(?m)^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)\s*$')
        $expectedSigner = Get-CertificateDigest $env:WIKIMF_SIGNING_KEYSTORE $env:WIKIMF_SIGNING_KEY_ALIAS
        $debugSigner = Get-CertificateDigest $debugKeystore 'androiddebugkey' -DebugKey
        if ($releaseSigners.Count -ne 1 -or $releaseSigners[0].Groups[1].Value -ne $expectedSigner -or $expectedSigner -eq $debugSigner) {
            throw 'Release APK signer must match the configured release key and differ from the current debug key.'
        }
        Write-Host $releaseSignature
        $releaseManifest = (& (Join-Path $releaseTools 'aapt2.exe') dump xmltree $releaseApk --file AndroidManifest.xml) -join "`n"
        if ($LASTEXITCODE -ne 0 -or $releaseManifest -match ':debuggable\([^)]*\)=true(?:\s|$)' -or $releaseManifest -notmatch ':usesCleartextTraffic\([^)]*\)=false(?:\s|$)' -or $releaseManifest -match ':networkSecurityConfig\(') {
            throw 'Release APK must remain non-debuggable, deny cleartext and exclude debug network configuration.'
        }
        Write-Host 'Release APK signature and network/debug manifest boundaries verified.'
    }
} finally {
    foreach ($signingName in $signingNames) { [Environment]::SetEnvironmentVariable($signingName, $previousSigning[$signingName], 'Process') }
}
exit $buildExitCode
