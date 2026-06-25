#!/usr/bin/env bash
# ============================================================================
# datasensAI Installer v1.3.0 — Mac / Linux
# State-machine wizard: double-click → guided menu → validated install
#
# Every step is validated. "Installation complete" is only printed after
# the login API returns a valid JWT with the generated credentials.
#
# Modes:
#   1) Fresh install      4) Reset/reinstall
#   2) Start existing     5) Export support logs
#   3) Repair install     6) Stop app
#                         7) Uninstall
# ============================================================================
# NOTE: do NOT use set -e here — state machine handles failures explicitly
set -uo pipefail

# ── Constants ──────────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/LovaRK/telemetry-governance-ai.git}"
BRANCH="${BRANCH:-main}"
TARGET_DIR="${TARGET_DIR:-$HOME/datasensai}"
WEB_PORT="${WEB_PORT:-3002}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
LLM_MODEL="${LLM_MODEL:-gemma2:9b}"
MIN_DISK_GB=20
COMPOSE_FILE="docker/docker-compose.yml"
INSTALLER_VERSION="1.3.0"
EXPECTED_MIN_MIGRATION=213

# Credentials (auto-generated, may be overridden by advanced mode)
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@datasensai.local}"
ADMIN_PASSWORD=""     # filled in s_config_generation

# Runtime state
LOG_DIR="$TARGET_DIR/install-logs"
LOG_FILE=""           # set after TARGET_DIR exists
COMPOSE_CMD=""
OS=""
CURRENT_STEP=0
TOTAL_STEPS=0

# ── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Output helpers ─────────────────────────────────────────────────────────
_log_raw() { printf "%s\n" "$*" >> "$LOG_FILE" 2>/dev/null || true; }

step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  local label="[$CURRENT_STEP/$TOTAL_STEPS]"
  printf "\n${CYAN}${BOLD}%s${NC} ${BOLD}%s${NC}\n" "$label" "$1"
  _log_raw "$(date -u +%H:%M:%S) STEP $label $1"
}
ok()   { printf "  ${GREEN}✓${NC}  %s\n" "$1"; _log_raw "  OK: $1"; }
warn() { printf "  ${YELLOW}!${NC}  %s\n" "$1"; _log_raw "  WARN: $1"; }
info() { printf "  %s\n" "$1"; _log_raw "  INFO: $1"; }
fail() { printf "  ${RED}✗${NC}  %s\n" "$1" >&2; _log_raw "  FAIL: $1"; }
dots() {
  # dots N "message" — print progress dots while waiting
  local n="$1" msg="$2" i=0
  printf "  %s" "$msg"
  while [ $i -lt "$n" ]; do
    printf "."
    sleep 1
    i=$((i + 1))
  done
  printf "\n"
}
section() { printf "\n${BOLD}── %s ──${NC}\n" "$1"; _log_raw "SECTION: $1"; }

die_with_support() {
  local msg="$1"
  printf "\n${RED}${BOLD}══════════════════════════════════════════════${NC}\n"
  printf "${RED}${BOLD}  Installation failed${NC}\n"
  printf "${RED}${BOLD}══════════════════════════════════════════════${NC}\n\n"
  printf "  ${RED}✗${NC}  %s\n\n" "$msg"
  printf "  ${BOLD}What to do:${NC}\n"
  printf "    1. Read the log file below for details\n"
  printf "    2. Run the support log exporter and share it:\n"
  printf "       %s/scripts/install/export-logs.sh\n\n" "$TARGET_DIR"
  printf "  ${BOLD}Log file:${NC} %s\n\n" "${LOG_FILE:-no log yet}"
  _log_raw "FATAL: $msg"
  exit 1
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }
have_docker_running() { docker info >/dev/null 2>&1; }

# ── Password generator ─────────────────────────────────────────────────────
generate_password() {
  # 20 chars: letters + digits + safe symbols, no ambiguous chars
  local chars='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%^&*'
  local pw=""
  if have_cmd openssl; then
    pw=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9!@#%^&*' | head -c 20)
  else
    # Fallback using /dev/urandom
    pw=$(LC_ALL=C tr -dc 'A-Za-z0-9!@#%^&*' < /dev/urandom | head -c 20)
  fi
  # Ensure at least one of each required class
  echo "${pw:-Datasens@2026!SecureX}"
}

# ── Latest migration auto-detect ───────────────────────────────────────────
detect_latest_migration() {
  local mig_dir="$TARGET_DIR/infrastructure/migrations"
  if [ -d "$mig_dir" ]; then
    ls "$mig_dir"/*.sql 2>/dev/null \
      | grep -Eo '/[0-9]+[a-z]?_' \
      | grep -Eo '[0-9]+' \
      | sort -n | tail -1
  else
    echo "$EXPECTED_MIN_MIGRATION"
  fi
}

# ── Docker compose detection ───────────────────────────────────────────────
detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif have_cmd docker-compose; then
    COMPOSE_CMD="docker-compose"
  else
    return 1
  fi
}

# ── Compose wrapper ────────────────────────────────────────────────────────
compose() {
  # Usage: compose [args...]  — uses COMPOSE_CMD and TARGET_DIR
  if [ "$COMPOSE_CMD" = "docker compose" ]; then
    docker compose -f "$TARGET_DIR/$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$TARGET_DIR/$COMPOSE_FILE" "$@"
  fi
}

# ── Login verification ─────────────────────────────────────────────────────
verify_login() {
  local email="$1" pw="$2" port="${3:-$WEB_PORT}"
  local url="http://localhost:$port/api/auth/login"
  local body="{\"email\":\"$email\",\"password\":\"$pw\"}"
  local response

  response=$(curl -fsS -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 15 2>/dev/null) || return 1

  # Check for accessToken in response
  echo "$response" | grep -q '"accessToken"' || return 1
  return 0
}

# ── Admin password reset (repair) ─────────────────────────────────────────
reset_admin_password() {
  local email="$1" new_pw="$2"
  info "Resetting admin password in database..."
  docker exec docker-web-1 node - <<JS 2>/dev/null
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
bcrypt.hash('$new_pw', 10).then(hash => {
  pool.query('UPDATE users SET password_hash = \$1, updated_at = NOW() WHERE email = \$2', [hash, '$email'])
    .then(r => { console.log('[repair] rows updated:', r.rowCount); pool.end(); process.exit(0); })
    .catch(e => { console.error('[repair] error:', e.message); pool.end(); process.exit(1); });
}).catch(e => { console.error('[repair] bcrypt error:', e.message); process.exit(1); });
JS
}

# ══════════════════════════════════════════════════════════════════════════
#  STATE IMPLEMENTATIONS
# ══════════════════════════════════════════════════════════════════════════

# [1] Pre-check: OS, disk, log setup
s_precheck() {
  step "Checking system"
  case "$(uname -s)" in
    Darwin) OS="mac" ;;
    Linux)  OS="linux" ;;
    *) die_with_support "Unsupported OS: $(uname -s). Use install.ps1 on Windows." ;;
  esac
  ok "Operating system: $OS $(uname -m)"

  # Use a safe temp log location until the repo directory is cloned.
  # Do NOT create $TARGET_DIR/install-logs/ here — that would make $TARGET_DIR
  # non-empty and cause "git clone: destination already exists" in s_repo.
  if [ -z "$LOG_FILE" ]; then
    local early_log_dir="$HOME/.datasensai-install-logs"
    mkdir -p "$early_log_dir" 2>/dev/null || early_log_dir="/tmp"
    LOG_FILE="$early_log_dir/install-$(date +%Y%m%d-%H%M%S).log"
    LOG_DIR="$early_log_dir"
    touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/datasensai-install.log"
  fi
  _log_raw "datasensAI installer v$INSTALLER_VERSION started $(date -u)"
  _log_raw "OS: $OS $(uname -m)"
  ok "Log file: $LOG_FILE"

  # Disk space
  local free_gb
  if [ "$OS" = "mac" ]; then
    free_gb=$(df -g "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
  else
    free_gb=$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' | tr -d 'G' || echo 0)
  fi
  if [ "${free_gb:-0}" -lt "$MIN_DISK_GB" ]; then
    die_with_support "Only ${free_gb} GB free. Need at least ${MIN_DISK_GB} GB (Docker images + Ollama model)."
  fi
  ok "Disk space: ${free_gb} GB free"

  # RAM (warn only)
  local total_gb
  if [ "$OS" = "mac" ]; then
    total_gb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 / 1024 ))
  else
    total_gb=$(( $(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0) / 1024 / 1024 ))
  fi
  if [ "$total_gb" -lt 8 ]; then
    warn "Only ${total_gb} GB RAM detected. 8 GB minimum recommended."
  elif [ "$total_gb" -lt 16 ]; then
    warn "${total_gb} GB RAM — Ollama model may run slowly. 16 GB recommended."
  else
    ok "RAM: ${total_gb} GB"
  fi
}

# [2] Dependency check: git, Homebrew (Mac)
s_dependency_check() {
  step "Checking dependencies"

  if ! have_cmd git; then
    warn "Git not found."
    if [ "$OS" = "mac" ]; then
      info "Installing Xcode Command Line Tools (provides git)..."
      info "A dialog may appear — click Install when prompted."
      xcode-select --install 2>/dev/null || true
      info "Waiting for Xcode CLT installation. Press Enter when the dialog says Done."
      read -r
    else
      info "Installing git..."
      sudo apt-get update -y && sudo apt-get install -y git 2>/dev/null \
        || sudo yum install -y git 2>/dev/null \
        || die_with_support "Could not install git automatically. Install it manually: https://git-scm.com"
    fi
    have_cmd git || die_with_support "git still not found after install attempt."
  fi
  ok "Git: $(git --version | head -1)"

  if [ "$OS" = "mac" ] && ! have_cmd brew; then
    info "Installing Homebrew (needed for Docker + Ollama)..."
    info "You may be asked for your Mac password."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || die_with_support "Homebrew installation failed. Install manually: https://brew.sh"
    if [ -d /opt/homebrew/bin ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    ok "Homebrew installed"
  elif [ "$OS" = "mac" ]; then
    ok "Homebrew: $(brew --version | head -1)"
  fi
}

# [3] Docker check
s_docker_check() {
  step "Checking Docker"

  if ! have_cmd docker; then
    warn "Docker Desktop not found."
    if [ "$OS" = "mac" ]; then
      info "Installing Docker Desktop via Homebrew..."
      info "(This may take a few minutes and will ask for your password)"
      brew install --cask docker \
        || die_with_support "Docker Desktop install failed. Install manually: https://www.docker.com/products/docker-desktop"
    else
      info "Installing Docker Engine..."
      curl -fsSL https://get.docker.com | sudo sh \
        || die_with_support "Docker Engine install failed. See: https://docs.docker.com/engine/install/"
      sudo usermod -aG docker "$USER" 2>/dev/null || true
    fi
  fi

  if ! have_docker_running; then
    info "Docker is installed but not running. Starting Docker Desktop..."
    if [ "$OS" = "mac" ]; then
      open -a Docker 2>/dev/null || true
      info "Waiting for Docker to start (up to 3 minutes)..."
      local tries=0
      while ! have_docker_running; do
        tries=$((tries + 1))
        [ "$tries" -gt 90 ] && die_with_support \
          "Docker did not start after 3 minutes. Open Docker Desktop from Applications and wait for the whale icon to appear in the menu bar, then re-run the installer."
        printf "  Waiting for Docker%s\r" "$(printf '.%.0s' $(seq 1 $((tries % 4))))"
        sleep 2
      done
      printf "\n"
    else
      sudo systemctl start docker 2>/dev/null || true
      sleep 5
      have_docker_running || die_with_support "Docker daemon did not start. Run: sudo systemctl start docker"
    fi
  fi
  ok "Docker: $(docker --version | head -1)"

  detect_compose || die_with_support \
    "Neither 'docker compose' nor 'docker-compose' is available. Reinstall Docker Desktop."
  ok "Compose: $COMPOSE_CMD"

  # Memory warning
  local mem_gb
  mem_gb=$(docker info 2>/dev/null | grep "Total Memory" | awk '{print $3}' | cut -d. -f1 || echo "?")
  [ "$mem_gb" != "?" ] && [ "$mem_gb" -lt 4 ] 2>/dev/null && \
    warn "Docker only has ${mem_gb} GiB RAM allocated. Increase it in Docker Desktop → Settings → Resources."
}

# [4] Port check
s_port_check() {
  step "Checking ports"
  local all_clear=true

  check_port() {
    local port="$1" name="$2"
    local pid
    if [ "$OS" = "mac" ]; then
      pid=$(lsof -ti:"$port" 2>/dev/null | head -1)
    else
      pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -Eo 'pid=[0-9]+' | head -1 | cut -d= -f2)
    fi
    if [ -n "$pid" ]; then
      # Check if it's one of our own containers
      local proc
      proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
      if echo "$proc" | grep -qi "docker\|com.docker"; then
        ok "Port $port ($name): in use by Docker (our containers) — OK"
      else
        warn "Port $port ($name): in use by process '$proc' (PID $pid)"
        warn "  → Stop that process, or change the port in .env (${name//:/_}=$port)"
        all_clear=false
      fi
    else
      ok "Port $port ($name): free"
    fi
  }

  check_port "$WEB_PORT" "WEB_PORT"
  check_port "$POSTGRES_PORT" "POSTGRES_PORT"
  check_port "$OLLAMA_PORT" "OLLAMA_PORT (Ollama)"

  if [ "$all_clear" = false ]; then
    die_with_support "One or more required ports are in use. Free them and re-run the installer."
  fi
}

# [5] Repo: clone or update
s_repo() {
  step "Setting up datasensAI files"

  # ── Check if this installer script is already inside the repo ──────────
  # (handles the case where the user runs install.sh directly from the repo
  # rather than from the extracted installer ZIP)
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || script_dir=""
  if [ -n "$script_dir" ]; then
    local detected_root
    detected_root=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || echo "")
    if [ -n "$detected_root" ] && [ -f "$detected_root/docker/docker-compose.yml" ]; then
      if [ "$detected_root" != "$TARGET_DIR" ]; then
        info "Detected: running from inside repo at $detected_root"
        info "Using this checkout instead of cloning."
        TARGET_DIR="$detected_root"
      fi
    fi
  fi

  if [ -d "$TARGET_DIR/.git" ]; then
    info "Existing repo found at $TARGET_DIR — updating to latest..."
    git -C "$TARGET_DIR" fetch --quiet origin 2>/dev/null || warn "Could not fetch latest from GitHub. Continuing with current version."
    git -C "$TARGET_DIR" checkout --quiet "$BRANCH" 2>/dev/null || true
    git -C "$TARGET_DIR" pull --quiet origin "$BRANCH" 2>/dev/null || warn "Could not pull latest. Continuing with current version."
    ok "Using existing checkout at $TARGET_DIR"
  else
    # Remove partial TARGET_DIR if we created it (e.g. the install-logs dir
    # was created during precheck). git clone requires an empty or absent dir.
    if [ -d "$TARGET_DIR" ] && [ ! -d "$TARGET_DIR/.git" ]; then
      local dir_contents
      dir_contents=$(ls -A "$TARGET_DIR" 2>/dev/null)
      if [ -z "$dir_contents" ]; then
        rmdir "$TARGET_DIR" 2>/dev/null || true
      fi
      # If it only has our own early log dir inside it, that means nothing
      # was there before us — safe to remove and let git clone create it fresh.
    fi

    info "Downloading datasensAI from GitHub..."
    info "(This needs internet access and takes 10–30 seconds)"
    local clone_out
    clone_out=$(git clone --depth 50 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR" 2>&1)
    local clone_rc=$?
    _log_raw "git clone output: $clone_out"
    if [ $clone_rc -ne 0 ]; then
      if echo "$clone_out" | grep -q "already exists and is not an empty directory"; then
        die_with_support \
          "$TARGET_DIR already exists. Run the installer again and choose 'Repair install', or delete $TARGET_DIR and re-run."
      fi
      die_with_support "Could not download datasensAI from GitHub. Check your internet connection and try again."
    fi
    ok "Downloaded to $TARGET_DIR"
  fi

  # Move early logs into the repo's canonical log directory
  local repo_log_dir="$TARGET_DIR/install-logs"
  mkdir -p "$repo_log_dir" 2>/dev/null || true
  if [ -f "$LOG_FILE" ] && [ "$(dirname "$LOG_FILE")" != "$repo_log_dir" ]; then
    local new_log="$repo_log_dir/$(basename "$LOG_FILE")"
    cp "$LOG_FILE" "$new_log" 2>/dev/null && LOG_FILE="$new_log" || true
  fi
  LOG_DIR="$repo_log_dir"
  _log_raw "Log moved to $LOG_FILE"
}

# [6] Config generation
s_config_generation() {
  step "Creating configuration"

  cd "$TARGET_DIR" || die_with_support "Cannot access $TARGET_DIR"

  local use_existing=false
  if [ -f .env ]; then
    # Check if it's a valid .env (has required keys)
    if grep -q "^GOVERNANCE_BOOTSTRAP_KEY=" .env && grep -q "^ADMIN_PASSWORD=" .env; then
      use_existing=true
    fi
  fi

  if [ "$use_existing" = true ] && [ "${FORCE_NEW_CONFIG:-0}" != "1" ]; then
    info "Existing configuration found — reading credentials..."
    ADMIN_EMAIL=$(grep "^ADMIN_EMAIL=" .env | cut -d= -f2-)
    ADMIN_PASSWORD=$(grep "^ADMIN_PASSWORD=" .env | cut -d= -f2-)
    ok "Using existing configuration"
    ok "Admin email: $ADMIN_EMAIL"
  else
    info "Generating fresh configuration with secure random secrets..."

    # Auto-generate password unless advanced mode requested
    if [ "${ADVANCED_SETUP:-0}" = "1" ]; then
      printf "\n  ${BOLD}Advanced Setup${NC}\n"
      printf "  Press Enter to accept defaults shown in brackets.\n\n"
      printf "  Admin email [admin@datasensai.local]: "
      read -r input_email
      ADMIN_EMAIL="${input_email:-admin@datasensai.local}"
      while true; do
        printf "  Admin password (min 12 chars, leave blank to auto-generate): "
        read -rs input_pw; printf "\n"
        if [ -z "$input_pw" ]; then
          ADMIN_PASSWORD=$(generate_password)
          info "Auto-generated password will be shown at the end."
          break
        elif [ ${#input_pw} -ge 12 ]; then
          ADMIN_PASSWORD="$input_pw"
          break
        else
          warn "Too short. Minimum 12 characters."
        fi
      done
    else
      ADMIN_PASSWORD=$(generate_password)
    fi

    local enc_key gov_key
    enc_key=$(openssl rand -hex 32)
    gov_key=$(openssl rand -hex 32)

    cat > .env <<EOF
# Generated by datasensAI installer v${INSTALLER_VERSION} on $(date -u +%Y-%m-%dT%H:%M:%SZ)
WEB_PORT=$WEB_PORT
POSTGRES_PORT=$POSTGRES_PORT
NODE_ENV=development
APP_ENV=production

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD

SPLUNK_SECRET_ENCRYPTION_KEY=$enc_key
GOVERNANCE_BOOTSTRAP_KEY=$gov_key

NEXT_PUBLIC_SPLUNK_MCP_URL=
NEXT_PUBLIC_SPLUNK_TOKEN=
NEXT_PUBLIC_SPLUNK_DISABLE_SSL_VERIFY=true

LLM_MODEL=${LLM_MODEL:-gemma2:9b}
ANTHROPIC_API_KEY=

HEALTH_CHECK_INTERVAL=10s
HEALTH_CHECK_TIMEOUT=5s
HEALTH_CHECK_RETRIES=5
EOF
    chmod 600 .env
    ok "Configuration created"
    ok "Admin email: $ADMIN_EMAIL"
    ok "Admin password: auto-generated (saved to credentials.txt after install)"
  fi

  # Validate required env vars exist
  for key in ADMIN_EMAIL ADMIN_PASSWORD GOVERNANCE_BOOTSTRAP_KEY SPLUNK_SECRET_ENCRYPTION_KEY; do
    val=$(grep "^${key}=" .env | cut -d= -f2-)
    [ -z "$val" ] && die_with_support ".env is missing required key: $key. Delete .env and re-run."
  done
  ok "Configuration validated"
}

# [7] Ollama / model check
s_model_check() {
  step "Setting up local AI engine (Ollama)"

  if [ -z "${LLM_MODEL:-}" ]; then
    ok "Skipping Ollama (no LLM model configured — set ANTHROPIC_API_KEY in Settings after install)"
    return 0
  fi

  # Install Ollama if missing
  if ! have_cmd ollama; then
    info "Installing Ollama (local AI engine)..."
    if [ "$OS" = "mac" ]; then
      brew install ollama \
        || die_with_support "Ollama install failed. Install manually: https://ollama.com"
    else
      curl -fsSL https://ollama.com/install.sh | sh \
        || die_with_support "Ollama install failed. Install manually: https://ollama.com"
    fi
  fi
  ok "Ollama: $(ollama --version 2>/dev/null | head -1 || echo 'installed')"

  # Start Ollama service
  if ! curl -fsS "http://localhost:$OLLAMA_PORT/api/tags" >/dev/null 2>&1; then
    info "Starting Ollama service..."
    if [ "$OS" = "mac" ]; then
      brew services start ollama >/dev/null 2>&1 || ollama serve >/tmp/ollama.log 2>&1 &
    else
      ollama serve >/tmp/ollama.log 2>&1 &
    fi
    local tries=0
    while ! curl -fsS "http://localhost:$OLLAMA_PORT/api/tags" >/dev/null 2>&1; do
      tries=$((tries + 1))
      [ "$tries" -gt 30 ] && die_with_support \
        "Ollama service did not start. Try running 'ollama serve' in a terminal, then re-run this installer."
      sleep 1
    done
  fi
  ok "Ollama service running on :$OLLAMA_PORT"

  # Pull model if missing
  if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qxF "$LLM_MODEL"; then
    info "Downloading AI model: $LLM_MODEL"
    info "This is a large download (~5 GB) and may take 10–30 minutes."
    info "Progress will appear below. Please wait..."
    ollama pull "$LLM_MODEL" || die_with_support \
      "Model download failed. Check your internet connection. The model '$LLM_MODEL' is ~5 GB."
  fi
  ok "Model ready: $LLM_MODEL"
}

# [8] Stack start
s_stack_start() {
  step "Starting datasensAI"
  cd "$TARGET_DIR" || die_with_support "Cannot access $TARGET_DIR"

  # Load .env into environment for compose substitution
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a

  info "Building and starting containers (first run takes 2–5 minutes)..."
  local build_out
  build_out=$(compose up -d --build 2>&1) || {
    _log_raw "compose up output: $build_out"
    # Detect common errors
    if echo "$build_out" | grep -q "port is already allocated\|address already in use"; then
      die_with_support "A port needed by datasensAI is already in use. Check Step [4] port conflicts."
    elif echo "$build_out" | grep -q "no such file or directory\|No such file"; then
      die_with_support "Docker Compose file not found. Re-clone the repo or run Fresh install."
    else
      die_with_support "Failed to start containers. See log file for details."
    fi
  }
  ok "Containers started"
}

# [9] DB ready check
s_db_ready() {
  step "Waiting for database"
  local tries=0
  while true; do
    local state
    state=$(docker ps --filter "name=docker-postgres-1" --format '{{.Status}}' 2>/dev/null | head -1)
    if echo "$state" | grep -qi "healthy"; then
      ok "Database ready"
      return 0
    fi
    tries=$((tries + 1))
    [ "$tries" -gt 90 ] && {
      _log_raw "postgres status: $state"
      docker logs docker-postgres-1 --tail=20 >> "$LOG_FILE" 2>/dev/null || true
      die_with_support "Database did not become healthy after 3 minutes. Check log file for details."
    }
    printf "  Waiting for database (%ds)...\r" "$((tries * 2))"
    sleep 2
  done
  printf "\n"
}

# [10] Migration verify
s_migration_verify() {
  step "Verifying database schema"
  local tries=0 health_json

  # Wait for API to respond
  while ! curl -fsS "http://localhost:$WEB_PORT/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 150 ] && {
      docker logs docker-web-1 --tail=30 >> "$LOG_FILE" 2>/dev/null || true
      local web_status
      web_status=$(docker ps --filter "name=docker-web-1" --format '{{.Status}}' 2>/dev/null | head -1)
      _log_raw "web status: $web_status"
      if docker logs docker-web-1 2>/dev/null | grep -q "Cannot find module"; then
        die_with_support "Web container crashed: missing module. This is a known bug — pull latest main and re-run."
      fi
      die_with_support "App did not start after 5 minutes. See log file."
    }
    printf "  Waiting for app to start (%ds)...\r" "$((tries * 2))"
    sleep 2
  done
  printf "\n"

  health_json=$(curl -fsS "http://localhost:$WEB_PORT/api/health" 2>/dev/null)
  _log_raw "health: $health_json"

  # Check schema.valid
  if ! echo "$health_json" | grep -q '"valid":true'; then
    fail "API health reports schema invalid"
    _log_raw "health json: $health_json"
    die_with_support "Database schema failed validation. See log file."
  fi

  # Check latestMigration
  local expected_migration
  expected_migration=$(detect_latest_migration)
  local actual_migration
  actual_migration=$(echo "$health_json" | grep -Eo '"latestMigration":[0-9]+' | grep -Eo '[0-9]+' | head -1)

  if [ -z "$actual_migration" ]; then
    die_with_support "Could not read latestMigration from health endpoint."
  fi

  if [ "$actual_migration" -lt "$expected_migration" ]; then
    die_with_support \
      "Migration incomplete: applied through $actual_migration, expected $expected_migration. Pull latest main and re-run."
  fi

  ok "Database schema valid (migration $actual_migration)"
  ok "API health check passed"
}

# [11] Admin seed verify
s_admin_seed() {
  step "Verifying admin account"

  # Verify admin user exists in DB
  local email_check
  email_check=$(docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -tAc \
    "SELECT COUNT(*) FROM users WHERE email='$ADMIN_EMAIL';" 2>/dev/null || echo "0")
  email_check=$(echo "$email_check" | tr -d '[:space:]')

  if [ "${email_check:-0}" = "0" ]; then
    info "Admin user not yet created — waiting for container initialization..."
    sleep 5
    email_check=$(docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -tAc \
      "SELECT COUNT(*) FROM users WHERE email='$ADMIN_EMAIL';" 2>/dev/null || echo "0")
    email_check=$(echo "$email_check" | tr -d '[:space:]')
    [ "${email_check:-0}" = "0" ] && die_with_support \
      "Admin user '$ADMIN_EMAIL' was not created. Check entrypoint logs: docker logs docker-web-1"
  fi
  ok "Admin user exists: $ADMIN_EMAIL"
}

# [12] Login verify — THE CRITICAL GATE
s_login_verify() {
  step "Testing login (this is the final validation gate)"
  info "Logging in with generated credentials..."

  if verify_login "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$WEB_PORT"; then
    ok "Login verified — credentials work"
    return 0
  fi

  # Login failed — attempt auto-repair
  warn "Login failed with current credentials. Attempting automatic repair..."
  _log_raw "login failed for $ADMIN_EMAIL — attempting password reset"

  if reset_admin_password "$ADMIN_EMAIL" "$ADMIN_PASSWORD"; then
    info "Password reset. Retrying login..."
    sleep 2
    if verify_login "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$WEB_PORT"; then
      ok "Login verified after repair"
      return 0
    fi
  fi

  # Still failing — collect evidence
  docker logs docker-web-1 --tail=30 >> "$LOG_FILE" 2>/dev/null || true
  die_with_support \
    "Login verification failed even after credential repair. Admin email: $ADMIN_EMAIL. See log file."
}

# [13] Web verify
s_web_verify() {
  step "Verifying dashboard"
  local http_status
  http_status=$(curl -fsS -o /dev/null -w "%{http_code}" \
    "http://localhost:$WEB_PORT/" --max-time 10 2>/dev/null || echo "000")

  if [ "$http_status" = "200" ] || [ "$http_status" = "307" ] || [ "$http_status" = "302" ]; then
    ok "Dashboard reachable at http://localhost:$WEB_PORT (HTTP $http_status)"
  else
    warn "Dashboard returned HTTP $http_status (may still be loading — not fatal)"
  fi
}

# [14] Save credentials
s_save_credentials() {
  step "Saving credentials"
  mkdir -p "$TARGET_DIR" 2>/dev/null || true

  local cred_tmp="$TARGET_DIR/credentials.tmp"
  local cred_final="$TARGET_DIR/credentials.txt"

  cat > "$cred_tmp" <<EOF
datasensAI Credentials — Installer v${INSTALLER_VERSION}
Generated: $(date -u +%Y-%m-%d\ %H:%M:%S) UTC
Verified: login API test PASSED

Dashboard URL:  http://localhost:${WEB_PORT}
Admin email:    ${ADMIN_EMAIL}
Admin password: ${ADMIN_PASSWORD}

This file is stored at: ${cred_final}
Keep it safe — do not share it.

Next steps after login:
  1. Settings → Splunk Connection → enter your Splunk URL + token
  2. Click "Test Connection" until green, then Save
  3. On the dashboard, click Refresh (pipeline takes 20-25 min)
EOF
  chmod 600 "$cred_tmp"
  mv "$cred_tmp" "$cred_final"
  ok "Credentials saved to: $cred_final"
}

# [15] Open browser
s_open_browser() {
  step "Opening browser"
  local url="http://localhost:$WEB_PORT"
  info "Opening $url ..."
  if [ "$OS" = "mac" ]; then
    open "$url" 2>/dev/null || warn "Could not open browser automatically. Open $url manually."
  else
    xdg-open "$url" 2>/dev/null || warn "Could not open browser automatically. Open $url manually."
  fi
  ok "Browser launched"
}

# [SUCCESS]
s_success() {
  local cred_file="$TARGET_DIR/credentials.txt"

  printf "\n"
  printf "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}\n"
  printf "${GREEN}${BOLD}║       datasensAI installed and verified successfully          ║${NC}\n"
  printf "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}\n\n"

  printf "  ${BOLD}URL:${NC}           http://localhost:%s\n" "$WEB_PORT"
  printf "  ${BOLD}Admin email:${NC}   %s\n" "$ADMIN_EMAIL"
  printf "  ${BOLD}Admin password:${NC} %s\n\n" "$ADMIN_PASSWORD"
  printf "  ${BOLD}Credentials saved to:${NC} %s\n\n" "$cred_file"

  printf "  ${BOLD}What to do next:${NC}\n"
  printf "    1. A browser window should have opened automatically\n"
  printf "    2. Log in with the email and password above\n"
  printf "    3. Settings → Splunk Connection → enter your Splunk URL + token\n"
  printf "    4. Click Test Connection until green, then Save\n"
  printf "    5. Back on the dashboard, click Refresh\n"
  printf "       (The AI pipeline takes 20-25 min on first run)\n\n"

  printf "  ${BOLD}If anything looks wrong:${NC}\n"
  printf "    Run: %s/scripts/install/doctor.sh\n\n" "$TARGET_DIR"

  _log_raw "SUCCESS — install complete at $(date -u)"
}

# ══════════════════════════════════════════════════════════════════════════
#  MODE RUNNERS
# ══════════════════════════════════════════════════════════════════════════

mode_fresh_install() {
  TOTAL_STEPS=15
  s_precheck
  s_dependency_check
  s_docker_check
  s_port_check
  s_repo
  s_config_generation
  s_model_check
  s_stack_start
  s_db_ready
  s_migration_verify
  s_admin_seed
  s_login_verify
  s_web_verify
  s_save_credentials
  s_open_browser
  s_success
}

mode_start_existing() {
  TOTAL_STEPS=8
  s_precheck
  s_docker_check
  s_config_generation  # reads existing .env
  s_stack_start
  s_db_ready
  s_migration_verify
  s_login_verify
  s_web_verify
  s_open_browser

  printf "\n${GREEN}${BOLD}datasensAI is running at http://localhost:%s${NC}\n\n" "$WEB_PORT"
  _log_raw "SUCCESS — started existing install"
}

mode_repair() {
  TOTAL_STEPS=12
  s_precheck
  s_docker_check
  s_port_check
  s_config_generation  # reads existing .env, or generates new one

  step "Restarting containers"
  cd "$TARGET_DIR" || die_with_support "Cannot access $TARGET_DIR"
  set -a; . ./.env; set +a
  compose restart 2>/dev/null || compose up -d 2>/dev/null || true
  ok "Containers restarted"

  s_db_ready
  s_migration_verify
  s_admin_seed
  s_login_verify      # auto-repairs password if needed
  s_web_verify
  s_save_credentials
  s_open_browser

  printf "\n${GREEN}${BOLD}Repair complete. datasensAI is running at http://localhost:%s${NC}\n\n" "$WEB_PORT"
  _log_raw "SUCCESS — repair complete"
}

mode_reset_reinstall() {
  printf "\n${RED}${BOLD}⚠  WARNING: Reset and Reinstall${NC}\n\n"
  printf "  This will DELETE all local datasensAI data:\n"
  printf "  • Database (all snapshots, scores, governance history)\n"
  printf "  • Configuration (.env and credentials)\n\n"
  printf "  Your Splunk data is not affected.\n\n"
  printf "  Type 'RESET' to confirm, or press Enter to cancel: "
  local confirm
  read -r confirm
  [ "$confirm" != "RESET" ] && { info "Reset cancelled."; exit 0; }

  TOTAL_STEPS=15
  s_precheck
  s_docker_check

  step "Wiping existing installation"
  cd "$TARGET_DIR" 2>/dev/null || true
  if [ -f "$TARGET_DIR/$COMPOSE_FILE" ]; then
    detect_compose || true
    if [ -n "$COMPOSE_CMD" ] && [ -f "$TARGET_DIR/.env" ]; then
      set -a; . "$TARGET_DIR/.env"; set +a
      compose down -v --remove-orphans 2>/dev/null || true
      ok "Docker volumes removed"
    fi
  fi
  rm -f "$TARGET_DIR/.env" "$TARGET_DIR/credentials.txt" "$TARGET_DIR/credentials.tmp" 2>/dev/null || true
  ok "Old configuration removed"

  FORCE_NEW_CONFIG=1
  s_port_check
  s_repo
  s_config_generation
  s_model_check
  s_stack_start
  s_db_ready
  s_migration_verify
  s_admin_seed
  s_login_verify
  s_web_verify
  s_save_credentials
  s_open_browser
  s_success
}

mode_export_logs() {
  printf "\n${BOLD}Exporting support logs...${NC}\n"
  local bundle_dir="$HOME/Desktop/datasensai-support-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$bundle_dir"

  # Copy install logs
  [ -d "$LOG_DIR" ] && cp "$LOG_DIR/"*.log "$bundle_dir/" 2>/dev/null || true

  # Redacted .env
  if [ -f "$TARGET_DIR/.env" ]; then
    sed -E \
      -e 's/(SPLUNK_SECRET_ENCRYPTION_KEY=).*/\1[REDACTED]/' \
      -e 's/(GOVERNANCE_BOOTSTRAP_KEY=).*/\1[REDACTED]/' \
      -e 's/(ADMIN_PASSWORD=).*/\1[REDACTED]/' \
      -e 's/(ANTHROPIC_API_KEY=).*/\1[REDACTED]/' \
      "$TARGET_DIR/.env" > "$bundle_dir/env-redacted.txt"
  fi

  # Docker status
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' > "$bundle_dir/docker-ps.txt" 2>&1
  docker info > "$bundle_dir/docker-info.txt" 2>&1

  # App logs
  for svc in postgres web worker; do
    docker logs "docker-${svc}-1" --tail=300 > "$bundle_dir/logs-${svc}.txt" 2>&1 || true
  done

  # Health
  curl -fsS "http://localhost:$WEB_PORT/api/health" > "$bundle_dir/api-health.json" 2>/dev/null || \
    echo "not reachable" > "$bundle_dir/api-health.json"

  # Versions
  {
    echo "OS: $(uname -s) $(uname -m) $(uname -r)"
    echo "Docker: $(docker --version 2>/dev/null)"
    have_cmd ollama && echo "Ollama: $(ollama --version 2>/dev/null)"
    have_cmd git && echo "Git: $(git --version)"
    have_cmd brew && echo "Homebrew: $(brew --version | head -1)"
  } > "$bundle_dir/versions.txt"

  # Port usage
  lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -E "3002|5433|11434" > "$bundle_dir/ports.txt" || true

  # Create ZIP
  local zip_file="$HOME/Desktop/datasensai-support-$(date +%Y%m%d-%H%M%S).zip"
  if have_cmd zip; then
    zip -r "$zip_file" "$bundle_dir/" >/dev/null 2>&1
    rm -rf "$bundle_dir"
    printf "\n${GREEN}✓${NC} Support bundle created:\n  %s\n\n" "$zip_file"
    printf "  Share this file with support. It does NOT contain your passwords.\n\n"
  else
    printf "\n${GREEN}✓${NC} Support bundle folder:\n  %s\n\n" "$bundle_dir"
  fi
}

mode_stop() {
  printf "\n${BOLD}Stopping datasensAI...${NC}\n"
  cd "$TARGET_DIR" 2>/dev/null || die_with_support "Installation not found at $TARGET_DIR"
  detect_compose || die_with_support "Docker Compose not available"
  [ -f .env ] && { set -a; . ./.env; set +a; }
  compose stop 2>/dev/null && ok "datasensAI stopped" || warn "Could not stop cleanly. Try: docker stop docker-web-1 docker-worker-1 docker-postgres-1"
}

mode_uninstall() {
  printf "\n${RED}${BOLD}⚠  Uninstall datasensAI${NC}\n\n"
  printf "  This will remove:\n"
  printf "  • datasensAI containers and database\n"
  printf "  • Installation folder: %s\n\n" "$TARGET_DIR"
  printf "  This does NOT remove Docker, Git, Homebrew, or Ollama.\n\n"
  printf "  Type 'UNINSTALL' to confirm, or press Enter to cancel: "
  local confirm
  read -r confirm
  [ "$confirm" != "UNINSTALL" ] && { info "Uninstall cancelled."; exit 0; }

  detect_compose || true
  if [ -n "$COMPOSE_CMD" ] && [ -f "$TARGET_DIR/$COMPOSE_FILE" ]; then
    cd "$TARGET_DIR" && [ -f .env ] && { set -a; . ./.env; set +a; }
    compose down -v --remove-orphans 2>/dev/null && ok "Containers and volumes removed"
  fi
  rm -rf "$TARGET_DIR" && ok "Installation folder removed: $TARGET_DIR"
  printf "\n${GREEN}datasensAI has been uninstalled.${NC}\n\n"
}

# ══════════════════════════════════════════════════════════════════════════
#  MODE SELECTION MENU
# ══════════════════════════════════════════════════════════════════════════

show_welcome() {
  clear
  printf "${BOLD}"
  cat <<'EOF'
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║                   datasensAI  —  Installer v1.3.0                   ║
║                                                                      ║
║   AI-powered Splunk telemetry intelligence dashboard                 ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
  printf "${NC}"
}

detect_existing_install() {
  [ -d "$TARGET_DIR/.git" ] || return 1
  docker ps --filter "name=docker-web-1" --format '{{.Status}}' 2>/dev/null | grep -qi "up" && return 0
  [ -f "$TARGET_DIR/.env" ] && return 0
  return 1
}

show_mode_menu() {
  printf "\n"
  if detect_existing_install; then
    printf "  ${BOLD}An existing datasensAI installation was found.${NC}\n\n"
    printf "  What would you like to do?\n\n"
    printf "  ${BOLD}1)${NC} Start existing app      — start containers and open browser\n"
    printf "  ${BOLD}2)${NC} Repair install          — fix problems, keep your data\n"
    printf "  ${BOLD}3)${NC} Fresh install           — download + set up from scratch\n"
    printf "  ${BOLD}4)${NC} Reset and reinstall     — WIPE data and start clean\n"
    printf "  ${BOLD}5)${NC} Export support logs     — create a ZIP to share with support\n"
    printf "  ${BOLD}6)${NC} Stop app\n"
    printf "  ${BOLD}7)${NC} Uninstall\n"
    printf "\n  Enter 1-7 [default: 1]: "
    local choice
    read -r choice
    choice="${choice:-1}"
  else
    printf "  ${BOLD}Welcome to the datasensAI installer.${NC}\n\n"
    printf "  What would you like to do?\n\n"
    printf "  ${BOLD}1)${NC} Fresh install           — install for the first time (recommended)\n"
    printf "  ${BOLD}5)${NC} Export support logs     — for troubleshooting\n"
    printf "  ${BOLD}7)${NC} Uninstall\n"
    printf "\n  Enter 1, 5, or 7 [default: 1]: "
    local choice
    read -r choice
    choice="${choice:-1}"
  fi

  case "$choice" in
    1)
      if detect_existing_install; then
        mode_start_existing
      else
        mode_fresh_install
      fi
      ;;
    2) mode_repair ;;
    3) mode_fresh_install ;;
    4) mode_reset_reinstall ;;
    5) mode_export_logs ;;
    6) mode_stop ;;
    7) mode_uninstall ;;
    *) warn "Invalid choice. Defaulting to option 1."; mode_start_existing ;;
  esac
}

# ══════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════
main() {
  # Use a safe temp log location that does NOT create $TARGET_DIR.
  # s_repo will move the log into $TARGET_DIR/install-logs/ after the clone.
  local early_log_dir="$HOME/.datasensai-install-logs"
  mkdir -p "$early_log_dir" 2>/dev/null || early_log_dir="/tmp"
  LOG_FILE="$early_log_dir/install-$(date +%Y%m%d-%H%M%S).log"
  touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/datasensai-install.log"
  LOG_DIR="$early_log_dir"

  show_welcome

  # Allow non-interactive mode for testing
  if [ "${MODE:-}" = "fresh" ]; then
    mode_fresh_install
  elif [ "${MODE:-}" = "repair" ]; then
    mode_repair
  elif [ "${MODE:-}" = "reset" ]; then
    mode_reset_reinstall
  elif [ "${MODE:-}" = "stop" ]; then
    mode_stop
  elif [ "${MODE:-}" = "logs" ]; then
    mode_export_logs
  else
    show_mode_menu
  fi
}

main "$@"
