#!/usr/bin/env bash
# ============================================================================
# datasensAI doctor — Mac/Linux health check
#
# Quick diagnosis of every component the app needs. Run this when something
# looks off after install, or as the first triage step before pinging support.
#
# Each line is independent — a failure in one row doesn't skip later rows, so
# you get the full picture in one shot. Exit code: 0 if everything ✅, 1 if
# any ❌ (suitable for CI / scripted health gates).
#
# Usage:
#   ./doctor.sh                       # all checks against http://localhost:3002
#   WEB_PORT=4000 ./doctor.sh         # alternate port
#   TARGET_DIR=/path/to/repo ./doctor.sh
# ============================================================================
set -u  # NOT -e: we want every check to run even if one fails

TARGET_DIR="${TARGET_DIR:-$HOME/datasensai}"
WEB_PORT="${WEB_PORT:-3002}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

check_pass() { printf "  ${GREEN}✓${NC}  %s\n" "$1"; PASS=$((PASS + 1)); }
check_warn() { printf "  ${YELLOW}!${NC}  %s\n" "$1"; WARN=$((WARN + 1)); }
check_fail() { printf "  ${RED}✗${NC}  %s\n" "$1"; FAIL=$((FAIL + 1)); }
section()    { printf "\n${BOLD}%s${NC}\n" "$1"; }

section "Host"
if command -v uname >/dev/null; then check_pass "OS: $(uname -s) $(uname -m)"; else check_fail "uname not found"; fi
free_gb=$(df -g "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
if [ "${free_gb:-0}" -ge 10 ]; then check_pass "Disk: ${free_gb} GB free in $HOME"
elif [ "${free_gb:-0}" -ge 5 ]; then check_warn "Disk: only ${free_gb} GB free in $HOME (recommend ≥ 10 GB headroom)"
else check_fail "Disk: only ${free_gb} GB free in $HOME — Docker pulls will fail"; fi

section "Tooling"
if command -v git >/dev/null; then check_pass "Git: $(git --version | head -1)"; else check_fail "Git not installed"; fi
if command -v docker >/dev/null; then
  if docker info >/dev/null 2>&1; then check_pass "Docker daemon running: $(docker --version)"
  else check_fail "Docker installed but daemon not running (start Docker Desktop)"; fi
else check_fail "Docker not installed"; fi
if command -v openssl >/dev/null; then check_pass "openssl: $(openssl version | head -1)"; else check_warn "openssl not found (only needed at install time)"; fi

section "LLM (Ollama)"
if curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
  check_pass "Ollama service responding on :11434"
  models=$(curl -fsS http://localhost:11434/api/tags 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')
  if [ -n "$models" ]; then
    check_pass "Models loaded: $models"
    if echo "$models" | grep -q "gemma2:9b"; then check_pass "Default model gemma2:9b present"
    else check_warn "gemma2:9b not pulled. Run: ollama pull gemma2:9b"; fi
  else check_warn "Ollama running but no models loaded"; fi
else check_warn "Ollama not responding on :11434 (skip if you're using Anthropic)"; fi

section "Repo"
if [ -d "$TARGET_DIR/.git" ]; then
  check_pass "Repo at $TARGET_DIR"
  branch=$(git -C "$TARGET_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
  sha=$(git -C "$TARGET_DIR" rev-parse --short HEAD 2>/dev/null)
  check_pass "Branch: $branch @ $sha"
  if [ -f "$TARGET_DIR/.env" ]; then
    check_pass ".env present"
    grep -E '^(ADMIN_EMAIL|ADMIN_PASSWORD|SPLUNK_SECRET_ENCRYPTION_KEY|GOVERNANCE_BOOTSTRAP_KEY)=.+' "$TARGET_DIR/.env" | while read -r line; do
      key=${line%%=*}; val=${line#*=}
      if [ -z "$val" ]; then check_fail ".env $key is empty"
      elif [ "$key" = "ADMIN_PASSWORD" ] && [ ${#val} -lt 12 ]; then check_warn ".env ADMIN_PASSWORD is shorter than 12 chars"
      else check_pass ".env $key set"; fi
    done
  else check_fail ".env missing — run install.sh"; fi
else check_fail "Repo not found at $TARGET_DIR (set TARGET_DIR=/path/to/repo if it's elsewhere)"; fi

section "App stack"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  for svc in postgres web worker; do
    state=$(docker ps --filter "name=docker-${svc}-1" --format '{{.Status}}' 2>/dev/null | head -1)
    if [ -n "$state" ]; then
      if echo "$state" | grep -qi "healthy\|Up "; then check_pass "Container docker-${svc}-1: $state"
      else check_fail "Container docker-${svc}-1 unhealthy: $state"; fi
    else check_fail "Container docker-${svc}-1 not running"; fi
  done
else check_warn "Skipping container checks (Docker not running)"; fi

if curl -fsS "http://localhost:${WEB_PORT}/api/health" >/dev/null 2>&1; then
  check_pass "Dashboard responding on http://localhost:${WEB_PORT}"
else check_fail "Dashboard NOT responding on http://localhost:${WEB_PORT}"; fi

section "Splunk (tenant config in DB)"
if command -v docker >/dev/null && docker ps --filter "name=docker-postgres-1" --format '{{.Status}}' | grep -qi healthy; then
  row=$(docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -tAc \
    "SELECT slug, COALESCE(splunk_url,'(unset)'), COALESCE(splunk_test_status,'(never tested)') FROM tenants WHERE slug='default';" 2>/dev/null | head -1)
  if [ -n "$row" ]; then
    IFS='|' read -r slug url test_status <<< "$row"
    if [ "$url" = "(unset)" ]; then
      check_warn "Default tenant has no Splunk URL configured yet (Settings → Splunk Connection)"
    elif echo "$url" | grep -qE "splunk-mock|localhost|127\.0\.0\.1|0\.0\.0\.0"; then
      check_warn "Default tenant points at a sandbox host ($url) — only OK if APP_ENV=sandbox"
    else
      check_pass "Default tenant splunk_url: $url"
      [ "$test_status" = "success" ] && check_pass "Last Splunk connection test: success" \
        || check_warn "Last Splunk connection test: $test_status — click Test Connection in Settings"
    fi
  else check_warn "Could not read tenants row (DB connect failed or no default tenant)"; fi
else check_warn "Skipping Splunk config check (Postgres not running)"; fi

# ── Summary ────────────────────────────────────────────────────────────────
printf "\n${BOLD}Summary:${NC} ${GREEN}%d ✓${NC}  ${YELLOW}%d !${NC}  ${RED}%d ✗${NC}\n\n" "$PASS" "$WARN" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  cat <<'EOF'
Common fixes:
  • Docker daemon not running        → open Docker Desktop, wait for the whale icon, re-run doctor
  • Containers not running           → cd $TARGET_DIR && docker compose -f docker/docker-compose.yml up -d
  • .env missing                     → run ./install.sh (it generates one)
  • Dashboard not responding         → docker compose -f docker/docker-compose.yml logs web | tail -50
  • Splunk URL unset                 → log in, Settings → Splunk Connection
EOF
  exit 1
fi
exit 0
