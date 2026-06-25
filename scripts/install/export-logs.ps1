# ============================================================================
# datasensAI — Support Bundle Exporter (Windows)
#
# Collects installer logs, redacted config, container logs, health status,
# and version info into a ZIP on the Desktop.
#
# Usage:
#   .\export-logs.ps1
#   .\export-logs.ps1 -TargetDir C:\datasensai -WebPort 4000
#
# The bundle does NOT contain your admin password, encryption keys, or
# Splunk tokens. Safe to share with support.
# ============================================================================
[CmdletBinding()]
param(
  [string]$TargetDir = "$env:USERPROFILE\datasensai",
  [int]   $WebPort   = 3002
)

Write-Host ""
Write-Host "datasensAI — Support Bundle Exporter" -ForegroundColor White
Write-Host ""

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

$bundleName = "datasensai-support-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$bundleDir  = "$env:USERPROFILE\Desktop\$bundleName"
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

# ── Install logs ──────────────────────────────────────────────────────────
$logSrc = "$TargetDir\install-logs"
if (Test-Path $logSrc) {
  Copy-Item "$logSrc\*.log" $bundleDir -ErrorAction SilentlyContinue
  Write-Host "  Copied installer logs"
} else {
  Write-Host "  (no installer logs found at $logSrc)"
}

# ── Redacted .env ─────────────────────────────────────────────────────────
if (Test-Path "$TargetDir\.env") {
  (Get-Content "$TargetDir\.env") `
    -replace '(?<=^SPLUNK_SECRET_ENCRYPTION_KEY=).*','[REDACTED]' `
    -replace '(?<=^GOVERNANCE_BOOTSTRAP_KEY=).*','[REDACTED]' `
    -replace '(?<=^ADMIN_PASSWORD=).*','[REDACTED]' `
    -replace '(?<=^ANTHROPIC_API_KEY=).*','[REDACTED]' |
    Set-Content "$bundleDir\env-redacted.txt"
  Write-Host "  Copied .env (secrets redacted)"
}

# ── Docker status ─────────────────────────────────────────────────────────
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}" 2>&1 | Set-Content "$bundleDir\docker-ps.txt"
docker info 2>&1 | Set-Content "$bundleDir\docker-info.txt"
Write-Host "  Copied docker status"

# ── App container logs ────────────────────────────────────────────────────
foreach ($svc in @('postgres','web','worker')) {
  docker logs "docker-$svc-1" --tail 300 2>&1 | Set-Content "$bundleDir\logs-$svc.txt"
}
Write-Host "  Copied container logs"

# ── API health ────────────────────────────────────────────────────────────
try {
  $h = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/health" -TimeoutSec 5
  $h.Content | Set-Content "$bundleDir\api-health.json"
  Write-Host "  Captured API health"
} catch {
  "not reachable" | Set-Content "$bundleDir\api-health.json"
  Write-Host "  (API not reachable on :$WebPort)"
}

# ── Port usage ────────────────────────────────────────────────────────────
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in @(3002,5433,11434,80,443) } |
  Format-Table -AutoSize 2>&1 | Set-Content "$bundleDir\ports.txt"

# ── Versions ──────────────────────────────────────────────────────────────
$versions = @(
  "Collected: $(Get-Date -Format 'u')"
  "OS: $([System.Environment]::OSVersion.VersionString)"
  if (Have docker) { "Docker: $(docker --version 2>$null)" }
  if (Have git)    { "Git:    $(git --version 2>$null)" }
  if (Have ollama) { "Ollama: $(ollama --version 2>$null)" }
  if (Have winget) { "winget: $(winget --version 2>$null)" }
  if (Have node)   { "Node:   $(node --version 2>$null)" }
  "TargetDir: $TargetDir"
  "WebPort:   $WebPort"
)
$versions | Set-Content "$bundleDir\versions.txt"

# ── Migration count ───────────────────────────────────────────────────────
$migDir = "$TargetDir\infrastructure\migrations"
if (Test-Path $migDir) {
  $migFiles = Get-ChildItem $migDir -Filter "*.sql" | Sort-Object Name
  $count = $migFiles.Count
  @("Migration SQL files on disk: $count") + ($migFiles | ForEach-Object { $_.Name }) |
    Set-Content "$bundleDir\migrations.txt"
}

# ── Create ZIP ────────────────────────────────────────────────────────────
$zipFile = "$env:USERPROFILE\Desktop\$bundleName.zip"
try {
  Compress-Archive -Path $bundleDir -DestinationPath $zipFile -Force
  Remove-Item $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "Support bundle ready:" -ForegroundColor Green
  Write-Host "  $zipFile"
  Write-Host ""
  Write-Host "  Share this file with support."
  Write-Host "  It does NOT contain your passwords or encryption keys."
  Write-Host ""
} catch {
  Write-Host ""
  Write-Host "Support bundle folder:" -ForegroundColor Green
  Write-Host "  $bundleDir"
  Write-Host ""
}
