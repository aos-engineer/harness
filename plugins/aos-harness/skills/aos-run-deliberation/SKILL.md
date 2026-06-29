---
name: aos-run-deliberation
description: Run AOS deliberation profiles such as `strategic-council`, optionally with a domain and `--dry-run`, through the local CLI wrapper.
metadata:
  short-description: Run AOS deliberation profiles
---

# AOS Run Deliberation

Use this skill when the user wants to run a deliberation profile and get a memo-oriented result.

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

- `profile`: required deliberation profile such as `strategic-council`, `incident-response`, `delivery-ops`, `architecture-review`, or `security-review`
- `brief`: brief path, usually under `core/briefs/` or a user-provided path
- `domain`: optional domain such as `saas`, `fintech`, `healthcare`, `platform-engineering`, or `personal-decisions`
- `adapter`: optional runtime adapter: `pi`, `claude-code`, `codex`, or `gemini`
- `dry-run`: optional, preferred when the user is exploring or validating setup

## Recommended Workflow

1. Confirm the brief path exists.
2. Prefer `--dry-run` when the user is exploring, validating, or troubleshooting.
3. Add `--adapter <name>` when the user asks for a specific runtime; otherwise let `.aos/config.yaml` choose the default.
4. Add `--domain <name>` only when requested or clearly useful.
5. Run the wrapper command and return the CLI output summary.

## Commands

Dry-run example:

```bash
"$AOS_WRAPPER" run strategic-council --brief core/briefs/sample-product-decision/brief.md --dry-run
```

Run with a domain:

```bash
"$AOS_WRAPPER" run strategic-council --brief core/briefs/sample-product-decision/brief.md --domain saas
```

Run with a specific adapter:

```bash
"$AOS_WRAPPER" run strategic-council --brief core/briefs/sample-product-decision/brief.md --adapter codex --dry-run
```

Another deliberation profile:

```bash
"$AOS_WRAPPER" run security-review --brief path/to/brief.md --dry-run
```

## Guardrails

- Do not use this skill for execution profiles such as `cto-execution`; use `aos-run-execution` instead.
- If the user omits a brief, expect the CLI to prompt interactively; prefer passing `--brief` in automation and scripted runs.
