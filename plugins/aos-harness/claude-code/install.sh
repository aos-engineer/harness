#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
SOURCE_DIR="${SCRIPT_DIR}/commands"
TARGET_DIR="${1:-${REPO_ROOT}/.claude/commands/aos}"

mkdir -p "${TARGET_DIR}"
cp "${SOURCE_DIR}"/*.md "${TARGET_DIR}/"

printf 'Installed Claude Code commands to %s\n' "${TARGET_DIR}"
