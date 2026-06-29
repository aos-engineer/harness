#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v gemini >/dev/null 2>&1; then
  echo "Gemini CLI not found on PATH. Install from https://ai.google.dev/gemini-api/docs/cli first." >&2
  exit 1
fi

GEMINI_EXT_DIR="${GEMINI_EXTENSIONS_DIR:-$HOME/.gemini/extensions}"
mkdir -p "$GEMINI_EXT_DIR"

LINK_TARGET="$GEMINI_EXT_DIR/aos-harness"
if [ -e "$LINK_TARGET" ] || [ -L "$LINK_TARGET" ]; then
  rm -rf "$LINK_TARGET"
fi
ln -s "$PLUGIN_ROOT" "$LINK_TARGET"

echo "Installed AOS Harness extension to $LINK_TARGET"
echo "Restart Gemini CLI to pick up the new skills."
