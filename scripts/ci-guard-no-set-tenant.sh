#!/bin/bash
# CI gate: prevent regression of "syntax error at or near '$1'"
# PostgreSQL SET does not accept parameterized values ($1 syntax).
# All tenant session writes must use set_config(), not SET app.current_tenant =
#
# Pattern is exact: "SET app.current_tenant =" (with =) so comments don't false-positive.
# Usage: bash scripts/ci-guard-no-set-tenant.sh

set -euo pipefail

PATTERN='SET app\.current_tenant ='
DIRS="apps packages core"

echo "[CI Gate] Scanning for forbidden SET app.current_tenant = pattern..."

# Exclude comments (lines starting with -- or //) and test/spec files
if grep -rn --include="*.ts" --include="*.js" "$PATTERN" $DIRS 2>/dev/null \
   | grep -v "\.test\.\|\.spec\." \
   | grep -v "node_modules" \
   | grep -v "^\s*//\|^\s*--"; then
  echo ""
  echo "ERROR: Found 'SET app.current_tenant =' in source code."
  echo "PostgreSQL SET does not accept parameterized queries (\$1 syntax)."
  echo "Use: SELECT set_config('app.current_tenant', \$1, true)"
  echo "See: core/database/connection.ts for the correct pattern."
  exit 1
fi

echo "[CI Gate] ✓ No forbidden 'SET app.current_tenant =' patterns found."
