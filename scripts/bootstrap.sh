#!/usr/bin/env bash
set -euo pipefail

# datasensAI — Full stack bootstrap script
# Usage: chmod +x scripts/bootstrap.sh && ./scripts/bootstrap.sh

COMPOSE_FILE="docker/docker-compose.yml"
WEB_URL="http://localhost:3002"
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma4:e4b}"
MAX_WAIT=120

log()  { echo "  $1"; }
ok()   { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }
fail() { echo "❌ $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       datasensAI — Bootstrap v1.0        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Docker check ─────────────────────────────────────────────────────────
log "Checking Docker..."
docker info > /dev/null 2>&1 || fail "Docker is not running. Please start Docker Desktop and retry."
ok "Docker is running"

# ── 2. Start PostgreSQL ──────────────────────────────────────────────────────
log "Starting PostgreSQL..."
docker-compose -f "$COMPOSE_FILE" up -d postgres > /dev/null 2>&1
elapsed=0
until docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U telemetry -d telemetry_os > /dev/null 2>&1; do
  sleep 2; elapsed=$((elapsed + 2))
  [ $elapsed -ge $MAX_WAIT ] && fail "PostgreSQL did not become ready in ${MAX_WAIT}s"
done
ok "PostgreSQL ready"

# ── 3. Start Ollama ──────────────────────────────────────────────────────────
log "Starting Ollama (local LLM)..."
docker-compose -f "$COMPOSE_FILE" up -d ollama > /dev/null 2>&1
elapsed=0
until docker-compose -f "$COMPOSE_FILE" exec -T ollama ollama list > /dev/null 2>&1; do
  sleep 3; elapsed=$((elapsed + 3))
  [ $elapsed -ge $MAX_WAIT ] && fail "Ollama did not become ready in ${MAX_WAIT}s"
done
ok "Ollama ready"

# ── 4. Pull Gemma model if missing ───────────────────────────────────────────
log "Checking for model: ${OLLAMA_MODEL}..."
if ! docker-compose -f "$COMPOSE_FILE" exec -T ollama ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL}"; then
  warn "Model '${OLLAMA_MODEL}' not found — pulling now (this may take a few minutes)..."
  docker-compose -f "$COMPOSE_FILE" exec -T ollama ollama pull "${OLLAMA_MODEL}" \
    || { warn "Failed to pull ${OLLAMA_MODEL}, trying gemma:2b fallback..."; \
         docker-compose -f "$COMPOSE_FILE" exec -T ollama ollama pull gemma:2b \
           || fail "Could not pull any Gemma model. Check your internet connection."; }
fi
ok "LLM model ready"

# ── 5. Start web app ─────────────────────────────────────────────────────────
log "Starting web application..."
docker-compose -f "$COMPOSE_FILE" up -d web > /dev/null 2>&1
elapsed=0
until curl -sf "${WEB_URL}/api/cache-status" > /dev/null 2>&1; do
  sleep 3; elapsed=$((elapsed + 3))
  [ $elapsed -ge $MAX_WAIT ] && fail "Web app did not become ready in ${MAX_WAIT}s — check logs: docker-compose -f $COMPOSE_FILE logs web"
done
ok "Web application ready"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║          Stack Ready! 🚀                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Dashboard:  ${WEB_URL}"
echo "  Ollama:     http://localhost:11434"
echo "  PostgreSQL: localhost:5433"
echo ""
echo "  Next steps:"
echo "  1. Open ${WEB_URL}"
echo "  2. Enter your Splunk URL and token in the setup screen"
echo "  3. Click 'Refresh' to run the full LLM pipeline"
echo ""
echo "  Logs:   docker-compose -f $COMPOSE_FILE logs -f"
echo "  Stop:   docker-compose -f $COMPOSE_FILE down"
echo ""
