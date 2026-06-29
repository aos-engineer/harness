# Full Adapter Implementations Design

**Date:** 2026-04-11
**Status:** Draft
**Author:** Segun Kolade + Claude

## Overview

Replace the partial generator-only adapters (Claude Code, Gemini) and add a new adapter (Codex) so that 4 CLI platforms have full runtime adapter implementations. The Pi adapter — currently the only full implementation — is refactored to share a common base with the new adapters.

OpenCode is deferred to a follow-up spec pending CLI investigation.

## Goals

1. Full runtime adapters for Claude Code, Gemini, and Codex
2. Shared base classes to eliminate duplication (~70% code reuse)
3. Dynamic model discovery — no hardcoded model mappings that go stale
4. Capability-driven — each adapter implements what its CLI supports, `UnsupportedError` for the rest
5. Replace the existing Claude Code and Gemini generators (no dual generator+runtime)

## Non-Goals

- API-direct adapters (bypassing CLI tools) — we rely on CLI read/write/tool capabilities
- Custom UI frameworks per adapter — all non-Pi adapters share a terminal-based UI
- Headless/CI mode — out of scope for this spec
- OpenCode adapter — deferred pending CLI investigation spike (separate spec)

---

## Architecture

### Approach: Shared Base Classes + CLI-Specific Overrides

Each adapter extends shared base classes and overrides only what's CLI-specific. The split:

| Layer | Shared (Base Class) | CLI-Specific (Override) |
|-------|-------------------|------------------------|
| **AgentRuntime (L1)** | Subprocess lifecycle, retry with backoff, abort/timeout, session file management, handle tracking, orphan process protection | CLI binary + args, JSON event parsing, stdout format handling, model discovery, auth mode, pricing |
| **EventBus (L2)** | 100% shared — handler storage + sequential async dispatch | Only `wire()` for Pi's native event system |
| **UI (L3)** | `TerminalUI` — ANSI rendering, readline prompts, command registry | Pi keeps its TUI integration (`PiUI`) |
| **Workflow (L4)** | 100% shared — `dispatchParallel`, file I/O, state persistence, git worktrees, artifacts, `executeCode`, `invokeSkill` | Nothing — workflow is CLI-agnostic |

### Package Structure

```
adapters/
  shared/                     # @aos-harness/adapter-shared
    src/
      base-agent-runtime.ts   # Abstract base class (subprocess lifecycle)
      base-event-bus.ts       # Concrete shared class (handler storage + dispatch)
      terminal-ui.ts          # Concrete shared class (ANSI + readline)
      base-workflow.ts        # Concrete shared class (file I/O, git, artifacts)
      types.ts                # ParsedEvent, ModelInfo, StdoutFormat types
      compose.ts              # composeAdapter() helper
    package.json

  pi/                         # Refactored to extend shared bases
    src/
      agent-runtime.ts        # PiAgentRuntime extends BaseAgentRuntime
      event-bus.ts             # PiEventBus extends BaseEventBus (adds wire())
      ui.ts                   # PiUI (keeps Pi TUI integration)
      workflow.ts             # Step 1: extends BaseWorkflow with zero overrides
                              # Step 2: deleted once tests confirm equivalence
      index.ts                # Entry point
    package.json

  claude-code/                # Replaces current generator
    src/
      agent-runtime.ts        # ClaudeCodeAgentRuntime extends BaseAgentRuntime
      index.ts                # Entry point + adapter composition
    package.json

  gemini/                     # Replaces current generator
    src/
      agent-runtime.ts        # GeminiAgentRuntime extends BaseAgentRuntime
      index.ts
    package.json

  codex/                      # New adapter
    src/
      agent-runtime.ts        # CodexAgentRuntime extends BaseAgentRuntime
      index.ts
    package.json
```

Each new adapter is essentially **one file of real logic** (`agent-runtime.ts`) plus a small entry point. Everything else comes from `shared/`.

---

## Detailed Design

### 1. BaseAgentRuntime (Abstract)

The base class handles the universal subprocess pattern:

**Concrete methods (shared):**
- `spawnAgent(config, sessionId)` — creates session directory, registers `HandleState`
- `sendMessage(handle, message, opts)` — orchestrates subprocess lifecycle: spawn process, buffer stdout via format-aware reader, delegate to `parseEventLine()`, handle timeout/abort, fire event bus handlers
- `sendMessageWithRetry(handle, message, opts, maxRetries, backoff, timeoutMs)` — retry wrapper with exponential/linear backoff
- `destroyAgent(handle)` — cleans up handle state
- `abort()` — kills all active processes (SIGTERM then SIGKILL after 5s)
- `injectContext(handle, files)` — stores context file paths in handle state
- `setModel(handle, modelConfig)` — updates model config in handle state
- `setOrchestratorPrompt(prompt)` — stores orchestrator prompt
- `getContextUsage(handle)` — returns last known token count and estimated percentage
- `resolveModelId(tier)` — checks user overrides, then env vars, then adapter defaults

**Abstract methods (CLI-specific):**
```typescript
abstract cliBinary(): string;
abstract stdoutFormat(): StdoutFormat;  // "ndjson" | "sse" | "chunked-json"
abstract buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[];
abstract parseEventLine(line: string): ParsedEvent | null;
abstract buildSubprocessEnv(): Record<string, string>;
abstract discoverModels(): Promise<ModelInfo[]>;
abstract defaultModelMap(): Record<ModelTier, string>;
abstract getAuthMode(): AuthMode;
abstract getModelCost(tier: ModelTier): ModelCost;
```

**Sub-agent support:**
- `spawnSubAgent(parentId, config, sessionId)` — delegates to `spawnAgent()` with parent tracking
- `destroySubAgent(parentId, childId)` — delegates to `destroyAgent()`

**Orphan process protection:**

Child CLI processes must not outlive the parent AOS process. The base class uses:
- `detached: false` (default) when spawning subprocesses — child inherits parent's process group
- A `beforeExit` / `SIGTERM` handler that calls `abort()` to kill all tracked active processes
- On Linux: `prctl(PR_SET_PDEATHSIG, SIGKILL)` via spawn options if available
- On macOS/Windows: the `beforeExit` handler is the primary mechanism; orphans are possible only if the parent receives `SIGKILL` (unavoidable)

The `activeProcesses` set already tracks all spawned subprocesses. The cleanup handler iterates and kills them.

### 2. Stdout Format Handling

Different CLIs emit structured output in different formats. The base class includes a format-aware stdout reader that normalizes raw output into discrete event strings before passing to `parseEventLine()`:

```typescript
type StdoutFormat = "ndjson" | "sse" | "chunked-json";
```

| Format | Description | Buffering Strategy |
|--------|-------------|-------------------|
| `ndjson` | One JSON object per line (newline-delimited) | Split on `\n`, pass each line to `parseEventLine()` |
| `sse` | Server-Sent Events (`data: {...}\n\n`) | Buffer until `\n\n`, strip `data: ` prefix, pass JSON to `parseEventLine()` |
| `chunked-json` | Multi-line JSON objects separated by blank lines or delimiters | Buffer lines until a complete JSON object is detected (brace matching), then pass to `parseEventLine()` |

Each adapter declares its format via `stdoutFormat()`. The base class selects the appropriate buffering strategy before calling `parseEventLine()`.

**Confirmed output formats per CLI:**

| CLI | Format | Confirmed |
|-----|--------|-----------|
| Pi (`pi --mode json`) | `ndjson` | Yes — verified in current Pi adapter |
| Claude Code (`claude -p --output-format json`) | `ndjson` | Yes — one JSON object per stdout line |
| Gemini (`gemini` CLI) | `ndjson` | Needs verification during implementation |
| Codex (`codex` CLI) | `ndjson` | Needs verification during implementation |

If Gemini or Codex turns out to use a different format, the adapter overrides `stdoutFormat()` accordingly. The buffering infrastructure is ready regardless.

### 3. ParsedEvent Normalization

Each CLI emits different JSON, but they all convey the same concepts. The base class processes a normalized union:

```typescript
type ParsedEvent =
  | { type: "text_delta"; text: string }
  | { type: "message_end"; text: string; tokensIn: number; tokensOut: number; cost: number; contextTokens: number; model: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; input: unknown; result: unknown }
  | { type: "ignored" }
```

Each adapter's `parseEventLine()` maps from its CLI's native JSON to this common shape. The base class accumulates text deltas, fires `onStream` callbacks, extracts final response data from `message_end`, and fires event bus handlers for `tool_call` and `tool_result`.

### 4. BaseEventBus (Concrete)

Identical to current `PiEventBus` minus the `wire()` method. Stores 8 handler callbacks and exposes `fire*()` methods for the base agent runtime to call during JSON stream processing:

```typescript
class BaseEventBus implements EventBusAdapter {
  // 8 on*() registration methods (identical to PiEventBus)
  // + fire methods called by BaseAgentRuntime:
  fireSessionStart(): Promise<void>
  fireSessionShutdown(): Promise<void>
  fireBeforeAgentStart(prompt: string): Promise<{ systemPrompt?: string }>
  fireAgentEnd(): Promise<void>
  fireToolCall(toolName: string, input: unknown): Promise<{ block?: boolean }>
  fireToolResult(toolName: string, input: unknown, result: unknown): Promise<void>
  fireMessageEnd(usage: { cost: number; tokens: number }): Promise<void>
  fireCompaction(): Promise<void>
}
```

**Sequential async dispatch:** All `fire*()` methods `await` their handler before returning. This guarantees that downstream consumers (constraint engine, cost tracker, domain enforcer) see events in the same order they were emitted, regardless of whether events come from Pi's native event system or from stdout parsing. No event is fired until the previous one's handler has resolved.

`PiEventBus` extends `BaseEventBus` and adds `wire(pi: ExtensionAPI)` to bridge Pi's native event system.

**Known behavioral difference:** Pi fires events when its host processes them (potentially batched or reordered by the extension framework). All other adapters fire events as stdout lines arrive (streaming, strictly ordered). The sequential dispatch guarantee applies within a single adapter — it does not guarantee cross-adapter parity with Pi's event timing. If Pi's host batches events differently, consumers must be tolerant of minor timing variations. This is documented but not mitigated, since Pi's event system is outside our control.

### 5. TerminalUI (Concrete)

Shared terminal-native UI for all non-Pi adapters:

- **Rendering:** ANSI-colored `console.log`. Agent responses get a colored header bar using raw escape codes.
- **Prompts:** `readline`-based `promptSelect()`, `promptConfirm()`, `promptInput()`.
- **Commands:** `Map<string, handler>` with `/command` dispatch.
- **Tools:** `Map<string, { schema, handler }>` in-process registry.
- **Widgets/Footer/Status:** `console.log` status lines.
- **Notifications:** Level-prefixed output (`[INFO]`, `[WARN]`, `[ERROR]`).
- **Input blocking:** State flag checked by command dispatch.
- **Steer messages:** Queued for next user turn.

### 6. BaseWorkflow (Concrete)

Extracted from current `PiWorkflow` with no changes to logic:

- `dispatchParallel()` — `Promise.allSettled` across agent handles
- `isolateWorkspace()` — git worktree create/cleanup
- `writeFile()`, `readFile()` — with path validation
- `openInEditor()` — with editor allowlist
- `persistState()`, `loadState()` — JSON to `.aos/state/`
- `createArtifact()`, `loadArtifact()` — YAML manifest + content
- `submitForReview()` — sends artifact to reviewer agent
- `executeCode()` — subprocess execution (bash/ts/python/js)
- `invokeSkill()` — loads skill YAML, sends prompt to agent

### 7. composeAdapter()

Shared helper using an explicit typed object literal:

```typescript
function composeAdapter(
  agentRuntime: AgentRuntimeAdapter,
  eventBus: EventBusAdapter,
  ui: UIAdapter,
  workflow: WorkflowAdapter,
): AOSAdapter {
  const adapter: AOSAdapter = {
    // AgentRuntimeAdapter
    spawnAgent: agentRuntime.spawnAgent.bind(agentRuntime),
    sendMessage: agentRuntime.sendMessage.bind(agentRuntime),
    destroyAgent: agentRuntime.destroyAgent.bind(agentRuntime),
    // ... all 13 AgentRuntimeAdapter methods
    // EventBusAdapter
    onSessionStart: eventBus.onSessionStart.bind(eventBus),
    // ... all 8 EventBusAdapter methods
    // UIAdapter
    registerCommand: ui.registerCommand.bind(ui),
    // ... all 17 UIAdapter methods
    // WorkflowAdapter
    dispatchParallel: workflow.dispatchParallel.bind(workflow),
    // ... all 14 WorkflowAdapter methods
  };
  return adapter;
}
```

TypeScript enforces that the result satisfies `AOSAdapter`. If two layers define a method with the same name, the compiler errors instead of silently overwriting. All adapter entry points use this instead of `Object.assign`.

---

## Per-Adapter CLI Specifics

### Claude Code (`claude` CLI)

| Method | Implementation |
|--------|---------------|
| `cliBinary()` | `"claude"` |
| `stdoutFormat()` | `"ndjson"` |
| `buildArgs()` | `--print`, `--output-format json`, `--model <id>`, `--system-prompt <prompt>`, `--resume <session-id>` |
| `parseEventLine()` | Parse `type: "assistant"` messages, `content[].type: "text"`, `message.usage` |
| `buildSubprocessEnv()` | Allowlist includes `ANTHROPIC_API_KEY` |
| `discoverModels()` | Runs `claude model list --json`. On failure: returns `defaultModelMap()` entries and logs warning |
| `defaultModelMap()` | `economy: "claude-haiku-4-5"`, `standard: "claude-sonnet-4-6"`, `premium: "claude-opus-4-6"` |
| `getAuthMode()` | Check `ANTHROPIC_API_KEY` env var |
| `getModelCost()` | Anthropic pricing (haiku/sonnet/opus tiers) |

### Gemini (`gemini` CLI)

| Method | Implementation |
|--------|---------------|
| `cliBinary()` | `"gemini"` |
| `stdoutFormat()` | `"ndjson"` (to be verified; adapter overrides if different) |
| `buildArgs()` | `--json`, `--model <id>`, `--system-instruction <prompt>`, session flags |
| `parseEventLine()` | Parse `candidates[].content.parts[].text`, `usageMetadata` |
| `buildSubprocessEnv()` | Allowlist includes `GOOGLE_API_KEY`, `GEMINI_API_KEY` |
| `discoverModels()` | Runs `gemini model list --json` or equivalent. On failure: returns `defaultModelMap()` entries and logs warning |
| `defaultModelMap()` | `economy: "gemini-2.0-flash"`, `standard: "gemini-2.5-pro"`, `premium: "gemini-2.5-pro"` |
| `getAuthMode()` | Check `GOOGLE_API_KEY` / `GEMINI_API_KEY` |
| `getModelCost()` | Google pricing (flash/pro tiers) |

### Codex (`codex` CLI)

| Method | Implementation |
|--------|---------------|
| `cliBinary()` | `"codex"` |
| `stdoutFormat()` | `"ndjson"` (to be verified; adapter overrides if different) |
| `buildArgs()` | `--json`, `--model <id>`, `--system-prompt <prompt>`, `--full-auto` |
| `parseEventLine()` | Parse OpenAI-style event stream |
| `buildSubprocessEnv()` | Allowlist includes `OPENAI_API_KEY` |
| `discoverModels()` | Runs `codex model list --json` or equivalent. On failure: returns `defaultModelMap()` entries and logs warning |
| `defaultModelMap()` | `economy: "o4-mini"`, `standard: "o3"`, `premium: "o3"` |
| `getAuthMode()` | Check `OPENAI_API_KEY` |
| `getModelCost()` | OpenAI pricing |

---

## Model Discovery

Each adapter implements `discoverModels()` which shells out to the CLI:

```typescript
interface ModelInfo {
  id: string;           // e.g. "claude-sonnet-4-6"
  name: string;         // human-readable display name
  contextWindow: number;
  provider: string;     // "anthropic", "google", "openai", etc.
}
```

**Resolution order for `resolveModelId(tier)`:**
1. User's `model_overrides` from adapter config (explicit pin)
2. Environment variables (`AOS_MODEL_ECONOMY`, `AOS_MODEL_STANDARD`, `AOS_MODEL_PREMIUM`)
3. Adapter's `defaultModelMap()` (hardcoded fallback)

**Failure handling for `discoverModels()`:**
If the CLI command fails (binary not found, non-zero exit, unparseable output), `discoverModels()` returns entries derived from `defaultModelMap()` and logs a warning: `"Model discovery failed for <cli>: <error>. Using default models."` This ensures the adapter is always functional even if the CLI doesn't support model listing.

`discoverModels()` is called lazily on first use and cached for the session. Exposed as a `/models` command so users can see what's available.

---

## Adapter Configuration

### Config File Location

Adapter configuration lives in `.aos/adapter.yaml` at the project root. This file is optional — adapters work with sensible defaults if it's absent.

### Full Schema

```yaml
# .aos/adapter.yaml
schema: aos/adapter-config/v1
platform: claude-code           # Required: pi | claude-code | gemini | codex | custom

model_overrides:                # Optional: pin specific model IDs per tier
  economy: claude-haiku-4-5
  standard: claude-sonnet-4-6
  premium: claude-opus-4-6

theme: dark                     # Optional: UI theme name
editor: code                    # Optional: preferred editor for openInEditor()
```

### Schema Changes to `adapter.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "aos/adapter-config/v1",
  "title": "AOS Adapter Configuration",
  "type": "object",
  "required": ["platform"],
  "properties": {
    "platform": { "enum": ["pi", "claude-code", "gemini", "codex", "custom"] },
    "model_overrides": {
      "type": "object",
      "description": "Optional per-tier model ID overrides. Falls back to discoverModels() / defaultModelMap() if not set.",
      "properties": {
        "economy": { "type": "string" },
        "standard": { "type": "string" },
        "premium": { "type": "string" }
      }
    },
    "theme": { "type": "string" },
    "editor": { "type": "string" }
  }
}
```

The old `model_map` field is replaced by `model_overrides` — same shape but different semantics (optional override vs required mapping).

### How Adapters Read Config

Each adapter's entry point reads `.aos/adapter.yaml` (if present), validates against the schema, and passes `model_overrides` to the `BaseAgentRuntime` constructor. The base class stores them for use in `resolveModelId()`.

---

## Pi Adapter Refactor

The Pi adapter is refactored in two steps to minimize risk:

### Step 1: Extract and Extend

- **`BaseWorkflow`** is extracted from `PiWorkflow` into `adapters/shared/`
- **`PiWorkflow`** is rewritten to extend `BaseWorkflow` with zero overrides (empty subclass)
- **`PiAgentRuntime`** extends `BaseAgentRuntime`, overrides CLI-specific methods
- **`PiEventBus`** extends `BaseEventBus`, adds `wire(pi: ExtensionAPI)`
- **`PiUI`** — unchanged
- **`index.ts`** — updated to use `composeAdapter()` helper
- **All existing Pi tests must pass** before proceeding to Step 2

### Step 2: Delete Empty Subclass

- **`PiWorkflow`** is deleted — `index.ts` uses `BaseWorkflow` directly
- Verify tests still pass after deletion

This two-step approach ensures that if `BaseWorkflow` has any subtle behavioral difference from `PiWorkflow` (e.g., import paths, implicit state), Step 1 catches it before Step 2 removes the safety net.

---

## Event Bus Wiring

**Pi adapter:** Events are fired by Pi's native event system via `wire()`. The `BaseAgentRuntime` does not fire events — Pi's host handles it.

**All other adapters:** Events are fired by `BaseAgentRuntime` during JSON stream processing. When `parseEventLine()` returns a `tool_call` event, the base class calls `eventBus.fireToolCall()`. When it returns `message_end`, it calls `eventBus.fireMessageEnd()`. The event bus is driven by the subprocess output rather than a host extension API.

**Sequential dispatch guarantee:** `BaseEventBus.fire*()` methods use a sequential async queue — each event handler must resolve before the next event is dispatched. This ensures downstream consumers (constraint engine, cost tracker, domain enforcer) see events in a deterministic order.

**Known behavioral difference:** Pi fires events when its host processes them (potentially batched or reordered by the extension framework). All other adapters fire events as stdout lines arrive (streaming, strictly ordered by arrival). The sequential dispatch guarantee applies within a single adapter — it does not guarantee identical timing with Pi's event delivery. If this causes issues, the mitigation path is adding a reordering buffer to `PiEventBus.wire()`, but this is deferred unless a concrete bug surfaces.

---

## Testing Strategy

- **Unit tests for shared base classes** — mock subprocess spawning, verify retry/abort/timeout logic, test event normalization, test stdout format buffering (ndjson, sse, chunked-json)
- **Unit tests per adapter** — verify `buildArgs()` produces correct CLI flags, verify `parseEventLine()` correctly normalizes sample JSON from each CLI
- **Integration tests** — spawn each CLI in JSON mode, send a simple prompt, verify round-trip through the adapter (requires CLI to be installed)
- **Pi regression tests** — run full existing Pi test suite after Step 1 and Step 2 of refactor
- **Mock adapter** — existing `runtime/tests/mock-adapter.ts` stays as-is for engine-level tests

---

## Implementation Order

1. **`adapters/shared/`** — base classes, types, compose helper, stdout format buffering
2. **Pi refactor Step 1** — make Pi extend shared bases (PiWorkflow as empty subclass), verify all tests pass
3. **Pi refactor Step 2** — delete PiWorkflow, use BaseWorkflow directly, verify tests pass
4. **Claude Code adapter** — most familiar CLI, good first real adapter
5. **Gemini adapter**
6. **Codex adapter**
7. **Schema update** — adapter.schema.json + .aos/adapter.yaml support
8. **Delete old generators** — remove Claude Code and Gemini generator code

---

## Future Work

- **OpenCode adapter** — requires CLI investigation spike to determine non-interactive JSON mode, output format, and model listing support. Separate spec once investigation is complete.
- **Headless/CI mode** — TerminalUI with no interactive prompts, for automated pipelines.
