#!/usr/bin/env bash
# datasensAI -- full uninstall (macOS)
# Removes datasensAI containers, volumes, and the installation folder.
# Does NOT remove Docker, Git, Homebrew, or Ollama.
set -u

TARGET_DIR="${DATASENSAI_DIR:-$HOME/datasensai}"
COMPOSE_FILE="$TARGET_DIR/docker/docker-compose.yml"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { printf "  ${GREEN}OK${NC}  %s\n" "$1"; }
info() { printf "  ${BOLD}..${NC}  %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${NC}  %s\n" "$1"; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

printf "\n${BOLD}${RED}Uninstall datasensAI${NC}\n\n"
echo "  This will remove:"
echo "    * datasensAI containers and database (all data)"
echo "    * Installation folder: $TARGET_DIR"
echo ""
echo "  This does NOT remove Docker, Git, Homebrew, or Ollama."
echo ""
printf "  Type '${BOLD}UNINSTALL${NC}' to confirm, or press Enter to cancel: "
read -r confirm
if [ "$confirm" != "UNINSTALL" ]; then
  info "Uninstall cancelled."
  exit 0
fi

# 1) Containers + volumes via compose (if the file is still present)
if [ -f "$COMPOSE_FILE" ] && docker info >/dev/null 2>&1; then
  info "Stopping and removing containers + volumes..."
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  ok "Containers and volumes removed"
fi

# 2) Belt-and-suspenders: remove any leftover containers by name
if docker info >/dev/null 2>&1; then
  for ctr in docker-postgres-1 docker-web-1 docker-worker-1 docker-splunk-mock-1; do
    docker rm -f "$ctr" >/dev/null 2>&1 || true
  done
fi

# 3) Remove the installation folder
if [ -d "$TARGET_DIR" ]; then
  info "Removing installation folder: $TARGET_DIR"
  rm -rf "$TARGET_DIR"
  ok "Installation folder removed"
else
  warn "Installation folder not found (already removed): $TARGET_DIR"
fi

printf "\n${GREEN}${BOLD}datasensAI has been uninstalled.${NC}\n\n"
echo "  To reinstall, run the installer again (Fresh install)."
echo ""
