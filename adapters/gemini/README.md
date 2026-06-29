# @aos-harness/gemini-adapter

AOS Harness adapter for Google's Gemini CLI. Lets `aos run` execute deliberation and execution profiles through the Gemini runtime instead of generating static artifacts.

## Install

```bash
npm i -g @aos-harness/gemini-adapter
```

Pin the adapter to the same version as the `aos-harness` CLI.

## Model Selection

By default, the Gemini adapter lets Gemini choose its own default model. To pin AOS tiers explicitly, use:

- `.aos/config.yaml` `adapter_defaults.gemini.models`
- legacy `.aos/adapter.yaml` `model_overrides`

If you do not pin a model, AOS does not pass `--model`.

## Notes

- The adapter uses Gemini's current headless CLI surface (`--prompt`, `--output-format stream-json`, `--resume`).
- Account-level Gemini failures are surfaced directly by the adapter; AOS no longer masks them behind stale CLI argument errors.

## License

MIT
