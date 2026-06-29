---
name: aos-validate
description: Run the AOS Harness validator through the local CLI wrapper and report passing checks and failures faithfully.
metadata:
  short-description: Validate AOS configs
---

# AOS Validate

Use this skill when the user wants to validate agents, profiles, domains, skills, workflows, and brief compatibility.

## Prerequisites

- Run from an initialized AOS project directory, or from the harness repo to validate bundled resources.
- `bun` must be installed and available on `PATH`.
- The AOS wrapper must be installed at `$HOME/plugins/aos-harness/scripts/aos_cli.sh`, available from the repo-local plugin path, or paired with `AOS_HARNESS_ROOT`.

Resolve the wrapper path before running commands. Prefer the shared home-local install when present:

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

## Command

```bash
"$AOS_WRAPPER" validate
```

## Required Workflow

1. Run the validator without suppressing its exit code.
2. Report the totals and any failures exactly as they appear.
3. Treat a non-zero exit as a real validation failure unless the CLI output itself explains an intentional skip or warning.

## Guardrails

- Do not rewrite the validator output to make the command look successful.
- Preserve the actual exit code.
- Do not assume a globally installed `aos` binary.
