# @aos-harness/claude-code-adapter

AOS Harness adapter for Anthropic's Claude Code runtime.

## What It Does

This is a runtime adapter, not a static generator. It lets `aos run` execute both:

- deliberation profiles through the arbiter bridge
- execution profiles through the workflow runner

It also emits transcript events to the local JSONL transcript and, when configured, to the live platform event endpoint.

## Install

```bash
npm i -g @aos-harness/claude-code-adapter
```

Pin the adapter to the same version as the `aos-harness` CLI.

## Model Selection

By default, the Claude Code adapter lets Claude choose its own default model. To pin tiers explicitly, use:

- `.aos/config.yaml` `adapter_defaults.claude-code.models`
- legacy `.aos/adapter.yaml` `model_overrides`

If you do not pin a model, AOS does not pass `--model`.

## Auth Note

Readiness checks now use `claude auth status --json`.

If Claude Code is running through `ANTHROPIC_API_KEY`, AOS surfaces that in readiness hints. If runs fail with `Invalid API key`, unset or refresh `ANTHROPIC_API_KEY`, or switch back to `claude login` auth.

## Host Surface

Claude Code does not currently use the Codex-style plugin marketplace flow here. The host-native install surface in this repo is the reusable command pack under [plugins/aos-harness/claude-code](../../plugins/aos-harness/claude-code/), which installs project slash commands on top of this adapter/runtime layer.
