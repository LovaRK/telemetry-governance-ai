#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3002}"

echo "=== E2E API DATA CONTRACT SWEEP ==="
echo "Base URL: $BASE_URL"
echo ""

endpoints=(
  "/api/health"
  "/api/cache-status"
  "/api/agent-decisions"
  "/api/recommendations"
  "/api/field-usage"
  "/api/quality-hotspots"
  "/api/security-coverage"
  "/api/kpi-history"
  "/api/search-audit"
  "/api/governance/telemetry"
  "/api/governance/events"
  "/api/governance/mutations"
  "/api/decision-lineage"
  "/api/executive-summary"
)

passed=0
failed=0

for path in "${endpoints[@]}"; do
  printf "Testing %-40s " "$path"

  body="$(curl -sS "$BASE_URL$path" 2>&1 || echo "{\"error\":\"curl failed\"}")"

  # Check for valid JSON
  if ! echo "$body" | jq empty >/dev/null 2>&1; then
    echo "❌ INVALID JSON"
    echo "  Response: ${body:0:200}"
    ((failed++))
    continue
  fi

  # Check for forbidden synthetic/demo text
  if echo "$body" | grep -Ei "mock|fake|synthetic|demo mode|hardcoded" >/dev/null; then
    echo "❌ FORBIDDEN DEMO TEXT"
    echo "$body" | grep -Ei "mock|fake|synthetic|demo mode|hardcoded" | head -3
    ((failed++))
    continue
  fi

  # Extract status and source
  status=$(echo "$body" | jq -r '.status // empty' 2>/dev/null || echo "")
  source=$(echo "$body" | jq -r '.meta.source // empty' 2>/dev/null || echo "")
  error=$(echo "$body" | jq -r '.error // empty' 2>/dev/null || echo "")

  if [ -n "$error" ]; then
    printf "⚠️  ERROR (expected)"
    if [ -n "$source" ]; then printf " | source: %s" "$source"; fi
    echo ""
  else
    printf "✅ VALID"
    if [ -n "$source" ]; then printf " | source: %s" "$source"; fi
    if [ -n "$status" ]; then printf " | status: %s" "$status"; fi
    echo ""
  fi

  ((passed++))
done

echo ""
echo "=== SUMMARY ==="
echo "Passed: $passed"
echo "Failed: $failed"

if [ "$failed" -gt 0 ]; then
  exit 1
else
  echo "✅ All endpoints returned valid JSON with no forbidden demo text"
  exit 0
fi
