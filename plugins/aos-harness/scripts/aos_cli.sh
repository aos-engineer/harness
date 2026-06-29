#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# Optional opt-in default checkout for hosts that install the plugin outside a
# repo. Empty by default — never bake in a machine-specific path (it wouldn't
# resolve elsewhere and would leak the author's home dir in a shipped plugin).
DEFAULT_HARNESS_ROOT="${AOS_DEFAULT_HARNESS_ROOT:-}"

is_harness_root() {
  [ -f "$1/cli/src/index.ts" ] && [ -f "$1/package.json" ]
}

find_harness_root_from() {
  local dir="$1"
  while [ "$dir" != "/" ]; do
    if is_harness_root "$dir"; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

resolve_harness_root() {
  if [ -n "${AOS_HARNESS_ROOT:-}" ]; then
    if ! is_harness_root "${AOS_HARNESS_ROOT}"; then
      echo "AOS_HARNESS_ROOT does not contain cli/src/index.ts: ${AOS_HARNESS_ROOT}" >&2
      return 1
    fi
    printf '%s\n' "${AOS_HARNESS_ROOT}"
    return 0
  fi

  local repo_local_root
  repo_local_root="$(cd -- "${PLUGIN_ROOT}/../.." && pwd)"
  if is_harness_root "${repo_local_root}"; then
    printf '%s\n' "${repo_local_root}"
    return 0
  fi

  if find_harness_root_from "$PWD"; then
    return 0
  fi

  if [ -n "${DEFAULT_HARNESS_ROOT}" ] && is_harness_root "${DEFAULT_HARNESS_ROOT}"; then
    printf '%s\n' "${DEFAULT_HARNESS_ROOT}"
    return 0
  fi

  return 1
}

if ! command -v bun >/dev/null 2>&1; then
  echo "aos-harness requires Bun on PATH." >&2
  echo "Install Bun from https://bun.sh and retry." >&2
  exit 127
fi

if REPO_ROOT="$(resolve_harness_root)"; then
  cd "${REPO_ROOT}"
  exec bun run cli/src/index.ts "$@"
fi

if command -v aos >/dev/null 2>&1; then
  exec aos "$@"
fi

echo "Unable to locate an AOS Harness checkout or global aos binary." >&2
echo "Set AOS_HARNESS_ROOT to a directory containing cli/src/index.ts." >&2
exit 1
