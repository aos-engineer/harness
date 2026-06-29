---
name: aos-run-execution
description: Run AOS execution profiles such as `cto-execution` through the local CLI wrapper.
metadata:
  short-description: Run AOS execution profiles
---

# AOS Run Execution

Use this skill when the user wants an execution package rather than a deliberation memo.

## Prerequisites

- Run from an initialized AOS project directory, or from the harness repo when using bundled sample briefs.
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

## Required Inputs

- `profile`: required execution profile, currently `cto-execution`
- `brief`: required brief path
- `adapter`: optional runtime adapter: `pi`, `claude-code`, `codex`, or `gemini`
- `workflow-dir`: optional override for non-default workflow locations

## Workflow

1. Confirm that the requested profile is an execution profile.
2. Confirm the brief path exists before launching.
3. Add `--adapter <name>` when the user asks for a specific runtime; otherwise let `.aos/config.yaml` choose the default.
4. Run the wrapper command with the profile and brief.
5. Summarize the result and point the user to the generated output path when available.

## Commands

Sample execution run:

```bash
"$AOS_WRAPPER" run cto-execution --brief core/briefs/sample-cto-execution/brief.md
```

With a specific adapter:

```bash
"$AOS_WRAPPER" run cto-execution --brief core/briefs/sample-cto-execution/brief.md --adapter claude-code
```

With a workflow override:

```bash
"$AOS_WRAPPER" run cto-execution --brief path/to/brief.md --workflow-dir core/workflows
```

## Guardrails

- Execution profiles may prompt for review gates during a real run. Do not claim the flow is fully non-interactive.
- If the user only wants to validate configuration, use the deliberation skill with `--dry-run` or the validate skill instead.
