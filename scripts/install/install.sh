#!/usr/bin/env bash
# ============================================================================
# datasensAI installer — Mac / Linux
#
# What this does, in plain language:
#   1. Checks what's missing on this machine (git, Docker, Ollama)
#   2. Asks before installing anything that's missing
#   3. Generates a .env with fresh random secrets (no defaults you've seen)
#   4. Brings up the app stack (Docker compose)
#   5. Waits until everything is healthy
#   6. Prints the dashboard URL and admin login
#
# Re-running is safe. The script detects what's already installed and skips
# those steps.
#
# Usage:
#   ./install.sh                              # interactive (recommended)
#   BRANCH=main ./install.sh                  # pull a specific branch
#   REPO_URL=https://...git ./install.sh      # use an alternate repo URL
#   QUIET=1 ./install.sh                      # skip non-essential prompts
# ============================================================================
set -euo pipefail

# ── Config (override via env) ───────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/LovaRK/telemetry-governance-ai.git}"
BRANCH="${BRANCH:-main}"
TARGET_DIR="${TARGET_DIR:-$HOME/datasensai}"
LLM_MODEL="${LLM_MODEL:-gemma2:9b}"
WEB_PORT="${WEB_PORT:-3002}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"
MIN_RAM_GB=8
MIN_DISK_GB=20
QUIET="${QUIET:-0}"

# ── Output helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
step()  { printf "\n${BLUE}${BOLD}==>${NC}${BOLD} %s${NC}\n" "$1"; }
ok()    { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "  ${YELLOW}⚠${NC}  %s\n" "$1"; }
fail()  { printf "  ${RED}✗${NC} %s\n" "$1" >&2; }
die()   { fail "$1"; printf "\n${RED}${BOLD}Installation aborted.${NC} Run ./doctor.sh to diagnose.\n" >&2; exit 1; }
ask()   { local prompt="$1" default="${2:-}"; local reply; [ "$QUIET" = 1 ] && [ -n "$default" ] && { echo "$default"; return; }; read -r -p "  $prompt " reply; echo "${reply:-$default}"; }
yes_no(){ local prompt="$1" default="${2:-y}"; while true; do local r; r=$(ask "$prompt [y/n] (default $default):" "$default"); case "$r" in [Yy]|[Yy][Ee][Ss]) return 0;; [Nn]|[Nn][Oo]) return 1;; esac; done; }

banner() {
  cat <<'EOF'
══════════════════════════════════════════════════════════════════
              datasensAI — Layman Installer (Mac/Linux)
══════════════════════════════════════════════════════════════════

About to install (only what's missing):
  • Git                 — to clone the repo
  • Docker Desktop      — to run the app containers
  • Ollama + gemma2:9b  — local LLM for AI analysis (~5 GB download)
  • datasensAI app      — the dashboard itself

You will be asked to confirm before each install. Docker Desktop and
Ollama install prompts come from the OS — they need your password.

Total time on a clean Mac: about 15–25 min (mostly the 5 GB Ollama
model download). Re-running on an already-installed machine: 2 min.

If anything goes wrong, ./doctor.sh tells you what's broken.

EOF
}

# ── Detection helpers ──────────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "mac" ;;
    Linux)  echo "linux" ;;
    *) die "Unsupported OS: $(uname -s). This installer supports Mac and Linux. For Windows use install.ps1." ;;
  esac
}
have_cmd() { command -v "$1" >/dev/null 2>&1; }

check_admin() {
  step "Checking admin rights"
  if [ "$(id -u)" = "0" ]; then
    warn "Running as root. Some package managers (brew) refuse root. Continuing but expect quirks."
  fi
  if ! sudo -n true 2>/dev/null; then
    warn "You may be prompted for your password (sudo) when installing system packages."
  fi
  ok "Admin check done"
}

check_disk_space() {
  step "Checking disk space (need ≥ ${MIN_DISK_GB} GB free in $HOME)"
  local free_gb
  free_gb=$(df -g "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
  if [ "${free_gb:-0}" -lt "$MIN_DISK_GB" ]; then
    die "Only ${free_gb} GB free in $HOME. Need at least ${MIN_DISK_GB} GB (Docker images + Ollama model + room to run)."
  fi
  ok "${free_gb} GB free — enough"
}

check_ram() {
  step "Checking RAM (recommended ≥ ${MIN_RAM_GB} GB)"
  local total_gb
  if [ "$(uname -s)" = "Darwin" ]; then
    total_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  else
    total_gb=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024 ))
  fi
  printf "  Detected: %s GB total RAM\n" "$total_gb"
  if [ "$total_gb" -lt 16 ]; then
    warn "Less than 16 GB. The default LLM (gemma2:9b, ~20 GB at inference) may swap and feel slow."
    warn "You can switch to a lighter model later: edit .env, set LLM_MODEL=llama3.2:3b, then ollama pull llama3.2:3b."
  fi
  ok "RAM check done"
}

# ── Installers ─────────────────────────────────────────────────────────────
ensure_git() {
  step "Git"
  if have_cmd git; then ok "git already installed: $(git --version | head -1)"; return; fi
  if [ "$OS" = "mac" ]; then
    warn "git not found. Running 'xcode-select --install' — accept the OS dialog when it appears."
    if yes_no "Install Xcode Command Line Tools (provides git)?" "y"; then
      xcode-select --install || true
      printf "\n  Waiting for Command Line Tools to finish installing.\n  Press Enter once the OS dialog says 'Done': "
      read -r
    else
      die "Cannot continue without git."
    fi
  else
    if yes_no "Install git via apt-get / yum?" "y"; then
      sudo apt-get update -y && sudo apt-get install -y git 2>/dev/null \
        || sudo yum install -y git 2>/dev/null \
        || die "Could not install git automatically. Install it manually and re-run."
    else
      die "Cannot continue without git."
    fi
  fi
  ok "git installed: $(git --version | head -1)"
}

ensure_brew() {
  if [ "$OS" != "mac" ]; then return; fi
  if have_cmd brew; then ok "Homebrew already installed"; return; fi
  if yes_no "Install Homebrew (needed to install Docker Desktop + Ollama)?" "y"; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Homebrew on Apple Silicon installs to /opt/homebrew; add to PATH
    if [ -d /opt/homebrew/bin ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    ok "Homebrew installed"
  else
    die "Homebrew is required to install Docker Desktop on Mac."
  fi
}

ensure_docker() {
  step "Docker"
  if have_cmd docker && docker info >/dev/null 2>&1; then
    ok "Docker running: $(docker --version | head -1)"
    return
  fi
  if have_cmd docker; then
    warn "Docker is installed but the daemon isn't running."
  else
    warn "Docker not found."
    if [ "$OS" = "mac" ]; then
      if yes_no "Install Docker Desktop via Homebrew (requires admin password)?" "y"; then
        brew install --cask docker
      else
        die "Cannot continue without Docker. Install Docker Desktop manually from https://www.docker.com/products/docker-desktop and re-run."
      fi
    else
      if yes_no "Install Docker Engine via the official convenience script (requires sudo)?" "y"; then
        curl -fsSL https://get.docker.com | sudo sh
        sudo usermod -aG docker "$USER" || true
        warn "You may need to log out and back in (or 'newgrp docker') for the docker group to take effect."
      else
        die "Cannot continue without Docker."
      fi
    fi
  fi

  step "Waiting for Docker daemon to start"
  if [ "$OS" = "mac" ]; then
    open -a Docker 2>/dev/null || warn "Could not auto-launch Docker Desktop. Launch it from Applications, then press Enter."
    printf "  Launching Docker Desktop (or please do it manually). Press Enter when the whale icon shows 'Docker Desktop is running': "
    read -r
  fi
  local tries=0
  while ! docker info >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 60 ] && die "Docker daemon never became ready. Open Docker Desktop manually and re-run."
    printf "  Waiting for Docker daemon… (%ds)\r" "$((tries * 2))"
    sleep 2
  done
  printf "\n"
  ok "Docker running: $(docker --version | head -1)"
}

ensure_ollama() {
  step "Ollama (local LLM)"
  if ! yes_no "Use local Ollama for AI analysis (recommended; private, free; ~5 GB download)?" "y"; then
    warn "Skipping Ollama. After install, set ANTHROPIC_API_KEY in Settings → AI Provider."
    LLM_MODEL=""
    return
  fi
  if ! have_cmd ollama; then
    if [ "$OS" = "mac" ]; then
      if yes_no "Install Ollama via Homebrew?" "y"; then
        brew install ollama
      else
        die "Ollama install declined. Install manually from https://ollama.com and re-run."
      fi
    else
      curl -fsSL https://ollama.com/install.sh | sh || die "Ollama install failed."
    fi
  fi
  ok "Ollama installed: $(ollama --version 2>/dev/null | head -1)"
  step "Starting Ollama service"
  if [ "$OS" = "mac" ]; then
    brew services start ollama >/dev/null 2>&1 || ollama serve >/dev/null 2>&1 &
  else
    ollama serve >/dev/null 2>&1 &
  fi
  local tries=0
  while ! curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 30 ] && die "Ollama service did not respond on :11434. Run 'ollama serve' manually."
    sleep 1
  done
  ok "Ollama service responding on :11434"
  step "Pulling model: $LLM_MODEL (this is the long step — ~5 GB)"
  if ! ollama list 2>/dev/null | awk '{print $1}' | grep -q "^${LLM_MODEL}$"; then
    ollama pull "$LLM_MODEL" || die "Failed to pull $LLM_MODEL."
  else
    ok "$LLM_MODEL already present"
  fi
}

# ── Repo + .env ────────────────────────────────────────────────────────────
ensure_repo() {
  step "Cloning the datasensAI repo into $TARGET_DIR"
  if [ -d "$TARGET_DIR/.git" ]; then
    ok "Repo already at $TARGET_DIR — pulling latest from $BRANCH"
    git -C "$TARGET_DIR" fetch --quiet origin
    git -C "$TARGET_DIR" checkout --quiet "$BRANCH"
    git -C "$TARGET_DIR" pull --quiet origin "$BRANCH"
  else
    git clone --depth 50 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR" || die "Could not clone $REPO_URL"
    ok "Cloned to $TARGET_DIR"
  fi
}

ensure_env() {
  step "Generating .env (random secrets, your admin credentials)"
  cd "$TARGET_DIR"
  if [ -f .env ] && ! yes_no ".env already exists. Overwrite (existing admin/secrets will be REPLACED)?" "n"; then
    ok "Keeping existing .env"
    return
  fi
  local admin_email admin_pw enc_key gov_key
  admin_email=$(ask "Admin email (used to log into the dashboard):" "admin@$(whoami).local")
  while true; do
    admin_pw=$(ask "Admin password (≥12 chars, mix letters+numbers+symbols):" "")
    [ ${#admin_pw} -ge 12 ] && break
    warn "Too short. Please use at least 12 characters."
  done
  enc_key=$(openssl rand -hex 32)
  gov_key=$(openssl rand -hex 32)
  cat > .env <<EOF
# Generated by scripts/install/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
WEB_PORT=$WEB_PORT
POSTGRES_PORT=$POSTGRES_PORT
NODE_ENV=development
APP_ENV=production

ADMIN_EMAIL=$admin_email
ADMIN_PASSWORD=$admin_pw

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
  ok ".env written ($(wc -l < .env) lines, perms 600)"
}

start_stack() {
  step "Starting the app stack (postgres + web + worker)"
  cd "$TARGET_DIR"
  docker compose --env-file .env -f docker/docker-compose.yml up -d --build
  ok "Compose up complete"

  step "Waiting for the web container to become healthy"
  local tries=0
  while ! curl -fsS "http://localhost:$WEB_PORT/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 120 ] && die "Web app never responded on :$WEB_PORT. Check 'docker compose -f docker/docker-compose.yml logs web'."
    printf "  Waiting for http://localhost:$WEB_PORT… (%ds)\r" "$((tries * 2))"
    sleep 2
  done
  printf "\n"
  ok "Web app responding on :$WEB_PORT"
}

# ── Main ───────────────────────────────────────────────────────────────────
main() {
  banner
  OS=$(detect_os)
  ok "Detected OS: $OS"
  check_admin
  check_disk_space
  check_ram
  ensure_git
  ensure_brew
  ensure_docker
  ensure_ollama
  ensure_repo
  ensure_env
  start_stack

  # Read admin creds back for the success message
  local email pw
  email=$(grep '^ADMIN_EMAIL=' "$TARGET_DIR/.env" | cut -d= -f2)
  pw=$(grep '^ADMIN_PASSWORD=' "$TARGET_DIR/.env" | cut -d= -f2)

  printf "\n${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${NC}\n"
  printf "${GREEN}${BOLD}                 datasensAI is ready                              ${NC}\n"
  printf "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${NC}\n\n"
  printf "  ${BOLD}URL:${NC}      http://localhost:%s\n" "$WEB_PORT"
  printf "  ${BOLD}Email:${NC}    %s\n" "$email"
  printf "  ${BOLD}Password:${NC} %s\n\n" "$pw"
  printf "  ${BOLD}Next:${NC}\n"
  printf "    1. Open http://localhost:%s in your browser\n" "$WEB_PORT"
  printf "    2. Log in with the email/password above\n"
  printf "    3. Settings → Splunk Connection → enter YOUR Splunk URL + token\n"
  printf "    4. Test Connection until green, Save\n"
  printf "    5. Back on dashboard, click Refresh — the pipeline takes 20–25 min\n\n"
  printf "  ${BOLD}If anything looks wrong:${NC}\n"
  printf "    Run: %s/scripts/install/doctor.sh\n\n" "$TARGET_DIR"
}

main "$@"
