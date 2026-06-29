# @aos-harness/adapter-shared

Shared base classes and utilities used by every AOS Harness platform adapter (Claude Code, Codex, Gemini, Pi).

Re-exports common types (`AgentRuntime`, `EventBus`, etc.) and provides composition helpers (`composeAdapter`, `BaseEventBus`, `BaseWorkflow`) so each adapter only needs to implement platform-specific runtime logic.

Current shared runtime behavior includes:

- adapter-scoped model resolution
- optional vendor-default model selection
- inline context-file prompt composition for CLIs that no longer accept direct file flags
- session-id persistence for resume-capable adapters

Part of the [AOS Harness](https://aos.engineer) monorepo. Most users install `aos-harness` (the CLI) instead of consuming this package directly.

## Requirements

- Bun ≥ 1.0.0

## License

MIT
