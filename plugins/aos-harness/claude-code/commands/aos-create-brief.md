---
description: Author a new AOS brief through a guided conversation
---

# AOS Create Brief

You are running the AOS Create Brief skill. Load and follow the instructions in:
`plugins/aos-harness/skills/aos-create-brief/SKILL.md`.

The user has invoked `/aos-create-brief`. Begin by asking whether they want to
author a deliberation brief (decision-making) or an execution brief (build/ship),
then conduct the workflow described in the skill.

Use `plugins/aos-harness/scripts/aos_cli.sh brief save` for the final save step.
When you call `aos brief save`, prefer `--from-file <tempfile>` over piping via stdin.
