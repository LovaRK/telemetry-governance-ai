#!/bin/bash
set -e

echo "🔍 DATA FLOW VERIFICATION TEST"
echo "================================"
echo ""

# Configuration
SPLUNK_URL="${SPLUNK_URL:-https://localhost:8089}"
SPLUNK_TOKEN="${SPLUNK_TOKEN:-}"
API_BASE="${API_BASE:-http://localhost:3002}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-root}"
DB_NAME="${DB_NAME:-dashboard}"

echo "📋 Configuration:"
echo "  Splunk: $SPLUNK_URL"
echo "  API: $API_BASE"
echo "  Database: postgres://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""

# Step 1: Check database connectivity
echo "1️⃣ Checking PostgreSQL..."
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
  echo "   ✅ PostgreSQL connected"
else
  echo "   ❌ PostgreSQL connection failed"
  exit 1
fi

# Step 2: Check schema tables
echo ""
echo "2️⃣ Checking database schema..."
TABLES=("telemetry_snapshots" "executive_kpis" "agent_decisions")
for table in "${TABLES[@]}"; do
  if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) FROM $table" > /dev/null 2>&1; then
    COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM $table" 2>/dev/null)
    echo "   ✅ Table '$table' exists (${COUNT} rows)"
  else
    echo "   ❌ Table '$table' not found"
    exit 1
  fi
done

# Step 3: Check API endpoints
echo ""
echo "3️⃣ Checking API endpoints..."
echo "   Testing /api/executive-summary..."
RESP=$(curl -s -w "\n%{http_code}" "$API_BASE/api/executive-summary" 2>/dev/null || echo "error")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)

if [ "$STATUS" = "503" ]; then
  MODE=$(echo "$BODY" | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
  if [ "$MODE" = "DEMO_MODE" ]; then
    echo "   ℹ️  /api/executive-summary: $STATUS (DEMO_MODE - no data yet)"
  else
    echo "   ❌ /api/executive-summary: $STATUS"
    echo "       Response: $BODY"
  fi
elif [ "$STATUS" = "200" ]; then
  echo "   ✅ /api/executive-summary: $STATUS (Real data)"
else
  echo "   ❌ /api/executive-summary: $STATUS"
  echo "       Response: $BODY"
fi

echo ""
echo "4️⃣ Testing /api/agent-decisions..."
RESP=$(curl -s -w "\n%{http_code}" "$API_BASE/api/agent-decisions" 2>/dev/null || echo "error")
STATUS=$(echo "$RESP" | tail -1)
if [ "$STATUS" = "200" ]; then
  echo "   ✅ /api/agent-decisions: $STATUS"
else
  echo "   ⚠️  /api/agent-decisions: $STATUS"
fi

echo ""
echo "5️⃣ READY FOR DATA FLOW TEST"
echo "================================"
echo ""
echo "To run the full pipeline:"
echo ""
echo "  curl -X POST $API_BASE/api/cache \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{"
echo "      \"mcpUrl\": \"$SPLUNK_URL\","
echo "      \"token\": \"YOUR_SPLUNK_TOKEN\","
echo "      \"disableSslVerify\": true"
echo "    }'"
echo ""
echo "This will:"
echo "  1. Connect to Splunk via MCP"
echo "  2. Fetch real index metrics"
echo "  3. Send to LLM decision agent"
echo "  4. Store decisions in PostgreSQL"
echo "  5. Make results available via /api/executive-summary"
echo ""
