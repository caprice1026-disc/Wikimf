# Local staging material only. DPAPI binds the password to this Windows user/machine.
# Create once: powershell -File apps/android/release-signing.ps1 -Create
# Build later: powershell -File apps/android/build.ps1 -StagingRelease
# CI uses the four WIKIMF_SIGNING_* environment variables directly, with a PKCS12
# keystore supplied from its secret store. Never commit the key or print passwords.
param([switch]$Create)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Local staging password protection requires Windows. CI must supply signing environment variables.' }
$stageDirectory = Join-Path $PSScriptRoot '.local/signing'
$stageKeystore = Join-Path $stageDirectory 'staging.p12'
$stagePasswordFile = Join-Path $stageDirectory 'password.dpapi'
$stageJavaHome = $env:JAVA_HOME
if (-not $stageJavaHome) {
    $stageJdk = Get-ChildItem (Join-Path $PSScriptRoot '.tooling/jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($stageJdk) { $stageJavaHome = $stageJdk.FullName }
}
if (-not $stageJavaHome) { throw 'JDK 17 is required for staging signing.' }
$stageKeytool = Join-Path $stageJavaHome 'bin/keytool.exe'

New-Item -ItemType Directory -Force -Path $stageDirectory | Out-Null
$stageUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
# icacls changes the DACL only; Set-Acl can also request unavailable audit privileges.
& icacls.exe $stageDirectory /inheritance:r /grant:r ("*" + $stageUser.Value + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' *> $null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict staging signing directory access.' }
$stageAcl = Get-Acl -LiteralPath $stageDirectory
$stageAllowed = @($stageUser.Value, 'S-1-5-18')
if (-not $stageAcl.AreAccessRulesProtected -or @($stageAcl.Access).Count -ne 2 -or @($stageAcl.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $stageAllowed }).Count) {
    throw 'Staging signing directory must be accessible only to this user and SYSTEM.'
}
$stageKeyExists = Test-Path -LiteralPath $stageKeystore
$stagePasswordExists = Test-Path -LiteralPath $stagePasswordFile
if ($stageKeyExists -ne $stagePasswordExists) { throw 'Staging signing material is incomplete. Restore its matching key/password backup; existing material will not be overwritten.' }
if (-not $stageKeyExists -and -not $Create) { throw 'Create staging material once with release-signing.ps1 -Create.' }

$stageGenerated = -not $stageKeyExists
if ($stageGenerated) {
    $stageBytes = New-Object byte[] 32
    $stageRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $stageRng.GetBytes($stageBytes) } finally { $stageRng.Dispose() }
    $stageSecurePassword = ConvertTo-SecureString -String ([Convert]::ToBase64String($stageBytes)) -AsPlainText -Force
    [Array]::Clear($stageBytes, 0, $stageBytes.Length)
    $stageSecurePassword | ConvertFrom-SecureString | Set-Content -LiteralPath $stagePasswordFile -Encoding ascii
} else {
    $stageSecurePassword = (Get-Content -LiteralPath $stagePasswordFile -Raw).Trim() | ConvertTo-SecureString
}
$env:WIKIMF_SIGNING_KEYSTORE = $stageKeystore
$env:WIKIMF_SIGNING_KEY_ALIAS = 'wikimf-staging'
$stageBstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($stageSecurePassword)
try {
    $env:WIKIMF_SIGNING_STORE_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($stageBstr)
    $env:WIKIMF_SIGNING_KEY_PASSWORD = $env:WIKIMF_SIGNING_STORE_PASSWORD
} finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($stageBstr); $stageSecurePassword.Dispose() }
try {
    if ($stageGenerated) {
        & $stageKeytool -genkeypair -noprompt -storetype PKCS12 -keystore $stageKeystore -storepass:env WIKIMF_SIGNING_STORE_PASSWORD -keypass:env WIKIMF_SIGNING_KEY_PASSWORD -alias $env:WIKIMF_SIGNING_KEY_ALIAS -dname 'CN=wikimf Staging' -keyalg RSA -keysize 3072 -validity 3650 *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Staging key creation failed.' }
    }
    & $stageKeytool -list -keystore $stageKeystore -storetype PKCS12 -storepass:env WIKIMF_SIGNING_STORE_PASSWORD -alias $env:WIKIMF_SIGNING_KEY_ALIAS *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Staging key/password validation failed.' }
} catch {
    foreach ($stageName in @('WIKIMF_SIGNING_KEYSTORE','WIKIMF_SIGNING_STORE_PASSWORD','WIKIMF_SIGNING_KEY_ALIAS','WIKIMF_SIGNING_KEY_PASSWORD')) { Remove-Item -LiteralPath ('Env:' + $stageName) -ErrorAction SilentlyContinue }
    if ($stageGenerated -and -not (Test-Path -LiteralPath $stageKeystore)) { Remove-Item -LiteralPath $stagePasswordFile }
    throw
}
Write-Host 'Local staging signing material validated. Keep the matching key and DPAPI password for future ST updates.'
