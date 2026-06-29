# CLI Adapter Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `aos run` work with `claude-code`, `gemini`, and `codex` adapters end-to-end with full interactive sessions, by wiring an MCP-bridge architecture that exposes `delegate`/`end` tools to subprocess arbiters.

**Architecture:** A new `adapter-session.ts` module composes the shared adapter layers, instantiates the engine, and spawns the arbiter as a CLI subprocess. The arbiter calls `delegate`/`end` via an MCP stdio server (`mcp-arbiter-bridge.ts`) that proxies tool calls back to the main CLI over a Unix domain socket (`bridge-server.ts`), where they dispatch into `engine.delegateMessage()` / `engine.end()`. Pi's path is unchanged.

**Tech Stack:** TypeScript, Bun runtime, `@modelcontextprotocol/sdk`, Node `net` for Unix sockets, existing `@aos-harness/runtime` engine, existing `@aos-harness/adapter-shared` base classes.

**Reference spec:** `docs/superpowers/specs/2026-04-11-cli-adapter-integration-design.md`

---

## File Structure

**New files:**
- `adapters/shared/src/agent-discovery.ts` — `discoverAgents`, `createFlatAgentsDir`, `findProjectRoot` (extracted from Pi)
- `cli/src/bridge-server.ts` — Unix socket server in main CLI; exposes `start(socketPath, handlers)` returning a close fn
- `cli/src/mcp-arbiter-bridge.ts` — standalone MCP stdio server entry point; spawned by arbiter CLI as a child
- `cli/src/adapter-session.ts` — orchestrates one full adapter session (loading, engine, bridge, arbiter spawn, readline)
- `cli/src/adapter-config.ts` — reads `.aos/adapter.yaml`
- `cli/src/gauges.ts` — text gauge rendering helpers
- `tests/agent-discovery.test.ts`
- `tests/bridge-server.test.ts`
- `tests/adapter-config.test.ts`
- `tests/gauges.test.ts`

**Modified files:**
- `adapters/shared/src/index.ts` — re-export new helpers
- `adapters/pi/src/index.ts` — import helpers from `@aos-harness/adapter-shared`
- `adapters/claude-code/src/runtime.ts` — add MCP arg building
- `adapters/gemini/src/runtime.ts` — add MCP arg building (settings.json)
- `adapters/codex/src/runtime.ts` — add MCP arg building (`-c` flags)
- `cli/src/commands/run.ts` — replace lines 376-385 with `runAdapterSession()` call
- `cli/package.json` — add `@modelcontextprotocol/sdk` dependency

---

## Task 1: Extract Agent Discovery Helpers to adapters/shared

**Files:**
- Create: `adapters/shared/src/agent-discovery.ts`
- Modify: `adapters/shared/src/index.ts`
- Test: `tests/agent-discovery.test.ts`

- [ ] **Step 1: Read Pi's helper definitions**

Read `adapters/pi/src/index.ts` lines 26-110 to capture the exact bodies of `findProjectRoot`, `discoverAgents`, `createFlatAgentsDir`. Copy them verbatim — they are battle-tested.

- [ ] **Step 2: Write failing test for discoverAgents**

`tests/agent-discovery.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents } from "@aos-harness/adapter-shared";

test("discoverAgents finds agents recursively by agent.yaml", () => {
  const root = mkdtempSync(join(tmpdir(), "discover-"));
  mkdirSync(join(root, "alice"), { recursive: true });
  writeFileSync(join(root, "alice", "agent.yaml"), "id: alice\n");
  mkdirSync(join(root, "nested", "bob"), { recursive: true });
  writeFileSync(join(root, "nested", "bob", "agent.yaml"), "id: bob\n");

  const map = discoverAgents(root);
  expect(map.get("alice")).toBe(join(root, "alice"));
  expect(map.get("bob")).toBe(join(root, "nested", "bob"));
});

test("findProjectRoot walks up to find core/ or .aos/", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(root, "core"));
  const deep = join(root, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  const { findProjectRoot } = require("@aos-harness/adapter-shared");
  expect(findProjectRoot(deep)).toBe(root);
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `cd aos-harness && bun test tests/agent-discovery.test.ts`
Expected: FAIL — `discoverAgents` not exported.

- [ ] **Step 4: Create the helper file**

Create `adapters/shared/src/agent-discovery.ts` with the three functions copied from Pi (lines 26-110 of `adapters/pi/src/index.ts`). Export them all.

- [ ] **Step 5: Re-export from shared index**

Edit `adapters/shared/src/index.ts` to add:
```typescript
export { discoverAgents, createFlatAgentsDir, findProjectRoot } from "./agent-discovery";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/agent-discovery.test.ts`
Expected: 2 PASS.

- [ ] **Step 7: Commit**

```bash
git add adapters/shared/src/agent-discovery.ts adapters/shared/src/index.ts tests/agent-discovery.test.ts
git commit -m "feat(shared): extract agent discovery helpers from Pi adapter"
```

---

## Task 2: Refactor Pi to Use Shared Helpers

**Files:**
- Modify: `adapters/pi/src/index.ts`

- [ ] **Step 1: Replace local helper definitions with import**

In `adapters/pi/src/index.ts`:
- Delete the function bodies for `findProjectRoot` (line 26), `discoverAgents` (line 42), `createFlatAgentsDir` (line 77)
- Add to imports near the top:
```typescript
import { discoverAgents, createFlatAgentsDir, findProjectRoot } from "@aos-harness/adapter-shared";
```

- [ ] **Step 2: Run typecheck**

Run: `cd adapters/pi && bun x tsc --noEmit`
Expected: no new errors (pre-existing bun-types errors are fine).

- [ ] **Step 3: Run existing Pi tests**

Run: `bun test adapters/pi`
Expected: all pre-existing tests pass.

- [ ] **Step 4: Smoke-test Pi end-to-end**

Run: `bun run cli/src/index.ts run --adapter pi --profile examples/profiles/quick --brief examples/briefs/sample.md` (or whatever the existing smoke profile is).
Expected: session starts and produces a memo. Abort with Ctrl+C after first round; we just need to confirm Pi still launches.

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/src/index.ts
git commit -m "refactor(pi): import agent discovery helpers from adapter-shared"
```

---

## Task 3: Add @modelcontextprotocol/sdk Dependency

**Files:**
- Modify: `cli/package.json`

- [ ] **Step 1: Add the dependency**

Run: `cd cli && bun add @modelcontextprotocol/sdk`
Expected: package added, lockfile updated.

- [ ] **Step 2: Verify the SDK imports work**

Run:
```bash
bun -e 'import("@modelcontextprotocol/sdk/server/index.js").then(m => console.log(Object.keys(m)))'
```
Expected: prints exported names including `Server`.

- [ ] **Step 3: Commit**

```bash
git add cli/package.json bun.lock
git commit -m "chore(cli): add @modelcontextprotocol/sdk dependency"
```

---

## Task 4: Implement Bridge Server (Unix Socket → Engine Dispatch)

**Files:**
- Create: `cli/src/bridge-server.ts`
- Test: `tests/bridge-server.test.ts`

The bridge server listens on a Unix socket. Each connection sends newline-delimited JSON-RPC messages. The server dispatches `delegate` and `end` requests to handler functions and writes responses back.

Wire format (one JSON object per line, both directions):
```
Request:  { "id": "<uuid>", "method": "delegate"|"end", "params": {...} }
Response: { "id": "<uuid>", "result": {...} }   OR   { "id": "<uuid>", "error": "msg" }
```

- [ ] **Step 1: Write failing test for delegate dispatch**

`tests/bridge-server.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../cli/src/bridge-server";

function rpc(socketPath: string, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        sock.end();
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    });
    sock.on("error", reject);
    sock.write(JSON.stringify(req) + "\n");
  });
}

test("bridge server dispatches delegate", async () => {
  const sockPath = join(tmpdir(), `aos-test-${Date.now()}.sock`);
  const close = await startBridgeServer(sockPath, {
    delegate: async (params) => ({ responses: [{ from: params.to, text: "ok" }] }),
    end: async () => ({ ok: true }),
  });
  const resp = await rpc(sockPath, {
    id: "1", method: "delegate", params: { to: "alice", message: "hi" },
  });
  expect(resp.id).toBe("1");
  expect(resp.result.responses[0].text).toBe("ok");
  await close();
});

test("bridge server returns error for unknown method", async () => {
  const sockPath = join(tmpdir(), `aos-test-${Date.now()}.sock`);
  const close = await startBridgeServer(sockPath, {
    delegate: async () => ({}),
    end: async () => ({}),
  });
  const resp = await rpc(sockPath, { id: "2", method: "bogus", params: {} });
  expect(resp.error).toMatch(/unknown method/i);
  await close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/bridge-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bridge-server.ts**

Create `cli/src/bridge-server.ts`:
```typescript
import { createServer, Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";

export interface BridgeHandlers {
  delegate: (params: { to: string | string[]; message: string }) => Promise<unknown>;
  end: (params: { closing_message: string }) => Promise<unknown>;
}

export async function startBridgeServer(
  socketPath: string,
  handlers: BridgeHandlers,
): Promise<() => Promise<void>> {
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((sock: Socket) => {
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: any;
        try { req = JSON.parse(line); } catch { continue; }
        try {
          let result: unknown;
          if (req.method === "delegate") result = await handlers.delegate(req.params);
          else if (req.method === "end") result = await handlers.end(req.params);
          else throw new Error(`unknown method: ${req.method}`);
          sock.write(JSON.stringify({ id: req.id, result }) + "\n");
        } catch (err: any) {
          sock.write(JSON.stringify({ id: req.id, error: String(err?.message ?? err) }) + "\n");
        }
      }
    });
    sock.on("error", () => { /* client disconnect is fine */ });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (existsSync(socketPath)) unlinkSync(socketPath);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bridge-server.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/bridge-server.ts tests/bridge-server.test.ts
git commit -m "feat(cli): add Unix socket bridge server for arbiter tool dispatch"
```

---

## Task 5: Implement MCP Arbiter Bridge (stdio MCP server → Unix socket client)

**Files:**
- Create: `cli/src/mcp-arbiter-bridge.ts`

This script is spawned by each arbiter CLI as its MCP stdio child. It exposes `delegate` and `end` tools and forwards tool calls to the bridge server over the Unix socket whose path is in `AOS_BRIDGE_SOCKET`.

- [ ] **Step 1: Implement the bridge entry point**

Create `cli/src/mcp-arbiter-bridge.ts`:
```typescript
#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { connect, Socket } from "node:net";
import { randomUUID } from "node:crypto";

const SOCK = process.env.AOS_BRIDGE_SOCKET;
if (!SOCK) {
  console.error("AOS_BRIDGE_SOCKET env var is required");
  process.exit(1);
}

let sock: Socket | null = null;
const pending = new Map<string, (msg: any) => void>();
let buf = "";

function ensureSock(): Promise<Socket> {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  return new Promise((resolve, reject) => {
    const s = connect(SOCK!);
    s.on("connect", () => { sock = s; resolve(s); });
    s.on("error", reject);
    s.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const cb = pending.get(msg.id);
          if (cb) { pending.delete(msg.id); cb(msg); }
        } catch { /* ignore */ }
      }
    });
    s.on("close", () => { sock = null; });
  });
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  const s = await ensureSock();
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });
    s.write(JSON.stringify({ id, method, params }) + "\n");
  });
}

const server = new Server(
  { name: "aos-arbiter-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "delegate",
      description: "Delegate a message to one or more participant agents and receive their responses.",
      inputSchema: {
        type: "object",
        properties: {
          to: { description: "Agent id, list of ids, or 'all'", type: ["string", "array"] },
          message: { type: "string" },
        },
        required: ["to", "message"],
      },
    },
    {
      name: "end",
      description: "End the deliberation. Provide a closing summary message.",
      inputSchema: {
        type: "object",
        properties: { closing_message: { type: "string" } },
        required: ["closing_message"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await rpc(req.params.name, req.params.arguments ?? {});
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: Smoke test the bridge against the bridge server**

Create a one-off shell test (don't commit):
```bash
SOCK=/tmp/aos-smoke-$$.sock
bun -e "
import { startBridgeServer } from './cli/src/bridge-server';
const close = await startBridgeServer('$SOCK', {
  delegate: async (p) => ({ echoed: p }),
  end: async () => ({ done: true }),
});
console.log('server up');
" &
SERVER_PID=$!
sleep 0.5
# Send an MCP list_tools request via stdin to the bridge
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | AOS_BRIDGE_SOCKET=$SOCK bun cli/src/mcp-arbiter-bridge.ts | head -1
kill $SERVER_PID
rm -f $SOCK
```
Expected: a JSON response listing the `delegate` and `end` tools.

(If the smoke test fails, debug before proceeding. Don't commit the smoke script.)

- [ ] **Step 3: Commit**

```bash
git add cli/src/mcp-arbiter-bridge.ts
git commit -m "feat(cli): add MCP stdio bridge that forwards tool calls to bridge server"
```

---

## Task 6: Implement adapter-config.ts

**Files:**
- Create: `cli/src/adapter-config.ts`
- Test: `tests/adapter-config.test.ts`

- [ ] **Step 1: Write failing test**

`tests/adapter-config.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAdapterConfig } from "../cli/src/adapter-config";

test("readAdapterConfig returns null when missing", () => {
  const root = mkdtempSync(join(tmpdir(), "cfg-"));
  expect(readAdapterConfig(root)).toBeNull();
});

test("readAdapterConfig parses model_overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "cfg-"));
  mkdirSync(join(root, ".aos"));
  writeFileSync(
    join(root, ".aos", "adapter.yaml"),
    "platform: claude-code\nmodel_overrides:\n  arbiter: claude-opus-4-6\n",
  );
  const cfg = readAdapterConfig(root);
  expect(cfg?.platform).toBe("claude-code");
  expect(cfg?.model_overrides?.arbiter).toBe("claude-opus-4-6");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/adapter-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `cli/src/adapter-config.ts`:
```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export interface AdapterConfig {
  platform?: string;
  model_overrides?: Partial<Record<string, string>>;
  theme?: string;
  editor?: string;
}

export function readAdapterConfig(root: string): AdapterConfig | null {
  const p = join(root, ".aos", "adapter.yaml");
  if (!existsSync(p)) return null;
  return yaml.load(readFileSync(p, "utf-8")) as AdapterConfig;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/adapter-config.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/adapter-config.ts tests/adapter-config.test.ts
git commit -m "feat(cli): add adapter-config reader for .aos/adapter.yaml"
```

---

## Task 7: Implement Constraint Gauges

**Files:**
- Create: `cli/src/gauges.ts`
- Test: `tests/gauges.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/gauges.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { renderTextGauge, renderRoundOneLiner } from "../cli/src/gauges";

test("renderTextGauge produces a labeled bar with min/max", () => {
  const out = renderTextGauge("TIME", 4.2, 2, 10, "min");
  expect(out).toContain("TIME");
  expect(out).toContain("4.2");
  expect(out).toContain("min: 2");
  expect(out).toContain("max: 10");
});

test("renderRoundOneLiner produces a compact summary", () => {
  const out = renderRoundOneLiner({ round: 3, maxRounds: 8, minutes: 4.2, dollars: 0.45 });
  expect(out).toContain("Round 3/8");
  expect(out).toContain("4.2min");
  expect(out).toContain("$0.45");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/gauges.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `cli/src/gauges.ts`:
```typescript
const BAR_WIDTH = 16;

function color(text: string, code: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function renderTextGauge(
  label: string,
  value: number,
  min: number,
  max: number,
  unit: string,
): string {
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const colored = value < min ? color(bar, "32") : value >= max * 0.9 ? color(bar, "31") : color(bar, "33");
  const valueStr = unit === "$" ? `$${value.toFixed(2)}` : `${value.toFixed(1)} ${unit}`;
  const minStr = unit === "$" ? `$${min}` : `${min}`;
  const maxStr = unit === "$" ? `$${max}` : `${max}`;
  return `  ${label.padEnd(7)} ${valueStr.padEnd(10)} [${colored}] (min: ${minStr}, max: ${maxStr})`;
}

export interface RoundSummary {
  round: number;
  maxRounds: number;
  minutes: number;
  dollars: number;
}

export function renderRoundOneLiner(s: RoundSummary): string {
  return color(`[Round ${s.round}/${s.maxRounds} · ${s.minutes.toFixed(1)}min · $${s.dollars.toFixed(2)}]`, "90");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/gauges.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/gauges.ts tests/gauges.test.ts
git commit -m "feat(cli): add text-mode constraint gauges"
```

---

## Task 8: Add MCP Arg Building to Claude Code Adapter

**Files:**
- Modify: `adapters/claude-code/src/runtime.ts`

- [ ] **Step 1: Read current Claude Code adapter to understand buildArgs**

Read `adapters/claude-code/src/runtime.ts` in full. Find where `buildArgs()` (or equivalent) returns the argv passed to `spawn()`. Note the agent-config flow so we know how to detect "this is the arbiter."

- [ ] **Step 2: Add MCP options to spawn args**

Extend the runtime to accept MCP options on the `MessageOpts` (or via a runtime constructor option). Concretely, add a method or extend spawn options:

```typescript
export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
}

// In ClaudeCodeAgentRuntime:
buildMcpArgs(opts: McpBridgeOptions): string[] {
  const config = JSON.stringify({
    mcpServers: {
      aos: {
        command: "bun",
        args: [opts.bridgeScriptPath],
        env: { AOS_BRIDGE_SOCKET: opts.socketPath },
      },
    },
  });
  return [
    "--mcp-config", config,
    "--strict-mcp-config",
    "--allowedTools", "mcp__aos__delegate mcp__aos__end",
    "--permission-mode", "bypassPermissions",
    "--output-format", "stream-json",
    "--verbose",
  ];
}
```

Make `buildMcpArgs` a public method on `ClaudeCodeAgentRuntime`. The session module (Task 11) will call it and merge results into the spawn args for the arbiter only.

- [ ] **Step 3: Typecheck**

Run: `cd adapters/claude-code && bun x tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add adapters/claude-code/src/runtime.ts
git commit -m "feat(claude-code): add buildMcpArgs for arbiter MCP bridge"
```

---

## Task 9: Add MCP Arg Building to Gemini Adapter

**Files:**
- Modify: `adapters/gemini/src/runtime.ts`

Gemini reads MCP servers from `~/.gemini/settings.json` or project `.gemini/settings.json`. We write a temp settings file under `.aos/.runtime/` and set `GEMINI_SETTINGS_PATH` env (verifying actual env var name).

- [ ] **Step 1: Verify Gemini settings env var**

Run: `gemini --help 2>&1 | grep -i settings; gemini --help 2>&1 | grep -i env` (assumes `gemini` is installed). If `GEMINI_SETTINGS_PATH` is not honored, fall back to writing `<projectRoot>/.gemini/settings.json` (back up any pre-existing one and restore on shutdown).

Document the chosen mechanism in a comment at the top of the new method.

- [ ] **Step 2: Implement buildMcpArgs + buildMcpSettings**

Add to `adapters/gemini/src/runtime.ts`:
```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
  settingsOutPath: string; // e.g., projectRoot/.aos/.runtime/gemini-settings-<sid>.json
}

writeMcpSettings(opts: McpBridgeOptions): void {
  mkdirSync(dirname(opts.settingsOutPath), { recursive: true });
  writeFileSync(opts.settingsOutPath, JSON.stringify({
    mcpServers: {
      aos: {
        command: "bun",
        args: [opts.bridgeScriptPath],
        env: { AOS_BRIDGE_SOCKET: opts.socketPath },
        trust: true,
        timeout: 600000,
      },
    },
  }, null, 2));
}

buildMcpArgs(): string[] {
  return [
    "--yolo",
    "--output-format", "stream-json",
    "--allowed-mcp-server-names", "aos",
  ];
}

mcpEnv(opts: McpBridgeOptions): Record<string, string> {
  return { GEMINI_SETTINGS_PATH: opts.settingsOutPath };
}
```

If verification in Step 1 showed `GEMINI_SETTINGS_PATH` is not respected, replace `mcpEnv` with a method that copies `.gemini/settings.json` into the project root and returns a cleanup callback.

- [ ] **Step 3: Typecheck**

Run: `cd adapters/gemini && bun x tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add adapters/gemini/src/runtime.ts
git commit -m "feat(gemini): add MCP settings writer and arg builder for arbiter"
```

---

## Task 10: Add MCP Arg Building to Codex Adapter

**Files:**
- Modify: `adapters/codex/src/runtime.ts`

- [ ] **Step 1: Implement buildMcpArgs**

Add to `adapters/codex/src/runtime.ts`:
```typescript
export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
}

buildMcpArgs(opts: McpBridgeOptions): string[] {
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-c", `mcp_servers.aos.command="bun"`,
    "-c", `mcp_servers.aos.args=["${opts.bridgeScriptPath}"]`,
    "-c", `mcp_servers.aos.env={AOS_BRIDGE_SOCKET="${opts.socketPath}"}`,
    "-c", `mcp_servers.aos.required=true`,
    "-c", `mcp_servers.aos.enabled_tools=["delegate","end"]`,
    "-c", `mcp_servers.aos.tool_timeout_sec=600`,
  ];
}
```

Note: if Codex is normally invoked without `exec` in this adapter, gate the `"exec"` arg on whether it's already part of the base args.

- [ ] **Step 2: Typecheck**

Run: `cd adapters/codex && bun x tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add adapters/codex/src/runtime.ts
git commit -m "feat(codex): add buildMcpArgs for arbiter MCP bridge"
```

---

## Task 11: Implement adapter-session.ts (Core Orchestration)

**Files:**
- Create: `cli/src/adapter-session.ts`

This is the main module. It loads the adapter, builds the engine, sets up the bridge, spawns the arbiter, and runs the readline loop. Substantial — break implementation into the steps below.

- [ ] **Step 1: Skeleton with config interface and adapter loader**

Create `cli/src/adapter-session.ts`:
```typescript
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import {
  BaseEventBus,
  TerminalUI,
  BaseWorkflow,
  composeAdapter,
  discoverAgents,
  createFlatAgentsDir,
} from "@aos-harness/adapter-shared";
import { AOSEngine } from "@aos-harness/runtime";
import { startBridgeServer } from "./bridge-server";
import { renderTextGauge, renderRoundOneLiner } from "./gauges";

export interface AdapterSessionConfig {
  platform: string;
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

const ADAPTER_MAP: Record<string, { package: string; className: string }> = {
  "claude-code": { package: "@aos-harness/claude-code-adapter", className: "ClaudeCodeAgentRuntime" },
  "gemini":      { package: "@aos-harness/gemini-adapter",      className: "GeminiAgentRuntime" },
  "codex":       { package: "@aos-harness/codex-adapter",       className: "CodexAgentRuntime" },
};

async function loadAdapterRuntime(platform: string): Promise<any> {
  const entry = ADAPTER_MAP[platform];
  if (!entry) throw new Error(`Unknown adapter: ${platform}`);
  try {
    const mod = await import(entry.package);
    return mod[entry.className];
  } catch {
    const here = dirname(fileURLToPath(import.meta.url));
    const fallback = join(here, "..", "..", "adapters", platform, "src", "index.ts");
    const mod = await import(fallback);
    return mod[entry.className];
  }
}

export async function runAdapterSession(config: AdapterSessionConfig): Promise<void> {
  // implemented in subsequent steps
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Add layer composition and engine setup**

Replace the body of `runAdapterSession`:
```typescript
const RuntimeClass = await loadAdapterRuntime(config.platform);

const eventBus = new BaseEventBus();
const agentRuntime = new RuntimeClass(eventBus, config.modelOverrides);
const ui = new TerminalUI();
const workflow = new BaseWorkflow(agentRuntime, config.root);
const adapter = composeAdapter(agentRuntime, eventBus, ui, workflow);

const agentsDir = join(config.root, "core", "agents");
const agentMap = discoverAgents(agentsDir);
const flatAgentsDir = createFlatAgentsDir(config.root, agentMap);
const domainsDir = join(config.root, "core", "domains");

const engine = new AOSEngine(adapter, config.profileDir, {
  agentsDir: flatAgentsDir,
  domain: config.domainName ?? undefined,
  domainDir: config.domainName ? domainsDir : undefined,
});

await engine.start(config.briefPath);
```

- [ ] **Step 3: Add bridge server + steer/halt state**

Append:
```typescript
const sockPath = join(tmpdir(), `aos-bridge-${config.sessionId}.sock`);
const bridgeScriptPath = join(dirname(fileURLToPath(import.meta.url)), "mcp-arbiter-bridge.ts");

let halted = false;
let steerQueue: string[] = [];
let endRequested = false;

async function waitWhileHalted() {
  while (halted) await new Promise((r) => setTimeout(r, 200));
}

function drainSteer(): string {
  if (steerQueue.length === 0) return "";
  const msgs = steerQueue.splice(0);
  return `\n\n[user steer]\n${msgs.join("\n")}\n`;
}

const closeBridge = await startBridgeServer(sockPath, {
  delegate: async (params) => {
    await waitWhileHalted();
    const steer = drainSteer();
    const responses = await engine.delegateMessage(
      params.to as any,
      (params.message as string) + (steer ? `\n\n${steer}` : ""),
    );
    const cs = engine.getConstraintState();
    process.stdout.write(renderRoundOneLiner({
      round: cs.rounds_used ?? 0,
      maxRounds: cs.max_rounds ?? 0,
      minutes: (cs.elapsed_ms ?? 0) / 60000,
      dollars: cs.budget_spent ?? 0,
    }) + "\n");
    return { responses, constraints: cs };
  },
  end: async (params) => {
    await waitWhileHalted();
    const responses = await engine.end(params.closing_message as string);
    endRequested = true;
    return { ok: true, responses };
  },
});
```

(Adjust `engine.end` signature if it differs — read `@aos-harness/runtime` exports to confirm.)

- [ ] **Step 4: Build arbiter spawn args and kick off the arbiter**

Append:
```typescript
const arbiterDir = agentMap.get("arbiter");
if (!arbiterDir) throw new Error("No arbiter agent found in core/agents/");

// Resolve arbiter prompt template (delegate to existing helper or inline; mirror Pi's logic).
// For brevity here, assume `resolveArbiterPrompt` exists or is implemented next to this file.
const resolvedPrompt = await resolveArbiterPrompt({
  arbiterDir,
  sessionId: config.sessionId,
  briefPath: config.briefPath,
  deliberationDir: config.deliberationDir,
  agentMap,
  engine,
  platform: config.platform,
});

adapter.setOrchestratorPrompt(resolvedPrompt);

const mcpOpts = { bridgeScriptPath, socketPath: sockPath };
const mcpArgs = (agentRuntime as any).buildMcpArgs?.(mcpOpts) ?? [];
const mcpEnv = (agentRuntime as any).mcpEnv?.(mcpOpts) ?? {};

if ((agentRuntime as any).writeMcpSettings) {
  (agentRuntime as any).writeMcpSettings({
    ...mcpOpts,
    settingsOutPath: join(config.root, ".aos", ".runtime", `gemini-settings-${config.sessionId}.json`),
  });
}

const arbiterHandle = await adapter.spawnAgent(
  { id: "arbiter", dir: arbiterDir },
  config.sessionId,
  { extraArgs: mcpArgs, extraEnv: mcpEnv },
);
```

(Note: `spawnAgent` signature may need `extraArgs`/`extraEnv` plumbing — if the existing adapter contract doesn't support it, add it as a `MessageOpts` field passed to the runtime; this is a small extension to `BaseAgentRuntime.spawnAgent` to merge extra args/env at process spawn.)

- [ ] **Step 5: Add readline loop + commands + shutdown**

Append:
```typescript
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

ui.registerCommand?.("aos-halt", () => { halted = true; console.log("Deliberation paused. Type /aos-resume to continue."); });
ui.registerCommand?.("aos-resume", () => { halted = false; console.log("Resumed."); });
ui.registerCommand?.("aos-end", () => { steerQueue.push("Please wrap up now and call the end tool."); });
ui.registerCommand?.("aos-status", () => {
  const cs = engine.getConstraintState();
  console.log(renderTextGauge("TIME", (cs.elapsed_ms ?? 0) / 60000, cs.min_minutes ?? 0, cs.max_minutes ?? 0, "min"));
  console.log(renderTextGauge("BUDGET", cs.budget_spent ?? 0, cs.min_budget ?? 0, cs.max_budget ?? 0, "$"));
  console.log(renderTextGauge("ROUNDS", cs.rounds_used ?? 0, cs.min_rounds ?? 0, cs.max_rounds ?? 0, "rounds"));
});
ui.registerCommand?.("aos-steer", (msg: string) => { steerQueue.push(msg); });

rl.on("line", async (input) => {
  const trimmed = input.trim();
  if (!trimmed) return;
  if (trimmed.startsWith("/aos-")) {
    const [cmd, ...rest] = trimmed.slice(1).split(" ");
    await ui.dispatchCommand?.(cmd, rest.join(" "));
  } else {
    steerQueue.push(trimmed);
  }
});

const finalText = await adapter.sendMessage(arbiterHandle, "Begin the deliberation now.");
console.log("\n" + finalText.text);

rl.close();
await closeBridge();
const cs = engine.getConstraintState();
console.log(`\nSession complete. Cost: $${(cs.budget_spent ?? 0).toFixed(4)}, Rounds: ${cs.rounds_used ?? 0}`);
```

(If `TerminalUI.registerCommand`/`dispatchCommand` don't exist, add them as a minimal `Map<string, fn>` in the loop file inline rather than touching shared. The README of `terminal-ui.ts` already mentions `registerTool`; commands are similar and may need a 5-line addition there. If so, do that as part of this step and commit it together with the session module.)

- [ ] **Step 6: Implement resolveArbiterPrompt helper**

At the bottom of `cli/src/adapter-session.ts`, add a helper that mirrors Pi's prompt resolution. Read Pi's `index.ts` around lines 200-340 for the template-vars logic. Copy the substitution. Export the helper if other modules might want it; otherwise keep file-private.

For per-platform tool name substitution:
```typescript
function getToolNamesForPlatform(platform: string) {
  if (platform === "claude-code") return { delegate: "mcp__aos__delegate", end: "mcp__aos__end" };
  return { delegate: "aos.delegate", end: "aos.end" };
}
```

Pass these into the template vars as `delegate_tool` and `end_tool`. Update arbiter prompt templates separately if needed (open question in spec — flag for follow-up).

- [ ] **Step 7: Typecheck**

Run: `cd cli && bun x tsc --noEmit`
Expected: no new errors in adapter-session.ts.

- [ ] **Step 8: Commit**

```bash
git add cli/src/adapter-session.ts
git commit -m "feat(cli): implement runAdapterSession orchestration module"
```

---

## Task 12: Wire adapter-session into run.ts

**Files:**
- Modify: `cli/src/commands/run.ts`

- [ ] **Step 1: Replace the "not yet supported" block**

Edit `cli/src/commands/run.ts` lines 376-385. Replace the entire `else` body with:
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

Add the import at the top of the file:
```typescript
import { runAdapterSession } from "../adapter-session";
import { readAdapterConfig } from "../adapter-config";
```

- [ ] **Step 2: Typecheck**

Run: `cd cli && bun x tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify Pi still works**

Run: `bun run cli/src/index.ts run --adapter pi --profile examples/profiles/quick --brief examples/briefs/sample.md`
Expected: Pi launches and runs as before (the `if pi { ... }` branch is unchanged).

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/run.ts
git commit -m "feat(cli): wire runAdapterSession into aos run command"
```

---

## Task 13: End-to-End Test with Claude Code

**Files:** none (manual test)

- [ ] **Step 1: Confirm `claude` CLI is installed**

Run: `claude --version`
Expected: prints version. If not installed, install via the Claude Code instructions and re-run.

- [ ] **Step 2: Create a minimal test profile if one doesn't exist**

Check `examples/profiles/`. If none works for non-Pi adapters, create `examples/profiles/quick-claude/` with a brief that asks two agents to deliberate on a trivial topic (e.g., "best name for a coffee shop"). Use existing arbiter and 2 perspective agents.

- [ ] **Step 3: Run the adapter end-to-end**

Run: `bun run cli/src/index.ts run --adapter claude-code --profile examples/profiles/quick-claude --brief examples/briefs/coffee-shop.md`

Expected:
- Bridge socket appears under `/tmp/`
- `claude` subprocess starts
- Round one-liners print after each delegate
- Final memo lands in the deliberation dir
- Process exits cleanly with cost summary

- [ ] **Step 4: Diagnose if it fails**

Common failures:
- "permission denied" on tools → confirm `--permission-mode bypassPermissions` is in the args
- Hangs immediately → bridge socket not connecting; check `AOS_BRIDGE_SOCKET` env in spawn
- Tool not found errors from arbiter → MCP-prefixed tool names in prompt; check `getToolNamesForPlatform`

- [ ] **Step 5: Commit any fixes**

If you had to patch anything, commit per fix with descriptive messages.

---

## Task 14: End-to-End Test with Gemini

**Files:** none (manual test)

- [ ] **Step 1: Confirm `gemini` CLI is installed and authed**

Run: `gemini --version` and `gemini -p "say hi" --yolo`

- [ ] **Step 2: Resolve settings.json injection mechanism**

Verify whether `GEMINI_SETTINGS_PATH` env is honored. If not, the adapter must write to `<root>/.gemini/settings.json` and back up any pre-existing one. Patch `adapters/gemini/src/runtime.ts` accordingly.

- [ ] **Step 3: Run end-to-end**

Run: `bun run cli/src/index.ts run --adapter gemini --profile examples/profiles/quick-claude --brief examples/briefs/coffee-shop.md`

Expected: same flow as Claude Code.

- [ ] **Step 4: Commit any fixes**

---

## Task 15: End-to-End Test with Codex

**Files:** none (manual test)

- [ ] **Step 1: Confirm `codex` CLI is installed**

Run: `codex --version`

- [ ] **Step 2: Run end-to-end**

Run: `bun run cli/src/index.ts run --adapter codex --profile examples/profiles/quick-claude --brief examples/briefs/coffee-shop.md`

Expected: same flow as Claude Code.

- [ ] **Step 3: Commit any fixes**

---

## Task 16: Full Test Suite + Typecheck Validation

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 2: Run typecheck across the workspace**

Run: `bun x tsc --noEmit -p cli && bun x tsc --noEmit -p adapters/claude-code && bun x tsc --noEmit -p adapters/gemini && bun x tsc --noEmit -p adapters/codex && bun x tsc --noEmit -p adapters/shared && bun x tsc --noEmit -p adapters/pi`
Expected: no new errors (pre-existing bun-types errors are tolerated).

- [ ] **Step 3: Verify no regressions in Pi**

Run the Pi smoke test from Task 2 Step 4. Confirm it still works.

- [ ] **Step 4: Commit the worktree-final state if any cleanup remains**

If small fix-ups accumulated, batch them:
```bash
git add -A
git commit -m "chore: post-validation cleanup"
```

---

## Open Risks (carry into implementation)

1. **Gemini settings.json mechanism** — verify `GEMINI_SETTINGS_PATH` env support during Task 9 / Task 14; fall back to project-local `.gemini/settings.json` write+restore if needed.
2. **Bridge bundling for npm distribution** — `mcp-arbiter-bridge.ts` must be reachable when the user installs `aos-harness` globally. If `bun run <abs-path>` fails because the file isn't shipped, add `cli/src/mcp-arbiter-bridge.ts` to the package `files` list and verify.
3. **Tool-name templating in arbiter prompts** — existing arbiter prompts may hardcode `delegate(...)` rather than the MCP-prefixed name. May require updating `core/agents/arbiter/prompt.md` to use `{{delegate_tool}}` and `{{end_tool}}` variables.
4. **`spawnAgent` signature** — may not currently accept `extraArgs`/`extraEnv`. Likely a small extension to `BaseAgentRuntime.spawnAgent` and the per-adapter override; do this in Task 11 Step 4 if not already supported.
5. **`engine.end` signature** — verify when implementing Task 11 Step 3.
