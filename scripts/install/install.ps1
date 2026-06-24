# ============================================================================
# datasensAI installer - Windows (PowerShell 5+)
#
# What this does, in plain language:
#   1. Checks what's missing on this machine (git, Docker, Ollama)
#   2. Asks before installing anything that's missing (via winget)
#   3. Generates a .env with fresh random secrets
#   4. Brings up the app stack (Docker compose)
#   5. Waits until everything is healthy
#   6. Prints the dashboard URL and admin login
#
# Run from an elevated PowerShell window (Right-click PowerShell -> Run as
# Administrator). Or double-click "Install datasensAI.bat" which triggers UAC.
#
# Usage:
#   .\install.ps1
#   .\install.ps1 -Branch main -TargetDir C:\datasensai
#   .\install.ps1 -Quiet           # skip non-essential prompts
# ============================================================================
[CmdletBinding()]
param(
  [string]$RepoUrl   = 'https://github.com/LovaRK/telemetry-governance-ai.git',
  [string]$Branch    = 'main',
  [string]$TargetDir = "$env:USERPROFILE\datasensai",
  [string]$LlmModel  = 'gemma2:9b',
  [int]   $WebPort   = 3002,
  [int]   $PostgresPort = 5433,
  [int]   $MinRamGb  = 8,
  [int]   $MinDiskGb = 20,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'

function Write-Step ($msg)  { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok   ($msg)  { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg)  { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail ($msg)  { Write-Host "  [X] $msg" -ForegroundColor Red }
function Die        ($msg)  { Write-Fail $msg; Write-Host "`nInstallation aborted. Run .\doctor.ps1 to diagnose." -ForegroundColor Red; exit 1 }

function Ask ($prompt, $default = $null) {
  if ($Quiet -and $default) { return $default }
  $r = Read-Host "  $prompt"
  if ([string]::IsNullOrWhiteSpace($r)) { return $default } else { return $r }
}

function YesNo ($prompt, $default = 'y') {
  while ($true) {
    $r = Ask "$prompt [y/n] (default $default):" $default
    switch -Regex ($r) {
      '^[Yy]([Ee][Ss])?$' { return $true }
      '^[Nn]([Oo])?$'     { return $false }
    }
  }
}

function Have-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Banner {
@"

==================================================================
              datasensAI - Layman Installer (Windows)
==================================================================

About to install (only what's missing):
  - Git                 - to clone the repo
  - Docker Desktop      - to run the app containers
  - Ollama + gemma2:9b  - local LLM for AI analysis (~5 GB download)
  - datasensAI app      - the dashboard itself

You will be asked to confirm before each install. Docker Desktop and
Ollama installs trigger UAC prompts from Windows.

Total time on a clean Windows machine: about 15-25 min (mostly the
5 GB Ollama model download). Re-running on an already-installed
machine: 2 min.

If anything goes wrong, .\doctor.ps1 tells you what's broken.

"@ | Write-Host
}

function Check-Admin {
  Write-Step "Checking admin rights"
  $current = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Die "PowerShell is not elevated. Close this window, then right-click PowerShell -> Run as Administrator, and re-run .\install.ps1."
  }
  Write-Ok "Running as Administrator"
}

function Check-Disk {
  Write-Step "Checking disk space (need >= $MinDiskGb GB free on C:)"
  $free = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
  if ($free -lt $MinDiskGb) {
    Die "Only $free GB free on C:. Need at least $MinDiskGb GB (Docker images + Ollama model + room to run)."
  }
  Write-Ok "$free GB free - enough"
}

function Check-Ram {
  Write-Step "Checking RAM (recommended >= $MinRamGb GB)"
  $total = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  Write-Host "  Detected: $total GB total RAM"
  if ($total -lt 16) {
    Write-Warn2 "Less than 16 GB. The default LLM (gemma2:9b, ~20 GB at inference) may swap and feel slow."
    Write-Warn2 "You can switch to a lighter model later: edit .env, set LLM_MODEL=llama3.2:3b, then ollama pull llama3.2:3b."
  }
  Write-Ok "RAM check done"
}

function Ensure-Winget {
  if (Have-Cmd winget) { return }
  Die "winget not found. On Windows 10, install 'App Installer' from the Microsoft Store. On Windows 11 it's pre-installed. Re-run after installing."
}

function Ensure-Git {
  Write-Step "Git"
  if (Have-Cmd git) { Write-Ok "git already installed: $(git --version)"; return }
  if (YesNo "Install Git via winget?" 'y') {
    winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    # Refresh PATH so the just-installed git is found
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  } else {
    Die "Cannot continue without git."
  }
  if (-not (Have-Cmd git)) { Die "Git install reported success but the command is still not found. Close + reopen PowerShell as Admin and re-run." }
  Write-Ok "git installed: $(git --version)"
}

function Ensure-Docker {
  Write-Step "Docker"
  if ((Have-Cmd docker) -and ((docker info 2>&1 | Out-String) -notmatch 'error')) {
    Write-Ok "Docker running: $(docker --version)"
    return
  }
  if (-not (Have-Cmd docker)) {
    if (YesNo "Install Docker Desktop via winget (triggers UAC prompt for the installer)?" 'y') {
      winget install --id Docker.DockerDesktop --silent --accept-package-agreements --accept-source-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    } else {
      Die "Cannot continue without Docker. Install Docker Desktop manually from https://www.docker.com/products/docker-desktop and re-run."
    }
  } else {
    Write-Warn2 "Docker is installed but the daemon isn't running."
  }

  Write-Step "Waiting for Docker daemon to start (please launch Docker Desktop if it didn't auto-start)"
  Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
  Read-Host "Press Enter when Docker Desktop says 'Docker Desktop is running' in the tray icon"
  $tries = 0
  while ($true) {
    try { docker info | Out-Null; break } catch {}
    $tries++
    if ($tries -gt 60) { Die "Docker daemon never became ready. Open Docker Desktop manually and re-run." }
    Write-Host -NoNewline "`r  Waiting for Docker daemon... ($($tries*2)s)"
    Start-Sleep 2
  }
  Write-Host ""
  Write-Ok "Docker running: $(docker --version)"
}

function Ensure-Ollama {
  Write-Step "Ollama (local LLM)"
  if (-not (YesNo "Use local Ollama for AI analysis (recommended; private, free; ~5 GB download)?" 'y')) {
    Write-Warn2 "Skipping Ollama. After install, set ANTHROPIC_API_KEY in Settings -> AI Provider."
    $script:LlmModel = ""
    return
  }
  if (-not (Have-Cmd ollama)) {
    if (YesNo "Install Ollama via winget?" 'y') {
      winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    } else {
      Die "Ollama install declined. Install manually from https://ollama.com and re-run."
    }
  }
  Write-Ok "Ollama installed"
  Write-Step "Waiting for Ollama service on :11434"
  Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
  $tries = 0
  while ($true) {
    try { (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:11434/api/tags" -TimeoutSec 2) | Out-Null; break } catch {}
    $tries++
    if ($tries -gt 30) { Die "Ollama service did not respond on :11434. Run 'ollama serve' manually." }
    Start-Sleep 1
  }
  Write-Ok "Ollama service responding on :11434"
  Write-Step "Pulling model: $LlmModel (this is the long step - ~5 GB)"
  $installed = (ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] })
  if ($installed -notcontains $LlmModel) {
    ollama pull $LlmModel
    if ($LASTEXITCODE -ne 0) { Die "Failed to pull $LlmModel." }
  } else {
    Write-Ok "$LlmModel already present"
  }
}

function Ensure-Repo {
  Write-Step "Cloning the datasensAI repo into $TargetDir"
  if (Test-Path "$TargetDir\.git") {
    Write-Ok "Repo already at $TargetDir - pulling latest from $Branch"
    git -C $TargetDir fetch --quiet origin
    git -C $TargetDir checkout --quiet $Branch
    git -C $TargetDir pull --quiet origin $Branch
  } else {
    git clone --depth 50 --branch $Branch $RepoUrl $TargetDir
    if ($LASTEXITCODE -ne 0) { Die "Could not clone $RepoUrl" }
    Write-Ok "Cloned to $TargetDir"
  }
}

function New-RandomHex {
  param([int]$Bytes = 32)
  $b = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { "{0:x2}" -f $_ })
}

function Ensure-Env {
  Write-Step "Generating .env (random secrets, your admin credentials)"
  Set-Location $TargetDir
  if ((Test-Path .env) -and -not (YesNo ".env already exists. Overwrite (existing admin/secrets will be REPLACED)?" 'n')) {
    Write-Ok "Keeping existing .env"
    return
  }
  $adminEmail = Ask "Admin email (used to log into the dashboard):" "admin@$env:USERNAME.local"
  while ($true) {
    $adminPw = Read-Host "  Admin password (>=12 chars, mix letters+numbers+symbols)" -AsSecureString
    $plain = [System.Net.NetworkCredential]::new('', $adminPw).Password
    if ($plain.Length -ge 12) { break }
    Write-Warn2 "Too short. Please use at least 12 characters."
  }
  $encKey = New-RandomHex 32
  $govKey = New-RandomHex 32
  $envContent = @"
# Generated by scripts/install/install.ps1 on $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ' -AsUTC)
WEB_PORT=$WebPort
POSTGRES_PORT=$PostgresPort
NODE_ENV=development
APP_ENV=production

ADMIN_EMAIL=$adminEmail
ADMIN_PASSWORD=$plain

SPLUNK_SECRET_ENCRYPTION_KEY=$encKey
GOVERNANCE_BOOTSTRAP_KEY=$govKey

NEXT_PUBLIC_SPLUNK_MCP_URL=
NEXT_PUBLIC_SPLUNK_TOKEN=
NEXT_PUBLIC_SPLUNK_DISABLE_SSL_VERIFY=true

LLM_MODEL=$($LlmModel -replace '^$','gemma2:9b')
ANTHROPIC_API_KEY=

HEALTH_CHECK_INTERVAL=10s
HEALTH_CHECK_TIMEOUT=5s
HEALTH_CHECK_RETRIES=5
"@
  Set-Content -Path .env -Value $envContent -NoNewline
  Write-Ok ".env written ($(Get-Content .env | Measure-Object -Line | Select-Object -Expand Lines) lines)"
}

function Start-Stack {
  Write-Step "Starting the app stack (postgres + web + worker)"
  Set-Location $TargetDir
  docker compose --env-file .env -f docker/docker-compose.yml up -d --build
  if ($LASTEXITCODE -ne 0) { Die "docker compose up failed. See output above." }
  Write-Ok "Compose up complete"

  Write-Step "Waiting for the web container to become healthy"
  $tries = 0
  while ($true) {
    try { (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/health" -TimeoutSec 2) | Out-Null; break } catch {}
    $tries++
    if ($tries -gt 120) { Die "Web app never responded on :$WebPort. Check 'docker compose -f docker/docker-compose.yml logs web'." }
    Write-Host -NoNewline "`r  Waiting for http://localhost:$WebPort... ($($tries*2)s)"
    Start-Sleep 2
  }
  Write-Host ""
  Write-Ok "Web app responding on :$WebPort"
}

# ── Main ───────────────────────────────────────────────────────────────────
Banner
Write-Ok "Detected OS: Windows ($([System.Environment]::OSVersion.VersionString))"
Check-Admin
Check-Disk
Check-Ram
Ensure-Winget
Ensure-Git
Ensure-Docker
Ensure-Ollama
Ensure-Repo
Ensure-Env
Start-Stack

$email = (Get-Content "$TargetDir\.env" | Select-String '^ADMIN_EMAIL=').ToString().Split('=',2)[1]
$pw    = (Get-Content "$TargetDir\.env" | Select-String '^ADMIN_PASSWORD=').ToString().Split('=',2)[1]

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "                 datasensAI is ready                              " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  URL:      http://localhost:$WebPort" -ForegroundColor White
Write-Host "  Email:    $email" -ForegroundColor White
Write-Host "  Password: $pw" -ForegroundColor White
Write-Host ""
Write-Host "  Next:" -ForegroundColor White
Write-Host "    1. Open http://localhost:$WebPort in your browser"
Write-Host "    2. Log in with the email/password above"
Write-Host "    3. Settings -> Splunk Connection -> enter YOUR Splunk URL + token"
Write-Host "    4. Test Connection until green, Save"
Write-Host "    5. Back on dashboard, click Refresh - the pipeline takes 20-25 min"
Write-Host ""
Write-Host "  If anything looks wrong:" -ForegroundColor White
Write-Host "    Run: $TargetDir\scripts\install\doctor.ps1"
Write-Host ""
