# @aos-harness/codex-adapter

AOS Harness adapter for OpenAI's [Codex CLI](https://github.com/openai/codex). Lets you run AOS deliberation and execution profiles with Codex as the underlying agent runtime.

Part of the [AOS Harness](https://aos.engineer) monorepo. Adapters are versioned and installed separately from the `aos-harness` CLI; pin this package to the same version as the CLI.

## Requirements

- Bun ≥ 1.0.0
- Codex CLI installed and authenticated on the host

## Model Selection

By default, the Codex adapter lets the Codex CLI choose its own default model. If you want to pin AOS tiers explicitly, use either:

- `.aos/config.yaml` `adapter_defaults.codex.models`
- legacy `.aos/adapter.yaml` `model_overrides`

If you do not pin a model, AOS does not pass `--model`.

## Host Surface

The Codex-native install surface in this repo lives under [plugins/aos-harness](../../plugins/aos-harness/). That plugin wraps the shared CLI and launches this adapter; it does not replace the adapter layer.

## License

MIT
