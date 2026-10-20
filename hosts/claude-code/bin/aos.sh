#!/bin/sh
# Runs one of the plugin's entry points under Bun: the hook entry for every hook event, the MCP server for
# the plugin's MCP registration. The entry points are bundled into dist/, so an installed plugin needs
# nothing but Bun.
#
# When Bun is missing, AOS steps aside instead of failing. The Bash hook is registered to fail closed, so a
# failing launcher would block every Bash call, in every session, with or without an AOS run. Instead hooks
# pass through, SessionStart tells the model that AOS is off and why, and the MCP server exits with the reason.
#
# Usage: aos.sh hook <event>   |   aos.sh mcp
# Set AOS_PLUGIN_SOURCE=1 to run the TypeScript sources in bin/ instead of dist/ (a source checkout only).

root=$(cd "$(dirname "$0")/.." && pwd)
kind=$1
[ "$#" -gt 0 ] && shift

case "$kind" in
  hook) entry=aos-hook ;;
  mcp) entry=aos-mcp ;;
  *)
    echo "aos.sh: unknown entry point: $kind" >&2
    exit 0
    ;;
esac

if command -v bun >/dev/null 2>&1; then
  if [ "${AOS_PLUGIN_SOURCE:-}" = 1 ]; then
    exec bun "$root/bin/$entry.ts" "$@"
  fi
  exec bun "$root/dist/$entry.js" "$@"
fi

if [ "$kind" = mcp ]; then
  echo "AOS needs Bun (https://bun.sh) on PATH; the AOS MCP server cannot start without it." >&2
  exit 1
fi

# Drain the payload so Claude Code never sees a broken pipe.
cat >/dev/null
if [ "${1:-}" = session-start ]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"AOS is installed but Bun is not on PATH, so AOS gates are off in this session. Tell the user: install Bun (https://bun.sh), then restart Claude Code."}}'
fi
exit 0
