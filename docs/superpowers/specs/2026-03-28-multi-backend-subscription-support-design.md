# Multi-Backend Subscription Support

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Enable AOS to run through Pi, Claude Code, Gemini, or Codex CLIs, allowing users to leverage existing subscriptions instead of API keys.

---

## 1. Problem

AOS currently has only one runtime adapter (Pi) that can execute agent sessions. The Claude Code and Gemini adapters are static code generators — they produce config files but cannot run agents. Users with Claude Max, Gemini, or Codex Pro subscriptions have no way to use those subscriptions with AOS. They must either use Pi with an API key or use the generators to produce artifacts for manual use.

## 2. Goal

Allow developers to run a full AOS deliberation session through any of four CLI backends:

| Backend | CLI Binary | Subscription |
|---|---|---|
| Pi | `pi` | Anthropic API key or subscription |
| Claude Code | `claude` | Claude Max |
| Gemini | `gemini` | Google Gemini subscription |
| Codex | `codex` | Codex Pro (OpenAI) |

Pi remains the recommended backend. All four are first-class alternatives.

## 3. Architecture

### 3.1 Generic CLI Agent Runtime

A single `CLIAgentRuntime` class implements `AgentRuntimeAdapter`. It handles the common subprocess lifecycle shared across all CLI backends:

- Subprocess spawn, stdout/stderr piping, exit code handling
- Output parsing via provider plugin (streaming or batch, see Section 3.2)
- Retry with exponential/linear backoff
- Timeout enforcement via AbortController
- Abort handling (SIGTERM → 5s → SIGKILL)
- Session file management (`.aos/sessions/<id>/<agent>.jsonl`)
- Token tracking (always), cost tracking (only when metered)

The runtime delegates all CLI-specific behavior to a `CLIProvider` plugin.

### 3.2 Provider Plugin Interface

Each backend implements this interface:

```typescript
interface CLIProviderCapabilities {
  session: "native" | "stateless";
  streaming: boolean;
  thinking: "none" | "basic" | "extended";
  toolUse: boolean;
  contextFiles: boolean;
  systemPrompt: boolean;
  jsonOutput: boolean;
}

interface CLIProvider {
  id: "pi" | "claude-code" | "gemini" | "codex";
  binary: string;
  capabilities: CLIProviderCapabilities;

  // How to construct the CLI invocation.
  // The runtime calls buildArgs for every sendMessage. If the provider
  // needs the message delivered via stdin instead of as a positional
  // argument (see Section 3.4 — Message Delivery), it sets
  // messageVia: "stdin" in the return value from prepareInvocation.
  prepareInvocation(opts: {
    message: string;
    systemPrompt?: string;
    sessionFile: string;
    model: string;
    thinking: ThinkingMode;
    contextFiles: string[];
    isFirstCall: boolean;
  }): {
    args: string[];           // CLI arguments (message may or may not be included)
    messageVia: "arg" | "stdin";  // How the message is delivered
  };

  // Return the filtered set of environment variables to pass to the
  // subprocess. The provider is responsible for allowlisting: only
  // return variables that the CLI needs. The runtime passes this
  // record as the subprocess env directly — it does NOT merge with
  // or inherit from process.env. This prevents accidental secret
  // leakage. See Section 3.5 — Environment Isolation.
  buildEnv(): Record<string, string>;

  // Output parsing. CLIs have two output models:
  //   - Streaming (Pi): JSON events emitted line by line during execution
  //   - Batch (Claude Code, Gemini, Codex): a single JSON blob on completion
  //
  // The runtime reads stdout line by line. For each line, it calls
  // parseOutput. The provider returns CLIEvent(s) or null (skip line).
  // Streaming providers emit text_delta events per line. Batch providers
  // return null for all lines except the final JSON blob, where they
  // emit a single message_end event.
  parseOutput(line: string): CLIEvent | null;

  resolveModelId(tier: ModelTier): string;

  detectAuthMode(): AuthMode;

  getModelCost(tier: ModelTier): ModelCost;
}
```

### 3.3 Normalized CLI Events

Provider plugins translate CLI-specific output into a common event type:

```typescript
type CLIEvent =
  | { type: "text_delta"; text: string }
  | { type: "message_end"; text: string; usage?: { input: number; output: number; cost?: number; contextTokens?: number }; model?: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "error"; message: string };
```

### 3.4 Message Delivery

Agent messages can be large — a system prompt plus injected context files plus the deliberation message can easily exceed OS argument length limits (128KB–2MB depending on platform). The provider's `prepareInvocation` method declares how the message should be delivered:

- **`messageVia: "arg"`** — Message included as a positional CLI argument. Used when the message is small enough (provider decides the threshold, recommended: 100KB).
- **`messageVia: "stdin"`** — Message piped to the subprocess's stdin. The `args` array omits the message; the runtime writes it to the process's stdin pipe and closes it. Used when the message exceeds the threshold.

The runtime handles both modes transparently. The provider only needs to set the flag and omit the message from `args` when using stdin. Each provider defines its own threshold and stdin syntax based on what its CLI supports.

### 3.5 Environment Isolation

The `buildEnv()` method returns the **complete** environment for the subprocess. The runtime passes this record directly as the subprocess env — it does not merge with or inherit from `process.env`. This means:

- The provider is responsible for allowlisting: only return variables the CLI needs
- Variables not explicitly included are not available to the subprocess
- This prevents accidental leakage of secrets (API keys for other services, credentials, tokens)

Each provider's allowlist is documented in its plugin section (Section 5). The pattern follows the existing Pi adapter's allowlist approach, now formalized as a contract.

### 3.6 Response Content Agnosticism

The engine treats agent response text as opaque content. It does not parse, validate, or expect specific formatting in the `text` field of `AgentResponse`. Responses flow through the delegation router and into transcripts as-is.

This means different model families (Claude via Pi/Claude Code, Gemini, OpenAI via Codex) may produce stylistically different responses. The engine is content-agnostic by design — it routes messages and enforces constraints, not response format. If a profile's orchestrator prompt instructs agents to respond in a specific format (e.g., structured JSON, markdown sections), that formatting depends on the model's ability to follow instructions, not the runtime.

Providers should not attempt to normalize response content across model families. The plugin boundary handles transport and metadata, not semantics.

## 4. Backend Discovery & Selection

### 4.1 BackendResolver

On startup, AOS runs a `BackendResolver` that:

1. Detects which CLIs are installed by checking if the binary exists on PATH
2. Probes that the CLI is functional (e.g., `<binary> --version`)
3. Selects a backend using the fallback chain: `pi` → `claude` → `gemini` → `codex`
4. Allows override via `--backend <name>` CLI flag or `AOS_BACKEND` env var

If no CLI is found, AOS exits with a clear error listing what to install.

**If multiple CLIs are available and no override is set**, the resolver logs which backend was auto-selected and which alternatives are available:

```
Backend auto-selected: pi (also available: claude, gemini)
Use --backend <name> or AOS_BACKEND=<name> to override.
```

This prevents confusion when a user has multiple CLIs installed and AOS silently picks one that affects billing or capability.

### 4.2 Fallback Chain Rationale

The fallback order `pi` → `claude` → `gemini` → `codex` is based on capability coverage:

| Priority | Backend | Rationale |
|---|---|---|
| 1st | Pi | Recommended. Full capability set: native sessions, streaming, thinking, JSON events with usage stats. Most complete AOS integration. |
| 2nd | Claude Code | Same model family as Pi (Anthropic Claude). Streaming, thinking, tool use, JSON output. Session support via `--resume`/`--continue`. Closest to Pi in behavior. |
| 3rd | Gemini | Different model family. Capabilities TBD but likely covers core features. |
| 4th | Codex | Newest CLI, least validated. Different model family (OpenAI). |

The ordering prioritizes: (1) capability completeness, (2) model family familiarity with AOS prompts, (3) maturity of integration.

### 4.3 BackendInfo

```typescript
interface BackendInfo {
  id: "pi" | "claude-code" | "gemini" | "codex";
  binary: string;
  available: boolean;
  version?: string;
}
```

### 4.4 Override Behavior

- `--backend <name>` or `AOS_BACKEND=<name>` → validate that CLI exists, error if not
- No override → run fallback chain, pick first available
- If override specifies an unavailable CLI → error with install instructions, do not fall back

## 5. Provider Plugins

### 5.1 Pi Provider

- **Binary:** `pi`
- **Session:** Native (`--session <file>`)
- **Args:** `--mode json -p --no-extensions --no-skills --no-prompt-templates --no-themes --session <file> --thinking <mode> --model <model> <message>`
- **Parsing:** JSON event stream — `message_update` with `assistantMessageEvent.text_delta`, `message_end` with `usage` block
- **Auth:** `ANTHROPIC_API_KEY` present → `{ type: "api_key", metered: true }`, absent → `{ type: "subscription", metered: false }`
- **Env allowlist:** `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `AOS_MODEL_*`, `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`
- **Model map:**
  - `economy` → `anthropic/claude-haiku-4-5`
  - `standard` → `anthropic/claude-sonnet-4-6`
  - `premium` → `anthropic/claude-opus-4-6`
- **Capabilities:** All supported (session: native, streaming: true, thinking: "extended", toolUse: true, contextFiles: true, systemPrompt: true, jsonOutput: true)

### 5.2 Claude Code Provider

- **Binary:** `claude`
- **Session:** Explore native support via `--resume`/`--continue` flags. Fall back to `stateless` if unreliable.
- **Args:** `--output-format json --model <model> --system-prompt <prompt> -p <message>`
- **Parsing:** JSON output with `result` and `usage` fields. Token counts available, cost not reported in subscription mode.
- **Auth:** `ANTHROPIC_API_KEY` present → `{ type: "api_key", metered: true }` (Claude Code will use the API key and the user will be billed), absent → `{ type: "subscription", metered: false }`. This ensures AOS correctly tracks billing when an API key is active, even through Claude Code.
- **Env allowlist:** Standard system vars, `ANTHROPIC_API_KEY` (if present). Claude Code also uses its own auth via `~/.claude/` when no API key is set.
- **Model map:**
  - `economy` → `haiku`
  - `standard` → `sonnet`
  - `premium` → `opus`
- **Capabilities:** session: TBD (explore `--resume`/`--continue`), streaming: true, thinking: "extended", toolUse: true, contextFiles: true, systemPrompt: true, jsonOutput: true.

### 5.3 Gemini Provider

- **Binary:** `gemini`
- **Session:** TBD during implementation — explore Gemini CLI's session capabilities.
- **Args:** `--model <model> --output-format json <message>` (exact flags to be validated against Gemini CLI docs during implementation)
- **Parsing:** JSON output. Format to be confirmed during implementation.
- **Auth:** `GOOGLE_API_KEY` present → `{ type: "api_key", metered: true }`, absent → `{ type: "subscription", metered: false }`
- **Env allowlist:** Standard system vars, `GOOGLE_API_KEY`
- **Model map:**
  - `economy` → `gemini-2.0-flash`
  - `standard` → `gemini-2.5-pro`
  - `premium` → `gemini-2.5-pro`
- **Capabilities:** TBD during implementation. The plugin boundary isolates unknowns.

### 5.4 Codex Provider

- **Binary:** `codex`
- **Session:** TBD during implementation — explore Codex CLI's session capabilities.
- **Args:** `--model <model> --output-format json <message>` (exact flags to be validated against Codex CLI docs during implementation)
- **Parsing:** JSON output. Format to be confirmed during implementation.
- **Auth:** `OPENAI_API_KEY` present → `{ type: "api_key", metered: true }`, absent → `{ type: "subscription", metered: false }`
- **Env allowlist:** Standard system vars, `OPENAI_API_KEY`
- **Model map:**
  - `economy` → `o4-mini`
  - `standard` → `o3`
  - `premium` → `o3`
- **Capabilities:** TBD during implementation. The plugin boundary isolates unknowns.

For Gemini and Codex, CLI flags, output formats, and capability declarations are intentionally marked TBD. The plugin interface is the isolation boundary — these unknowns affect only the provider file, not the shared runtime or engine.

## 6. Native CLI Features

### 6.1 Principle

AOS leverages each CLI's native capabilities. No synthetic workarounds that block features.

### 6.2 Capability-Based Behavior

| Capability | Supported | Not Supported |
|---|---|---|
| Session | Use CLI's native mechanism (`--session`, `--resume`, `--continue`) | Pass full context each call using CLI's own flags |
| Streaming | Wire `onStream` callback to live output | Wait for full response, deliver at once |
| Thinking | Pass `--thinking` or equivalent flag | Omit flag, agent runs without extended thinking |
| Tool use | Allow CLI to use its native tools | Agent operates text-only |
| Context files | Inject via `@file` or equivalent syntax | Inline file contents into the message |
| System prompt | Pass via `--system-prompt` or equivalent | Prepend to first message |
| JSON output | Parse structured events | Parse plain text as single response |

### 6.3 No Synthetic Sessions

The runtime does not build its own conversation history management. If a CLI has no session support, that is a known limitation of that backend — documented, not papered over. Users who need multi-turn session fidelity should use Pi.

## 7. Auth Mode & Cost Tracking

### 7.1 Auth Detection

Each provider determines auth mode from its own environment:

- **Pi:** `ANTHROPIC_API_KEY` → metered, else subscription
- **Claude Code:** `ANTHROPIC_API_KEY` → metered, else subscription (Claude Code uses the API key when present)
- **Gemini:** `GOOGLE_API_KEY` → metered, else subscription
- **Codex:** `OPENAI_API_KEY` → metered, else subscription

### 7.2 Token & Cost Tracking

- **Token counts:** Always tracked when the CLI reports them. Used for context window management and compaction decisions regardless of billing mode.
- **Cost tracking:** Only when `authMode.metered === true`. Subscription backends report `cost: 0`.
- **Budget constraints:** Enabled only when metered. Subscription sessions skip budget enforcement (existing behavior via `ConstraintEngine`).

### 7.3 Model Tier Mapping

Each backend defines its own default tier-to-model mapping. Users override with `AOS_MODEL_ECONOMY`, `AOS_MODEL_STANDARD`, `AOS_MODEL_PREMIUM` env vars (existing mechanism, unchanged).

## 8. Integration with Existing Framework

### 8.1 Engine

`AOSEngine` takes an `AOSAdapter` in its constructor. No change needed — `CLIAgentRuntime` implements `AgentRuntimeAdapter`, which is part of `AOSAdapter`. The engine is backend-agnostic.

### 8.2 Entry Point

The AOS CLI entry point gains:

1. `--backend <pi|claude-code|gemini|codex>` flag and `AOS_BACKEND` env var
2. Backend resolution runs before engine construction
3. Selected provider is instantiated and passed to `CLIAgentRuntime`
4. Runtime is wired into `AOSAdapter` alongside existing L2/L3/L4 adapters

### 8.3 Capability Mismatch at Startup

After backend selection, the engine compares profile requirements against `provider.capabilities`:

- **Hard requirement mismatch** → Error, refuse to start, suggest Pi. Examples:
  - Profile mandates `thinking: "extended"` but backend declares `thinking: "none"` or `thinking: "basic"`
  - Profile requires native session support but backend is stateless
- **Soft preference mismatch** → Warning, continue with degraded experience. Examples:
  - Streaming unavailable (response delivered at once instead of progressively)
  - Context file injection unsupported (files inlined into message instead)

The `thinking` capability uses a granular scale (`"none" | "basic" | "extended"`) rather than a boolean. This lets the runtime distinguish between a backend that cannot think at all, one that supports basic chain-of-thought, and one that supports extended/budget-based thinking. A profile requiring `"extended"` will reject a `"basic"` backend.

### 8.4 Existing Code Impact

- **`adapters/pi/src/agent-runtime.ts`** — Refactored. `PiAgentRuntime` replaced by `CLIAgentRuntime` + `PiProvider`. All current behavior preserved.
- **`adapters/pi/src/event-bus.ts`** — Unchanged (L2)
- **`adapters/pi/src/ui.ts`** — Unchanged (L3)
- **`adapters/pi/src/workflow.ts`** — Unchanged (L4)
- **`adapters/claude-code/src/generate.ts`** — Unchanged (generator)
- **`adapters/gemini/src/generate.ts`** — Unchanged (generator)
- **`runtime/src/types.ts`** — No changes to existing types. New types added in `adapters/shared/types.ts`.
- **`runtime/src/engine.ts`** — No changes
- **`runtime/src/constraint-engine.ts`** — No changes

## 9. File Structure

```
adapters/
  shared/
    cli-agent-runtime.ts      # Generic CLIAgentRuntime (AgentRuntimeAdapter)
    types.ts                  # CLIProvider, CLIEvent, CLIProviderCapabilities, BackendInfo
    backend-resolver.ts       # Detection, probing, fallback chain, override handling
  pi/src/
    provider.ts               # PiProvider plugin (extracted from agent-runtime.ts)
    agent-runtime.ts          # DELETED — logic moved to shared/cli-agent-runtime.ts + provider.ts
    event-bus.ts              # Unchanged (L2)
    ui.ts                     # Unchanged (L3)
    workflow.ts               # Unchanged (L4)
    index.ts                  # Updated — imports from shared + provider
  claude-code/src/
    provider.ts               # ClaudeCodeProvider plugin (NEW)
    generate.ts               # Unchanged (generator)
    templates.ts              # Unchanged (generator)
  gemini/src/
    provider.ts               # GeminiProvider plugin (NEW)
    generate.ts               # Unchanged (generator)
    templates.ts              # Unchanged (generator)
  codex/src/
    provider.ts               # CodexProvider plugin (NEW)
```

## 10. Error Handling

### 10.1 CLI Not Found at Runtime

Binary disappears mid-session → `sendMessage` fails with: `"Backend '<name>' not found. Is it installed and on PATH?"`. Standard retry logic applies. No automatic fallback to another backend mid-session.

### 10.2 Authentication Failures

CLI returns auth error → provider maps to `CLIEvent { type: "error" }` → runtime surfaces: `"Authentication failed for <name>. Run '<name> login' or switch to another backend with --backend"`. No retry on auth errors.

### 10.3 CLI Output Format Changes

Only the affected provider's `parseOutput` breaks. Plugin boundary contains blast radius to one file.

### 10.4 Error Philosophy

- **Fail clearly** — never silently drop features
- **Fail early** — catch mismatches at startup, not mid-deliberation
- **Fail narrowly** — plugin boundary contains CLI-specific issues

## 11. Migration Path

Refactoring `PiAgentRuntime` into `CLIAgentRuntime` + `PiProvider` is a significant change to tested, working code. To prevent a "big bang" refactor where a bug in the shared runtime breaks the only working backend, the implementation follows three steps:

### Step 1: Extract PiProvider

Extract Pi-specific logic (arg building, env allowlist, output parsing, model mapping, auth detection) from `PiAgentRuntime` into a new `PiProvider` class. `PiAgentRuntime` calls into `PiProvider` but retains all runtime logic. **Verify Pi still works identically** — all existing tests pass, behavior unchanged.

### Step 2: Introduce CLIAgentRuntime

Move the generic runtime logic (subprocess spawn, streaming, retry, abort, timeout) from `PiAgentRuntime` into `CLIAgentRuntime`. Wire Pi through it: `new CLIAgentRuntime(piProvider)`. Delete `PiAgentRuntime`. **Verify Pi still works identically** — same tests, same behavior, different code organization.

### Step 3: Add New Providers

With the shared runtime proven against Pi, add Claude Code, Gemini, and Codex providers. Each is a new file implementing `CLIProvider`. Add `BackendResolver` and wire into the CLI entry point.

Each step is a separate commit (or PR). Step 1 and 2 are pure refactors with no behavior change. Step 3 adds new functionality.

## 12. Future Considerations

### 12.1 Mixed-Provider Sessions

Current design: single backend per session. The `CLIProvider` interface and `CLIAgentRuntime` are structured so that a future `MixedBackendRuntime` could hold multiple providers and route per-agent based on tier or routing rules. No breaking changes needed.

### 12.2 Additional Backends

New CLIs (Cursor, Windsurf, etc.) require only a new provider plugin file implementing `CLIProvider`. No changes to the shared runtime, engine, or existing providers.

### 12.3 API Key Mode for Non-Pi Backends

Currently, Claude Code/Gemini/Codex providers default to subscription mode. If these CLIs gain better API-key-mode support or cost reporting, the providers can update `detectAuthMode()` and `getModelCost()` independently.

## 13. Testing Strategy

- **Unit tests per provider:** Mock subprocess output, verify `parseOutput` produces correct `CLIEvent` sequences
- **Unit tests for CLIAgentRuntime:** Mock provider, verify spawn/stream/retry/abort/timeout lifecycle
- **Unit tests for BackendResolver:** Mock `which` calls, verify fallback chain and override behavior
- **Integration tests:** Run each backend against a real CLI (where available in CI) with a minimal agent config
- **Capability mismatch tests:** Verify correct error/warning behavior when profile requirements exceed backend capabilities
