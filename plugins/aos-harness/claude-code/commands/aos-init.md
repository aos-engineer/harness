---
allowed-tools: Bash(plugins/aos-harness/scripts/aos_cli.sh init:*)
argument-hint: [--adapter pi|claude-code|codex|gemini|comma-list] [--apply] [--force]
description: Initialize an AOS project with one or more adapters
---

Run the shared AOS wrapper to initialize or update the current project.

Command output:
!`plugins/aos-harness/scripts/aos_cli.sh init $ARGUMENTS`

Summarize the created `.aos/config.yaml`, enabled adapters, default adapter,
and any install/login next steps from the CLI output.
