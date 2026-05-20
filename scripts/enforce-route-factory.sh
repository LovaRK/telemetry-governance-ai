#!/bin/bash

echo "=== L3 ENFORCEMENT VALIDATION ==="
echo ""

# Check 1: Raw export async function violations
echo "Check 1: Raw export async function violations"
RAW_EXPORTS=$(grep -rE "export async function (GET|POST|PUT|PATCH|DELETE)" apps/web/app/api 2>/dev/null | wc -l)
echo "Raw exports found: $RAW_EXPORTS"
if [ $RAW_EXPORTS -eq 0 ]; then
  echo "✓ PASS"
else
  echo "✗ FAIL"
  grep -rE "export async function (GET|POST|PUT|PATCH|DELETE)" apps/web/app/api 2>/dev/null
fi
echo ""

# Check 2: NextResponse.json violations (exclude streaming routes)
echo "Check 2: NextResponse.json calls (JSON routes only)"
JSON_CALLS=$(grep -rE "NextResponse\.json" apps/web/app/api 2>/dev/null | wc -l)
echo "NextResponse.json calls found: $JSON_CALLS"
if [ $JSON_CALLS -eq 0 ]; then
  echo "✓ PASS"
else
  echo "✗ FAIL"
  grep -rE "NextResponse\.json" apps/web/app/api 2>/dev/null
fi
echo ""

# Check 3: createRoute usage count
echo "Check 3: createRoute factory usage"
CREATEROUTE=$(grep -rl "createRoute" apps/web/app/api | grep -v "createStreamRoute" | grep route.ts | wc -l)
echo "Routes using createRoute (JSON): $CREATEROUTE"
echo ""

# Check 4: createStreamRoute usage count  
echo "Check 4: createStreamRoute factory usage"
CREATESTREAM=$(grep -rl "createStreamRoute" apps/web/app/api | grep route.ts | wc -l)
echo "Routes using createStreamRoute (SSE): $CREATESTREAM"
echo ""

# Check 5: Total route count
echo "Check 5: Total routes"
TOTAL=$(find apps/web/app/api -name "route.ts" -type f | wc -l)
echo "Total routes: $TOTAL"
echo "Expected: createRoute ($CREATEROUTE) + createStreamRoute ($CREATESTREAM) = $((CREATEROUTE + CREATESTREAM))"
echo ""

if [ $RAW_EXPORTS -eq 0 ] && [ $JSON_CALLS -eq 0 ] && [ $((CREATEROUTE + CREATESTREAM)) -eq $TOTAL ]; then
  echo "=== ALL CHECKS PASSED ✓ ==="
  exit 0
else
  echo "=== SOME CHECKS FAILED ✗ ==="
  exit 1
fi
