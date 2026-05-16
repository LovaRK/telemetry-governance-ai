#!/bin/sh
# Docker entrypoint script for web service
# Runs database migrations (with fail-fast on error), then starts Next.js dev server

set -e

echo "=========================================="
echo "🚀 Dashboard Service Initialization"
echo "=========================================="
echo ""

# Run database migrations (fail-fast: exit immediately on error)
echo "📊 Running database migrations..."
echo ""

if npm run migrate; then
  echo ""
  echo "✓ Migrations complete and successful"
  echo ""
else
  # Fail-fast: migrations failed, do NOT start the application
  echo ""
  echo "❌ MIGRATION FAILED — Application will not start"
  echo "   Check migration logs above for details"
  echo "   Do NOT proceed with degraded schema state"
  echo ""
  exit 1
fi

# Verify health
echo "🏥 Verifying database health..."
sleep 2

# Start the web server
echo ""
echo "🌐 Starting Next.js dev server..."
echo ""
cd /app/apps/web
exec npm run dev
