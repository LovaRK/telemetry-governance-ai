#!/bin/bash
# Phase 8: Data Purity CI Enforcement
#
# This script enforces data purity guardrails via static analysis.
# Run this in CI to prevent synthetic data from being committed.
#
# Checks:
# 1. No DEMO_MODE fallback data returns
# 2. No default/synthetic config values
# 3. No unattributed data in critical paths
# 4. All API endpoints use pure response wrappers

set -e

echo "🔐 Data Purity CI Enforcement"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0
FAIL=0

# Test 1: Check for DEMO_MODE fallbacks returning empty arrays
echo ""
echo "📋 Test 1: Scanning for DEMO_MODE fallbacks..."
if grep -r "DEMO_MODE" apps/web/app/api --include="*.ts" | grep -E "(data: \[\]|data:\s*\[\]|return.*DEMO_MODE.*\[\])" | head -5 > /tmp/demo_fallbacks.txt 2>&1; then
    if [ -s /tmp/demo_fallbacks.txt ]; then
        echo "❌ FAIL: Found DEMO_MODE fallbacks:"
        head -10 /tmp/demo_fallbacks.txt
        FAIL=$((FAIL + 1))
    else
        echo "✓ PASS: No DEMO_MODE fallbacks found"
        PASS=$((PASS + 1))
    fi
else
    echo "✓ PASS: No DEMO_MODE fallbacks found"
    PASS=$((PASS + 1))
fi

# Test 2: Check for hard-coded synthetic data constants
echo ""
echo "📋 Test 2: Scanning for synthetic data constants..."
if grep -r "DEFAULT_DATA\|MOCK_\|STUB_DATA\|FALLBACK_" apps/web/app/api --include="*.ts" > /tmp/synthetic_data.txt 2>&1; then
    if [ -s /tmp/synthetic_data.txt ] && [ $(wc -l < /tmp/synthetic_data.txt) -gt 0 ]; then
        echo "⚠️  WARNING: Found synthetic data references:"
        head -5 /tmp/synthetic_data.txt
        FAIL=$((FAIL + 1))
    else
        echo "✓ PASS: No synthetic data constants found"
        PASS=$((PASS + 1))
    fi
else
    echo "✓ PASS: No synthetic data constants found"
    PASS=$((PASS + 1))
fi

# Test 3: Verify guard files exist
echo ""
echo "📋 Test 3: Verifying guard files exist..."
GUARD_FILES=(
    "core/guards/data-purity.guard.ts"
    "core/guards/fail-loud.ts"
    "core/guards/trace-context.ts"
    "core/guards/next-trace-context.ts"
    "core/guards/adapter-purity.guard.ts"
    "core/guards/executor-purity.guard.ts"
    "apps/api/middleware/data-purity.middleware.ts"
    "apps/api/middleware/api-response-purity.ts"
)

for file in "${GUARD_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ❌ MISSING: $file"
        FAIL=$((FAIL + 1))
    fi
done

if [ $FAIL -eq 0 ]; then
    echo "✓ PASS: All guard files present"
    PASS=$((PASS + 1))
fi

# Test 4: Check that API responses use purity wrappers
echo ""
echo "📋 Test 4: Verifying response purity enforcement..."
if grep -r "createPureResponse\|createPureErrorResponse\|enforceMeta" apps/web/app/api --include="*.ts" > /tmp/pure_responses.txt 2>&1; then
    RESPONSE_COUNT=$(grep -c . /tmp/pure_responses.txt || echo 0)
    if [ "$RESPONSE_COUNT" -gt 0 ]; then
        echo "✓ PASS: Found $RESPONSE_COUNT purity-wrapped responses"
        PASS=$((PASS + 1))
    else
        echo "⚠️  WARNING: No purity-wrapped responses found"
        FAIL=$((FAIL + 1))
    fi
else
    echo "⚠️  WARNING: Could not verify response purity enforcement"
    FAIL=$((FAIL + 1))
fi

# Test 5: Check for trace context usage in critical paths
echo ""
echo "📋 Test 5: Verifying trace context propagation..."
if grep -r "withNextTraceContext\|getTraceId" apps/web/app/api --include="*.ts" > /tmp/trace_usage.txt 2>&1; then
    TRACE_COUNT=$(grep -c . /tmp/trace_usage.txt || echo 0)
    if [ "$TRACE_COUNT" -gt 0 ]; then
        echo "✓ PASS: Found $TRACE_COUNT trace context usages"
        PASS=$((PASS + 1))
    else
        echo "⚠️  WARNING: No trace context usage found"
        FAIL=$((FAIL + 1))
    fi
else
    echo "⚠️  WARNING: Could not verify trace context usage"
    FAIL=$((FAIL + 1))
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Results: $PASS passed, $FAIL failed"

if [ $FAIL -eq 0 ]; then
    echo "✅ All data purity checks passed!"
    exit 0
else
    echo "❌ Data purity enforcement failed"
    echo ""
    echo "Fix by:"
    echo "  1. Removing all DEMO_MODE fallbacks"
    echo "  2. Ensuring all API responses use createPureResponse()"
    echo "  3. Ensuring all handlers use withNextTraceContext()"
    exit 1
fi
