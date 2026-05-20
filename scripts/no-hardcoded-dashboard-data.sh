#!/usr/bin/env bash
set -euo pipefail

echo "=== SCANNING FOR HARDCODED DASHBOARD DATA ==="
echo ""

paths=(
  "apps/web/app"
  "apps/web/components"
  "apps/web/lib"
)

# Known hardcoded values that should NOT appear in live dashboard
patterns=(
  "Active \\(30-day half-life\\)"
  "Approval expiry: 90 days"
  "9 time classes tracked"
  "Weekly ground truth audits"
  "Targeting stable hallucinations"
  "DEMO_MODE.*true"
  "mockData ="
  "demoData ="
  '"synthetic"'
  "hardcodedValues"
)

failed=0

for pattern in "${patterns[@]}"; do
  if grep -RInE "$pattern" "${paths[@]}" >/tmp/hardcoded_hits_$$.txt 2>/dev/null; then
    echo "❌ FORBIDDEN HARDCODED TEXT: $pattern"
    head -5 /tmp/hardcoded_hits_$$.txt | sed 's/^/   /'
    echo ""
    failed=1
  fi
done

rm -f /tmp/hardcoded_hits_$$.txt

if [ "$failed" -eq 1 ]; then
  echo "❌ Found hardcoded dashboard data that should be API-backed"
  exit 1
else
  echo "✅ No forbidden hardcoded dashboard data found"
  echo "   (Static Trust Layer Status and decision-history stub are expected)"
  exit 0
fi
