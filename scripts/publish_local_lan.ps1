param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedCertificate,
    [string]$PreviousApk
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$key = Join-Path $repoRoot 'apps/android/.tooling/debug.keystore'
if (-not (Test-Path -LiteralPath $key)) { throw 'The existing LAN validation key is missing. Restore it; do not create a replacement and call it an update.' }
Set-Location -LiteralPath $repoRoot
& (Join-Path $repoRoot 'apps/android/build.ps1') -Tasks @('assembleLan','assembleRelease','lintLan','lintRelease')
if ($LASTEXITCODE -ne 0) { throw 'LAN build failed.' }
$verify = @('scripts/verify_android_lan.py','--expected-certificate',$ExpectedCertificate.ToLowerInvariant())
if ($PreviousApk) { $verify += @('--previous-apk',(Resolve-Path -LiteralPath $PreviousApk).Path) }
& python @verify
if ($LASTEXITCODE -ne 0) { throw 'APK signer/version/boundary verification failed; no delivery copy was created.' }
$manifest = Get-Content '.tmp/lan-apk-manifest.json' -Raw | ConvertFrom-Json
$destination = Join-Path $repoRoot '.tmp/lan-delivery'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$apk = Join-Path $destination ('wikimf-' + $manifest.version + '.apk')
Copy-Item -LiteralPath 'apps/android/app/build/outputs/apk/lan/app-lan.apk' -Destination $apk
Copy-Item -LiteralPath '.tmp/lan-apk-manifest.json' -Destination (Join-Path $destination 'manifest.json')
Write-Host ('Verified local LAN APK: ' + $apk)
Write-Host 'Keep the previous APK and private signing key. CI test artifacts use a different temporary signer.'
