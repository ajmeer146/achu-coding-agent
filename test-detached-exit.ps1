# Detached-process exit verification harness (Windows PowerShell 5.1).
#
# Verifies TWO independent properties:
#   PARENT EXIT    - `node test-detached-exit.mjs` returns promptly with exit 0.
#   CHILD SURVIVAL - the detached server child is still alive and reachable
#                    after the parent has exited.
#
# NOTE: never uses $pid (read-only in PowerShell); uses $childProcessId.
$ErrorActionPreference = "Continue"

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$raw = & node (Join-Path $root "test-detached-exit.mjs") 2>&1
$nodeExit = $LASTEXITCODE
$sw.Stop()
$elapsedMs = [int]$sw.Elapsed.TotalMilliseconds
$outputText = ($raw | Out-String)

Write-Host "=== test-detached-exit results ==="
Write-Host $outputText
Write-Host ("node exit code : {0}" -f $nodeExit)
Write-Host ("parent elapsed : {0} ms" -f $elapsedMs)

$failures = @()
$PARENT_EXIT_BUDGET_MS = 30000

# --- Parent exit evidence -------------------------------------------------
if ($nodeExit -ne 0) { $failures += ("parent exit code {0} != 0" -f $nodeExit) }
if ($outputText -notmatch '(?m)^PARENT_EXIT\s*$') { $failures += "PARENT_EXIT marker missing from output" }
if ($elapsedMs -gt $PARENT_EXIT_BUDGET_MS) {
  $failures += ("parent took {0} ms (> {1} ms) - something is holding the event loop open" -f $elapsedMs, $PARENT_EXIT_BUDGET_MS)
}

# --- Child PID (validated integer; NOT $pid) ------------------------------
$childProcessId = 0
$pidMatch = [regex]::Match($outputText, '(?m)^CHILD_PID=(\d+)\s*$')
if (-not $pidMatch.Success) {
  $failures += "CHILD_PID line missing from output"
} else {
  $pidText = $pidMatch.Groups[1].Value
  if ((-not [int]::TryParse($pidText, [ref]$childProcessId)) -or $childProcessId -le 0) {
    $failures += ("CHILD_PID '{0}' is not a valid positive integer" -f $pidText)
  } else {
    Write-Host ("child pid parsed: {0} (valid integer)" -f $childProcessId)
  }
}

# --- Child survival evidence ----------------------------------------------
$urlMatch = [regex]::Match($outputText, '(?m)^CHILD_URL=(http://\S+)\s*$')
$childUrl = $null
if ($urlMatch.Success) { $childUrl = $urlMatch.Groups[1].Value }

if ($childProcessId -gt 0) {
  $childAlive = Get-Process -Id $childProcessId -ErrorAction SilentlyContinue
  if ($childAlive) {
    Write-Host ("child {0} alive after parent exit: YES" -f $childProcessId)
  } else {
    $failures += ("child {0} is NOT alive after parent exit" -f $childProcessId)
  }
}

if ($childUrl) {
  try {
    $wc = New-Object System.Net.WebClient
    $wc.Proxy = $null
    $body = $wc.DownloadString($childUrl)
    $wc.Dispose()
    if ($body -match 'achu-child-ok') {
      Write-Host ("child server reachable at {0}: YES (HTTP 200, correct body)" -f $childUrl)
    } else {
      $failures += ("child URL {0} reachable but body mismatch: '{1}'" -f $childUrl, $body)
    }
  } catch {
    $failures += ("child URL {0} not reachable: {1}" -f $childUrl, $_.Exception.Message)
  }
} else {
  $failures += "CHILD_URL line missing from output"
}

# --- Bounded cleanup: terminate ONLY the test-owned process tree ----------
if ($childProcessId -gt 0) {
  try { & taskkill /PID $childProcessId /T /F *> $null } catch { }
  Start-Sleep -Milliseconds 300
  $stillAlive = Get-Process -Id $childProcessId -ErrorAction SilentlyContinue
  if ($stillAlive) {
    $failures += ("cleanup failed: test-owned child {0} still alive" -f $childProcessId)
  } else {
    Write-Host ("cleanup: test-owned child {0} terminated" -f $childProcessId)
  }
}

if ($failures.Count -gt 0) {
  Write-Host ""
  foreach ($f in $failures) { Write-Host ("FAIL: " + $f) }
  Write-Host "RESULT: FAIL"
  exit 1
}

Write-Host ""
Write-Host "RESULT: PASS (parent exit and child survival both verified independently)"
exit 0
