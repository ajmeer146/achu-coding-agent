# Achu Local Agent System Tray Manager
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 1. Single-instance protection via Mutex
$createdNew = $false
$trayMutex = New-Object System.Threading.Mutex($true, "Local\AchuLocalAgentTrayMutex", [ref]$createdNew)
if (-not $createdNew) {
    # Another tray instance is already running; exit gracefully without duplicating icon
    exit 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$nodeExe = Join-Path $appDir "bin\node.exe"
$serverMjs = Join-Path $appDir "server.mjs"
$logDir = Join-Path $env:USERPROFILE ".achu"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "agent.log"

function Test-AgentHealth {
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:3001/health" -Method Get -TimeoutSec 1 -ErrorAction Stop
        return ($res.status -eq "ok")
    } catch {
        return $false
    }
}

function Start-AgentServer {
    if (Test-AgentHealth) { return }
    $existing = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server.mjs*" }
    if ($existing) {
        for ($i = 0; $i -lt 6; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-AgentHealth) { return }
        }
    }
    if (-not (Test-AgentHealth)) {
        Start-Process -FilePath $nodeExe -ArgumentList @($serverMjs) -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $logFile
    }
}

function Stop-AgentServer {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server.mjs*" -or $_.CommandLine -like "*dist\server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# Start the agent process if not already responding
Start-AgentServer

# Create NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "Achu Local Agent (Running - Port 3001)"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$headerItem = $contextMenu.Items.Add("● Achu Local Agent: Running (Port 3001)")
$headerItem.Enabled = $false

$sep1 = $contextMenu.Items.Add("-")

$openSiteItem = $contextMenu.Items.Add("Open Work with Achu Website")
$openSiteItem.Add_Click({
    Start-Process "https://www.workswithachu.me/workspace/coding-agent"
})

$startItem = $contextMenu.Items.Add("Start Agent")
$startItem.Visible = $false
$startItem.Add_Click({
    Start-AgentServer
    Start-Sleep -Seconds 1
    if (Test-AgentHealth) {
        $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Agent started on port 3001", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Failed to start agent. Check logs.", [System.Windows.Forms.ToolTipIcon]::Error)
    }
})

$restartItem = $contextMenu.Items.Add("Restart Agent")
$restartItem.Add_Click({
    Stop-AgentServer
    Start-Sleep -Seconds 1
    Start-AgentServer
    Start-Sleep -Seconds 1
    if (Test-AgentHealth) {
        $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Agent restarted on port 3001", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Agent restarting...", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$stopItem = $contextMenu.Items.Add("Stop Agent")
$stopItem.Add_Click({
    Stop-AgentServer
    $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Agent stopped", [System.Windows.Forms.ToolTipIcon]::Warning)
})

$sep2 = $contextMenu.Items.Add("-")

$updateItem = $contextMenu.Items.Add("Check for Updates...")
$updateItem.Add_Click({
    $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Checking for updates...", [System.Windows.Forms.ToolTipIcon]::Info)
    try {
        $info = Invoke-RestMethod -Uri "https://www.workswithachu.me/api/download/local-agent?info=true" -Method Get -TimeoutSec 5 -ErrorAction Stop
        if ($info.ok -and $info.version) {
            $currentPkgJson = Join-Path $appDir "package.json"
            $currVer = "1.0.0"
            if (Test-Path $currentPkgJson) {
                try {
                    $pkg = Get-Content $currentPkgJson -Raw | ConvertFrom-Json
                    if ($pkg.version) { $currVer = $pkg.version }
                } catch {}
            }
            if ($info.version -ne $currVer) {
                $notifyIcon.ShowBalloonTip(4000, "Update Available", "Version $($info.version) is available (current: $currVer). Starting update...", [System.Windows.Forms.ToolTipIcon]::Info)
                $updateScript = Join-Path $scriptDir "update-agent.ps1"
                if (Test-Path $updateScript) {
                    Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $updateScript) -WindowStyle Hidden
                }
            } else {
                $notifyIcon.ShowBalloonTip(3000, "Up to Date", "Achu Local Agent is up to date (version $currVer).", [System.Windows.Forms.ToolTipIcon]::Info)
            }
        }
    } catch {
        $notifyIcon.ShowBalloonTip(3000, "Update Check", "Could not reach update server.", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$logsItem = $contextMenu.Items.Add("View Agent Logs")
$logsItem.Add_Click({
    if (-not (Test-Path $logFile)) {
        "Achu Local Agent log started: $(Get-Date)" | Out-File $logFile -Encoding utf8
    }
    Start-Process notepad.exe -ArgumentList @($logFile)
})

$sep3 = $contextMenu.Items.Add("-")

$exitItem = $contextMenu.Items.Add("Exit (Stop Agent & Tray)")
$exitItem.Add_Click({
    Stop-AgentServer
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    if ($trayMutex) {
        $trayMutex.ReleaseMutex()
        $trayMutex.Dispose()
    }
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Background health monitoring timer
$healthTimer = New-Object System.Windows.Forms.Timer
$healthTimer.Interval = 3000
$healthTimer.Add_Tick({
    $isHealthy = Test-AgentHealth
    if ($isHealthy) {
        $headerItem.Text = "● Achu Local Agent: Running (Port 3001)"
        $notifyIcon.Text = "Achu Local Agent (Running - Port 3001)"
        $startItem.Visible = $false
        $restartItem.Visible = $true
        $stopItem.Visible = $true
    } else {
        $headerItem.Text = "○ Achu Local Agent: Stopped"
        $notifyIcon.Text = "Achu Local Agent (Stopped)"
        $startItem.Visible = $true
        $restartItem.Visible = $false
        $stopItem.Visible = $false
    }
})
$healthTimer.Start()

# Show startup balloon
$notifyIcon.ShowBalloonTip(3000, "Achu Local Agent", "Running on port 3001. Open https://www.workswithachu.me to connect.", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
