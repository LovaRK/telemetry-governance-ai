#!/usr/bin/env bash
# Mac double-click wrapper: opens Terminal automatically and runs install.sh.
# Users never have to type in a terminal — just double-click this file.
#
# How it works: macOS treats .command files as "Terminal scripts". Double-
# clicking opens Terminal in the file's directory and executes the script.
# We just cd to the script's own dir and exec install.sh.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

clear
cat <<'EOF'
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║    datasensAI installer is starting in this Terminal window.     ║
║                                                                  ║
║    You may be asked for your Mac password (sudo) and may see     ║
║    install dialogs for Docker Desktop / Homebrew / Ollama.       ║
║                                                                  ║
║    The whole thing takes 15-25 min on a clean Mac (mostly the    ║
║    Ollama model download). Once it finishes, the success         ║
║    message will tell you where to log in.                        ║
║                                                                  ║
║    If you need to stop, press Ctrl+C and re-run later — the      ║
║    installer is safe to re-run.                                  ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

EOF

echo "Starting installer in 5 seconds (Ctrl+C to abort)..."
sleep 5
exec ./install.sh
