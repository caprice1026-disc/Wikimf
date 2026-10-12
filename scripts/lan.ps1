param(
    [Parameter(Position=0)][ValidateSet('Init','Up','Login','Status','Down')][string]$Action = 'Status',
    [string]$BindIP,
    [ValidateRange(1024,65535)][int]$Port = 8080
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $repoRoot '.env.lan'
Set-Location -LiteralPath $repoRoot

function Assert-PrivateIPv4([string]$Value) {
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($Value, [ref]$address) -or $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use a numeric private IPv4 address.' }
    $bytes = $address.GetAddressBytes()
    if ($Value -ne $address.ToString() -or -not ($bytes[0] -eq 10 -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31))) { throw 'LAN binding must be an RFC1918 private IPv4 address.' }
}
function New-LanSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
if ($Action -eq 'Init') {
    if (Test-Path -LiteralPath $envPath) { throw '.env.lan already exists; it has not been overwritten.' }
    if (-not $BindIP) { throw 'Specify the PC Wi-Fi IPv4, for example: scripts/lan.ps1 Init -BindIP 192.168.11.10' }
    Assert-PrivateIPv4 $BindIP
    $lines = @(('LAN_BIND_IP=' + $BindIP), ('LAN_PORT=' + $Port), ('LAN_DB_PASSWORD=' + (New-LanSecret)), ('LAN_SESSION_SECRET=' + (New-LanSecret)))
    $stream = [System.IO.File]::Open($envPath, [System.IO.FileMode]::CreateNew)
    $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding($false)))
    try { $writer.WriteLine(($lines -join "`n")) } finally { $writer.Dispose() }
    Write-Host "Created ignored .env.lan for http://${BindIP}:${Port}. Keep it private."
    return
}
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Run scripts/lan.ps1 Init -BindIP <PC private IPv4> first.' }
$settings = @{}
foreach ($line in (Get-Content -LiteralPath $envPath)) {
    if ($line -match '^(LAN_BIND_IP|LAN_PORT|LAN_DB_PASSWORD|LAN_SESSION_SECRET)=(.+)$') { $settings[$Matches[1]] = $Matches[2] }
}
Assert-PrivateIPv4 $settings['LAN_BIND_IP']
if (-not $settings['LAN_PORT'] -or [int]$settings['LAN_PORT'] -lt 1024 -or [int]$settings['LAN_PORT'] -gt 65535) { throw 'Invalid LAN_PORT.' }
# Scope overrides to this process so unrelated environment variables cannot change the configured bind.
foreach ($name in $settings.Keys) { [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process') }
$composeArgs = @('compose','--project-name','wikimf-lan','--env-file',$envPath,'-f',(Join-Path $repoRoot 'compose.lan.yaml'))
switch ($Action) {
    'Up' { & docker @composeArgs up -d --build }
    'Login' { & docker @composeArgs exec -T backend python -m wikimf.lan --prepare }
    'Status' { & docker @composeArgs ps }
    'Down' { & docker @composeArgs down }
}
if ($LASTEXITCODE -ne 0) { throw "Docker Compose $Action failed (exit $LASTEXITCODE)." }
Write-Host 'Firewall and router settings are unchanged. See docs/releases/android-lan-verification.md.'
