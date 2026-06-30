#!/usr/bin/env bash
# Build the Windows + Mac installer zips entirely from repo sources.
# Output: ./dist/datasensAI-installer-windows-v1.3.0.zip
#         ./dist/datasensAI-installer-mac-v1.3.0.zip
#
# Usage:  scripts/install/build/build_zips.sh [output_dir]
set -euo pipefail

VERSION="1.3.0"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"                 # scripts/install
REPO="$(cd "$SRC/../.." && pwd)"              # repo root
OUT="${1:-$REPO/dist}"
mkdir -p "$OUT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------- Windows ----------------
WIN="$WORK/datasensAI-v$VERSION-win/datasensAI-v$VERSION-installer"
mkdir -p "$WIN/tools"
cp "$SRC/Install datasensAI.bat" "$WIN/"
cp "$SRC/doctor.ps1"             "$WIN/"
cp "$SRC/export-logs.ps1"        "$WIN/"
python3 "$HERE/fix_ps1.py" "$SRC/install.ps1"                       "$WIN/install.ps1"
python3 "$HERE/fix_ps1.py" "$SRC/tools/uninstall_datasensAI_windows.ps1" "$WIN/tools/uninstall_datasensAI_windows.ps1"
cp "$SRC/HOW_TO_INSTALL_WINDOWS.txt" "$WIN/HOW_TO_INSTALL.txt"
( cd "$WORK" && zip -rq "$OUT/datasensAI-installer-windows-v$VERSION.zip" "datasensAI-v$VERSION-win/datasensAI-v$VERSION-installer/" )

# ---------------- Mac ----------------
MAC="$WORK/datasensAI-v$VERSION-mac/datasensAI-v$VERSION-installer"
mkdir -p "$MAC/tools"
cp "$SRC/Install datasensAI.command" "$MAC/"
cp "$SRC/install.sh"     "$MAC/"
cp "$SRC/doctor.sh"      "$MAC/"
cp "$SRC/export-logs.sh" "$MAC/"
cp "$SRC/tools/uninstall_datasensAI_mac.sh" "$MAC/tools/"
cp "$SRC/HOW_TO_INSTALL_MAC.txt" "$MAC/HOW_TO_INSTALL.txt"
chmod +x "$MAC/Install datasensAI.command" "$MAC"/*.sh "$MAC/tools/"*.sh
( cd "$WORK" && zip -rq "$OUT/datasensAI-installer-mac-v$VERSION.zip" "datasensAI-v$VERSION-mac/datasensAI-v$VERSION-installer/" )

echo "Built:"
ls -lh "$OUT/datasensAI-installer-windows-v$VERSION.zip" "$OUT/datasensAI-installer-mac-v$VERSION.zip"
