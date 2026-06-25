#!/usr/bin/env bash
# Mac double-click wrapper for datasensAI installer v1.3.0.
# macOS treats .command files as Terminal scripts — double-clicking opens
# Terminal in this directory and runs install.sh automatically.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

clear
cat <<'EOF'
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║        datasensAI Installer v1.3.0 — Starting...                    ║
║                                                                      ║
║   A menu will appear in a moment. Choose what you want to do:        ║
║                                                                      ║
║     1) Install for the first time                                    ║
║     2) Start an existing install                                      ║
║     3) Repair if something is broken                                  ║
║     (and more options)                                               ║
║                                                                      ║
║   You may be asked for your Mac password and may see install         ║
║   dialogs for Docker Desktop, Homebrew, or Ollama.                  ║
║                                                                      ║
║   First install: 15-25 min (mostly the ~5 GB Ollama model).         ║
║   The installer will NOT show "complete" until login is verified.    ║
║                                                                      ║
║   If you need to stop: press Ctrl+C — safe to re-run later.         ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝

EOF

echo "Starting installer in 3 seconds (Ctrl+C to abort)..."
sleep 3
exec ./install.sh
