# datasensAI -- full uninstall (Windows)
# Removes datasensAI containers, volumes, and the installation folder.
# Does NOT remove Docker, Git, winget, or Ollama.
# Run from PowerShell (Administrator recommended).

$ErrorActionPreference = 'SilentlyContinue'

$TargetDir   = if ($env:DATASENSAI_DIR) { $env:DATASENSAI_DIR } else { "$env:USERPROFILE\datasensai" }
$ComposeFile = "$TargetDir\docker\docker-compose.yml"

function Write-Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Info($m) { Write-Host "  ..  $m" -ForegroundColor White }
function Write-Warn($m) { Write-Host "  !   $m" -ForegroundColor Yellow }

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Args)
  if (docker compose version 2>$null) {
    & docker compose -f $ComposeFile @Args
  } else {
    & docker-compose -f $ComposeFile @Args
  }
}

Write-Host ""
Write-Host "Uninstall datasensAI" -ForegroundColor Red
Write-Host ""
Write-Host "  This will remove:"
Write-Host "    * datasensAI containers and database (all data)"
Write-Host "    * Installation folder: $TargetDir"
Write-Host ""
Write-Host "  This does NOT remove Docker, Git, winget, or Ollama."
Write-Host ""
$confirm = Read-Host "  Type 'UNINSTALL' to confirm, or press Enter to cancel"
if ($confirm -ne 'UNINSTALL') { Write-Info "Uninstall cancelled."; return }

# 1) Containers + volumes via compose (if present and Docker is up)
$dockerUp = $false
docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerUp = $true }

if ((Test-Path $ComposeFile) -and $dockerUp) {
  Write-Info "Stopping and removing containers + volumes..."
  Invoke-Compose down -v --remove-orphans *> $null
  Write-Ok "Containers and volumes removed"
}

# 2) Belt-and-suspenders: remove any leftover containers by name
if ($dockerUp) {
  foreach ($ctr in 'docker-postgres-1','docker-web-1','docker-worker-1','docker-splunk-mock-1') {
    docker rm -f $ctr *> $null
  }
}

# 3) Remove the installation folder
if (Test-Path $TargetDir) {
  Write-Info "Removing installation folder: $TargetDir"
  Remove-Item $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $TargetDir)) { Write-Ok "Installation folder removed" }
  else { Write-Warn "Could not fully remove $TargetDir (a file may be in use). Reboot and delete it manually." }
} else {
  Write-Warn "Installation folder not found (already removed): $TargetDir"
}

Write-Host ""
Write-Host "datasensAI has been uninstalled." -ForegroundColor Green
Write-Host ""
Write-Host "  To reinstall, run the installer again (Fresh install)."
Write-Host ""
