#!/usr/bin/env bash
set -euo pipefail

# cloudpilot Korean IME Fix Installer
# Upstream issue #14371
#
# Patches cloudpilot to prevent Korean (and other CJK) IME last character
# truncation when pressing Enter in Kitty and other terminals.
#
# Usage:
#   # from a cloned repo:
#   ./patches/install-korean-ime-fix.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
ORANGE='\033[38;5;214m'
MUTED='\033[0;2m'
NC='\033[0m'

CLOUDPILOT_DIR="${CLOUDPILOT_DIR:-$HOME/.cloudpilot}"
CLOUDPILOT_SRC="${CLOUDPILOT_SRC:-$HOME/.cloudpilot-src}"
FORK_REPO="${FORK_REPO:-https://github.com/claudianus/opencode.git}"
FORK_BRANCH="${FORK_BRANCH:-fix-zhipuai-coding-plan-thinking}"

info()  { echo -e "${MUTED}$*${NC}"; }
warn()  { echo -e "${ORANGE}$*${NC}"; }
err()   { echo -e "${RED}$*${NC}" >&2; }
ok()    { echo -e "${GREEN}$*${NC}"; }

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Error: $1 is required but not installed."
    exit 1
  fi
}

need git
need bun

# ── 1. Clone or update fork ────────────────────────────────────────────
if [ -d "$CLOUDPILOT_SRC/.git" ]; then
  info "Updating existing source at $CLOUDPILOT_SRC ..."
  git -C "$CLOUDPILOT_SRC" fetch origin "$FORK_BRANCH"
  git -C "$CLOUDPILOT_SRC" checkout "$FORK_BRANCH"
  git -C "$CLOUDPILOT_SRC" reset --hard "origin/$FORK_BRANCH"
else
  info "Cloning fork (shallow) to $CLOUDPILOT_SRC ..."
  git clone --depth 1 --branch "$FORK_BRANCH" "$FORK_REPO" "$CLOUDPILOT_SRC"
fi

# ── 2. Verify the IME fix is present in source ────────────────────────
PROMPT_FILE="$CLOUDPILOT_SRC/packages/cloudpilot-ai/src/cli/cmd/tui/component/prompt/index.tsx"
if [ ! -f "$PROMPT_FILE" ]; then
  err "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

if grep -q "setTimeout(() => setTimeout" "$PROMPT_FILE"; then
  ok "IME fix already present in source."
else
  warn "IME fix not found. Applying patch ..."
  # Apply the fix: replace onSubmit={submit} with double-deferred version
  sed -i 's|onSubmit={submit}|onSubmit={() => {\n                // IME: double-defer so the last composed character (e.g. Korean\n                // hangul) is flushed to plainText before we read it for submission.\n                setTimeout(() => setTimeout(() => submit(), 0), 0)\n              }}|' "$PROMPT_FILE"
  if grep -q "setTimeout(() => setTimeout" "$PROMPT_FILE"; then
    ok "Patch applied."
  else
    err "Failed to apply patch. The source may have changed."
    exit 1
  fi
fi

# ── 3. Install dependencies ────────────────────────────────────────────
info "Installing dependencies (this may take a minute) ..."
cd "$CLOUDPILOT_SRC"
bun install --frozen-lockfile 2>/dev/null || bun install

# ── 4. Build (current platform only) ──────────────────────────────────
info "Building cloudpilot for current platform ..."
cd "$CLOUDPILOT_SRC/packages/cloudpilot-ai"
bun run build --single

# ── 5. Install binary ──────────────────────────────────────────────────
mkdir -p "$CLOUDPILOT_DIR/bin"

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
[ "$ARCH" = "aarch64" ] && ARCH="arm64"
[ "$ARCH" = "x86_64" ] && ARCH="x64"
[ "$PLATFORM" = "darwin" ] && true
[ "$PLATFORM" = "linux" ] && true

BUILT_BINARY="$CLOUDPILOT_SRC/packages/cloudpilot-ai/dist/cloudpilot-${PLATFORM}-${ARCH}/bin/cloudpilot"

if [ ! -f "$BUILT_BINARY" ]; then
  BUILT_BINARY=$(find "$CLOUDPILOT_SRC/packages/cloudpilot-ai/dist" -name "cloudpilot" -type f -executable 2>/dev/null | head -1)
fi

if [ -f "$BUILT_BINARY" ]; then
  if [ -f "$CLOUDPILOT_DIR/bin/cloudpilot" ]; then
    cp "$CLOUDPILOT_DIR/bin/cloudpilot" "$CLOUDPILOT_DIR/bin/cloudpilot.bak.$(date +%Y%m%d%H%M%S)"
  fi
  cp "$BUILT_BINARY" "$CLOUDPILOT_DIR/bin/cloudpilot"
  chmod +x "$CLOUDPILOT_DIR/bin/cloudpilot"
  ok "Installed to $CLOUDPILOT_DIR/bin/cloudpilot"
else
  err "Build failed - binary not found in dist/"
  info "Try running manually:"
  echo "  cd $CLOUDPILOT_SRC/packages/cloudpilot-ai && bun run build --single"
  exit 1
fi

echo ""
ok "Done! Korean IME fix is now active."
echo ""
info "To uninstall and revert to the official release:"
echo "  curl -fsSL https://opencode.ai/install | bash"
echo ""
info "To update (re-pull and rebuild):"
echo "  $0"
