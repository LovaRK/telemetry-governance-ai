#!/bin/bash

echo "=========================================="
echo "datasensAI Dashboard — Local Startup"
echo "=========================================="
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker first."
  exit 1
fi

REPO_ROOT="/Users/ramakrishna/Desktop/Teja/Dashboards"
cd "$REPO_ROOT"

echo "✓ Starting services..."
echo ""

# Start all services
docker-compose --env-file .env -f docker/docker-compose.yml up -d

# Wait for services
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check PostgreSQL
echo -n "  PostgreSQL... "
for i in {1..30}; do
  if docker-compose --env-file .env -f docker/docker-compose.yml exec -T postgres pg_isready -U root > /dev/null 2>&1; then
    echo "✓ Ready"
    break
  fi
  sleep 1
done

# Check Ollama
echo -n "  Ollama... "
for i in {1..30}; do
  if docker-compose --env-file .env -f docker/docker-compose.yml exec -T ollama ollama list > /dev/null 2>&1; then
    echo "✓ Ready"
    break
  fi
  sleep 1
done

# Check Web
echo -n "  Web service... "
for i in {1..30}; do
  if curl -s http://localhost:3002/api/cache-status > /dev/null 2>&1; then
    echo "✓ Ready"
    break
  fi
  sleep 1
done

echo ""
echo "=========================================="
echo "✅ Dashboard is running!"
echo "=========================================="
echo ""
echo "📊 Open in browser: http://localhost:3002"
echo ""
echo "🔑 Next steps:"
echo "  1. Enter your Splunk URL and token"
echo "  2. Click 'Connect & Refresh'"
echo "  3. Wait for data to load"
echo ""
echo "📋 View logs:  docker-compose --env-file .env -f docker/docker-compose.yml logs -f"
echo "🛑 Stop:       docker-compose --env-file .env -f docker/docker-compose.yml down"
echo ""
