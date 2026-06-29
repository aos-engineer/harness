---
allowed-tools: Bash(plugins/aos-harness/scripts/aos_cli.sh validate:*)
description: Validate AOS agents, profiles, domains, skills, workflows, and briefs
---

Run the shared AOS validator and report the actual result.

Command output:
!`plugins/aos-harness/scripts/aos_cli.sh validate`

Preserve the validator's exit status in the summary. If validation fails, list
the failing resource paths and messages exactly enough for the user to fix them.
