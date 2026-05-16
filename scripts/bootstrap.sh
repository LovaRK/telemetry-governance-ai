#!/bin/bash
# Bootstrap script for Telemetry OS Dashboard
# Brings up full local development stack with one command
# Prerequisites: Docker installed and running, Node 18+

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
  echo -e "${BLUE}ℹ${NC}  $1"
}

log_success() {
  echo -e "${GREEN}✓${NC}  $1"
}

log_error() {
  echo -e "${RED}✗${NC}  $1"
}

log_step() {
  echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}$1${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

wait_for_condition() {
  local condition=$1
  local service=$2
  local max_attempts=$3
  local delay=$4

  attempt=0
  while [ $attempt -lt $max_attempts ]; do
    if eval "$condition" > /dev/null 2>&1; then
      log_success "$service is ready"
      return 0
    fi
    attempt=$((attempt + 1))
    if [ $attempt -lt $max_attempts ]; then
      log_info "Waiting for $service... ($attempt/$max_attempts)"
      sleep $delay
    fi
  done

  log_error "$service did not become ready after $((max_attempts * delay)) seconds"
  return 1
}

# Main bootstrap flow
main() {
  echo ""
  echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   Telemetry OS Dashboard — Bootstrap       ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
  echo ""

  # Step 0: Check Docker
  log_step "Checking Docker"
  if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker Desktop."
    exit 1
  fi

  if ! docker ps > /dev/null 2>&1; then
    log_error "Docker daemon is not running. Please start Docker Desktop."
    exit 1
  fi

  log_success "Docker is running"

  # Step 1: Pull latest images
  log_step "Pulling latest Docker images"
  docker-compose -f docker/docker-compose.yml pull 2>/dev/null || true

  # Step 2: Start PostgreSQL
  log_step "Starting PostgreSQL"
  docker-compose -f docker/docker-compose.yml up -d postgres

  wait_for_condition \
    "docker exec postgres pg_isready -U telemetry -d telemetry_os" \
    "PostgreSQL" \
    30 \
    2

  # Step 3: Start Ollama
  log_step "Starting Ollama LLM service"
  docker-compose -f docker/docker-compose.yml up -d ollama

  wait_for_condition \
    "docker exec ollama ollama list 2>/dev/null | grep -q gemma" \
    "Ollama" \
    20 \
    2

  # Step 4: Pull LLM model
  log_step "Pulling LLM model (gemma4:e4b)"
  log_info "This may take 2-3 minutes on first run..."

  if docker exec ollama ollama list 2>/dev/null | grep -q "gemma4:e4b"; then
    log_success "gemma4:e4b is already pulled"
  else
    if ! docker exec ollama ollama pull gemma4:e4b 2>/dev/null; then
      log_info "gemma4:e4b unavailable, attempting gemma:2b as fallback..."
      docker exec ollama ollama pull gemma:2b || true
    fi
  fi

  # Step 5: Start web service
  log_step "Starting Next.js web server"
  docker-compose -f docker/docker-compose.yml up -d web

  wait_for_condition \
    "curl -s http://localhost:3002/api/health | grep -q '\"status\"'" \
    "Web server" \
    30 \
    2

  # Step 6: Final verification
  log_step "Verifying health check"
  health=$(curl -s http://localhost:3002/api/health)

  if echo "$health" | grep -q '"status":"healthy"'; then
    log_success "All services are healthy"
  else
    log_info "Health status: $(echo "$health" | grep -o '"status":"[^"]*"')"
  fi

  # Success summary
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   ✓ Stack Ready                            ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BLUE}Dashboard:${NC}         http://localhost:3002"
  echo -e "${BLUE}Health check:${NC}      http://localhost:3002/api/health"
  echo -e "${BLUE}PostgreSQL:${NC}        localhost:5432 (telemetry/telemetry)"
  echo -e "${BLUE}Ollama:${NC}            localhost:11434"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "  1. Open http://localhost:3002 in your browser"
  echo "  2. Configure Splunk credentials in the dashboard"
  echo "  3. Click 'Refresh Data' to fetch telemetry and run LLM analysis"
  echo ""
  echo -e "${YELLOW}Useful commands:${NC}"
  echo "  docker-compose -f docker/docker-compose.yml logs -f web     # Watch web server logs"
  echo "  docker-compose -f docker/docker-compose.yml logs -f ollama   # Watch LLM service logs"
  echo "  docker-compose -f docker/docker-compose.yml down             # Stop all services"
  echo ""
}

main
