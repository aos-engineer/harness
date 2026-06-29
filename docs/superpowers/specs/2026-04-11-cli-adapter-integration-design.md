# CLI Adapter Integration Design

**Date:** 2026-04-11
**Status:** Draft (v2 — revised after architectural review)
**Author:** Segun Kolade + Claude
**Depends on:** Full Adapter Implementations (2026-04-11, merged)

## Overview

Wire the new runtime adapters (Claude Code, Gemini, Codex) into the `aos run` CLI command so they can be used end-to-end: config reading, adapter loading, engine wiring, interactive session with commands, constraint gauge display, and graceful shutdown.

## Goals

1. `aos run` works with `claude-code`, `gemini`, and `codex` adapters — not just Pi
2. Full interactive session support: `/aos-halt`, `/aos-resume`, `/aos-end`, `/aos-status`, `/aos-steer`
3. `.aos/adapter.yaml` config reading with model overrides passed to adapter runtime
4. Text-mode constraint gauges for terminal output
5. Shared agent discovery helpers extracted from Pi (no duplication)
6. Arbiter orchestration via MCP stdio bridge — same pattern across all three CLIs

## Non-Goals

- Changing Pi's code path — Pi keeps its separate extension-based entry point
- Headless/CI mode — out of scope (future work)
- OpenCode adapter — deferred pending CLI investigation
- Amending the `sendMessage()` contract — kept one-shot; full agentic loop happens inside the CLI subprocess

---

## Key Architectural Decision: MCP Bridge

All three non-Pi CLIs (Claude Code, Gemini, Codex) support external tool servers via the **Model Context Protocol (MCP) over stdio**. In each, a single CLI invocation runs the full agentic loop, calling MCP tools as many times as needed before returning a final response. This means:

- `BaseAgentRuntime.sendMessage()` stays one-shot — we send the kickoff message once and the arbiter drives itself to completion
- `delegate` and `end` are exposed as **MCP tools**, not in-process tools registered on the TerminalUI
- Each arbiter subprocess spawns its own MCP bridge subprocess (per-CLI requirement — they can't share one because each CLI owns its MCP server lifecycle)
- The bridge talks back to the main AOS CLI over a Unix domain socket, forwarding tool calls into the engine and returning results

```
┌──────────────┐  spawn   ┌──────────────┐  spawn stdio  ┌──────────────────┐
│  aos CLI     │─────────▶│  arbiter CLI │──────────────▶│  MCP bridge      │
│  (engine +   │          │  (claude/    │  MCP protocol │  (tiny proxy)    │
│   unix sock) │◀─────────│   gemini/    │◀─────────────▶│                  │
│              │ IPC      │   codex)     │               │                  │
└──────────────┘          └──────────────┘               └──────────────────┘
     ▲                                                            │
     └──── JSON-RPC over unix socket ─────────────────────────────┘
```

Pi is unchanged — its tools are registered in-process (Pi *is* the arbiter runtime).

---

## Architecture

### New Module: `cli/src/adapter-session.ts`

A single module that encapsulates the generic adapter session lifecycle for all non-Pi adapters. `run.ts` calls it instead of printing "not yet fully supported."

**Exported function:**

```typescript
async function runAdapterSession(config: AdapterSessionConfig): Promise<void>
```

**Config shape:**

```typescript
interface AdapterSessionConfig {
  platform: string;           // "claude-code" | "gemini" | "codex"
  profileDir: string;
  briefPath: string;
  domainName: string | null;
  root: string;
  sessionId: string;
  deliberationDir: string;
  verbose: boolean;
  workflowConfig: any | null;
  workflowsDir: string;
  modelOverrides?: Partial<Record<string, string>>;
}
```

### New Module: `cli/src/mcp-arbiter-bridge.ts`

A standalone script that runs as a subprocess of each arbiter CLI. It:

- Implements an MCP stdio server via `@modelcontextprotocol/sdk`
- Exposes `delegate(to, message)` and `end(closing_message)` tools
- Connects back to the main `aos` CLI over a Unix socket (path passed via `AOS_BRIDGE_SOCKET` env var)
- Forwards tool invocations as JSON-RPC requests and returns the results as MCP tool results

The script entry point is invoked via `bun run path/to/mcp-arbiter-bridge.ts` and takes the socket path from the environment. The main CLI runs a Unix-socket server that dispatches incoming RPCs to `engine.delegateMessage()` and the end-flow handler.

### New Module: `adapters/shared/src/agent-discovery.ts`

Moved out of Pi. Contains:

```typescript
discoverAgents(agentsDir: string): Map<string, string>
createFlatAgentsDir(projectRoot: string, agentMap: Map<string, string>): string
findProjectRoot(cwd: string): string | null
```

Both `cli/src/adapter-session.ts` and `adapters/pi/src/index.ts` import from here. (Placing it in `adapters/shared/` avoids the circular dependency that would arise if it lived in `cli/src/`.)

### Integration Point in `run.ts`

Replace the current `else` block (lines 376-385) with:

```typescript
} else {
  const adapterConfig = readAdapterConfig(root);
  await runAdapterSession({
    platform: adapter,
    profileDir: profileDir!,
    briefPath,
    domainName,
    root,
    sessionId,
    deliberationDir,
    verbose: !!args.flags.verbose,
    workflowConfig: isExecutionProfile ? workflowConfig : null,
    workflowsDir,
    modelOverrides: adapterConfig?.model_overrides,
  });
}
```

---

## Detailed Design

### 1. Dynamic Adapter Loading

Map platform names to adapter packages:

```typescript
const ADAPTER_MAP: Record<string, { package: string; className: string }> = {
  "claude-code": { package: "@aos-harness/claude-code-adapter", className: "ClaudeCodeAgentRuntime" },
  "gemini":      { package: "@aos-harness/gemini-adapter",      className: "GeminiAgentRuntime" },
  "codex":       { package: "@aos-harness/codex-adapter",       className: "CodexAgentRuntime" },
};
```

**Loading flow:**
1. Look up platform in `ADAPTER_MAP`
2. Try `await import(entry.package)` — works in monorepo dev (workspace:*) and if a user installs these as separate packages
3. Fall back to resolving from the `aos-harness` package install dir: `import(join(packageDir, "adapters", platform, "src", "index.ts"))` — this matches the npm distribution layout where adapters ship inside the main package under `adapters/`
4. `packageDir` is computed from `import.meta.url` of the CLI entry, not the user's project root
5. If both fail, exit with error: `"Adapter for <platform> not found."`
6. Extract runtime class: `mod[className]`
7. Instantiate: `new RuntimeClass(eventBus, modelOverrides)`

### 2. Layer Instantiation & Composition

```typescript
const eventBus = new BaseEventBus();
const agentRuntime = new RuntimeClass(eventBus, config.modelOverrides);
const ui = new TerminalUI();
const workflow = new BaseWorkflow(agentRuntime, config.root);

const adapter = composeAdapter(agentRuntime, eventBus, ui, workflow);
```

All imported from `@aos-harness/adapter-shared`.

### 3. Agent Discovery & Engine Creation

```typescript
import { discoverAgents, createFlatAgentsDir } from "@aos-harness/adapter-shared";

const agentsDir = join(root, "core", "agents");
const agentMap = discoverAgents(agentsDir);
const flatAgentsDir = createFlatAgentsDir(root, agentMap);
const domainsDir = join(root, "core", "domains");

const engine = new AOSEngine(adapter, config.profileDir, {
  agentsDir: flatAgentsDir,
  domain: config.domainName ?? undefined,
  domainDir: config.domainName ? domainsDir : undefined,
});

await engine.start(config.briefPath);
```

Pi's existing `index.ts` is updated to import these helpers from `adapter-shared` instead of defining them inline.

### 4. MCP Bridge Lifecycle

For each arbiter session:

1. Generate a Unix socket path: `/tmp/aos-bridge-<sessionId>.sock`
2. Start a Unix socket server in the main CLI that accepts JSON-RPC requests with methods `delegate` and `end`
3. Compose the MCP config for the target CLI (see §5), pointing at the bridge script with the socket path in env
4. Spawn the arbiter subprocess with MCP config + flags via `adapter.sendMessage(arbiterHandle, kickoff)`
5. The subprocess spawns the MCP bridge as its own child; the bridge connects to the socket
6. When the arbiter calls `delegate(...)`, the bridge forwards to the socket, the CLI dispatches to `engine.delegateMessage(...)`, result flows back
7. When the arbiter calls `end(closing_message)`, the bridge forwards, the CLI triggers memo writing and sets a shutdown flag, returns the closing message as tool result
8. Arbiter's system prompt instructs it to stop producing tool calls after `end` returns, so its loop naturally ends
9. `sendMessage()` resolves with the final arbiter text; CLI closes the socket server and exits

### 5. Per-CLI MCP Configuration

Each adapter's `buildArgs()` (or a new `buildMcpArgs()` helper) adds the CLI-specific flags to register the bridge:

**Claude Code:**
```
claude -p "<kickoff>" \
  --mcp-config '{"mcpServers":{"aos":{"command":"bun","args":["<bridge.ts>"],"env":{"AOS_BRIDGE_SOCKET":"<sock>"}}}}' \
  --strict-mcp-config \
  --allowedTools "mcp__aos__delegate mcp__aos__end" \
  --permission-mode bypassPermissions \
  --output-format stream-json --verbose
```

**Gemini:** config must live in `~/.gemini/settings.json` or a project-level `.gemini/settings.json`. The adapter writes a temp settings file under `.aos/.runtime/gemini-settings-<sessionId>.json` and points the CLI at it via `GEMINI_SETTINGS_PATH` env (or project-level `.gemini/` dir if required):
```
gemini --yolo --output-format stream-json \
  --allowed-mcp-server-names aos \
  -p "<kickoff>"
```

**Codex:** `-c` flags override config.toml keys inline:
```
codex exec --json --skip-git-repo-check \
  -c 'mcp_servers.aos.command="bun"' \
  -c 'mcp_servers.aos.args=["<bridge.ts>"]' \
  -c 'mcp_servers.aos.env={AOS_BRIDGE_SOCKET="<sock>"}' \
  -c 'mcp_servers.aos.required=true' \
  -c 'mcp_servers.aos.enabled_tools=["delegate","end"]' \
  "<kickoff>"
```

### 6. Arbiter Prompt Resolution

Same as Pi — read `prompt.md` from the arbiter agent directory, resolve template variables. Key addition: the prompt must reference the MCP-prefixed tool names the model will actually see (e.g., `mcp__aos__delegate` for Claude Code; Gemini and Codex expose them with server-namespaced names too). The resolver produces a CLI-specific variant:

```typescript
const toolNames = getToolNamesForPlatform(platform);
// { delegate: "mcp__aos__delegate", end: "mcp__aos__end" } for Claude Code
// { delegate: "aos.delegate", end: "aos.end" } for Gemini/Codex (example)
```

Template variables include `{{delegate_tool}}` and `{{end_tool}}` so the prompt tells the arbiter the exact names to call.

### 7. Interactive Commands

Registered on TerminalUI before entering the readline loop:

| Command | Semantics |
|---------|-----------|
| `/aos-halt` | Set `halted = true`. The arbiter's current turn completes (the subprocess is not interrupted); when its next MCP tool call arrives, the bridge holds the response until `halted = false`. Prints: "Deliberation paused. Type /aos-resume to continue." |
| `/aos-resume` | Set `halted = false`; release any pending tool response |
| `/aos-end` | Send a signal via the bridge socket to inject a final "please wrap up now" message as the next tool result; arbiter receives it and is expected to call `end` |
| `/aos-status` | Print full constraint gauges to console |
| `/aos-steer <msg>` | Queue message; the bridge prepends it to the **next** tool-result payload returned to the arbiter (so the arbiter sees the steer as part of the delegate response for its next turn) |

This resolves the synchronization question: steer messages and halt-gating happen at the MCP tool-result boundary, which is a natural interleaving point.

### 8. Readline Loop

```typescript
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on("line", async (input) => {
  const trimmed = input.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/aos-")) {
    const [cmd, ...rest] = trimmed.slice(1).split(" ");
    await ui.dispatchCommand(cmd, rest.join(" "));
  } else {
    ui.steerMessage(trimmed);
  }
});
```

The loop runs concurrently with the arbiter subprocess. Exit conditions:
- Arbiter subprocess exits → `sendMessage()` resolves → CLI closes readline, prints summary, exits 0
- User types `/aos-end` → steer-inject "wrap up" → arbiter calls `end` → memo written → subprocess exits → shutdown flow
- Ctrl+C → kill arbiter subprocess, close socket server, exit 130

### 9. Text-Mode Constraint Gauges

Printed only on `/aos-status`. After each round, print a compact one-liner instead of full gauge bars:

```
[Round 3/8 · 4.2min · $0.45]
```

Full gauges on `/aos-status`:
```
  TIME:   4.2 min  [████████░░░░░░░░] (min: 2, max: 10)
  BUDGET: $0.45    [██░░░░░░░░░░░░░░] (min: $1, max: $10)
  ROUNDS: 3        [████░░░░░░░░░░░░] (min: 2, max: 8)
```

Helper function `renderTextGauge(label, value, min, max, unit)` with ANSI coloring (green/yellow/red based on proximity to max).

### 10. Memo Writing & Shutdown Ownership

The **engine** owns memo writing. When the arbiter calls `end(closing_message)`:

1. Bridge forwards the call to the main CLI
2. CLI calls `engine.delegateMessage("all", closing_message)` to gather final statements
3. CLI calls `engine.writeMemo(closing_message, finalResponses)` to persist the deliberation memo
4. CLI returns a success tool result to the bridge
5. Arbiter's system prompt instructs it to produce no further tool calls after `end` — so it emits a final text response and exits
6. `sendMessage()` resolves; main CLI does cost summary and cleanup

This mirrors Pi's flow but with the engine (not the arbiter process) writing the memo.

### 11. Config Reading

**`.aos/adapter.yaml`** is read by `adapter-session.ts` at startup:

```typescript
function readAdapterConfig(root: string): AdapterConfig | null {
  const configPath = join(root, ".aos", "adapter.yaml");
  if (!existsSync(configPath)) return null;
  return yaml.load(readFileSync(configPath, "utf-8")) as AdapterConfig;
}
```

```typescript
interface AdapterConfig {
  platform?: string;
  model_overrides?: Partial<Record<string, string>>;
  theme?: string;
  editor?: string;
}
```

---

## File Changes

### New Files
| File | Responsibility |
|------|---------------|
| `cli/src/adapter-session.ts` | Generic adapter session lifecycle (~300-400 lines) |
| `cli/src/mcp-arbiter-bridge.ts` | MCP stdio server + Unix socket client (~150 lines) |
| `cli/src/bridge-server.ts` | Unix socket server in main CLI that dispatches bridge RPCs to engine (~100 lines) |
| `adapters/shared/src/agent-discovery.ts` | Shared agent discovery helpers (~80 lines, extracted from Pi) |

### Modified Files
| File | Change |
|------|--------|
| `cli/src/commands/run.ts` | Replace "not yet supported" block with `runAdapterSession()` call |
| `adapters/pi/src/index.ts` | Import `discoverAgents`, `createFlatAgentsDir`, `findProjectRoot` from `@aos-harness/adapter-shared` |
| `adapters/shared/src/index.ts` | Export the new agent-discovery helpers |
| `adapters/claude-code/src/runtime.ts` | Add `buildMcpArgs()` or extend `buildArgs()` for MCP flags |
| `adapters/gemini/src/runtime.ts` | Same for Gemini; handle settings.json temp file |
| `adapters/codex/src/runtime.ts` | Same for Codex; `-c` flag overrides |
| Root `package.json` | Add `@modelcontextprotocol/sdk` dependency |

---

## Dependencies

New npm dependency: `@modelcontextprotocol/sdk` (for the bridge script).

---

## Testing Strategy

- **Unit tests for `agent-discovery.ts`** — test `discoverAgents()` with mock directory structures
- **Unit tests for `adapter-session.ts`** — mock adapter import, verify layer instantiation, verify command registration
- **Unit tests for `bridge-server.ts`** — mock engine, send fake RPCs over socket, verify dispatch
- **Integration test** — run the bridge end-to-end with a mock MCP client (no real CLI), verify `delegate`/`end` flow
- **Manual E2E** — run `aos run` with each installed CLI (claude, gemini, codex) against a small test profile

---

## Implementation Order

1. Extract `agent-discovery.ts` into `adapters/shared/` and update Pi to import from there
2. Verify Pi still works (run existing tests)
3. Implement `bridge-server.ts` (Unix socket server + engine dispatch)
4. Implement `mcp-arbiter-bridge.ts` (MCP stdio server + socket client)
5. Integration test the bridge pair against a mock MCP client
6. Extend each adapter's runtime with MCP arg building (Claude Code first)
7. Implement `adapter-session.ts` — loading, instantiation, bridge wiring, readline loop
8. Add interactive commands (halt/resume/end/status/steer) with bridge-mediated semantics
9. Add constraint gauge rendering (compact per-round + full on /aos-status)
10. Wire `.aos/adapter.yaml` config reading
11. Wire into `run.ts` — replace "not yet supported" block
12. E2E test with Claude Code, then Gemini, then Codex

---

## Open Questions / Risks

- **Gemini settings.json location**: need to verify whether `GEMINI_SETTINGS_PATH` env is respected or whether we must write to the project `.gemini/` dir. May require a different config strategy for Gemini.
- **Bridge bundling in npm distribution**: `mcp-arbiter-bridge.ts` must be spawnable by a bun runtime the user has installed. Confirm it works when invoked via `bun run <path>` from a globally-installed npm package.
- **Tool-name mismatch across CLIs**: each CLI namespaces MCP tools differently in what the model sees. Verify the arbiter prompt template handles this cleanly (per-platform tool-name substitution).
- **Halt semantics**: withholding a tool result keeps the subprocess alive but idle — ensure no CLI has a hard timeout that kills the arbiter during a long halt.
