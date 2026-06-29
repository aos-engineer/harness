---
name: aos-create-brief
description: Author an AOS brief by conducting a guided conversation, then validate and save through the harness CLI.
metadata:
  short-description: Author an AOS brief
---

# AOS Create Brief

Use this skill when the user wants to create a brief for an AOS deliberation
(decision-making) or execution (build/ship) run, especially when they have an
idea but don't know the brief format.

## Prerequisites

- The user is inside a project directory (writes default to ./briefs/<slug>/).
- `bun` is on PATH and the AOS harness wrapper is reachable.

Resolve the wrapper path first:

```bash
if [ -x "$HOME/plugins/aos-harness/scripts/aos_cli.sh" ]; then
  AOS_WRAPPER="$HOME/plugins/aos-harness/scripts/aos_cli.sh"
elif REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -x "$REPO_ROOT/plugins/aos-harness/scripts/aos_cli.sh" ]; then
  export AOS_HARNESS_ROOT="${AOS_HARNESS_ROOT:-$REPO_ROOT}"
  AOS_WRAPPER="$REPO_ROOT/plugins/aos-harness/scripts/aos_cli.sh"
else
  echo "aos-harness wrapper not found. Install the plugin or set AOS_HARNESS_ROOT." >&2
  exit 1
fi
```

## Workflow

1. Ask the user whether they are building something (execution) or deciding something (deliberation).
2. Ask for a one-line title and a kebab-case slug.
3. Conduct a conversation gathering each required section. Ask one or two specific questions at a time.
4. Draft clear brief markdown with no filler.
5. Write the draft to a tempfile, then call `aos brief save`:

```bash
"$AOS_WRAPPER" brief save "./briefs/<slug>/brief.md" \
  --kind <kind> --from-file "<tempfile>"
```

Use `--from-file`, not `--from-stdin`; markdown can contain characters that
make shell piping fragile.

6. If validation fails, re-draft only the failing section(s), rewrite the tempfile, and re-run `save`.
7. Report the saved path. Suggest this run command, leaving `<profile>` as a placeholder:

```bash
aos run <profile> --brief ./briefs/<slug>/brief.md
```

## Schema

### Deliberation kind

Required:
- `# Brief: <title>`
- `## Situation` - what is happening, who is involved, what triggered the decision
- `## Stakes` - upside and downside framing
- `## Constraints` - budget, timeline, technical, regulatory
- `## Key Question` - the single decision question for the council

Optional: `## Background`, `## Out of scope`.

### Execution kind

Required:
- `# Brief: <title>`
- `## Feature / Vision` - what we're building and why; alias `## Vision` accepted
- `## Context` - environment, prior art, repo state
- `## Constraints` - non-negotiables
- `## Success Criteria` - how we know we're done

Optional: `## Stakeholders`, `## Out of scope`, `## Open Questions`.

## Guardrails

- Default to writing under the user's current working directory (`./briefs/<slug>/`). Use `--shared` only if the user explicitly wants to commit a brief into the harness samples.
- Never overwrite an existing brief without explicit user confirmation (`--force`).
- Do not invent stakes, constraints, or success criteria the user has not stated. If a required section is genuinely empty, ask one more question.
- Do not pick a profile for the user. Suggest with a placeholder; let them choose.
