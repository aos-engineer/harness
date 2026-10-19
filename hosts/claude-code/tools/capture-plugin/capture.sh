#!/bin/sh
# Saves one hook payload verbatim. It always exits 0: a non-zero exit (2 under dash for an unset
# variable) would make Claude Code block the tool, and capture must never change the session.
dir="${AOS_CAPTURE_DIR:-}"
if [ -z "$dir" ]; then
  echo "aos-capture: AOS_CAPTURE_DIR is not set; payload dropped" >&2
  cat > /dev/null
  exit 0
fi
cat > "$dir/$(date +%s)-$$-$1.json"
exit 0
