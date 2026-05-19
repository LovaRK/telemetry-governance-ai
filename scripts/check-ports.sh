#!/bin/bash

# Port Collision Detection & Validation Script
# Ensures all required ports are available before starting services
# Usage: ./scripts/check-ports.sh

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env.development ]; then
  export $(cat .env.development | xargs)
else
  echo -e "${YELLOW}⚠️  .env.development not found, using defaults${NC}"
fi

WEB_PORT=${WEB_PORT:-3002}
API_PORT=${API_PORT:-3001}
POSTGRES_PORT=${POSTGRES_PORT:-5433}
REDIS_PORT=${REDIS_PORT:-6379}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Port Availability Check${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check_port() {
  local port=$1
  local service=$2

  if lsof -i :$port -t >/dev/null 2>&1; then
    local pid=$(lsof -i :$port -t)
    local process=$(lsof -i :$port -a -c . | tail -1 | awk '{print $1}')
    echo -e "${RED}❌ Port $port ($service) is in use${NC}"
    echo -e "   Process: $process (PID: $pid)"
    echo -e "   To free: ${YELLOW}kill -9 $pid${NC}"
    return 1
  else
    echo -e "${GREEN}✅ Port $port ($service) available${NC}"
    return 0
  fi
}

# Check all ports
PORTS_OK=true

echo ""
echo "Required ports:"
check_port $WEB_PORT "Web (host)" || PORTS_OK=false
check_port $API_PORT "API (host)" || PORTS_OK=false
check_port $POSTGRES_PORT "PostgreSQL (host)" || PORTS_OK=false
check_port $REDIS_PORT "Redis (host)" || PORTS_OK=false

echo ""
echo "Internal container ports (must not change):"
echo -e "${BLUE}ℹ️  3000 (Next.js web server)${NC}"
echo -e "${BLUE}ℹ️  5432 (PostgreSQL server)${NC}"
echo -e "${BLUE}ℹ️  6379 (Redis server)${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$PORTS_OK" = true ]; then
  echo -e "${GREEN}✅ All ports available. Safe to run: npm run dev${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
else
  echo -e "${RED}❌ Port conflicts detected. Free ports and try again.${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
fi
