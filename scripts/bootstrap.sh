#!/bin/bash
set -e

echo "🚀 datasensAI Dashboard Bootstrap"
echo "=================================="
echo ""

# Check Docker is running
echo "✓ Checking Docker daemon..."
if ! docker info > /dev/null 2>&1; then
  echo "✗ Docker daemon is not running. Start Docker and try again."
  exit 1
fi
echo "  Docker is running"

# Navigate to repo root
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
echo "  Working directory: $REPO_ROOT"
echo ""

# Pull latest images
echo "✓ Pulling latest Docker images..."
docker-compose -f docker/docker-compose.yml pull
echo "  Images pulled"
echo ""

# Start PostgreSQL
echo "✓ Starting PostgreSQL..."
docker-compose -f docker/docker-compose.yml up -d postgres
echo "  Waiting for PostgreSQL to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if docker exec dashboards-postgres-1 pg_isready -U root > /dev/null 2>&1; then
    echo "  PostgreSQL is ready"
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ $attempt -eq $max_attempts ]; then
  echo "✗ PostgreSQL failed to start"
  exit 1
fi
echo ""

# Start Ollama
echo "✓ Starting Ollama..."
docker-compose -f docker/docker-compose.yml up -d ollama
echo "  Waiting for Ollama to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if docker exec dashboards-ollama-1 ollama list > /dev/null 2>&1; then
    echo "  Ollama is ready"
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ $attempt -eq $max_attempts ]; then
  echo "✗ Ollama failed to start"
  exit 1
fi
echo ""

# Pull Gemma model
echo "✓ Pulling Gemma model (this may take a few minutes)..."
if docker exec dashboards-ollama-1 ollama list | grep -q "gemma2"; then
  echo "  Gemma2 model already available"
else
  docker exec dashboards-ollama-1 ollama pull gemma2:2b || {
    echo "  Note: Model pull may timeout; Ollama will continue pulling in background"
  }
fi
echo ""

# Start web service
echo "✓ Starting web service..."
docker-compose -f docker/docker-compose.yml up -d web
echo "  Waiting for web service to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if curl -s http://localhost:3002/api/cache-status > /dev/null 2>&1; then
    echo "  Web service is ready"
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ $attempt -eq $max_attempts ]; then
  echo "✗ Web service failed to start"
  exit 1
fi
echo ""

# Summary
echo "✅ Stack is ready!"
echo "=================================="
echo ""
echo "📊 Dashboard:    http://localhost:3002"
echo "🗄️  PostgreSQL:   localhost:5432 (root/root)"
echo "🦙 Ollama:       localhost:11434"
echo ""
echo "Next steps:"
echo "  1. Open http://localhost:3002 in your browser"
echo "  2. Enter your Splunk connection details (URL + token)"
echo "  3. Click 'Connect & Refresh' to start the pipeline"
echo ""
echo "To view logs:"
echo "  docker-compose -f docker/docker-compose.yml logs -f"
echo ""
echo "To stop the stack:"
echo "  docker-compose -f docker/docker-compose.yml down"
echo ""
