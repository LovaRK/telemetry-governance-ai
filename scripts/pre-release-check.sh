#!/usr/bin/env bash
set -euo pipefail

echo "[pre-release-check] verifying fixture cleanliness"
node scripts/verify-clean.js

echo "[pre-release-check] PASS: no fixture residue"
