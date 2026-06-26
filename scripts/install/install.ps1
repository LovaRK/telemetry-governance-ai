# ============================================================================
# datasensAI Installer v1.3.0 — Windows (PowerShell 5+)
# State-machine wizard: double-click -> guided menu -> validated install
#
# Every step is validated. "Installation complete" is only printed after
# the login API returns a valid JWT with the generated credentials.
#
# Run from an ELEVATED PowerShell window (right-click -> Run as Administrator)
# or double-click "Install datasensAI.bat" which triggers UAC automatically.
#
# Modes:
#   1) Fresh install      4) Reset/reinstall
#   2) Start existing     5) Export support logs
#   3) Repair install     6) Stop app
#                         7) Uninstall
# ============================================================================
[CmdletBinding()]
param(
  [string]$RepoUrl      = 'https://github.com/BitsIO-Ram/telemetry-governance-ai.git',
  [string]$Branch       = 'main',
  [string]$TargetDir    = "$env:USERPROFILE\datasensai",
  [string]$LlmModel     = 'gemma2:9b',
  [int]   $WebPort      = 3002,
  [int]   $PostgresPort = 5433,
  [int]   $OllamaPort   = 11434,
  [int]   $MinDiskGb    = 20,
  [string]$Mode         = '',      # fresh | start | repair | reset | logs | stop | uninstall
  [switch]$AdvancedSetup           # show credential prompts
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Script-level state ────────────────────────────────────────────────────
$Script:ComposeCmd    = $null
$Script:AdminEmail    = 'admin@datasensai.local'
$Script:AdminPassword = ''
$Script:CurrentStep   = 0
$Script:TotalSteps    = 0
$Script:LogFile       = "$TargetDir\install-logs\install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$Script:InstallerVersion = '1.3.0'
$Script:ExpectedMinMigration = 213

# ── Output helpers ────────────────────────────────────────────────────────
function Write-Log($msg) {
  try { Add-Content -Path $Script:LogFile -Value "$(Get-Date -Format 'HH:mm:ss') $msg" -ErrorAction SilentlyContinue } catch {}
}

function Write-Step($msg) {
  $Script:CurrentStep++
  $label = "[$($Script:CurrentStep)/$($Script:TotalSteps)]"
  Write-Host ""
  Write-Host "$label $msg" -ForegroundColor Cyan
  Write-Log "STEP $label $msg"
}

function Write-Ok($msg)   { Write-Host "  [OK]  $msg" -ForegroundColor Green;  Write-Log "  OK: $msg" }
function Write-Warn($msg) { Write-Host "  [!]   $msg" -ForegroundColor Yellow; Write-Log "  WARN: $msg" }
function Write-Info($msg) { Write-Host "  $msg";                                Write-Log "  INFO: $msg" }
function Write-Fail($msg) { Write-Host "  [X]   $msg" -ForegroundColor Red;    Write-Log "  FAIL: $msg" }

function Die-WithSupport($msg) {
  Write-Host ""
  Write-Host "══════════════════════════════════════════════" -ForegroundColor Red
  Write-Host "  Installation failed" -ForegroundColor Red
  Write-Host "══════════════════════════════════════════════" -ForegroundColor Red
  Write-Host ""
  Write-Fail $msg
  Write-Host ""
  Write-Host "  What to do:" -ForegroundColor White
  Write-Host "    1. Read the log file for details"
  Write-Host "    2. Run .\scripts\install\export-logs.ps1 and share the bundle"
  Write-Host ""
  Write-Host "  Log: $($Script:LogFile)" -ForegroundColor White
  Write-Host ""
  Write-Log "FATAL: $msg"
  exit 1
}

function Have-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Have-DockerRunning() {
  try { docker info 2>&1 | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Args)
  $f = "$TargetDir\docker\docker-compose.yml"
  if ($Script:ComposeCmd -eq 'docker compose') {
    & docker compose -f $f @Args
  } else {
    & docker-compose -f $f @Args
  }
}

# ── Password generator ────────────────────────────────────────────────────
function New-RandomPassword() {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $b64 = [Convert]::ToBase64String($bytes)
  # Strip non-safe chars, take 20 chars, ensure minimum length
  $safe = $b64 -replace '[/+=]','' | Select-Object -First 1
  if ($safe.Length -lt 16) { return "Datasens@2026!Secure" }
  return $safe.Substring(0, [Math]::Min(20, $safe.Length)) + '!'
}

function New-RandomHex([int]$Bytes = 32) {
  $b = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { "{0:x2}" -f $_ })
}

# ── Latest migration detect ────────────────────────────────────────────────
function Get-LatestMigration() {
  $migDir = "$TargetDir\infrastructure\migrations"
  if (Test-Path $migDir) {
    $nums = Get-ChildItem $migDir -Filter "*.sql" |
      ForEach-Object { if ($_.Name -match '^(\d+)') { [int]$Matches[1] } } |
      Sort-Object | Select-Object -Last 1
    if ($nums) { return $nums }
  }
  return $Script:ExpectedMinMigration
}

# ── Login verification ────────────────────────────────────────────────────
function Test-Login([string]$Email, [string]$Password, [int]$Port) {
  $url  = "http://localhost:$Port/api/auth/login"
  $body = "{`"email`":`"$Email`",`"password`":`"$Password`"}"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -Method Post `
      -Body $body -ContentType 'application/json' -TimeoutSec 15
    return $resp.Content -match '"accessToken"'
  } catch { return $false }
}

# ── Admin password reset (repair) ─────────────────────────────────────────
function Reset-AdminPassword([string]$Email, [string]$NewPw) {
  Write-Info "Resetting admin password in database..."
  $script = @"
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
bcrypt.hash('$NewPw', 10).then(hash => {
  pool.query('UPDATE users SET password_hash = \$1, updated_at = NOW() WHERE email = \$2', [hash, '$Email'])
    .then(r => { console.log('[repair] rows updated:', r.rowCount); pool.end(); process.exit(0); })
    .catch(e => { console.error('[repair] error:', e.message); pool.end(); process.exit(1); });
}).catch(e => { console.error('[repair] bcrypt error:', e.message); process.exit(1); });
"@
  try {
    echo $script | docker exec -i docker-web-1 node -
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

# ══════════════════════════════════════════════════════════════════════════
#  STATE IMPLEMENTATIONS
# ══════════════════════════════════════════════════════════════════════════

function Step-Precheck() {
  Write-Step "Checking system"

  # Ensure log directory exists
  $logDir = Split-Path $Script:LogFile -Parent
  New-Item -ItemType Directory -Path $logDir -Force -ErrorAction SilentlyContinue | Out-Null
  Write-Log "datasensAI installer v$($Script:InstallerVersion) started $(Get-Date -Format 'u')"
  Write-Ok "Log file: $($Script:LogFile)"

  # Admin check
  $current = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Die-WithSupport "PowerShell is not running as Administrator. Close this window, right-click PowerShell -> Run as Administrator, and re-run."
  }
  Write-Ok "Running as Administrator"

  # OS version
  $osVer = [System.Environment]::OSVersion.VersionString
  Write-Ok "OS: $osVer"

  # Disk space
  $freeGb = [Math]::Round((Get-PSDrive C -ErrorAction SilentlyContinue).Free / 1GB, 1)
  if ($freeGb -lt $MinDiskGb) {
    Die-WithSupport "Only $freeGb GB free on C:. Need at least $MinDiskGb GB."
  }
  Write-Ok "Disk space: $freeGb GB free"

  # RAM (warn only)
  $totalGb = [Math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).TotalPhysicalMemory / 1GB)
  if ($totalGb -lt 8) {
    Write-Warn "Only $totalGb GB RAM. 8 GB minimum recommended."
  } elseif ($totalGb -lt 16) {
    Write-Warn "$totalGb GB RAM — Ollama model may run slowly. 16 GB recommended."
  } else {
    Write-Ok "RAM: $totalGb GB"
  }
}

function Step-DependencyCheck() {
  Write-Step "Checking dependencies (winget)"
  if (-not (Have-Cmd winget)) {
    Die-WithSupport "winget not found. Install 'App Installer' from the Microsoft Store (Windows 10) or update Windows 11, then re-run."
  }
  Write-Ok "winget: $(winget --version)"

  if (-not (Have-Cmd git)) {
    Write-Info "Installing Git..."
    winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    if (-not (Have-Cmd git)) { Die-WithSupport "Git install failed. Install manually from https://git-scm.com" }
  }
  Write-Ok "Git: $(git --version | Select-Object -First 1)"
}

function Step-DockerCheck() {
  Write-Step "Checking Docker"

  if (-not (Have-Cmd docker)) {
    Write-Info "Installing Docker Desktop..."
    Write-Info "(This triggers a UAC prompt and may take a few minutes)"
    winget install --id Docker.DockerDesktop --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  }

  if (-not (Have-DockerRunning)) {
    Write-Info "Starting Docker Desktop..."
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) { Start-Process $dockerExe -ErrorAction SilentlyContinue }
    Write-Host "  Waiting for Docker Desktop to start..." -NoNewline
    $tries = 0
    while (-not (Have-DockerRunning)) {
      $tries++
      if ($tries -gt 90) {
        Die-WithSupport "Docker did not start after 3 minutes. Open Docker Desktop from Start menu and wait for the whale icon in the system tray, then re-run."
      }
      Write-Host "." -NoNewline
      Start-Sleep 2
    }
    Write-Host ""
  }
  Write-Ok "Docker: $(docker --version | Select-Object -First 1)"

  # Detect compose
  $Script:ComposeCmd = $null
  try { docker compose version 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $Script:ComposeCmd = 'docker compose' } } catch {}
  if (-not $Script:ComposeCmd) {
    if (Have-Cmd 'docker-compose') { $Script:ComposeCmd = 'docker-compose' } else {
      Die-WithSupport "Neither 'docker compose' nor 'docker-compose' found. Reinstall Docker Desktop."
    }
  }
  Write-Ok "Compose: $($Script:ComposeCmd)"
}

function Step-PortCheck() {
  Write-Step "Checking ports"
  $allClear = $true

  function Check-Port([int]$Port, [string]$Name) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
      $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
      if ($proc.Name -match 'docker|vpnkit|com.docker') {
        Write-Ok "Port $Port ($Name): in use by Docker (our containers) — OK"
      } else {
        Write-Warn "Port $Port ($Name): in use by '$($proc.Name)' (PID $($conn.OwningProcess))"
        Write-Warn "  Stop that process, or change ${Name}=$Port in .env"
        $script:allClear = $false
      }
    } else {
      Write-Ok "Port $Port ($Name): free"
    }
  }

  Check-Port $WebPort      "WEB_PORT"
  Check-Port $PostgresPort "POSTGRES_PORT"
  Check-Port $OllamaPort   "OLLAMA_PORT"

  if (-not $allClear) { Die-WithSupport "One or more required ports are in use. Free them and re-run." }
}

function Step-Repo() {
  Write-Step "Setting up datasensAI files"
  if (Test-Path "$TargetDir\.git") {
    Write-Info "Existing repo found — updating to latest..."
    git -C $TargetDir fetch --quiet origin 2>$null
    git -C $TargetDir checkout --quiet $Branch 2>$null
    git -C $TargetDir pull --quiet origin $Branch 2>$null
    Write-Ok "Code updated to latest from main"
  } else {
    Write-Info "Downloading datasensAI from GitHub..."
    git clone --depth 50 --branch $Branch $RepoUrl $TargetDir 2>&1
    if ($LASTEXITCODE -ne 0) { Die-WithSupport "Could not download from GitHub. Check your internet connection." }
    Write-Ok "Downloaded to $TargetDir"
  }
  # Ensure log dir still valid
  New-Item -ItemType Directory -Path (Split-Path $Script:LogFile -Parent) -Force -ErrorAction SilentlyContinue | Out-Null
}

function Step-ConfigGeneration() {
  Write-Step "Creating configuration"
  Set-Location $TargetDir -ErrorAction Stop

  $useExisting = $false
  if ((Test-Path .env) -and (Select-String -Path .env -Pattern '^GOVERNANCE_BOOTSTRAP_KEY=' -Quiet) `
                        -and (Select-String -Path .env -Pattern '^ADMIN_PASSWORD=' -Quiet)) {
    $useExisting = $true
  }

  if ($useExisting -and -not $AdvancedSetup) {
    Write-Info "Existing configuration found — reading credentials..."
    $Script:AdminEmail    = (Select-String -Path .env -Pattern '^ADMIN_EMAIL=(.*)').Matches[0].Groups[1].Value
    $Script:AdminPassword = (Select-String -Path .env -Pattern '^ADMIN_PASSWORD=(.*)').Matches[0].Groups[1].Value
    Write-Ok "Using existing configuration"
    Write-Ok "Admin email: $($Script:AdminEmail)"
  } else {
    Write-Info "Generating fresh configuration with secure random secrets..."

    if ($AdvancedSetup) {
      Write-Host ""
      Write-Host "  Advanced Setup — press Enter to accept defaults." -ForegroundColor White
      Write-Host ""
      $input = Read-Host "  Admin email [admin@datasensai.local]"
      $Script:AdminEmail = if ($input) { $input } else { 'admin@datasensai.local' }
      $loop = $true
      while ($loop) {
        $sec = Read-Host "  Admin password (min 12 chars, blank = auto-generate)" -AsSecureString
        $plain = [System.Net.NetworkCredential]::new('', $sec).Password
        if ($plain.Length -eq 0) {
          $Script:AdminPassword = New-RandomPassword
          Write-Info "Auto-generated password will be shown at the end."
          $loop = $false
        } elseif ($plain.Length -ge 12) {
          $Script:AdminPassword = $plain
          $loop = $false
        } else {
          Write-Warn "Too short. Minimum 12 characters."
        }
      }
    } else {
      $Script:AdminPassword = New-RandomPassword
    }

    $encKey = New-RandomHex 32
    $govKey = New-RandomHex 32
    $ts     = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ' -AsUTC

    $envContent = @"
# Generated by datasensAI installer v$($Script:InstallerVersion) on $ts
WEB_PORT=$WebPort
POSTGRES_PORT=$PostgresPort
NODE_ENV=development
APP_ENV=production

ADMIN_EMAIL=$($Script:AdminEmail)
ADMIN_PASSWORD=$($Script:AdminPassword)

SPLUNK_SECRET_ENCRYPTION_KEY=$encKey
GOVERNANCE_BOOTSTRAP_KEY=$govKey

NEXT_PUBLIC_SPLUNK_MCP_URL=
NEXT_PUBLIC_SPLUNK_TOKEN=
NEXT_PUBLIC_SPLUNK_DISABLE_SSL_VERIFY=true

LLM_MODEL=$LlmModel
ANTHROPIC_API_KEY=

HEALTH_CHECK_INTERVAL=10s
HEALTH_CHECK_TIMEOUT=5s
HEALTH_CHECK_RETRIES=5
"@
    Set-Content -Path .env -Value $envContent -NoNewline
    Write-Ok "Configuration created"
    Write-Ok "Admin email: $($Script:AdminEmail)"
  }

  # Validate required keys
  foreach ($key in @('ADMIN_EMAIL','ADMIN_PASSWORD','GOVERNANCE_BOOTSTRAP_KEY','SPLUNK_SECRET_ENCRYPTION_KEY')) {
    $match = Select-String -Path .env -Pattern "^${key}=(.+)" -ErrorAction SilentlyContinue
    if (-not $match) { Die-WithSupport ".env is missing required key: $key. Delete .env and re-run." }
  }
  Write-Ok "Configuration validated"
}

function Step-ModelCheck() {
  Write-Step "Setting up local AI engine (Ollama)"

  if ([string]::IsNullOrEmpty($LlmModel)) {
    Write-Ok "Skipping Ollama (configure Anthropic API key in Settings after install)"
    return
  }

  if (-not (Have-Cmd ollama)) {
    Write-Info "Installing Ollama..."
    winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    if (-not (Have-Cmd ollama)) { Die-WithSupport "Ollama install failed. Install manually from https://ollama.com" }
  }
  Write-Ok "Ollama installed"

  # Start Ollama service
  $ollamaUp = $false
  try { (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$OllamaPort/api/tags" -TimeoutSec 2) | Out-Null; $ollamaUp = $true } catch {}
  if (-not $ollamaUp) {
    Write-Info "Starting Ollama service..."
    Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
    $tries = 0
    while ($true) {
      try { (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$OllamaPort/api/tags" -TimeoutSec 2) | Out-Null; break } catch {}
      $tries++
      if ($tries -gt 30) { Die-WithSupport "Ollama service did not start. Run 'ollama serve' in a separate window, then re-run." }
      Start-Sleep 1
    }
  }
  Write-Ok "Ollama running on :$OllamaPort"

  # Pull model if needed
  $installed = ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] }
  if ($installed -notcontains $LlmModel) {
    Write-Info "Downloading AI model: $LlmModel (~5 GB — this may take 10-30 minutes)"
    Write-Info "Progress appears below. Please wait..."
    ollama pull $LlmModel
    if ($LASTEXITCODE -ne 0) { Die-WithSupport "Model download failed. Check internet connection." }
  }
  Write-Ok "Model ready: $LlmModel"
}

function Step-StackStart() {
  Write-Step "Starting datasensAI"
  Set-Location $TargetDir -ErrorAction Stop

  # Load .env into current process
  Get-Content .\.env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    Set-Item -Path "env:$k" -Value "$v" -ErrorAction SilentlyContinue
  }

  Write-Info "Building and starting containers (first run: 2-5 minutes)..."
  $out = Invoke-Compose up -d --build 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Log "compose up output: $out"
    if ($out -match 'port is already allocated|address already in use') {
      Die-WithSupport "A required port is already in use. Check Step [$($Script:CurrentStep)] port conflicts."
    }
    Die-WithSupport "Failed to start containers. See log file for details."
  }
  Write-Ok "Containers started"
}

function Step-DbReady() {
  Write-Step "Waiting for database"
  $tries = 0
  while ($true) {
    $status = docker ps --filter "name=docker-postgres-1" --format '{{.Status}}' 2>$null | Select-Object -First 1
    if ($status -match '(?i)healthy') { Write-Ok "Database ready"; return }
    $tries++
    if ($tries -gt 90) {
      docker logs docker-postgres-1 --tail 20 2>&1 | Add-Content -Path $Script:LogFile -ErrorAction SilentlyContinue
      Die-WithSupport "Database did not become healthy after 3 minutes. Check log file."
    }
    Write-Host "  Waiting for database ($($tries*2)s)..." -NoNewline
    Write-Host "`r" -NoNewline
    Start-Sleep 2
  }
  Write-Host ""
}

function Step-MigrationVerify() {
  Write-Step "Verifying database schema"
  $tries = 0
  while ($true) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/health" -TimeoutSec 2 | Out-Null
      break
    } catch {}
    $tries++
    if ($tries -gt 150) {
      docker logs docker-web-1 --tail 30 2>&1 | Add-Content -Path $Script:LogFile -ErrorAction SilentlyContinue
      Die-WithSupport "App did not start after 5 minutes. See log file."
    }
    Write-Host "  Waiting for app to start ($($tries*2)s)..." -NoNewline
    Write-Host "`r" -NoNewline
    Start-Sleep 2
  }
  Write-Host ""

  $healthJson = (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/health" -TimeoutSec 10).Content
  Write-Log "health: $healthJson"

  if ($healthJson -notmatch '"valid":true') {
    Die-WithSupport "API health reports schema invalid. See log file."
  }

  $expectedMig  = Get-LatestMigration
  $actualMigMatch = [regex]::Match($healthJson, '"latestMigration":(\d+)')
  if (-not $actualMigMatch.Success) { Die-WithSupport "Could not read latestMigration from health endpoint." }
  $actualMig = [int]$actualMigMatch.Groups[1].Value
  if ($actualMig -lt $expectedMig) {
    Die-WithSupport "Migration incomplete: applied through $actualMig, expected $expectedMig. Pull latest main and re-run."
  }

  Write-Ok "Database schema valid (migration $actualMig)"
  Write-Ok "API health check passed"
}

function Step-AdminSeed() {
  Write-Step "Verifying admin account"

  $count = docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -tAc `
    "SELECT COUNT(*) FROM users WHERE email='$($Script:AdminEmail)';" 2>$null
  $count = $count.Trim()

  if ($count -eq '0' -or [string]::IsNullOrEmpty($count)) {
    Write-Info "Admin user not yet created — waiting 5 seconds..."
    Start-Sleep 5
    $count = docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -tAc `
      "SELECT COUNT(*) FROM users WHERE email='$($Script:AdminEmail)';" 2>$null
    $count = $count.Trim()
    if ($count -eq '0' -or [string]::IsNullOrEmpty($count)) {
      Die-WithSupport "Admin user '$($Script:AdminEmail)' was not created. Check: docker logs docker-web-1"
    }
  }
  Write-Ok "Admin user exists: $($Script:AdminEmail)"
}

function Step-LoginVerify() {
  Write-Step "Testing login (final validation gate)"
  Write-Info "Logging in with generated credentials..."

  if (Test-Login $Script:AdminEmail $Script:AdminPassword $WebPort) {
    Write-Ok "Login verified — credentials work"
    return
  }

  Write-Warn "Login failed with current credentials. Attempting automatic repair..."
  Write-Log "login failed for $($Script:AdminEmail) — attempting password reset"

  if (Reset-AdminPassword $Script:AdminEmail $Script:AdminPassword) {
    Write-Info "Password reset. Retrying login..."
    Start-Sleep 2
    if (Test-Login $Script:AdminEmail $Script:AdminPassword $WebPort) {
      Write-Ok "Login verified after repair"
      return
    }
  }

  docker logs docker-web-1 --tail 30 2>&1 | Add-Content -Path $Script:LogFile -ErrorAction SilentlyContinue
  Die-WithSupport "Login verification failed even after credential repair. See log file."
}

function Step-WebVerify() {
  Write-Step "Verifying dashboard"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/" -TimeoutSec 10
    $code = $resp.StatusCode
    Write-Ok "Dashboard reachable at http://localhost:$WebPort (HTTP $code)"
  } catch {
    Write-Warn "Dashboard check returned an error (may still be loading — not fatal)"
  }
}

function Step-SaveCredentials() {
  Write-Step "Saving credentials"
  $credDir  = $TargetDir
  $credTemp = "$credDir\credentials.tmp"
  $credFile = "$credDir\credentials.txt"
  New-Item -ItemType Directory -Path $credDir -Force -ErrorAction SilentlyContinue | Out-Null

  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Set-Content -Path $credTemp -Value @"
datasensAI Credentials — Installer v$($Script:InstallerVersion)
Generated: $ts UTC
Verified: login API test PASSED

Dashboard URL:  http://localhost:$WebPort
Admin email:    $($Script:AdminEmail)
Admin password: $($Script:AdminPassword)

This file is stored at: $credFile
Keep it safe — do not share it.

Next steps after login:
  1. Settings -> Splunk Connection -> enter your Splunk URL + token
  2. Click "Test Connection" until green, then Save
  3. On the dashboard, click Refresh (pipeline takes 20-25 min)
"@
  Move-Item -Path $credTemp -Destination $credFile -Force
  Write-Ok "Credentials saved to: $credFile"
}

function Step-OpenBrowser() {
  Write-Step "Opening browser"
  $url = "http://localhost:$WebPort"
  Write-Info "Opening $url ..."
  try { Start-Process $url } catch { Write-Warn "Could not open browser automatically. Open $url manually." }
  Write-Ok "Browser launched"
}

function Step-Success() {
  Write-Host ""
  Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
  Write-Host "║       datasensAI installed and verified successfully          ║" -ForegroundColor Green
  Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
  Write-Host ""
  Write-Host "  URL:           http://localhost:$WebPort" -ForegroundColor White
  Write-Host "  Admin email:   $($Script:AdminEmail)" -ForegroundColor White
  Write-Host "  Admin password: $($Script:AdminPassword)" -ForegroundColor White
  Write-Host ""
  Write-Host "  Credentials saved to: $TargetDir\credentials.txt" -ForegroundColor White
  Write-Host ""
  Write-Host "  What to do next:" -ForegroundColor White
  Write-Host "    1. A browser window should have opened automatically"
  Write-Host "    2. Log in with the email and password above"
  Write-Host "    3. Settings -> Splunk Connection -> enter your Splunk URL + token"
  Write-Host "    4. Click Test Connection until green, then Save"
  Write-Host "    5. Back on dashboard, click Refresh (pipeline: 20-25 min first run)"
  Write-Host ""
  Write-Host "  If anything looks wrong:" -ForegroundColor White
  Write-Host "    Run: $TargetDir\scripts\install\doctor.ps1"
  Write-Host ""
  Write-Log "SUCCESS — install complete at $(Get-Date -Format 'u')"
}

# ══════════════════════════════════════════════════════════════════════════
#  MODE RUNNERS
# ══════════════════════════════════════════════════════════════════════════

function Mode-FreshInstall() {
  $Script:TotalSteps = 15
  Step-Precheck; Step-DependencyCheck; Step-DockerCheck; Step-PortCheck
  Step-Repo; Step-ConfigGeneration; Step-ModelCheck; Step-StackStart
  Step-DbReady; Step-MigrationVerify; Step-AdminSeed; Step-LoginVerify
  Step-WebVerify; Step-SaveCredentials; Step-OpenBrowser; Step-Success
}

function Mode-StartExisting() {
  $Script:TotalSteps = 8
  Step-Precheck; Step-DockerCheck; Step-ConfigGeneration; Step-StackStart
  Step-DbReady; Step-MigrationVerify; Step-LoginVerify; Step-WebVerify; Step-OpenBrowser
  Write-Host ""
  Write-Host "datasensAI is running at http://localhost:$WebPort" -ForegroundColor Green
  Write-Host ""
  Write-Log "SUCCESS — started existing install"
}

function Mode-Repair() {
  $Script:TotalSteps = 12
  Step-Precheck; Step-DockerCheck; Step-PortCheck; Step-ConfigGeneration

  Write-Step "Restarting containers"
  Set-Location $TargetDir
  Get-Content .\.env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    Set-Item -Path "env:$k" -Value "$v" -ErrorAction SilentlyContinue
  }
  Invoke-Compose restart 2>$null
  if ($LASTEXITCODE -ne 0) { Invoke-Compose up -d 2>$null }
  Write-Ok "Containers restarted"

  Step-DbReady; Step-MigrationVerify; Step-AdminSeed; Step-LoginVerify
  Step-WebVerify; Step-SaveCredentials; Step-OpenBrowser
  Write-Host ""
  Write-Host "Repair complete. datasensAI is running at http://localhost:$WebPort" -ForegroundColor Green
  Write-Host ""
  Write-Log "SUCCESS — repair complete"
}

function Mode-ResetReinstall() {
  Write-Host ""
  Write-Host "WARNING: Reset and Reinstall" -ForegroundColor Red
  Write-Host ""
  Write-Host "  This will DELETE all local datasensAI data:"
  Write-Host "  * Database (all snapshots, scores, governance history)"
  Write-Host "  * Configuration (.env and credentials)"
  Write-Host ""
  Write-Host "  Your Splunk data is not affected."
  Write-Host ""
  $confirm = Read-Host "  Type 'RESET' to confirm, or press Enter to cancel"
  if ($confirm -ne 'RESET') { Write-Info "Reset cancelled."; return }

  $Script:TotalSteps = 15
  Step-Precheck; Step-DockerCheck

  Write-Step "Wiping existing installation"
  Set-Location $TargetDir -ErrorAction SilentlyContinue
  if ((Test-Path "$TargetDir\docker\docker-compose.yml") -and $Script:ComposeCmd) {
    Get-Content .\.env 2>$null | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
      $k, $v = $_ -split '=', 2
      Set-Item -Path "env:$k" -Value "$v" -ErrorAction SilentlyContinue
    }
    Invoke-Compose down -v --remove-orphans 2>$null
    Write-Ok "Docker volumes removed"
  }
  Remove-Item "$TargetDir\.env"          -ErrorAction SilentlyContinue
  Remove-Item "$TargetDir\credentials.txt" -ErrorAction SilentlyContinue
  Remove-Item "$TargetDir\credentials.tmp" -ErrorAction SilentlyContinue
  Write-Ok "Old configuration removed"

  Step-PortCheck; Step-Repo; Step-ConfigGeneration; Step-ModelCheck; Step-StackStart
  Step-DbReady; Step-MigrationVerify; Step-AdminSeed; Step-LoginVerify
  Step-WebVerify; Step-SaveCredentials; Step-OpenBrowser; Step-Success
}

function Mode-ExportLogs() {
  Write-Host ""
  Write-Host "Exporting support logs..." -ForegroundColor White
  $bundleDir = "$env:USERPROFILE\Desktop\datasensai-support-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

  # Install logs
  $logDir = Split-Path $Script:LogFile -Parent
  if (Test-Path $logDir) { Copy-Item "$logDir\*.log" $bundleDir -ErrorAction SilentlyContinue }

  # Redacted .env
  if (Test-Path "$TargetDir\.env") {
    (Get-Content "$TargetDir\.env") -replace '(?<=^SPLUNK_SECRET_ENCRYPTION_KEY=).*','[REDACTED]' `
      -replace '(?<=^GOVERNANCE_BOOTSTRAP_KEY=).*','[REDACTED]' `
      -replace '(?<=^ADMIN_PASSWORD=).*','[REDACTED]' `
      -replace '(?<=^ANTHROPIC_API_KEY=).*','[REDACTED]' |
      Set-Content "$bundleDir\env-redacted.txt"
  }

  # Docker status
  docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}" 2>&1 | Set-Content "$bundleDir\docker-ps.txt"
  docker info 2>&1 | Set-Content "$bundleDir\docker-info.txt"

  # App logs
  foreach ($svc in @('postgres','web','worker')) {
    docker logs "docker-${svc}-1" --tail 300 2>&1 | Set-Content "$bundleDir\logs-${svc}.txt"
  }

  # Health
  try { (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/health" -TimeoutSec 5).Content | Set-Content "$bundleDir\api-health.json" }
  catch { "not reachable" | Set-Content "$bundleDir\api-health.json" }

  # Versions
  @(
    "OS: $([System.Environment]::OSVersion.VersionString)"
    "Docker: $(docker --version 2>$null)"
    if (Have-Cmd ollama) { "Ollama: $(ollama --version 2>$null)" }
    if (Have-Cmd git)    { "Git: $(git --version 2>$null)" }
    if (Have-Cmd winget) { "winget: $(winget --version 2>$null)" }
  ) | Set-Content "$bundleDir\versions.txt"

  # Port usage
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(3002, 5433, 11434) } |
    Format-Table -AutoSize 2>&1 | Set-Content "$bundleDir\ports.txt"

  # Create ZIP
  $zipFile = "$env:USERPROFILE\Desktop\datasensai-support-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
  try {
    Compress-Archive -Path $bundleDir -DestinationPath $zipFile -Force
    Remove-Item $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Support bundle created:" -ForegroundColor Green
    Write-Host "  $zipFile"
    Write-Host ""
    Write-Host "  Share this file with support. It does NOT contain your passwords."
    Write-Host ""
  } catch {
    Write-Host ""
    Write-Host "Support bundle folder:" -ForegroundColor Green
    Write-Host "  $bundleDir"
    Write-Host ""
  }
}

function Mode-Stop() {
  Write-Host ""
  Write-Host "Stopping datasensAI..." -ForegroundColor White
  if (-not (Test-Path "$TargetDir\docker\docker-compose.yml")) { Die-WithSupport "Installation not found at $TargetDir" }
  Step-DockerCheck
  Set-Location $TargetDir
  Get-Content .\.env 2>$null | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    Set-Item -Path "env:$k" -Value "$v" -ErrorAction SilentlyContinue
  }
  Invoke-Compose stop
  if ($LASTEXITCODE -eq 0) { Write-Ok "datasensAI stopped" } else { Write-Warn "Could not stop cleanly." }
}

function Mode-Uninstall() {
  Write-Host ""
  Write-Host "Uninstall datasensAI" -ForegroundColor Red
  Write-Host ""
  Write-Host "  This will remove:"
  Write-Host "  * datasensAI containers and database"
  Write-Host "  * Installation folder: $TargetDir"
  Write-Host ""
  Write-Host "  This does NOT remove Docker, Git, winget, or Ollama."
  Write-Host ""
  $confirm = Read-Host "  Type 'UNINSTALL' to confirm, or press Enter to cancel"
  if ($confirm -ne 'UNINSTALL') { Write-Info "Uninstall cancelled."; return }

  Step-DockerCheck
  if ((Test-Path "$TargetDir\docker\docker-compose.yml") -and $Script:ComposeCmd) {
    Set-Location $TargetDir
    Get-Content .\.env 2>$null | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
      $k, $v = $_ -split '=', 2
      Set-Item -Path "env:$k" -Value "$v" -ErrorAction SilentlyContinue
    }
    Invoke-Compose down -v --remove-orphans 2>$null
    Write-Ok "Containers and volumes removed"
  }
  Remove-Item $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Ok "Installation folder removed: $TargetDir"
  Write-Host ""
  Write-Host "datasensAI has been uninstalled." -ForegroundColor Green
  Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════════
#  MENU + MAIN
# ══════════════════════════════════════════════════════════════════════════

function Show-Welcome() {
  Clear-Host
  Write-Host @"

╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║               datasensAI  —  Installer v1.3.0 (Windows)             ║
║                                                                      ║
║   AI-powered Splunk telemetry intelligence dashboard                 ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor White
}

function Test-ExistingInstall() {
  if (-not (Test-Path "$TargetDir\.git")) { return $false }
  $runningWeb = docker ps --filter "name=docker-web-1" --format '{{.Status}}' 2>$null | Select-Object -First 1
  if ($runningWeb -match '(?i)up') { return $true }
  return (Test-Path "$TargetDir\.env")
}

function Show-ModeMenu() {
  Write-Host ""
  $existing = Test-ExistingInstall
  if ($existing) {
    Write-Host "  An existing datasensAI installation was found." -ForegroundColor White
    Write-Host ""
    Write-Host "  What would you like to do?" -ForegroundColor White
    Write-Host ""
    Write-Host "  1) Start existing app      - start containers and open browser"
    Write-Host "  2) Repair install          - fix problems, keep your data"
    Write-Host "  3) Fresh install           - download + set up from scratch"
    Write-Host "  4) Reset and reinstall     - WIPE data and start clean"
    Write-Host "  5) Export support logs     - create a ZIP to share with support"
    Write-Host "  6) Stop app"
    Write-Host "  7) Uninstall"
    Write-Host ""
    $choice = Read-Host "  Enter 1-7 [default: 1]"
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }
  } else {
    Write-Host "  Welcome to the datasensAI installer." -ForegroundColor White
    Write-Host ""
    Write-Host "  What would you like to do?" -ForegroundColor White
    Write-Host ""
    Write-Host "  1) Fresh install           - install for the first time (recommended)"
    Write-Host "  5) Export support logs     - for troubleshooting"
    Write-Host "  7) Uninstall"
    Write-Host ""
    $choice = Read-Host "  Enter 1, 5, or 7 [default: 1]"
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }
  }

  switch ($choice) {
    '1' { if ($existing) { Mode-StartExisting } else { Mode-FreshInstall } }
    '2' { Mode-Repair }
    '3' { Mode-FreshInstall }
    '4' { Mode-ResetReinstall }
    '5' { Mode-ExportLogs }
    '6' { Mode-Stop }
    '7' { Mode-Uninstall }
    default { Write-Warn "Invalid choice. Defaulting to 1."; if ($existing) { Mode-StartExisting } else { Mode-FreshInstall } }
  }
}

# ── Ensure log dir exists before anything ────────────────────────────────
$earlyLogDir = Split-Path $Script:LogFile -Parent
New-Item -ItemType Directory -Path $earlyLogDir -Force -ErrorAction SilentlyContinue | Out-Null

Show-Welcome

switch ($Mode.ToLower()) {
  'fresh'     { Mode-FreshInstall }
  'start'     { Mode-StartExisting }
  'repair'    { Mode-Repair }
  'reset'     { Mode-ResetReinstall }
  'logs'      { Mode-ExportLogs }
  'stop'      { Mode-Stop }
  'uninstall' { Mode-Uninstall }
  default     { Show-ModeMenu }
}
