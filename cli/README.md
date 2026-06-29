# aos-harness

**Agentic Orchestration System** — Assemble specialized AI agents into deliberation and execution teams.

> **Breaking change in 0.6.0:** `aos-harness` no longer bundles adapter code. You must install the adapter(s) for the AI CLI(s) you want to use as separate packages. If you upgrade from 0.5.x and run `aos run` without the matching `@aos-harness/<name>-adapter` installed, the CLI will print an install hint and exit. See [CHANGELOG](../CHANGELOG.md#060) for the full migration note.

## Prerequisites

- [Bun](https://bun.sh) 1.0+

## Getting Started

### 1. Install the CLI

```bash
bun add -g aos-harness
# or: npm i -g aos-harness
```

Or install it into the current project:

```bash
bun add aos-harness
# or: npm install aos-harness
```

### 2. Install an adapter

Install the vendor CLI you want to drive first, then install the matching AOS adapter package. The adapter is the AOS integration layer on top of the vendor CLI:

- `claude` + `@aos-harness/claude-code-adapter`
- `codex` + `@aos-harness/codex-adapter`
- `gemini` + `@aos-harness/gemini-adapter`
- `pi` + `@aos-harness/pi-adapter`

Pick the AI CLI you'll drive agents with and install the matching adapter. You can install more than one. Versions are lockstep — pin the adapter to the same version as the CLI.

```bash
bun add -g @aos-harness/claude-code-adapter   # Anthropic's Claude Code
bun add -g @aos-harness/gemini-adapter         # Google's Gemini CLI
bun add -g @aos-harness/codex-adapter          # OpenAI's Codex CLI
bun add -g @aos-harness/pi-adapter             # Pi (https://pi.dev)
```

Project-local adapter install also works:

```bash
bun add @aos-harness/codex-adapter
# or: npm install @aos-harness/codex-adapter
```

For Pi, `aos init --adapter pi` also writes `.pi/extensions/aos-harness.ts` so opening `pi` in the project makes `/aos-run` available. To install that shim once for every AOS project:

```bash
aos setup-pi --global
```

### 3. Initialize and run

```bash
# Initialize a project (writes .aos/ and copies core/ into the project)
aos init
# local install via Bun
bunx aos init
# local install via npm
npx aos init

# Or scan only in CI / automation
aos init --non-interactive

# Or install missing adapter packages after config generation
aos init --apply

# Make /aos-run available in Pi across all AOS projects
aos setup-pi --global

# Run a strategic deliberation
aos run strategic-council --brief brief.md

# Run a CTO execution workflow
aos run cto-execution --brief feature-brief.md --domain saas

# List available agents, profiles, and domains
aos list

# Create custom configs
aos create agent my-analyst
aos create profile my-review

# Validate all configurations
aos validate
```

### Adapter Model Selection

`aos run` resolves model settings in this order:

1. adapter-scoped settings in `.aos/config.yaml` `adapter_defaults`
2. legacy `.aos/adapter.yaml`
3. `AOS_MODEL_ECONOMY` / `AOS_MODEL_STANDARD` / `AOS_MODEL_PREMIUM`
4. adapter defaults

Default behavior:

- `pi` pins explicit tier models by default
- `codex`, `claude-code`, and `gemini` let the vendor CLI choose its default model unless you set explicit tier models

Example:

```yaml
api_version: aos/config/v2
adapters:
  enabled: [codex, pi]
  default: codex
adapter_defaults:
  codex:
    use_vendor_default_model: true
  pi:
    use_vendor_default_model: false
    models:
      economy: anthropic/claude-haiku-4-5
      standard: anthropic/claude-sonnet-4-6
      premium: anthropic/claude-opus-4-7
```

Claude Code note:

- `aos init` now checks `claude auth status --json`.
- If Claude Code is being forced through `ANTHROPIC_API_KEY`, the readiness scan will tell you. If sessions fail with `Invalid API key`, unset or refresh that key, or switch back to `claude login` auth.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Uncaught runtime error |
| 2 | Invalid input (unknown adapter, bad path, bad URL, missing adapter package) |
| 3 | Validation failure that requires user action (`aos init --non-interactive --adapter ...` selected adapter not ready, or profile tool-policy widening failure) |

## What It Does

AOS Harness orchestrates multiple AI agents with distinct cognitive biases into structured deliberation and execution sessions:

- **Deliberation** — Agents debate a strategic question. An Arbiter synthesizes ranked recommendations with documented dissent.
- **Execution** — A CTO orchestrator delegates production work through multi-phase workflows with review gates.

Ships with 13 agent personas, 6 orchestration profiles, 5 domain packs, and full constraint management (time, budget, rounds).

## Documentation

- [Full documentation](https://aos.engineer/docs/getting-started)
- [GitHub repository](https://github.com/aos-engineer/aos-harness)

## License

MIT
