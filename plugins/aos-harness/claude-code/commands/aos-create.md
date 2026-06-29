---
allowed-tools: Bash(plugins/aos-harness/scripts/aos_cli.sh create:*)
argument-hint: agent|profile|domain|skill <name>
description: Scaffold a new AOS agent, profile, domain, or skill
---

Run the shared AOS wrapper to scaffold the requested AOS resource.

Command output:
!`plugins/aos-harness/scripts/aos_cli.sh create $ARGUMENTS`

Report the created path and call out any scaffold TODOs that the user needs to
fill in before running a session.
