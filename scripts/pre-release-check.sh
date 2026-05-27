#!/usr/bin/env bash
set -euo pipefail

echo "[pre-release-check] Soak: 10x refresh"
npx jest -c jest.gates.config.js tests/soak --forceExit

echo "[pre-release-check] verifying fixture cleanliness"
node scripts/verify-clean.js

echo "[pre-release-check] PASS: all checks"
