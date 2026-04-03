#!/usr/bin/env bash
# QVeris CLI Installer
# Usage: curl -fsSL https://qveris.ai/install | bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
RED='\033[31m'
DIM='\033[2m'
RESET='\033[0m'

info()  { echo -e "  ${CYAN}▸${RESET} $1"; }
ok()    { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()  { echo -e "  ${YELLOW}!${RESET} $1"; }
fail()  { echo -e "  ${RED}✘${RESET} $1"; exit 1; }

echo ""
echo -e "  ${BOLD}QVeris CLI Installer${RESET}"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 18+ first: ${CYAN}https://nodejs.org${RESET}"
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js $NODE_VERSION detected. QVeris CLI requires Node.js 18+."
fi

ok "Node.js v$NODE_VERSION"

# ── 2. Check npm ──────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  fail "npm not found. Install npm first."
fi

ok "npm $(npm -v)"

# ── 3. Install @qverisai/cli globally ────────────────────────────────
info "Installing @qverisai/cli..."

npm install -g @qverisai/cli 2>&1 | while IFS= read -r line; do
  # suppress verbose npm output, show only errors
  case "$line" in
    *ERR*|*error*|*Error*) echo "  $line" ;;
  esac
done

if [ $? -ne 0 ] 2>/dev/null; then
  # If global install fails (permissions), try with --prefix
  warn "Global install failed, trying user-local install..."
  NPM_DIR="${HOME}/.npm-global"
  mkdir -p "$NPM_DIR"
  npm config set prefix "$NPM_DIR" 2>/dev/null || true
  npm install -g @qverisai/cli --prefix "$NPM_DIR" 2>&1 | grep -i err || true
fi

# ── 4. Verify installation ───────────────────────────────────────────
# Find where qveris was installed
QVERIS_BIN=""
if command -v qveris &>/dev/null; then
  QVERIS_BIN=$(command -v qveris)
else
  # Check common locations
  for dir in \
    "$(npm prefix -g 2>/dev/null)/bin" \
    "${HOME}/.npm-global/bin" \
    "/usr/local/bin" \
    "/opt/homebrew/bin" \
    "${HOME}/.local/bin"; do
    if [ -f "$dir/qveris" ]; then
      QVERIS_BIN="$dir/qveris"
      break
    fi
  done
fi

if [ -z "$QVERIS_BIN" ]; then
  fail "Installation succeeded but 'qveris' not found in PATH."
fi

# ── 5. Check if qveris is in PATH ────────────────────────────────────
if command -v qveris &>/dev/null; then
  ok "qveris installed at $QVERIS_BIN"
else
  # Not in PATH — add it
  BIN_DIR=$(dirname "$QVERIS_BIN")
  SHELL_RC=""
  case "${SHELL:-/bin/bash}" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    */fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
    *)      SHELL_RC="$HOME/.profile" ;;
  esac

  # Add to PATH in shell rc if not already there
  if [ -n "$SHELL_RC" ] && ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# QVeris CLI" >> "$SHELL_RC"
    if [[ "$SHELL_RC" == *"fish"* ]]; then
      echo "set -gx PATH $BIN_DIR \$PATH" >> "$SHELL_RC"
    else
      echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    fi
    ok "Added $BIN_DIR to PATH in $SHELL_RC"
    warn "Run ${CYAN}source $SHELL_RC${RESET} or open a new terminal to use 'qveris'"
  fi
  export PATH="$BIN_DIR:$PATH"
  ok "qveris installed at $QVERIS_BIN"
fi

# ── 6. Print version and next steps ──────────────────────────────────
VERSION=$(qveris --version 2>/dev/null || echo "unknown")

echo ""
echo -e "  ${GREEN}${BOLD}QVeris CLI installed successfully!${RESET} ${DIM}($VERSION)${RESET}"
echo ""
echo -e "  ${BOLD}Get started:${RESET}"
echo -e "    ${CYAN}qveris login${RESET}                          Authenticate"
echo -e "    ${CYAN}qveris discover${RESET} \"weather API\"         Find capabilities"
echo -e "    ${CYAN}qveris inspect${RESET} 1                      View tool details"
echo -e "    ${CYAN}qveris call${RESET} 1 --params '{...}'        Execute a tool"
echo ""
echo -e "  ${DIM}Docs: https://qveris.ai/docs${RESET}"
echo ""
