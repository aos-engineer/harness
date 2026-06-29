---
allowed-tools: Bash(plugins/aos-harness/scripts/aos_cli.sh run:*)
argument-hint: <profile> --brief <path> [--domain <name>] [--dry-run]
description: Run an AOS deliberation profile through the shared wrapper
---

Run the requested deliberation session through the shared wrapper.

Command output:
!`plugins/aos-harness/scripts/aos_cli.sh run $ARGUMENTS`

Summarize the run, call out errors directly, and tell the user where the session artifacts were written.
