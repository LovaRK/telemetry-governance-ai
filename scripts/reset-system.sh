#!/bin/bash

set -e

echo "🔄 Resetting system..."
echo "  ✓ Stopping containers..."
docker compose -f docker/docker-compose.yml down -v

echo "  ✓ Starting fresh containers..."
docker compose -f docker/docker-compose.yml up -d

echo "  ⏳ Waiting for database to be ready..."
sleep 15

# Verify containers are healthy
echo "  ✓ Waiting for PostgreSQL health check..."
for i in {1..30}; do
  if docker compose -f docker/docker-compose.yml ps docker-postgres-1 | grep -q healthy; then
    echo "  ✓ PostgreSQL is healthy"
    break
  fi
  sleep 1
done

echo "  ✓ Waiting for web service to start..."
sleep 10

echo "🏥 Verifying system health..."
HEALTH=$(curl -s http://localhost:3002/api/health || echo '{"error":"unreachable"}')
if echo "$HEALTH" | grep -q "ok"; then
  echo "  ✓ Health check passed"
else
  echo "  ❌ Health check failed: $HEALTH"
  exit 1
fi

echo ""
echo "✅ READY"
echo "   Next: verify credentials with login API and Splunk API"
