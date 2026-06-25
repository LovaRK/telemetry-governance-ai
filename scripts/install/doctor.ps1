# ============================================================================
# datasensAI doctor - Windows health check
#
# Quick diagnosis of every component the app needs. Each line is independent
# so a failure in one row doesn't skip later rows.
#
# Exit code: 0 if everything green, 1 if any red (for scripted gating).
#
# Usage:
#   .\doctor.ps1
#   .\doctor.ps1 -WebPort 4000 -TargetDir C:\datasensai
# ============================================================================
[CmdletBinding()]
param(
  [string]$TargetDir = "$env:USERPROFILE\datasensai",
  [int]   $WebPort   = 3002
)

$script:Pass = 0; $script:Fail = 0; $script:Warn = 0
function CheckPass($m) { Write-Host "  [OK]  $m" -ForegroundColor Green; $script:Pass++ }
function CheckWarn($m) { Write-Host "  [!]   $m" -ForegroundColor Yellow; $script:Warn++ }
function CheckFail($m) { Write-Host "  [X]   $m" -ForegroundColor Red; $script:Fail++ }
function Section($m)   { Write-Host ""; Write-Host $m -ForegroundColor White -BackgroundColor DarkBlue }
function Have($cmd)    { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Section "Host"
CheckPass "OS: Windows $([System.Environment]::OSVersion.VersionString)"
$free = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
if ($free -ge 10) { CheckPass "Disk: $free GB free on C:" }
elseif ($free -ge 5) { CheckWarn "Disk: only $free GB free on C: (recommend >= 10 GB headroom)" }
else { CheckFail "Disk: only $free GB free on C: - Docker pulls will fail" }

Section "Tooling"
if (Have git) { CheckPass "Git: $(git --version)" } else { CheckFail "Git not installed" }
if (Have docker) {
  try { docker info 2>&1 | Out-Null; CheckPass "Docker daemon running: $(docker --version)" }
  catch { CheckFail "Docker installed but daemon not running (start Docker Desktop)" }
} else { CheckFail "Docker not installed" }

Section "LLM (Ollama)"
try {
  $tags = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:11434/api/tags" -TimeoutSec 2
  CheckPass "Ollama service responding on :11434"
  $models = ($tags.Content | ConvertFrom-Json).models | ForEach-Object { $_.name }
  if ($models) {
    CheckPass "Models loaded: $($models -join ', ')"
    if ($models -contains 'gemma2:9b') { CheckPass "Default model gemma2:9b present" }
    else { CheckWarn "gemma2:9b not pulled. Run: ollama pull gemma2:9b" }
  } else { CheckWarn "Ollama running but no models loaded" }
} catch { CheckWarn "Ollama not responding on :11434 (skip if you're using Anthropic)" }

Section "Repo"
if (Test-Path "$TargetDir\.git") {
  CheckPass "Repo at $TargetDir"
  $branch = (git -C $TargetDir rev-parse --abbrev-ref HEAD 2>$null)
  $sha    = (git -C $TargetDir rev-parse --short HEAD 2>$null)
  CheckPass "Branch: $branch @ $sha"
  if (Test-Path "$TargetDir\.env") {
    CheckPass ".env present"
    $envLines = Get-Content "$TargetDir\.env"
    foreach ($key in @('ADMIN_EMAIL','ADMIN_PASSWORD','SPLUNK_SECRET_ENCRYPTION_KEY','GOVERNANCE_BOOTSTRAP_KEY')) {
      $line = $envLines | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
      if (-not $line) { CheckFail ".env $key missing"; continue }
      $val = $line.Substring($key.Length + 1)
      if (-not $val) { CheckFail ".env $key is empty" }
      elseif ($key -eq 'ADMIN_PASSWORD' -and $val.Length -lt 12) { CheckWarn ".env ADMIN_PASSWORD is shorter than 12 chars" }
      else { CheckPass ".env $key set" }
    }
  } else { CheckFail ".env missing - run install.ps1" }
} else { CheckFail "Repo not found at $TargetDir (pass -TargetDir if it's elsewhere)" }

Section "App stack"
if (Have docker) {
  try { docker info 2>&1 | Out-Null
    foreach ($svc in 'postgres','web','worker') {
      $name = "docker-$svc-1"
      $state = (docker ps --filter "name=$name" --format '{{.Status}}' 2>$null | Select-Object -First 1)
      if ($state) {
        if ($state -match 'healthy|^Up ') { CheckPass "Container ${name}: $state" }
        else { CheckFail "Container $name unhealthy: $state" }
      } else { CheckFail "Container $name not running" }
    }
  } catch { CheckWarn "Skipping container checks (Docker not running)" }
}

try {
  $healthResp = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/health" -TimeoutSec 10
  CheckPass "Dashboard responding on http://localhost:$WebPort"

  # Schema / migration check
  $healthJson = $healthResp.Content
  if ($healthJson -match '"valid":true') {
    CheckPass "Schema health: valid"
    $migMatch = [regex]::Match($healthJson, '"latestMigration":(\d+)')
    if ($migMatch.Success) { CheckPass "Latest migration applied: $($migMatch.Groups[1].Value)" }
    else { CheckWarn "Could not read latestMigration from health endpoint" }
  } else { CheckFail "Schema health: INVALID — run .\install.ps1 -> Repair" }

  # Login verification
  if (Test-Path "$TargetDir\.env") {
    $envContent = Get-Content "$TargetDir\.env"
    $adminEmail = ($envContent | Where-Object { $_ -match '^ADMIN_EMAIL=(.+)' } | Select-Object -First 1) -replace '^ADMIN_EMAIL=',''
    $adminPw    = ($envContent | Where-Object { $_ -match '^ADMIN_PASSWORD=(.+)' } | Select-Object -First 1) -replace '^ADMIN_PASSWORD=',''
    if ($adminEmail -and $adminPw) {
      $body = "{`"email`":`"$adminEmail`",`"password`":`"$adminPw`"}"
      try {
        $loginResp = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$WebPort/api/auth/login" `
          -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 10
        if ($loginResp.Content -match '"accessToken"') { CheckPass "Login API verified — credentials work ($adminEmail)" }
        else { CheckFail "Login API returned unexpected response for $adminEmail" }
      } catch { CheckFail "Login API FAILED for $adminEmail — run .\install.ps1 -> Repair" }
    } else { CheckWarn "Could not read credentials from .env for login check" }
  }

  # Credentials file
  if (Test-Path "$TargetDir\credentials.txt") { CheckPass "Credentials file: $TargetDir\credentials.txt" }
  else { CheckWarn "Credentials file not found — will be created after a successful install" }

} catch { CheckFail "Dashboard NOT responding on http://localhost:$WebPort" }

Section "Splunk (tenant config in DB)"
$pgState = (docker ps --filter "name=docker-postgres-1" --format '{{.Status}}' 2>$null | Select-Object -First 1)
if ($pgState -match 'healthy') {
  $row = docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -tAc `
    "SELECT slug, COALESCE(splunk_url,'(unset)'), COALESCE(splunk_test_status,'(never tested)') FROM tenants WHERE slug='default';" 2>$null `
    | Select-Object -First 1
  if ($row) {
    $parts = $row -split '\|'
    $slug = $parts[0]; $url = $parts[1]; $testStatus = $parts[2]
    if ($url -eq '(unset)') {
      CheckWarn "Default tenant has no Splunk URL configured yet (Settings -> Splunk Connection)"
    } elseif ($url -match 'splunk-mock|localhost|127\.0\.0\.1|0\.0\.0\.0') {
      CheckWarn "Default tenant points at a sandbox host ($url) - only OK if APP_ENV=sandbox"
    } else {
      CheckPass "Default tenant splunk_url: $url"
      if ($testStatus -eq 'success') { CheckPass "Last Splunk connection test: success" }
      else { CheckWarn "Last Splunk connection test: $testStatus - click Test Connection in Settings" }
    }
  } else { CheckWarn "Could not read tenants row (DB connect failed or no default tenant)" }
} else { CheckWarn "Skipping Splunk config check (Postgres not running)" }

Write-Host ""
Write-Host "Summary: " -NoNewline -ForegroundColor White
Write-Host "$Pass OK  " -NoNewline -ForegroundColor Green
Write-Host "$Warn !   " -NoNewline -ForegroundColor Yellow
Write-Host "$Fail X" -ForegroundColor Red
Write-Host ""

if ($script:Fail -gt 0) {
  Write-Host @"
Common fixes:
  - Docker daemon not running        -> open Docker Desktop, wait for the whale icon, re-run doctor
  - Containers not running           -> cd $TargetDir; docker compose -f docker/docker-compose.yml up -d
  - .env missing                     -> run .\install.ps1 (it generates one)
  - Dashboard not responding         -> docker compose -f docker/docker-compose.yml logs web | Select -Last 50
  - Splunk URL unset                 -> log in, Settings -> Splunk Connection
"@
  exit 1
}
exit 0
