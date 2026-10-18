# Achu Local Agent System Tray Manager
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$nodeExe = Join-Path $appDir "bin\node.exe"
$serverMjs = Join-Path $appDir "server.mjs"

# Start the agent process if not running
$existing = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server.mjs*" }
if (-not $existing) {
    Start-Process -FilePath $nodeExe -ArgumentList @($serverMjs) -WorkingDirectory $appDir -WindowStyle Hidden
}

# Create NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "Achu Local Agent (Port 3001)"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$headerItem = $contextMenu.Items.Add("Achu Local Agent: Running (Port 3001)")
$headerItem.Enabled = $false

$sep1 = $contextMenu.Items.Add("-")

$openSiteItem = $contextMenu.Items.Add("Open Work with Achu")
$openSiteItem.Add_Click({
    Start-Process "https://www.workswithachu.me/workspace/coding-agent"
})

$restartItem = $contextMenu.Items.Add("Restart Agent")
$restartItem.Add_Click({
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server.mjs*" -or $_.CommandLine -like "*dist\server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
    Start-Process -FilePath $nodeExe -ArgumentList @($serverMjs) -WorkingDirectory $appDir -WindowStyle Hidden
    $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Agent restarted on port 3001", [System.Windows.Forms.ToolTipIcon]::Info)
})

$stopItem = $contextMenu.Items.Add("Stop Agent")
$stopItem.Add_Click({
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server.mjs*" -or $_.CommandLine -like "*dist\server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $notifyIcon.ShowBalloonTip(2000, "Achu Local Agent", "Agent stopped", [System.Windows.Forms.ToolTipIcon]::Warning)
})

$sep2 = $contextMenu.Items.Add("-")

$exitItem = $contextMenu.Items.Add("Exit")
$exitItem.Add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Show startup balloon
$notifyIcon.ShowBalloonTip(3000, "Achu Local Agent", "Running on port 3001. Connected to Work with Achu.", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
