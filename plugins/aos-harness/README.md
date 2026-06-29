# AOS Harness Host Installs

This bundle keeps adapters as the runtime boundary and adds thin host-native install surfaces on top.

## Surfaces

- `Codex`: local plugin via [`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) and [`.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json)
- `Claude Code`: project slash-command pack in [`claude-code/commands/`](./claude-code/commands/) for init, list, run, create, validate, replay, and brief authoring
- `Gemini`: extension package via [`.gemini/extension.json`](./.gemini/extension.json) plus [`gemini/install.sh`](./gemini/install.sh)
- `Pi`: extension package via [`adapters/pi/package.json`](../../adapters/pi/package.json), plus `aos init --adapter pi` or `aos setup-pi --global` shim generation

## Runtime Adapters

The host plugin is adapter-neutral. Use `aos init --adapter <name>` and
`aos run ... --adapter <name>` with any supported runtime:

- `pi`
- `claude-code`
- `codex`
- `gemini`

## Shared Wrapper

All host surfaces call:

```bash
plugins/aos-harness/scripts/aos_cli.sh
```

The wrapper resolves the repo root from `AOS_HARNESS_ROOT` first, then from the repo-local checkout. If you install the host plugin outside this repository, set `AOS_HARNESS_ROOT` to the repo root before invoking it.

## Install Package Checklist

- Codex marketplace metadata: `../../.agents/plugins/marketplace.json`
- Codex manifest: `.codex-plugin/plugin.json`
- Claude Code install script: `claude-code/install.sh`
- Gemini install script: `gemini/install.sh`
- Shared CLI wrapper: `scripts/aos_cli.sh`
