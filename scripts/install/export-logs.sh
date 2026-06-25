#!/usr/bin/env bash
# ============================================================================
# datasensAI — Support Bundle Exporter (Mac/Linux)
#
# Collects installer logs, redacted config, container logs, health status,
# and version info into a ZIP on the Desktop.
#
# Usage:
#   ./export-logs.sh
#   TARGET_DIR=/path/to/datasensai WEB_PORT=4000 ./export-logs.sh
#
# The bundle does NOT contain your admin password, encryption keys, or
# Splunk tokens. Safe to share with support.
# ============================================================================
set -uo pipefail

TARGET_DIR="${TARGET_DIR:-$HOME/datasensai}"
WEB_PORT="${WEB_PORT:-3002}"

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

have_cmd() { command -v "$1" >/dev/null 2>&1; }

echo ""
printf "${BOLD}datasensAI — Support Bundle Exporter${NC}\n\n"

BUNDLE_NAME="datasensai-support-$(date +%Y%m%d-%H%M%S)"
BUNDLE_DIR="$HOME/Desktop/$BUNDLE_NAME"
mkdir -p "$BUNDLE_DIR"

# ── Install logs ──────────────────────────────────────────────────────────
LOG_SRC="$TARGET_DIR/install-logs"
if [ -d "$LOG_SRC" ]; then
  cp "$LOG_SRC/"*.log "$BUNDLE_DIR/" 2>/dev/null && echo "  Copied installer logs"
else
  echo "  (no installer logs found at $LOG_SRC)"
fi

# ── Redacted .env ─────────────────────────────────────────────────────────
if [ -f "$TARGET_DIR/.env" ]; then
  sed -E \
    -e 's/(SPLUNK_SECRET_ENCRYPTION_KEY=).*/\1[REDACTED]/' \
    -e 's/(GOVERNANCE_BOOTSTRAP_KEY=).*/\1[REDACTED]/' \
    -e 's/(ADMIN_PASSWORD=).*/\1[REDACTED]/' \
    -e 's/(ANTHROPIC_API_KEY=).*/\1[REDACTED]/' \
    "$TARGET_DIR/.env" > "$BUNDLE_DIR/env-redacted.txt"
  echo "  Copied .env (secrets redacted)"
fi

# ── Docker status ─────────────────────────────────────────────────────────
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' > "$BUNDLE_DIR/docker-ps.txt" 2>&1
docker info > "$BUNDLE_DIR/docker-info.txt" 2>&1
echo "  Copied docker status"

# ── App container logs ────────────────────────────────────────────────────
for svc in postgres web worker; do
  docker logs "docker-${svc}-1" --tail 300 > "$BUNDLE_DIR/logs-${svc}.txt" 2>&1 || true
done
echo "  Copied container logs"

# ── API health ────────────────────────────────────────────────────────────
if curl -fsS "http://localhost:${WEB_PORT}/api/health" > "$BUNDLE_DIR/api-health.json" 2>/dev/null; then
  echo "  Captured API health"
else
  echo "  (API not reachable on :${WEB_PORT})" > "$BUNDLE_DIR/api-health.json"
fi

# ── Port usage ────────────────────────────────────────────────────────────
lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -E "3002|5433|11434|:80 |:443 " > "$BUNDLE_DIR/ports.txt" || true

# ── Versions ─────────────────────────────────────────────────────────────
{
  echo "Collected: $(date -u)"
  echo "OS: $(uname -s) $(uname -m) $(uname -r)"
  have_cmd docker  && echo "Docker:    $(docker --version)"
  have_cmd git     && echo "Git:       $(git --version)"
  have_cmd ollama  && echo "Ollama:    $(ollama --version 2>/dev/null || echo installed)"
  have_cmd brew    && echo "Homebrew:  $(brew --version | head -1)"
  have_cmd node    && echo "Node:      $(node --version)"
  echo "TARGET_DIR: $TARGET_DIR"
  echo "WEB_PORT:   $WEB_PORT"
} > "$BUNDLE_DIR/versions.txt"

# ── Migration count ───────────────────────────────────────────────────────
if [ -d "$TARGET_DIR/infrastructure/migrations" ]; then
  ls "$TARGET_DIR/infrastructure/migrations/"*.sql 2>/dev/null | wc -l | xargs echo "Migration SQL files on disk:" > "$BUNDLE_DIR/migrations.txt" || true
  ls "$TARGET_DIR/infrastructure/migrations/"*.sql 2>/dev/null | sort >> "$BUNDLE_DIR/migrations.txt" || true
fi

# ── Create ZIP ────────────────────────────────────────────────────────────
ZIP_FILE="$HOME/Desktop/${BUNDLE_NAME}.zip"
if have_cmd zip; then
  zip -r "$ZIP_FILE" "$BUNDLE_DIR/" >/dev/null 2>&1
  rm -rf "$BUNDLE_DIR"
  echo ""
  printf "${GREEN}✓ Support bundle ready:${NC}\n"
  printf "  %s\n\n" "$ZIP_FILE"
  printf "  Share this file with support.\n"
  printf "  It does NOT contain your passwords or encryption keys.\n\n"
else
  echo ""
  printf "${GREEN}✓ Support bundle folder:${NC}\n"
  printf "  %s\n\n" "$BUNDLE_DIR"
  printf "${YELLOW}!${NC}  Install 'zip' to get a .zip file: brew install zip\n\n"
fi
