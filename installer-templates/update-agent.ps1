# Safe Update Script for Achu Local Agent
param(
    [string]$UpdateUrl = "https://www.workswithachu.me/api/download/local-agent?info=true",
    [switch]$Force
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$currentPkgJson = Join-Path $appDir "package.json"
$currentVersion = "1.0.0"
if (Test-Path $currentPkgJson) {
    try {
        $pkg = Get-Content $currentPkgJson -Raw | ConvertFrom-Json
        if ($pkg.version) { $currentVersion = $pkg.version }
    } catch {}
}

Write-Host "Checking for updates... Current version: $currentVersion"

try {
    $info = Invoke-RestMethod -Uri $UpdateUrl -Method Get -TimeoutSec 10 -ErrorAction Stop
} catch {
    Write-Warning "Could not connect to update server: $_"
    exit 1
}

if (-not $info.ok -or -not $info.version) {
    Write-Host "No update information available."
    exit 0
}

Write-Host "Latest version available: $($info.version)"

function Compare-VersionStrings($v1, $v2) {
    try {
        $clean1 = ($v1 -replace '[^0-9.]','').Trim('.')
        $clean2 = ($v2 -replace '[^0-9.]','').Trim('.')
        $p1 = $clean1.Split('.') | ForEach-Object { [int]$_ }
        $p2 = $clean2.Split('.') | ForEach-Object { [int]$_ }
        $maxLen = [Math]::Max($p1.Length, $p2.Length)
        for ($i = 0; $i -lt $maxLen; $i++) {
            $num1 = if ($i -lt $p1.Length) { $p1[$i] } else { 0 }
            $num2 = if ($i -lt $p2.Length) { $p2[$i] } else { 0 }
            if ($num1 -gt $num2) { return 1 }
            if ($num1 -lt $num2) { return -1 }
        }
        return 0
    } catch {
        return 0
    }
}

$cmp = Compare-VersionStrings $info.version $currentVersion
if ($cmp -le 0 -and -not $Force) {
    Write-Host "Achu Local Agent is up to date (version $currentVersion)."
    exit 0
}

Write-Host "Updating Achu Local Agent from $currentVersion to $($info.version)..."

# Prepare staging directory
$tempDir = Join-Path $env:TEMP "achu-update"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }
$installerDest = Join-Path $tempDir "AchuLocalAgentSetup-$($info.version).exe"

# Download installer
$downloadUrl = $info.downloadUrl
if ($downloadUrl.StartsWith("/")) {
    $downloadUrl = "https://www.workswithachu.me" + $downloadUrl
}

Write-Host "Downloading installer from $downloadUrl..."
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerDest -TimeoutSec 180
} catch {
    Write-Error "Download failed: $_"
    exit 2
}

# Verify SHA-256 Checksum
if ($info.sha256) {
    Write-Host "Verifying SHA-256 checksum..."
    $fileHash = (Get-FileHash -Path $installerDest -Algorithm SHA256).Hash.ToLower()
    $expectedHash = $info.sha256.ToLower()
    if ($fileHash -ne $expectedHash) {
        Write-Error "Checksum verification failed! Expected: $expectedHash, Computed: $fileHash"
        Remove-Item $installerDest -Force -ErrorAction SilentlyContinue
        exit 3
    }
    Write-Host "Checksum verified successfully!"
}

# Create backup of current server.mjs
$serverMjs = Join-Path $appDir "server.mjs"
$serverBak = Join-Path $appDir "server.mjs.bak"
if (Test-Path $serverMjs) {
    Copy-Item -Path $serverMjs -Destination $serverBak -Force
}

# Run installer silently in background
Write-Host "Installing update silently..."
$installProc = Start-Process -FilePath $installerDest -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -PassThru -Wait

if ($installProc.ExitCode -ne 0) {
    Write-Warning "Installer exited with error code $($installProc.ExitCode). Restoring backup..."
    if (Test-Path $serverBak) {
        Copy-Item -Path $serverBak -Destination $serverMjs -Force
    }
    exit 4
}

# Verify agent starts on port 3001
Write-Host "Verifying new version startup..."
$started = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $check = Invoke-RestMethod -Uri "http://127.0.0.1:3001/health" -Method Get -TimeoutSec 1 -ErrorAction Stop
        if ($check.status -eq "ok") {
            $started = $true
            break
        }
    } catch {}
}

if (-not $started) {
    Write-Warning "Agent failed to respond on port 3001 after update. Rolling back..."
    if (Test-Path $serverBak) {
        Copy-Item -Path $serverBak -Destination $serverMjs -Force
        & (Join-Path $scriptDir "restart-agent.bat")
    }
    exit 5
}

Write-Host "Update completed successfully! Achu Local Agent is now running version $($info.version)."
Remove-Item $installerDest -Force -ErrorAction SilentlyContinue
exit 0
