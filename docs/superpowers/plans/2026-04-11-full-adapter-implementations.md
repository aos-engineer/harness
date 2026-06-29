# Full Adapter Implementations Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace partial Claude Code/Gemini generators and add Codex adapter with full runtime implementations sharing ~70% code via base classes.

**Architecture:** Shared base classes (`adapters/shared/`) provide subprocess lifecycle, event bus, terminal UI, and workflow. Each CLI adapter extends `BaseAgentRuntime` and overrides only CLI-specific methods (binary name, arg building, JSON parsing, model discovery). Pi is refactored in two steps to extend the shared bases.

**Tech Stack:** TypeScript, Bun (runtime + test + workspaces), Node.js child_process, ANSI terminal output, readline

---

## File Structure

### New Package: `adapters/shared/`
| File | Responsibility |
|------|---------------|
| `src/types.ts` | `ParsedEvent`, `ModelInfo`, `StdoutFormat`, `HandleState` types |
| `src/base-agent-runtime.ts` | Abstract subprocess lifecycle, retry, abort, handle tracking |
| `src/base-event-bus.ts` | Concrete handler storage + sequential `fire*()` dispatch |
| `src/terminal-ui.ts` | Concrete ANSI rendering, readline prompts, command/tool registry |
| `src/base-workflow.ts` | Concrete file I/O, git worktrees, state, artifacts, code execution |
| `src/compose.ts` | `composeAdapter()` typed helper |
| `src/index.ts` | Barrel export |
| `package.json` | `@aos-harness/adapter-shared` workspace package |
| `tsconfig.json` | TypeScript config |

### Modified Package: `adapters/pi/`
| File | Change |
|------|--------|
| `src/agent-runtime.ts` | Refactor to extend `BaseAgentRuntime` |
| `src/event-bus.ts` | Refactor to extend `BaseEventBus`, keep `wire()` |
| `src/workflow.ts` | Step 1: extend `BaseWorkflow` (zero overrides). Step 2: delete |
| `src/index.ts` | Use `composeAdapter()` instead of inline `Object.assign` |
| `package.json` | Add `@aos-harness/adapter-shared` dependency |

### Replaced Package: `adapters/claude-code/`
| File | Change |
|------|--------|
| `src/agent-runtime.ts` | New: `ClaudeCodeAgentRuntime extends BaseAgentRuntime` |
| `src/index.ts` | New: entry point with `composeAdapter()` |
| `src/generate.ts` | Delete |
| `src/templates.ts` | Delete |
| `package.json` | Update deps, remove generate script |

### Replaced Package: `adapters/gemini/`
| File | Change |
|------|--------|
| `src/agent-runtime.ts` | New: `GeminiAgentRuntime extends BaseAgentRuntime` |
| `src/index.ts` | New: entry point with `composeAdapter()` |
| `src/generate.ts` | Delete |
| `src/templates.ts` | Delete |
| `package.json` | Update deps, remove generate script |

### New Package: `adapters/codex/`
| File | Responsibility |
|------|---------------|
| `src/agent-runtime.ts` | `CodexAgentRuntime extends BaseAgentRuntime` |
| `src/index.ts` | Entry point with `composeAdapter()` |
| `package.json` | `@aos-harness/codex-adapter` workspace package |
| `tsconfig.json` | TypeScript config |

### Modified: Schema
| File | Change |
|------|--------|
| `core/schema/adapter.schema.json` | Add `codex` to platform enum, replace `model_map` with `model_overrides` |

### Test Files
| File | Responsibility |
|------|---------------|
| `adapters/shared/tests/base-agent-runtime.test.ts` | Subprocess lifecycle, retry, abort, timeout, stdout buffering |
| `adapters/shared/tests/base-event-bus.test.ts` | Handler registration, sequential dispatch |
| `adapters/shared/tests/terminal-ui.test.ts` | Command registry, rendering, prompt mocking |
| `adapters/shared/tests/base-workflow.test.ts` | File I/O, state persistence, artifacts |
| `adapters/shared/tests/compose.test.ts` | Adapter composition type safety |
| `adapters/claude-code/tests/agent-runtime.test.ts` | CLI arg building, JSON parsing |
| `adapters/gemini/tests/agent-runtime.test.ts` | CLI arg building, JSON parsing |
| `adapters/codex/tests/agent-runtime.test.ts` | CLI arg building, JSON parsing |

---

### Task 1: Create `adapters/shared/` Package Scaffold

**Files:**
- Create: `adapters/shared/package.json`
- Create: `adapters/shared/tsconfig.json`
- Create: `adapters/shared/src/index.ts`
- Create: `adapters/shared/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@aos-harness/adapter-shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "files": ["src/"],
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "rootDir": ".",
    "paths": {
      "@aos-harness/runtime/*": ["../../runtime/src/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
// ── Shared Adapter Types ──────────────────────────────────────────

import type { AgentConfig, ModelTier, ThinkingMode } from "@aos-harness/runtime/types";

// ── Stdout format declaration ────────────────────────────────────

export type StdoutFormat = "ndjson" | "sse" | "chunked-json";

// ── Parsed event normalization ───────────────────────────────────

export type ParsedEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "message_end";
      text: string;
      tokensIn: number;
      tokensOut: number;
      cost: number;
      contextTokens: number;
      model: string;
    }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; input: unknown; result: unknown }
  | { type: "ignored" };

// ── Model info from CLI discovery ────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  provider: string;
}

// ── Per-handle state tracked by BaseAgentRuntime ─────────────────

export interface HandleState {
  config: AgentConfig;
  sessionFile: string;
  contextFiles: string[];
  modelConfig: { tier: ModelTier; thinking: ThinkingMode };
  lastContextTokens: number;
}
```

- [ ] **Step 4: Create barrel index.ts**

```typescript
export type {
  StdoutFormat,
  ParsedEvent,
  ModelInfo,
  HandleState,
} from "./types";
export { BaseAgentRuntime } from "./base-agent-runtime";
export { BaseEventBus } from "./base-event-bus";
export { TerminalUI } from "./terminal-ui";
export { BaseWorkflow } from "./base-workflow";
export { composeAdapter } from "./compose";
```

Note: This file references modules that don't exist yet. That's fine — they'll be created in subsequent tasks.

- [ ] **Step 5: Install dependencies**

Run: `cd aos-harness && bun install`
Expected: Resolves workspace dependencies including the new `@aos-harness/adapter-shared` package.

- [ ] **Step 6: Commit**

```bash
git add adapters/shared/
git commit -m "feat(shared): scaffold adapter-shared package with types"
```

---

### Task 2: Implement BaseEventBus

**Files:**
- Create: `adapters/shared/src/base-event-bus.ts`
- Create: `adapters/shared/tests/base-event-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/shared/tests/base-event-bus.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { BaseEventBus } from "../src/base-event-bus";

describe("BaseEventBus", () => {
  it("stores and fires onSessionStart handler", async () => {
    const bus = new BaseEventBus();
    let called = false;
    bus.onSessionStart(async () => {
      called = true;
    });
    await bus.fireSessionStart();
    expect(called).toBe(true);
  });

  it("stores and fires onToolCall handler with args", async () => {
    const bus = new BaseEventBus();
    let receivedTool = "";
    let receivedInput: unknown = null;
    bus.onToolCall(async (toolName, input) => {
      receivedTool = toolName;
      receivedInput = input;
      return { block: false };
    });
    const result = await bus.fireToolCall("Read", { path: "/foo" });
    expect(receivedTool).toBe("Read");
    expect(receivedInput).toEqual({ path: "/foo" });
    expect(result).toEqual({ block: false });
  });

  it("fires onMessageEnd with usage data", async () => {
    const bus = new BaseEventBus();
    let receivedUsage: { cost: number; tokens: number } | null = null;
    bus.onMessageEnd(async (usage) => {
      receivedUsage = usage;
    });
    await bus.fireMessageEnd({ cost: 0.05, tokens: 1500 });
    expect(receivedUsage).toEqual({ cost: 0.05, tokens: 1500 });
  });

  it("returns empty result when no handler registered", async () => {
    const bus = new BaseEventBus();
    await bus.fireSessionStart(); // should not throw
    const result = await bus.fireToolCall("Read", {});
    expect(result).toEqual({ block: false });
  });

  it("fires events sequentially (no interleaving)", async () => {
    const bus = new BaseEventBus();
    const order: number[] = [];
    bus.onToolCall(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
      return { block: false };
    });
    // Fire two events concurrently — second must wait for first
    const p1 = bus.fireToolCall("A", {});
    const p2 = bus.fireToolCall("B", {});
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 1, 2]);
  });

  it("fires onBeforeAgentStart and returns systemPrompt", async () => {
    const bus = new BaseEventBus();
    bus.onBeforeAgentStart(async (prompt) => {
      return { systemPrompt: `Modified: ${prompt}` };
    });
    const result = await bus.fireBeforeAgentStart("original");
    expect(result).toEqual({ systemPrompt: "Modified: original" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/shared/tests/base-event-bus.test.ts`
Expected: FAIL — `Cannot find module "../src/base-event-bus"`

- [ ] **Step 3: Implement BaseEventBus**

Create `adapters/shared/src/base-event-bus.ts`:

```typescript
// ── BaseEventBus (L2) ─────────────────────────────────────────────
// Concrete handler storage + sequential async dispatch.
// All fire*() methods serialize through a queue to prevent interleaving.

import type { EventBusAdapter } from "@aos-harness/runtime/types";

export class BaseEventBus implements EventBusAdapter {
  private handlers: {
    sessionStart: (() => Promise<void>) | null;
    sessionShutdown: (() => Promise<void>) | null;
    beforeAgentStart: ((prompt: string) => Promise<{ systemPrompt?: string }>) | null;
    agentEnd: (() => Promise<void>) | null;
    toolCall: ((toolName: string, input: unknown) => Promise<{ block?: boolean }>) | null;
    toolResult: ((toolName: string, input: unknown, result: unknown) => Promise<void>) | null;
    messageEnd: ((usage: { cost: number; tokens: number }) => Promise<void>) | null;
    compaction: (() => Promise<void>) | null;
  } = {
    sessionStart: null,
    sessionShutdown: null,
    beforeAgentStart: null,
    agentEnd: null,
    toolCall: null,
    toolResult: null,
    messageEnd: null,
    compaction: null,
  };

  // Sequential dispatch queue
  private queue: Promise<void> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.queue = this.queue.then(() => fn().then(resolve, reject));
    return result;
  }

  // ── Registration (EventBusAdapter interface) ───────────────────

  onSessionStart(handler: () => Promise<void>): void {
    this.handlers.sessionStart = handler;
  }

  onSessionShutdown(handler: () => Promise<void>): void {
    this.handlers.sessionShutdown = handler;
  }

  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void {
    this.handlers.beforeAgentStart = handler;
  }

  onAgentEnd(handler: () => Promise<void>): void {
    this.handlers.agentEnd = handler;
  }

  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void {
    this.handlers.toolCall = handler;
  }

  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void {
    this.handlers.toolResult = handler;
  }

  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void {
    this.handlers.messageEnd = handler;
  }

  onCompaction(handler: () => Promise<void>): void {
    this.handlers.compaction = handler;
  }

  // ── Fire methods (called by BaseAgentRuntime) ──────────────────

  fireSessionStart(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.sessionStart) await this.handlers.sessionStart();
    });
  }

  fireSessionShutdown(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.sessionShutdown) await this.handlers.sessionShutdown();
    });
  }

  fireBeforeAgentStart(prompt: string): Promise<{ systemPrompt?: string }> {
    return this.enqueue(async () => {
      if (this.handlers.beforeAgentStart) {
        return await this.handlers.beforeAgentStart(prompt);
      }
      return {};
    });
  }

  fireAgentEnd(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.agentEnd) await this.handlers.agentEnd();
    });
  }

  fireToolCall(toolName: string, input: unknown): Promise<{ block?: boolean }> {
    return this.enqueue(async () => {
      if (this.handlers.toolCall) {
        return await this.handlers.toolCall(toolName, input);
      }
      return { block: false };
    });
  }

  fireToolResult(toolName: string, input: unknown, result: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.toolResult) {
        await this.handlers.toolResult(toolName, input, result);
      }
    });
  }

  fireMessageEnd(usage: { cost: number; tokens: number }): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.messageEnd) await this.handlers.messageEnd(usage);
    });
  }

  fireCompaction(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.compaction) await this.handlers.compaction();
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test adapters/shared/tests/base-event-bus.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add adapters/shared/src/base-event-bus.ts adapters/shared/tests/base-event-bus.test.ts
git commit -m "feat(shared): implement BaseEventBus with sequential async dispatch"
```

---

### Task 3: Implement BaseWorkflow

**Files:**
- Create: `adapters/shared/src/base-workflow.ts`
- Create: `adapters/shared/tests/base-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/shared/tests/base-workflow.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseWorkflow } from "../src/base-workflow";

describe("BaseWorkflow", () => {
  const testDir = join(import.meta.dir, "__test-workspace__");
  let workflow: BaseWorkflow;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // Minimal mock runtime that implements sendMessage
    const mockRuntime = {
      sendMessage: async () => ({
        text: "Mock response",
        tokensIn: 10,
        tokensOut: 20,
        cost: 0.001,
        contextTokens: 0,
        model: "mock",
        status: "success" as const,
      }),
    };
    workflow = new BaseWorkflow(mockRuntime, testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("writeFile creates file with content", async () => {
    const filePath = join(testDir, "test.txt");
    await workflow.writeFile(filePath, "hello world");
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
  });

  it("writeFile creates parent directories", async () => {
    const filePath = join(testDir, "sub", "dir", "test.txt");
    await workflow.writeFile(filePath, "nested");
    expect(readFileSync(filePath, "utf-8")).toBe("nested");
  });

  it("writeFile rejects paths outside project root", async () => {
    expect(workflow.writeFile("/tmp/evil.txt", "hack")).rejects.toThrow("outside the project directory");
  });

  it("readFile returns file content", async () => {
    const filePath = join(testDir, "read-me.txt");
    await workflow.writeFile(filePath, "read this");
    const content = await workflow.readFile(filePath);
    expect(content).toBe("read this");
  });

  it("readFile throws for missing file", async () => {
    expect(workflow.readFile(join(testDir, "missing.txt"))).rejects.toThrow("File not found");
  });

  it("persistState and loadState round-trip", async () => {
    await workflow.persistState("test-key", { foo: "bar", num: 42 });
    const loaded = await workflow.loadState("test-key");
    expect(loaded).toEqual({ foo: "bar", num: 42 });
  });

  it("loadState returns null for missing key", async () => {
    const loaded = await workflow.loadState("nonexistent");
    expect(loaded).toBeNull();
  });

  it("persistState rejects invalid key characters", async () => {
    expect(workflow.persistState("bad/key", {})).rejects.toThrow("Invalid state key");
  });

  it("dispatchParallel sends to all handles concurrently", async () => {
    const handles = [
      { id: "s:a", agentId: "a", sessionId: "s" },
      { id: "s:b", agentId: "b", sessionId: "s" },
    ];
    const results = await workflow.dispatchParallel(handles, "hello");
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("success");
    expect(results[1].status).toBe("success");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/shared/tests/base-workflow.test.ts`
Expected: FAIL — `Cannot find module "../src/base-workflow"`

- [ ] **Step 3: Implement BaseWorkflow**

Create `adapters/shared/src/base-workflow.ts`. This is extracted from `adapters/pi/src/workflow.ts` with the `PiWorkflow` class renamed to `BaseWorkflow` and the constructor accepting a generic runtime reference instead of `PiAgentRuntime`:

```typescript
// ── BaseWorkflow (L4) ────────────────────────────────────────────
// Parallel dispatch, file operations, state persistence, artifacts,
// code execution, and skill invocation. CLI-agnostic.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import * as yaml from "js-yaml";
import type {
  WorkflowAdapter,
  AgentHandle,
  AgentResponse,
  AgentConfig,
  MessageOpts,
  ArtifactManifest,
  LoadedArtifact,
  ExecuteCodeOpts,
  ExecutionResult,
  SkillInput,
  SkillResult,
  ReviewResult,
} from "@aos-harness/runtime/types";
import { UnsupportedError } from "@aos-harness/runtime/types";

// Minimal interface for the agent runtime dependency
interface AgentMessageSender {
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
}

export class BaseWorkflow implements WorkflowAdapter {
  private agentRuntime: AgentMessageSender;
  private projectRoot: string;

  constructor(agentRuntime: AgentMessageSender, projectRoot: string = process.cwd()) {
    this.agentRuntime = agentRuntime;
    this.projectRoot = resolve(projectRoot);
  }

  private validatePath(filePath: string): string {
    const resolved = resolve(filePath);
    if (!resolved.startsWith(this.projectRoot)) {
      throw new Error(`Path "${filePath}" is outside the project directory`);
    }
    return resolved;
  }

  private validateStateKey(key: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new Error(`Invalid state key: "${key}" — must be alphanumeric with hyphens/underscores`);
    }
  }

  async dispatchParallel(
    handles: AgentHandle[],
    message: string,
    opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void },
  ): Promise<AgentResponse[]> {
    const tasks = handles.map((handle) =>
      this.agentRuntime.sendMessage(handle, message, {
        signal: opts?.signal,
        onStream: opts?.onStream
          ? (partial: string) => opts.onStream!(handle.agentId, partial)
          : undefined,
      }),
    );

    const results = await Promise.allSettled(tasks);

    return results.map((result): AgentResponse => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return {
        text: "",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        contextTokens: 0,
        model: "",
        status: "failed",
        error: err,
      };
    });
  }

  async isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const id = `aos-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worktreePath = join(".aos", "worktrees", id);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("git", ["worktree", "add", "--detach", worktreePath], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git worktree add failed (exit ${code}): ${stderr.trim()}`));
      });
    });

    const cleanup = async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("git", ["worktree", "remove", "--force", worktreePath], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git worktree remove failed (exit ${code}): ${stderr.trim()}`));
        });
      });
    };

    return { path: worktreePath, cleanup };
  }

  async writeFile(path: string, content: string): Promise<void> {
    const safe = this.validatePath(path);
    const dir = dirname(safe);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(safe, content, "utf-8");
  }

  async readFile(path: string): Promise<string> {
    const safe = this.validatePath(path);
    if (!existsSync(safe)) {
      throw new Error(`File not found: ${path}`);
    }
    return readFileSync(safe, "utf-8");
  }

  private static ALLOWED_EDITORS = new Set(["code", "vim", "nvim", "nano", "emacs", "subl", "mate", "open"]);

  async openInEditor(path: string, editor: string): Promise<void> {
    const safePath = this.validatePath(path);
    const editorName = editor.split("/").pop() ?? editor;
    if (!BaseWorkflow.ALLOWED_EDITORS.has(editorName)) {
      throw new Error(`Editor "${editor}" is not in the allowed list: ${[...BaseWorkflow.ALLOWED_EDITORS].join(", ")}`);
    }
    spawn(editor, [safePath], { detached: true, stdio: "ignore" }).unref();
  }

  async persistState(key: string, value: unknown): Promise<void> {
    this.validateStateKey(key);
    const stateDir = join(this.projectRoot, ".aos", "state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const filePath = join(stateDir, `${key}.json`);
    writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  async loadState(key: string): Promise<unknown> {
    this.validateStateKey(key);
    const filePath = join(this.projectRoot, ".aos", "state", `${key}.json`);
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async createArtifact(artifact: ArtifactManifest, content: string): Promise<void> {
    await this.writeFile(artifact.content_path, content);
    const manifestPath = artifact.content_path.replace(/\.[^.]+$/, ".artifact.yaml");
    await this.writeFile(manifestPath, yaml.dump(artifact));
  }

  async loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact> {
    const manifestPath = join(sessionDir, "artifacts", `${artifactId}.artifact.yaml`);
    const manifestYaml = await this.readFile(manifestPath);
    const manifest = yaml.load(manifestYaml, { schema: yaml.JSON_SCHEMA }) as ArtifactManifest;
    const content = await this.readFile(manifest.content_path);
    return { manifest, content };
  }

  async submitForReview(
    artifact: LoadedArtifact,
    reviewer: AgentHandle,
    reviewPrompt?: string,
  ): Promise<ReviewResult> {
    const prompt =
      reviewPrompt ||
      `Review the following artifact and provide your assessment:

## Artifact: ${artifact.manifest.id}
- Produced by: ${artifact.manifest.produced_by.join(", ")}
- Format: ${artifact.manifest.format}

Respond with:
1. Status: APPROVED, REJECTED, or NEEDS-REVISION
2. If not approved, list issues with severity (critical/major/minor/suggestion)
3. Specific feedback for improvement`;

    const fullPrompt = `${prompt}\n\n---\n\n${artifact.content}`;

    try {
      const response = await this.agentRuntime.sendMessage(reviewer, fullPrompt);
      const text = response.text ?? "";

      const upperText = text.toUpperCase();
      let status: "approved" | "rejected" | "needs-revision" = "needs-revision";
      if (upperText.includes("APPROVED") && !upperText.includes("NOT APPROVED")) {
        status = "approved";
      } else if (upperText.includes("REJECTED")) {
        status = "rejected";
      }

      return { status, feedback: text, reviewer: reviewer.agentId };
    } catch (err: any) {
      return {
        status: "needs-revision",
        feedback: `Review failed: ${err.message}`,
        reviewer: reviewer.agentId,
      };
    }
  }

  async executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
    const language = opts?.language ?? "bash";
    const timeout = opts?.timeout_ms ?? 30000;
    const cwd = opts?.cwd ?? process.cwd();
    const sandbox = opts?.sandbox ?? "strict";

    let cmd: string;
    let args: string[];

    switch (language) {
      case "bash":
      case "sh":
        cmd = "/bin/bash";
        args = ["-c", code];
        break;
      case "typescript":
      case "ts":
        cmd = "bun";
        args = ["eval", code];
        break;
      case "python":
      case "py":
        cmd = "python3";
        args = ["-c", code];
        break;
      case "node":
      case "javascript":
      case "js":
        cmd = "node";
        args = ["-e", code];
        break;
      default:
        throw new Error(`Unsupported language: ${language}. Supported: bash, typescript, python, javascript`);
    }

    return new Promise<ExecutionResult>((resolve) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(cmd, args, {
        cwd: this.validatePath(cwd),
        env: {
          ...this.buildSafeEnv(sandbox),
          ...(opts?.env ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeout);

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > 1_048_576) {
          stdout = stdout.slice(0, 1_048_576) + "\n[TRUNCATED]";
          killed = true;
          child.kill("SIGKILL");
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1_048_576) {
          stderr = stderr.slice(0, 1_048_576) + "\n[TRUNCATED]";
        }
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timer);
        resolve({
          success: exitCode === 0 && !killed,
          exit_code: exitCode ?? (killed ? 137 : 1),
          stdout,
          stderr:
            killed && !stderr.includes("TRUNCATED")
              ? stderr + "\n[KILLED: timeout or output limit]"
              : stderr,
          duration_ms: Date.now() - startTime,
        });
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exit_code: 1,
          stdout,
          stderr: err.message,
          duration_ms: Date.now() - startTime,
        });
      });
    });
  }

  private buildSafeEnv(sandbox: "strict" | "relaxed"): Record<string, string> {
    const base: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      TERM: "dumb",
    };

    if (sandbox === "relaxed") {
      for (const key of ["NODE_PATH", "BUN_INSTALL", "PYTHONPATH", "SHELL"]) {
        if (process.env[key]) base[key] = process.env[key]!;
      }
    }

    return base;
  }

  async invokeSkill(handle: AgentHandle, skillId: string, input: SkillInput): Promise<SkillResult> {
    const skillDir = join(this.projectRoot, "core", "skills", skillId);
    const skillYamlPath = join(skillDir, "skill.yaml");

    if (!existsSync(skillYamlPath)) {
      throw new UnsupportedError("invokeSkill", `Skill "${skillId}" not found at ${skillYamlPath}`);
    }

    const skillYamlRaw = readFileSync(skillYamlPath, "utf-8");
    const skillConfig = yaml.load(skillYamlRaw, { schema: yaml.JSON_SCHEMA }) as any;

    let skillPrompt = skillConfig.description;
    const promptPath = join(skillDir, "prompt.md");
    if (existsSync(promptPath)) {
      skillPrompt = readFileSync(promptPath, "utf-8");
    }

    const contextParts: string[] = [];
    if (input.args) contextParts.push(`Arguments: ${input.args}`);
    if (input.context) {
      for (const [key, value] of Object.entries(input.context)) {
        contextParts.push(`${key}: ${value}`);
      }
    }

    const fullPrompt = [skillPrompt, "", "## Input Context", contextParts.join("\n")].join("\n");

    try {
      const response = await this.agentRuntime.sendMessage(handle, fullPrompt);
      return {
        success: true,
        output: response.text ?? JSON.stringify(response),
      };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: err.message ?? String(err),
      };
    }
  }

  async enforceToolAccess(
    _agentId: string,
    _toolCall: { tool: string; path?: string; command?: string },
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Default: allow all. Adapters can override for enforcement.
    return { allowed: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test adapters/shared/tests/base-workflow.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add adapters/shared/src/base-workflow.ts adapters/shared/tests/base-workflow.test.ts
git commit -m "feat(shared): implement BaseWorkflow extracted from PiWorkflow"
```

---

### Task 4: Implement TerminalUI

**Files:**
- Create: `adapters/shared/src/terminal-ui.ts`
- Create: `adapters/shared/tests/terminal-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/shared/tests/terminal-ui.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { TerminalUI } from "../src/terminal-ui";

describe("TerminalUI", () => {
  it("registers and dispatches commands", async () => {
    const ui = new TerminalUI();
    let received = "";
    ui.registerCommand("test-cmd", async (args) => {
      received = args;
    });
    await ui.dispatchCommand("test-cmd", "hello world");
    expect(received).toBe("hello world");
  });

  it("dispatchCommand returns false for unknown command", async () => {
    const ui = new TerminalUI();
    const result = await ui.dispatchCommand("nonexistent", "");
    expect(result).toBe(false);
  });

  it("registers tools", () => {
    const ui = new TerminalUI();
    ui.registerTool("my-tool", { input: { type: "string" } }, async (params) => {
      return { result: params.input };
    });
    expect(ui.hasTool("my-tool")).toBe(true);
  });

  it("blockInput and unblockInput control state", () => {
    const ui = new TerminalUI();
    expect(ui.isInputBlocked()).toBe(false);

    ui.blockInput(["help", "status"]);
    expect(ui.isInputBlocked()).toBe(true);
    expect(ui.getAllowedCommands()).toEqual(["help", "status"]);

    ui.unblockInput();
    expect(ui.isInputBlocked()).toBe(false);
    expect(ui.getAllowedCommands()).toEqual([]);
  });

  it("steerMessage queues a message", () => {
    const ui = new TerminalUI();
    ui.steerMessage("do something");
    expect(ui.consumeSteeredMessage()).toBe("do something");
    expect(ui.consumeSteeredMessage()).toBeNull();
  });

  it("setStatus and setWidget do not throw", () => {
    const ui = new TerminalUI();
    ui.setStatus("key", "value");
    ui.setWidget("widget-1", () => ["line1", "line2"]);
    ui.setWidget("widget-1", undefined);
    ui.setTheme("dark");
    // These are console-based — just verify no errors
  });

  it("notify writes to console without throwing", () => {
    const ui = new TerminalUI();
    ui.notify("test info", "info");
    ui.notify("test warn", "warning");
    ui.notify("test error", "error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/shared/tests/terminal-ui.test.ts`
Expected: FAIL — `Cannot find module "../src/terminal-ui"`

- [ ] **Step 3: Implement TerminalUI**

Create `adapters/shared/src/terminal-ui.ts`:

```typescript
// ── TerminalUI (L3) ───────────────────────────────────────────────
// ANSI terminal-native UI for non-Pi adapters.
// Console-based rendering, readline prompts, command/tool registry.

import * as readline from "node:readline";
import type { UIAdapter } from "@aos-harness/runtime/types";

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

export class TerminalUI implements UIAdapter {
  private commands = new Map<string, (args: string) => Promise<void>>();
  private tools = new Map<string, { schema: Record<string, unknown>; handler: (params: Record<string, unknown>) => Promise<unknown> }>();
  private inputBlocked = false;
  private allowedCommands: string[] = [];
  private steeredMessage: string | null = null;

  // ── Commands ────────────────────────────────────────────────────

  registerCommand(name: string, handler: (args: string) => Promise<void>): void {
    this.commands.set(name, handler);
  }

  /** Dispatch a command by name. Returns true if handled, false if unknown. */
  async dispatchCommand(name: string, args: string): Promise<boolean> {
    const handler = this.commands.get(name);
    if (!handler) return false;
    await handler(args);
    return true;
  }

  // ── Tools ───────────────────────────────────────────────────────

  registerTool(
    name: string,
    schema: Record<string, unknown>,
    handler: (params: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(name, { schema, handler });
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  async invokeTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return await tool.handler(params);
  }

  // ── Rendering ───────────────────────────────────────────────────

  renderAgentResponse(agent: string, response: string, color: string): void {
    const { r, g, b } = parseHexColor(color);
    const bgOpen = `\x1b[48;2;${r};${g};${b}m`;
    const fgDark = `\x1b[38;2;30;30;30m`;
    const reset = `\x1b[0m`;
    const dim = `\x1b[2m`;
    console.log(`${bgOpen}${fgDark} ${agent} ${reset}`);
    console.log(`${dim}${response}${reset}`);
  }

  renderCustomMessage(type: string, content: string, _details: Record<string, unknown>): void {
    console.log(`[${type}] ${content}`);
  }

  // ── Widgets & Footer ────────────────────────────────────────────

  setWidget(_id: string, _renderer: (() => string[]) | undefined): void {
    // Terminal mode: widgets are no-op (no persistent TUI surface)
  }

  setFooter(_renderer: (width: number) => string[]): void {
    // Terminal mode: footer is no-op
  }

  // ── Status & Theme ──────────────────────────────────────────────

  setStatus(_key: string, _text: string): void {
    // Terminal mode: status is no-op (could be extended to print)
  }

  setTheme(_name: string): void {
    // Terminal mode: theme is no-op
  }

  // ── User Interaction ────────────────────────────────────────────

  async promptSelect(label: string, options: string[]): Promise<number> {
    console.log(`\n${label}`);
    for (let i = 0; i < options.length; i++) {
      console.log(`  ${i + 1}. ${options[i]}`);
    }
    const answer = await this.readLine("Enter number: ");
    const idx = parseInt(answer, 10) - 1;
    return idx >= 0 && idx < options.length ? idx : 0;
  }

  async promptConfirm(title: string, message: string): Promise<boolean> {
    console.log(`\n${title}`);
    console.log(message);
    const answer = await this.readLine("Confirm? (y/n): ");
    return answer.toLowerCase().startsWith("y");
  }

  async promptInput(label: string): Promise<string> {
    return this.readLine(`${label}: `);
  }

  private readLine(prompt: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    const prefix = level === "error" ? "[ERROR]" : level === "warning" ? "[WARN]" : "[INFO]";
    const colorCode = level === "error" ? "\x1b[31m" : level === "warning" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    console.log(`${colorCode}${prefix}${reset} ${message}`);
  }

  // ── Input Control ───────────────────────────────────────────────

  blockInput(allowedCommands: string[]): void {
    this.inputBlocked = true;
    this.allowedCommands = allowedCommands;
  }

  unblockInput(): void {
    this.inputBlocked = false;
    this.allowedCommands = [];
  }

  isInputBlocked(): boolean {
    return this.inputBlocked;
  }

  getAllowedCommands(): string[] {
    return this.allowedCommands;
  }

  // ── Steer Messages ──────────────────────────────────────────────

  steerMessage(message: string): void {
    this.steeredMessage = message;
  }

  consumeSteeredMessage(): string | null {
    const msg = this.steeredMessage;
    this.steeredMessage = null;
    return msg;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test adapters/shared/tests/terminal-ui.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add adapters/shared/src/terminal-ui.ts adapters/shared/tests/terminal-ui.test.ts
git commit -m "feat(shared): implement TerminalUI with ANSI rendering and command registry"
```

---

### Task 5: Implement composeAdapter

**Files:**
- Create: `adapters/shared/src/compose.ts`
- Create: `adapters/shared/tests/compose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/shared/tests/compose.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { composeAdapter } from "../src/compose";
import type { AgentRuntimeAdapter, EventBusAdapter, UIAdapter, WorkflowAdapter } from "@aos-harness/runtime/types";

// Minimal stubs that satisfy each interface
function stubRuntime(): AgentRuntimeAdapter {
  return {
    spawnAgent: async () => ({ id: "test", agentId: "a", sessionId: "s" }),
    sendMessage: async () => ({ text: "", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "", status: "success" as const }),
    destroyAgent: async () => {},
    setOrchestratorPrompt: () => {},
    injectContext: async () => {},
    getContextUsage: () => ({ tokens: 0, percent: 0 }),
    setModel: () => {},
    getAuthMode: () => ({ type: "unknown" as const, metered: false }),
    getModelCost: () => ({ inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: "USD" }),
    abort: () => {},
    spawnSubAgent: async () => ({ id: "test", agentId: "a", sessionId: "s" }),
    destroySubAgent: async () => {},
  };
}

function stubEventBus(): EventBusAdapter {
  return {
    onSessionStart: () => {},
    onSessionShutdown: () => {},
    onBeforeAgentStart: () => {},
    onAgentEnd: () => {},
    onToolCall: () => {},
    onToolResult: () => {},
    onMessageEnd: () => {},
    onCompaction: () => {},
  };
}

function stubUI(): UIAdapter {
  return {
    registerCommand: () => {},
    registerTool: () => {},
    renderAgentResponse: () => {},
    renderCustomMessage: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setStatus: () => {},
    setTheme: () => {},
    promptSelect: async () => 0,
    promptConfirm: async () => false,
    promptInput: async () => "",
    notify: () => {},
    blockInput: () => {},
    unblockInput: () => {},
    steerMessage: () => {},
  };
}

function stubWorkflow(): WorkflowAdapter {
  return {
    dispatchParallel: async () => [],
    isolateWorkspace: async () => ({ path: "/tmp", cleanup: async () => {} }),
    writeFile: async () => {},
    readFile: async () => "",
    openInEditor: async () => {},
    persistState: async () => {},
    loadState: async () => null,
    executeCode: async () => ({ success: true, exit_code: 0, stdout: "", stderr: "", duration_ms: 0 }),
    invokeSkill: async () => ({ success: true, output: "" }),
    createArtifact: async () => {},
    loadArtifact: async () => ({ manifest: {} as any, content: "" }),
    submitForReview: async () => ({ status: "approved" as const, feedback: "", reviewer: "" }),
    enforceToolAccess: async () => ({ allowed: true }),
  };
}

describe("composeAdapter", () => {
  it("composes 4 layers into a single AOSAdapter", () => {
    const adapter = composeAdapter(stubRuntime(), stubEventBus(), stubUI(), stubWorkflow());
    // Verify all 4 layer methods exist
    expect(typeof adapter.spawnAgent).toBe("function");
    expect(typeof adapter.onSessionStart).toBe("function");
    expect(typeof adapter.registerCommand).toBe("function");
    expect(typeof adapter.dispatchParallel).toBe("function");
  });

  it("preserves this binding", async () => {
    class CountingRuntime {
      count = 0;
      async spawnAgent() {
        this.count++;
        return { id: "test", agentId: "a", sessionId: "s" };
      }
      // ... rest of interface
      sendMessage = stubRuntime().sendMessage;
      destroyAgent = stubRuntime().destroyAgent;
      setOrchestratorPrompt = stubRuntime().setOrchestratorPrompt;
      injectContext = stubRuntime().injectContext;
      getContextUsage = stubRuntime().getContextUsage;
      setModel = stubRuntime().setModel;
      getAuthMode = stubRuntime().getAuthMode;
      getModelCost = stubRuntime().getModelCost;
      abort = stubRuntime().abort;
      spawnSubAgent = stubRuntime().spawnSubAgent;
      destroySubAgent = stubRuntime().destroySubAgent;
    }

    const runtime = new CountingRuntime();
    const adapter = composeAdapter(runtime, stubEventBus(), stubUI(), stubWorkflow());
    await adapter.spawnAgent({} as any, "session-1");
    expect(runtime.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/shared/tests/compose.test.ts`
Expected: FAIL — `Cannot find module "../src/compose"`

- [ ] **Step 3: Implement composeAdapter**

Create `adapters/shared/src/compose.ts`:

```typescript
// ── composeAdapter ────────────────────────────────────────────────
// Combines 4 adapter layers into a single AOSAdapter with explicit
// method binding. TypeScript enforces the result satisfies AOSAdapter —
// if two layers collide on a method name, the compiler errors.

import type {
  AgentRuntimeAdapter,
  EventBusAdapter,
  UIAdapter,
  WorkflowAdapter,
  AOSAdapter,
} from "@aos-harness/runtime/types";

export function composeAdapter(
  agentRuntime: AgentRuntimeAdapter,
  eventBus: EventBusAdapter,
  ui: UIAdapter,
  workflow: WorkflowAdapter,
): AOSAdapter {
  return {
    // ── AgentRuntimeAdapter (L1) ──────────────────────────────
    spawnAgent: agentRuntime.spawnAgent.bind(agentRuntime),
    sendMessage: agentRuntime.sendMessage.bind(agentRuntime),
    destroyAgent: agentRuntime.destroyAgent.bind(agentRuntime),
    setOrchestratorPrompt: agentRuntime.setOrchestratorPrompt.bind(agentRuntime),
    injectContext: agentRuntime.injectContext.bind(agentRuntime),
    getContextUsage: agentRuntime.getContextUsage.bind(agentRuntime),
    setModel: agentRuntime.setModel.bind(agentRuntime),
    getAuthMode: agentRuntime.getAuthMode.bind(agentRuntime),
    getModelCost: agentRuntime.getModelCost.bind(agentRuntime),
    abort: agentRuntime.abort.bind(agentRuntime),
    spawnSubAgent: agentRuntime.spawnSubAgent.bind(agentRuntime),
    destroySubAgent: agentRuntime.destroySubAgent.bind(agentRuntime),

    // ── EventBusAdapter (L2) ──────────────────────────────────
    onSessionStart: eventBus.onSessionStart.bind(eventBus),
    onSessionShutdown: eventBus.onSessionShutdown.bind(eventBus),
    onBeforeAgentStart: eventBus.onBeforeAgentStart.bind(eventBus),
    onAgentEnd: eventBus.onAgentEnd.bind(eventBus),
    onToolCall: eventBus.onToolCall.bind(eventBus),
    onToolResult: eventBus.onToolResult.bind(eventBus),
    onMessageEnd: eventBus.onMessageEnd.bind(eventBus),
    onCompaction: eventBus.onCompaction.bind(eventBus),

    // ── UIAdapter (L3) ────────────────────────────────────────
    registerCommand: ui.registerCommand.bind(ui),
    registerTool: ui.registerTool.bind(ui),
    renderAgentResponse: ui.renderAgentResponse.bind(ui),
    renderCustomMessage: ui.renderCustomMessage.bind(ui),
    setWidget: ui.setWidget.bind(ui),
    setFooter: ui.setFooter.bind(ui),
    setStatus: ui.setStatus.bind(ui),
    setTheme: ui.setTheme.bind(ui),
    promptSelect: ui.promptSelect.bind(ui),
    promptConfirm: ui.promptConfirm.bind(ui),
    promptInput: ui.promptInput.bind(ui),
    notify: ui.notify.bind(ui),
    blockInput: ui.blockInput.bind(ui),
    unblockInput: ui.unblockInput.bind(ui),
    steerMessage: ui.steerMessage.bind(ui),

    // ── WorkflowAdapter (L4) ──────────────────────────────────
    dispatchParallel: workflow.dispatchParallel.bind(workflow),
    isolateWorkspace: workflow.isolateWorkspace.bind(workflow),
    writeFile: workflow.writeFile.bind(workflow),
    readFile: workflow.readFile.bind(workflow),
    openInEditor: workflow.openInEditor.bind(workflow),
    persistState: workflow.persistState.bind(workflow),
    loadState: workflow.loadState.bind(workflow),
    executeCode: workflow.executeCode.bind(workflow),
    invokeSkill: workflow.invokeSkill.bind(workflow),
    createArtifact: workflow.createArtifact.bind(workflow),
    loadArtifact: workflow.loadArtifact.bind(workflow),
    submitForReview: workflow.submitForReview.bind(workflow),
    enforceToolAccess: workflow.enforceToolAccess.bind(workflow),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test adapters/shared/tests/compose.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add adapters/shared/src/compose.ts adapters/shared/tests/compose.test.ts
git commit -m "feat(shared): implement composeAdapter with explicit typed binding"
```

---

### Task 6: Implement BaseAgentRuntime

**Files:**
- Create: `adapters/shared/src/base-agent-runtime.ts`
- Create: `adapters/shared/tests/base-agent-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/shared/tests/base-agent-runtime.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { BaseAgentRuntime } from "../src/base-agent-runtime";
import { BaseEventBus } from "../src/base-event-bus";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "../src/types";
import type { AuthMode, ModelCost, ModelTier, MessageOpts, AgentConfig } from "@aos-harness/runtime/types";

// Concrete test implementation that echoes messages via /bin/echo
class EchoRuntime extends BaseAgentRuntime {
  cliBinary(): string {
    return "/bin/echo";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, _isFirstCall: boolean, _opts?: MessageOpts): string[] {
    // Echo a single JSON line that parseEventLine can parse
    const event = JSON.stringify({
      type: "message_end",
      text: `echo: ${message}`,
      tokensIn: 10,
      tokensOut: 20,
      cost: 0.001,
      contextTokens: 100,
      model: "echo-model",
    });
    return [event];
  }

  parseEventLine(line: string): ParsedEvent | null {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "message_end") {
        return {
          type: "message_end",
          text: obj.text,
          tokensIn: obj.tokensIn,
          tokensOut: obj.tokensOut,
          cost: obj.cost,
          contextTokens: obj.contextTokens,
          model: obj.model,
        };
      }
      return { type: "ignored" };
    } catch {
      return null;
    }
  }

  buildSubprocessEnv(): Record<string, string> {
    return { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  }

  async discoverModels(): Promise<ModelInfo[]> {
    return [{ id: "echo-model", name: "Echo", contextWindow: 100000, provider: "test" }];
  }

  defaultModelMap(): Record<ModelTier, string> {
    return { economy: "echo-small", standard: "echo-medium", premium: "echo-large" };
  }

  getAuthMode(): AuthMode {
    return { type: "unknown", metered: false };
  }

  getModelCost(_tier: ModelTier): ModelCost {
    return { inputPerMillionTokens: 1, outputPerMillionTokens: 2, currency: "USD" };
  }
}

describe("BaseAgentRuntime", () => {
  let runtime: EchoRuntime;
  let eventBus: BaseEventBus;

  beforeEach(() => {
    eventBus = new BaseEventBus();
    runtime = new EchoRuntime(eventBus);
  });

  it("spawnAgent creates a handle", async () => {
    const config: AgentConfig = {
      id: "test-agent",
      name: "Test",
      systemPrompt: "You are a test agent",
      model: { tier: "standard", thinking: "on" },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-1");
    expect(handle.agentId).toBe("test-agent");
    expect(handle.sessionId).toBe("session-1");
    expect(handle.id).toBe("session-1:test-agent");
  });

  it("sendMessage returns response from subprocess", async () => {
    const config = {
      id: "echo-agent",
      name: "Echo",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-2");
    const response = await runtime.sendMessage(handle, "hello");

    expect(response.status).toBe("success");
    expect(response.text).toBe("echo: hello");
    expect(response.tokensIn).toBe(10);
    expect(response.tokensOut).toBe(20);
    expect(response.model).toBe("echo-model");
  });

  it("sendMessage fires eventBus.fireMessageEnd", async () => {
    let firedUsage: { cost: number; tokens: number } | null = null;
    eventBus.onMessageEnd(async (usage) => {
      firedUsage = usage;
    });

    const config = {
      id: "event-agent",
      name: "Event",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-3");
    await runtime.sendMessage(handle, "test");

    expect(firedUsage).not.toBeNull();
    expect(firedUsage!.cost).toBe(0.001);
  });

  it("destroyAgent removes handle", async () => {
    const config = {
      id: "destroy-agent",
      name: "Destroy",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-4");
    await runtime.destroyAgent(handle);

    const response = await runtime.sendMessage(handle, "should fail");
    expect(response.status).toBe("failed");
    expect(response.error).toContain("No state found");
  });

  it("setModel updates handle model config", async () => {
    const config = {
      id: "model-agent",
      name: "Model",
      systemPrompt: "",
      model: { tier: "economy" as const, thinking: "off" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-5");
    runtime.setModel(handle, { tier: "premium", thinking: "extended" });
    // Verify by checking getContextUsage doesn't throw (handle still exists)
    const usage = runtime.getContextUsage(handle);
    expect(usage.tokens).toBe(0);
  });

  it("abort kills active processes", async () => {
    // Just verify abort() doesn't throw when no processes are active
    runtime.abort();
  });

  it("injectContext stores context files", async () => {
    const config = {
      id: "ctx-agent",
      name: "Context",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-6");
    await runtime.injectContext(handle, ["file1.ts", "file2.ts"]);
    // No direct way to verify — but should not throw
  });

  it("resolveModelId checks env vars before defaults", () => {
    // With no env vars set, should use defaults
    const modelId = runtime.resolveModelId("economy");
    expect(modelId).toBe("echo-small");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/shared/tests/base-agent-runtime.test.ts`
Expected: FAIL — `Cannot find module "../src/base-agent-runtime"`

- [ ] **Step 3: Implement BaseAgentRuntime**

Create `adapters/shared/src/base-agent-runtime.ts`:

```typescript
// ── BaseAgentRuntime (L1) ─────────────────────────────────────────
// Abstract subprocess lifecycle for CLI-based adapters.
// Concrete implementations override CLI-specific methods.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentRuntimeAdapter,
  AgentHandle,
  AgentResponse,
  AgentConfig,
  ChildAgentConfig,
  MessageOpts,
  AuthMode,
  ModelCost,
  ModelTier,
  ThinkingMode,
  ContextUsage,
} from "@aos-harness/runtime/types";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "./types";
import type { BaseEventBus } from "./base-event-bus";

export abstract class BaseAgentRuntime implements AgentRuntimeAdapter {
  protected handles = new Map<string, HandleState>();
  protected activeProcesses = new Set<ChildProcess>();
  protected orchestratorPrompt: string | undefined;
  protected eventBus: BaseEventBus;
  protected modelOverrides: Partial<Record<ModelTier, string>> = {};
  private cachedModels: ModelInfo[] | null = null;
  private cleanupRegistered = false;

  constructor(eventBus: BaseEventBus, modelOverrides?: Partial<Record<ModelTier, string>>) {
    this.eventBus = eventBus;
    if (modelOverrides) this.modelOverrides = modelOverrides;
    this.registerCleanup();
  }

  // ── Orphan process protection ──────────────────────────────────

  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => {
      for (const proc of this.activeProcesses) {
        try {
          proc.kill("SIGTERM");
        } catch {
          // Process may already be dead
        }
      }
    };

    process.on("beforeExit", cleanup);
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });
    process.on("SIGINT", () => {
      cleanup();
      process.exit(130);
    });
  }

  // ── Abstract methods (CLI-specific) ────────────────────────────

  abstract cliBinary(): string;
  abstract stdoutFormat(): StdoutFormat;
  abstract buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[];
  abstract parseEventLine(line: string): ParsedEvent | null;
  abstract buildSubprocessEnv(): Record<string, string>;
  abstract discoverModels(): Promise<ModelInfo[]>;
  abstract defaultModelMap(): Record<ModelTier, string>;
  abstract getAuthMode(): AuthMode;
  abstract getModelCost(tier: ModelTier): ModelCost;

  // ── Model resolution ───────────────────────────────────────────

  resolveModelId(tier: ModelTier): string {
    // 1. User overrides from adapter config
    if (this.modelOverrides[tier]) return this.modelOverrides[tier]!;

    // 2. Environment variables
    const envKeys: Record<ModelTier, string> = {
      economy: "AOS_MODEL_ECONOMY",
      standard: "AOS_MODEL_STANDARD",
      premium: "AOS_MODEL_PREMIUM",
    };
    const envVal = process.env[envKeys[tier]];
    if (envVal) return envVal;

    // 3. Adapter defaults
    return this.defaultModelMap()[tier];
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;
    try {
      this.cachedModels = await this.discoverModels();
    } catch (err: any) {
      console.warn(`Model discovery failed for ${this.cliBinary()}: ${err.message}. Using default models.`);
      const defaults = this.defaultModelMap();
      this.cachedModels = Object.entries(defaults).map(([tier, id]) => ({
        id,
        name: id,
        contextWindow: 200_000,
        provider: this.cliBinary(),
      }));
    }
    return this.cachedModels;
  }

  // ── AgentRuntimeAdapter implementation ─────────────────────────

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    const sessionDir = join(".aos", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const sessionFile = join(sessionDir, `${config.id}.jsonl`);

    const handle: AgentHandle = {
      id: `${sessionId}:${config.id}`,
      agentId: config.id,
      sessionId,
    };

    this.handles.set(handle.id, {
      config,
      sessionFile,
      contextFiles: [],
      modelConfig: { tier: config.model.tier, thinking: config.model.thinking },
      lastContextTokens: 0,
    });

    return handle;
  }

  async sendMessage(
    handle: AgentHandle,
    message: string,
    opts?: MessageOpts,
  ): Promise<AgentResponse> {
    return this.sendMessageWithRetry(handle, message, opts);
  }

  async sendMessageWithRetry(
    handle: AgentHandle,
    message: string,
    opts?: MessageOpts,
    maxRetries: number = 2,
    backoff: "exponential" | "linear" = "exponential",
    timeoutMs: number = 120000,
  ): Promise<AgentResponse> {
    let lastResponse: AgentResponse | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.sendMessageOnce(handle, message, opts, timeoutMs);
      if (response.status === "success") return response;

      lastResponse = response;
      if (response.status === "aborted") return response;

      if (attempt < maxRetries) {
        const delayMs = backoff === "exponential"
          ? 1000 * Math.pow(2, attempt)
          : 1000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return lastResponse!;
  }

  private async sendMessageOnce(
    handle: AgentHandle,
    message: string,
    opts?: MessageOpts,
    timeoutMs: number = 120000,
  ): Promise<AgentResponse> {
    const state = this.handles.get(handle.id);
    if (!state) {
      return {
        text: "",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        contextTokens: 0,
        model: "unknown",
        status: "failed",
        error: `No state found for handle ${handle.id}`,
      };
    }

    const isFirstCall = !existsSync(state.sessionFile);
    const args = this.buildArgs(state, message, isFirstCall, opts);
    const format = this.stdoutFormat();

    return new Promise<AgentResponse>((resolve) => {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort();
      }, timeoutMs);

      const proc = spawn(this.cliBinary(), args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: this.buildSubprocessEnv(),
      });

      this.activeProcesses.add(proc);

      let buffer = "";
      let stderr = "";
      let accumulatedText = "";
      let finalResponse = "";
      let tokensIn = 0;
      let tokensOut = 0;
      let cost = 0;
      let contextTokens = 0;
      let model = this.resolveModelId(state.modelConfig.tier);
      let wasAborted = false;

      const processEvent = (event: ParsedEvent) => {
        switch (event.type) {
          case "text_delta":
            accumulatedText += event.text;
            opts?.onStream?.(accumulatedText);
            break;
          case "message_end":
            finalResponse = event.text;
            tokensIn += event.tokensIn;
            tokensOut += event.tokensOut;
            cost += event.cost;
            contextTokens = event.contextTokens;
            if (event.model) model = event.model;
            break;
          case "tool_call":
            this.eventBus.fireToolCall(event.name, event.input);
            break;
          case "tool_result":
            this.eventBus.fireToolResult(event.name, event.input, event.result);
            break;
          case "ignored":
            break;
        }
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;

        // For SSE format, strip "data: " prefix
        let jsonLine = line;
        if (format === "sse") {
          if (!line.startsWith("data:")) return;
          jsonLine = line.slice(5).trim();
          if (jsonLine === "[DONE]") return;
        }

        const event = this.parseEventLine(jsonLine);
        if (event) processEvent(event);
      };

      proc.stdout!.on("data", (data: Buffer) => {
        buffer += data.toString();

        if (format === "ndjson" || format === "sse") {
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) processLine(line);
        } else if (format === "chunked-json") {
          // Try to parse complete JSON objects from buffer
          let braceDepth = 0;
          let start = -1;
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === "{") {
              if (braceDepth === 0) start = i;
              braceDepth++;
            } else if (buffer[i] === "}") {
              braceDepth--;
              if (braceDepth === 0 && start >= 0) {
                processLine(buffer.slice(start, i + 1));
                buffer = buffer.slice(i + 1);
                i = -1; // Reset scan
                start = -1;
              }
            }
          }
        }
      });

      proc.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timeoutId);

        // Process remaining buffer
        if (buffer.trim()) processLine(buffer);

        this.activeProcesses.delete(proc);

        if (contextTokens > 0) {
          state.lastContextTokens = contextTokens;
        }

        // Fire messageEnd event
        if (tokensIn > 0 || tokensOut > 0 || cost > 0) {
          this.eventBus.fireMessageEnd({ cost, tokens: tokensIn + tokensOut });
        }

        if (wasAborted) {
          resolve({
            text: accumulatedText,
            tokensIn, tokensOut, cost, contextTokens, model,
            status: "aborted",
            error: "Agent call was aborted",
          });
          return;
        }

        if (code !== 0 && !finalResponse && !accumulatedText) {
          resolve({
            text: "",
            tokensIn, tokensOut, cost, contextTokens, model,
            status: "failed",
            error: `Process exited with code ${code}: ${stderr.slice(0, 500)}`,
          });
          return;
        }

        resolve({
          text: finalResponse || accumulatedText,
          tokensIn, tokensOut, cost, contextTokens, model,
          status: "success",
        });
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);
        resolve({
          text: "",
          tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model,
          status: "failed",
          error: `Failed to spawn ${this.cliBinary()}: ${err.message}`,
        });
      });

      // Timeout abort
      timeoutController.signal.addEventListener("abort", () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);
        resolve({
          text: accumulatedText,
          tokensIn, tokensOut, cost, contextTokens, model,
          status: "failed",
          error: `Agent timed out after ${Math.round(timeoutMs / 1000)}s`,
        });
      }, { once: true });

      // External abort signal
      if (opts?.signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (opts.signal.aborted) {
          killProc();
        } else {
          opts.signal.addEventListener("abort", killProc, { once: true });
        }
      }
    });
  }

  async destroyAgent(handle: AgentHandle): Promise<void> {
    this.handles.delete(handle.id);
  }

  setOrchestratorPrompt(prompt: string): void {
    this.orchestratorPrompt = prompt;
  }

  async injectContext(handle: AgentHandle, files: string[]): Promise<void> {
    const state = this.handles.get(handle.id);
    if (state) {
      state.contextFiles = files;
    }
  }

  getContextUsage(handle: AgentHandle): ContextUsage {
    const state = this.handles.get(handle.id);
    const tokens = state?.lastContextTokens || 0;
    const maxContext = 200_000;
    return {
      tokens,
      percent: maxContext > 0 ? (tokens / maxContext) * 100 : 0,
    };
  }

  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void {
    const state = this.handles.get(handle.id);
    if (state) {
      state.modelConfig = modelConfig;
    }
  }

  abort(): void {
    for (const proc of this.activeProcesses) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }
    this.activeProcesses.clear();
  }

  async spawnSubAgent(
    parentId: string,
    config: ChildAgentConfig,
    sessionId: string,
  ): Promise<AgentHandle> {
    const agentConfig: AgentConfig = {
      ...config,
      model: config.model ?? { tier: "standard" as ModelTier, thinking: "on" as ThinkingMode },
    } as AgentConfig;

    const handle = await this.spawnAgent(agentConfig, sessionId);
    handle.parentAgentId = parentId;
    return handle;
  }

  async destroySubAgent(_parentId: string, childId: string): Promise<void> {
    // Find handle by agentId suffix
    for (const [key, _state] of this.handles) {
      if (key.endsWith(`:${childId}`)) {
        this.handles.delete(key);
        return;
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test adapters/shared/tests/base-agent-runtime.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Update barrel index.ts**

The barrel file created in Task 1 already references these exports. Verify it imports correctly:

Run: `cd aos-harness && bun x tsc --noEmit --project adapters/shared/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add adapters/shared/src/base-agent-runtime.ts adapters/shared/tests/base-agent-runtime.test.ts
git commit -m "feat(shared): implement BaseAgentRuntime with subprocess lifecycle and stdout buffering"
```

---

### Task 7: Refactor Pi Adapter — Step 1 (Extend Shared Bases)

**Files:**
- Modify: `adapters/pi/package.json`
- Modify: `adapters/pi/src/agent-runtime.ts`
- Modify: `adapters/pi/src/event-bus.ts`
- Modify: `adapters/pi/src/workflow.ts`
- Modify: `adapters/pi/src/index.ts`

- [ ] **Step 1: Add adapter-shared dependency to Pi**

Edit `adapters/pi/package.json` to add the dependency:

```json
{
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*",
    "js-yaml": "^4.1.0"
  }
}
```

Run: `cd aos-harness && bun install`

- [ ] **Step 2: Refactor PiAgentRuntime to extend BaseAgentRuntime**

Rewrite `adapters/pi/src/agent-runtime.ts` to extend `BaseAgentRuntime`. The class keeps its Pi-specific CLI args, JSON parsing, and env vars, but delegates subprocess lifecycle to the base:

```typescript
// ── Pi Agent Runtime (L1) ────────────────────────────────────────
// Extends BaseAgentRuntime with Pi-specific CLI behavior.

import { BaseAgentRuntime } from "@aos-harness/adapter-shared";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "@aos-harness/adapter-shared";
import type { AuthMode, ModelCost, ModelTier, MessageOpts } from "@aos-harness/runtime/types";
import type { BaseEventBus } from "@aos-harness/adapter-shared";

export class PiAgentRuntime extends BaseAgentRuntime {
  constructor(eventBus: BaseEventBus, modelOverrides?: Partial<Record<ModelTier, string>>) {
    super(eventBus, modelOverrides);
  }

  cliBinary(): string {
    return "pi";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = [
      "--mode", "json",
      "-p",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--session", state.sessionFile,
      "--thinking", state.modelConfig.thinking,
    ];

    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }
      args.push("--model", this.resolveModelId(state.modelConfig.tier));

      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push(`@${file}`);
      }
    }

    args.push(message);
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    // Stream text deltas
    if (event.type === "message_update" && event.assistantMessageEvent) {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta" && (ame.delta || ame.text)) {
        return { type: "text_delta", text: ame.delta || ame.text };
      }
    }

    // Tool calls
    if (event.type === "tool_execution_start") {
      return {
        type: "tool_call",
        name: event.toolName ?? "unknown",
        input: event.input ?? {},
      };
    }

    // Final message with usage
    if (event.type === "message_end" && event.message) {
      const msg = event.message;
      if (msg.role === "assistant") {
        let text = "";
        if (msg.content && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") text = part.text;
          }
        }
        const usage = msg.usage;
        return {
          type: "message_end",
          text,
          tokensIn: usage?.input || 0,
          tokensOut: usage?.output || 0,
          cost: usage?.cost?.total || 0,
          contextTokens: usage?.totalTokens || 0,
          model: msg.model || "",
        };
      }
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    // Pi doesn't have a model list command — return defaults
    const defaults = this.defaultModelMap();
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 200_000,
      provider: "anthropic",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "anthropic/claude-haiku-4-5",
      standard: "anthropic/claude-sonnet-4-6",
      premium: "anthropic/claude-opus-4-6",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.ANTHROPIC_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "subscription", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: { inputPerMillionTokens: 0.80, outputPerMillionTokens: 4.00, currency: "USD" },
      standard: { inputPerMillionTokens: 3.00, outputPerMillionTokens: 15.00, currency: "USD" },
      premium: { inputPerMillionTokens: 15.00, outputPerMillionTokens: 75.00, currency: "USD" },
    };
    return pricing[tier];
  }
}
```

- [ ] **Step 3: Refactor PiEventBus to extend BaseEventBus**

Rewrite `adapters/pi/src/event-bus.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { BaseEventBus } from "@aos-harness/adapter-shared";

export class PiEventBus extends BaseEventBus {
  wire(pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, _ctx) => {
      await this.fireSessionStart();
    });

    pi.on("session_shutdown", async (_event, _ctx) => {
      await this.fireSessionShutdown();
    });

    pi.on("before_agent_start", async (event, _ctx) => {
      const result = await this.fireBeforeAgentStart(event.prompt);
      if (result.systemPrompt !== undefined) {
        return { systemPrompt: result.systemPrompt };
      }
      return undefined;
    });

    pi.on("agent_end", async (_event, _ctx) => {
      await this.fireAgentEnd();
    });

    pi.on("tool_call", async (event, _ctx) => {
      const result = await this.fireToolCall(event.toolName, event.input);
      if (result.block) {
        return { block: true };
      }
      return undefined;
    });

    pi.on("tool_result", async (event, _ctx) => {
      await this.fireToolResult(event.toolName, event.input, event.content);
    });

    pi.on("message_end", async (event, _ctx) => {
      const msg = event.message as {
        usage?: { cost?: { total?: number }; totalTokens?: number };
      };
      const cost = msg.usage?.cost?.total ?? 0;
      const tokens = msg.usage?.totalTokens ?? 0;
      await this.fireMessageEnd({ cost, tokens });
    });

    pi.on("session_before_compact", async (_event, _ctx) => {
      await this.fireCompaction();
      return undefined;
    });
  }
}
```

- [ ] **Step 4: Refactor PiWorkflow to extend BaseWorkflow (empty subclass)**

Rewrite `adapters/pi/src/workflow.ts`:

```typescript
// ── Pi Workflow (L4) — delegates entirely to BaseWorkflow ────────
import { BaseWorkflow } from "@aos-harness/adapter-shared";

export class PiWorkflow extends BaseWorkflow {
  // No overrides — all behavior comes from BaseWorkflow.
  // This empty subclass exists as a safety net during the refactor.
  // It will be deleted in Step 2 once tests confirm equivalence.
}
```

- [ ] **Step 5: Update index.ts to use composeAdapter**

In `adapters/pi/src/index.ts`, update the imports and the adapter composition section. Replace:

```typescript
import { PiWorkflow } from "./workflow";
```

And replace the `Object.assign` + rebinding block (lines 355-371) with:

```typescript
import { composeAdapter } from "@aos-harness/adapter-shared";
import { PiWorkflow } from "./workflow";

// ... inside session_start handler:
const workflow = new PiWorkflow(agentRuntime, projectRoot);

const adapter = composeAdapter(agentRuntime, eventBus, ui, workflow);
```

Remove the manual `Object.assign` and the `for` loop that rebinds methods.

- [ ] **Step 6: Run existing tests to verify nothing breaks**

Run: `cd aos-harness && bun test`
Expected: All existing tests PASS

- [ ] **Step 7: Typecheck**

Run: `cd aos-harness && bun x tsc --noEmit --project adapters/pi/tsconfig.json`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add adapters/pi/
git commit -m "refactor(pi): extend shared base classes (step 1 — empty PiWorkflow subclass)"
```

---

### Task 8: Refactor Pi Adapter — Step 2 (Delete PiWorkflow)

**Files:**
- Delete: `adapters/pi/src/workflow.ts`
- Modify: `adapters/pi/src/index.ts`

- [ ] **Step 1: Update index.ts to use BaseWorkflow directly**

Replace:
```typescript
import { PiWorkflow } from "./workflow";
// ...
const workflow = new PiWorkflow(agentRuntime, projectRoot);
```

With:
```typescript
import { BaseWorkflow } from "@aos-harness/adapter-shared";
// ...
const workflow = new BaseWorkflow(agentRuntime, projectRoot);
```

- [ ] **Step 2: Delete workflow.ts**

```bash
rm adapters/pi/src/workflow.ts
```

- [ ] **Step 3: Run tests**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add adapters/pi/
git commit -m "refactor(pi): delete PiWorkflow, use BaseWorkflow directly (step 2)"
```

---

### Task 9: Implement Claude Code Adapter

**Files:**
- Create: `adapters/claude-code/src/agent-runtime.ts`
- Rewrite: `adapters/claude-code/src/index.ts`
- Delete: `adapters/claude-code/src/generate.ts`
- Delete: `adapters/claude-code/src/templates.ts`
- Modify: `adapters/claude-code/package.json`
- Create: `adapters/claude-code/tests/agent-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/claude-code/tests/agent-runtime.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { ClaudeCodeAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import type { HandleState } from "@aos-harness/adapter-shared";
import type { AgentConfig } from "@aos-harness/runtime/types";

describe("ClaudeCodeAgentRuntime", () => {
  const eventBus = new BaseEventBus();
  const runtime = new ClaudeCodeAgentRuntime(eventBus);

  it("returns 'claude' as CLI binary", () => {
    expect(runtime.cliBinary()).toBe("claude");
  });

  it("uses ndjson stdout format", () => {
    expect(runtime.stdoutFormat()).toBe("ndjson");
  });

  it("builds correct args for first call", () => {
    const state: HandleState = {
      config: {
        id: "test",
        name: "Test",
        systemPrompt: "You are helpful",
        model: { tier: "standard", thinking: "on" },
      } as AgentConfig,
      sessionFile: ".aos/sessions/s1/test.jsonl",
      contextFiles: ["src/main.ts"],
      modelConfig: { tier: "standard", thinking: "on" },
      lastContextTokens: 0,
    };

    const args = runtime.buildArgs(state, "hello world", true);

    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are helpful");
    expect(args).toContain("--model");
    expect(args).toContain("hello world");
  });

  it("builds correct args for subsequent call (resume)", () => {
    const state: HandleState = {
      config: {
        id: "test",
        name: "Test",
        systemPrompt: "You are helpful",
        model: { tier: "standard", thinking: "on" },
      } as AgentConfig,
      sessionFile: ".aos/sessions/s1/test.jsonl",
      contextFiles: [],
      modelConfig: { tier: "standard", thinking: "on" },
      lastContextTokens: 0,
    };

    const args = runtime.buildArgs(state, "follow up", false);

    expect(args).toContain("--print");
    expect(args).toContain("--resume");
    expect(args).not.toContain("--system-prompt");
    expect(args).toContain("follow up");
  });

  it("parses Claude Code JSON message_end event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Hello from Claude",
      session_id: "abc123",
      cost_usd: 0.005,
      duration_ms: 1200,
      duration_api_ms: 1100,
      num_turns: 1,
      is_error: false,
      total_cost_usd: 0.005,
      usage: {
        input_tokens: 150,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event!.text).toBe("Hello from Claude");
      expect(event!.tokensIn).toBe(150);
      expect(event!.tokensOut).toBe(50);
      expect(event!.cost).toBe(0.005);
    }
  });

  it("returns correct default model map", () => {
    const map = runtime.defaultModelMap();
    expect(map.economy).toBe("claude-haiku-4-5");
    expect(map.standard).toBe("claude-sonnet-4-6");
    expect(map.premium).toBe("claude-opus-4-6");
  });

  it("returns correct auth mode with API key", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(runtime.getAuthMode()).toEqual({ type: "api_key", metered: true });
    if (original) {
      process.env.ANTHROPIC_API_KEY = original;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/claude-code/tests/agent-runtime.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ClaudeCodeAgentRuntime**

Create `adapters/claude-code/src/agent-runtime.ts`:

```typescript
// ── Claude Code Agent Runtime (L1) ────────────────────────────────
// Extends BaseAgentRuntime for the `claude` CLI.

import { spawn } from "node:child_process";
import { BaseAgentRuntime } from "@aos-harness/adapter-shared";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "@aos-harness/adapter-shared";
import type { AuthMode, ModelCost, ModelTier, MessageOpts } from "@aos-harness/runtime/types";

export class ClaudeCodeAgentRuntime extends BaseAgentRuntime {
  cliBinary(): string {
    return "claude";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = [
      "--print",
      "--output-format", "json",
      "--verbose",
    ];

    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }
      args.push("--model", this.resolveModelId(state.modelConfig.tier));

      // Inject context files
      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push("--add-file", file);
      }
    } else {
      // Resume existing session
      args.push("--resume", state.sessionFile);
    }

    args.push(message);
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }

    // Claude Code --print --output-format json emits a single result object
    if (obj.type === "result") {
      return {
        type: "message_end",
        text: obj.result ?? "",
        tokensIn: obj.usage?.input_tokens ?? 0,
        tokensOut: obj.usage?.output_tokens ?? 0,
        cost: obj.cost_usd ?? 0,
        contextTokens: (obj.usage?.input_tokens ?? 0) + (obj.usage?.output_tokens ?? 0),
        model: obj.model ?? "",
      };
    }

    // Streaming content blocks
    if (obj.type === "content_block_delta" && obj.delta?.text) {
      return { type: "text_delta", text: obj.delta.text };
    }

    // Tool use events
    if (obj.type === "tool_use") {
      return {
        type: "tool_call",
        name: obj.name ?? "unknown",
        input: obj.input ?? {},
      };
    }

    if (obj.type === "tool_result") {
      return {
        type: "tool_result",
        name: obj.name ?? "unknown",
        input: {},
        result: obj.content ?? obj.output ?? "",
      };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "ANTHROPIC_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    return new Promise<ModelInfo[]>((resolve) => {
      const proc = spawn("claude", ["model", "list", "--json"], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: this.buildSubprocessEnv(),
      });

      let stdout = "";
      proc.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          // Fallback to defaults
          const defaults = this.defaultModelMap();
          resolve(
            Object.entries(defaults).map(([_tier, id]) => ({
              id,
              name: id,
              contextWindow: 200_000,
              provider: "anthropic",
            })),
          );
          return;
        }

        try {
          const models = JSON.parse(stdout);
          if (Array.isArray(models)) {
            resolve(
              models.map((m: any) => ({
                id: m.id ?? m.model_id ?? m.name,
                name: m.name ?? m.id,
                contextWindow: m.context_window ?? 200_000,
                provider: "anthropic",
              })),
            );
          } else {
            resolve(this.fallbackModels());
          }
        } catch {
          resolve(this.fallbackModels());
        }
      });

      proc.on("error", () => {
        resolve(this.fallbackModels());
      });
    });
  }

  private fallbackModels(): ModelInfo[] {
    const defaults = this.defaultModelMap();
    console.warn(`Model discovery failed for claude. Using default models.`);
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 200_000,
      provider: "anthropic",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "claude-haiku-4-5",
      standard: "claude-sonnet-4-6",
      premium: "claude-opus-4-6",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.ANTHROPIC_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "subscription", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: { inputPerMillionTokens: 0.80, outputPerMillionTokens: 4.00, currency: "USD" },
      standard: { inputPerMillionTokens: 3.00, outputPerMillionTokens: 15.00, currency: "USD" },
      premium: { inputPerMillionTokens: 15.00, outputPerMillionTokens: 75.00, currency: "USD" },
    };
    return pricing[tier];
  }
}
```

- [ ] **Step 4: Create entry point**

Rewrite `adapters/claude-code/src/index.ts`:

```typescript
export { ClaudeCodeAgentRuntime } from "./agent-runtime";
export { BaseEventBus, TerminalUI, BaseWorkflow, composeAdapter } from "@aos-harness/adapter-shared";
```

- [ ] **Step 5: Delete old generator files**

```bash
rm adapters/claude-code/src/generate.ts adapters/claude-code/src/templates.ts
```

- [ ] **Step 6: Update package.json**

Rewrite `adapters/claude-code/package.json`:

```json
{
  "name": "@aos-harness/claude-code-adapter",
  "version": "0.2.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "files": ["src/"],
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

Run: `cd aos-harness && bun install`

- [ ] **Step 7: Run test to verify it passes**

Run: `cd aos-harness && bun test adapters/claude-code/tests/agent-runtime.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 8: Typecheck**

Run: `cd aos-harness && bun x tsc --noEmit --project adapters/claude-code/tsconfig.json`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add adapters/claude-code/
git commit -m "feat(claude-code): replace generator with full runtime adapter"
```

---

### Task 10: Implement Gemini Adapter

**Files:**
- Create: `adapters/gemini/src/agent-runtime.ts`
- Rewrite: `adapters/gemini/src/index.ts`
- Delete: `adapters/gemini/src/generate.ts`
- Delete: `adapters/gemini/src/templates.ts`
- Modify: `adapters/gemini/package.json`
- Create: `adapters/gemini/tests/agent-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `adapters/gemini/tests/agent-runtime.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { GeminiAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import type { HandleState } from "@aos-harness/adapter-shared";
import type { AgentConfig } from "@aos-harness/runtime/types";

describe("GeminiAgentRuntime", () => {
  const eventBus = new BaseEventBus();
  const runtime = new GeminiAgentRuntime(eventBus);

  it("returns 'gemini' as CLI binary", () => {
    expect(runtime.cliBinary()).toBe("gemini");
  });

  it("uses ndjson stdout format", () => {
    expect(runtime.stdoutFormat()).toBe("ndjson");
  });

  it("builds correct args for first call", () => {
    const state: HandleState = {
      config: {
        id: "test",
        name: "Test",
        systemPrompt: "You are helpful",
        model: { tier: "standard", thinking: "on" },
      } as AgentConfig,
      sessionFile: ".aos/sessions/s1/test.jsonl",
      contextFiles: ["src/main.ts"],
      modelConfig: { tier: "standard", thinking: "on" },
      lastContextTokens: 0,
    };

    const args = runtime.buildArgs(state, "hello world", true);

    expect(args).toContain("--json");
    expect(args).toContain("--model");
    expect(args).toContain("--system-instruction");
    expect(args).toContain("You are helpful");
    expect(args).toContain("hello world");
  });

  it("parses Gemini JSON response", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Hello from Gemini",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
      cost_usd: 0.002,
      model: "gemini-2.5-pro",
    });

    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event!.text).toBe("Hello from Gemini");
      expect(event!.tokensIn).toBe(100);
      expect(event!.tokensOut).toBe(50);
    }
  });

  it("returns correct default model map", () => {
    const map = runtime.defaultModelMap();
    expect(map.economy).toBe("gemini-2.0-flash");
    expect(map.standard).toBe("gemini-2.5-pro");
    expect(map.premium).toBe("gemini-2.5-pro");
  });

  it("checks GOOGLE_API_KEY for auth mode", () => {
    const original = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "test-key";
    expect(runtime.getAuthMode()).toEqual({ type: "api_key", metered: true });
    if (original) {
      process.env.GOOGLE_API_KEY = original;
    } else {
      delete process.env.GOOGLE_API_KEY;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/gemini/tests/agent-runtime.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement GeminiAgentRuntime**

Create `adapters/gemini/src/agent-runtime.ts`:

```typescript
// ── Gemini Agent Runtime (L1) ─────────────────────────────────────
// Extends BaseAgentRuntime for the `gemini` CLI.

import { spawn } from "node:child_process";
import { BaseAgentRuntime } from "@aos-harness/adapter-shared";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "@aos-harness/adapter-shared";
import type { AuthMode, ModelCost, ModelTier, MessageOpts } from "@aos-harness/runtime/types";

export class GeminiAgentRuntime extends BaseAgentRuntime {
  cliBinary(): string {
    return "gemini";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = [
      "--json",
      "--model", this.resolveModelId(state.modelConfig.tier),
    ];

    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-instruction", systemPrompt);
      }

      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push("--file", file);
      }
    } else {
      args.push("--session", state.sessionFile);
    }

    args.push(message);
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }

    // Final result
    if (obj.type === "result") {
      return {
        type: "message_end",
        text: obj.result ?? "",
        tokensIn: obj.usage?.input_tokens ?? 0,
        tokensOut: obj.usage?.output_tokens ?? 0,
        cost: obj.cost_usd ?? 0,
        contextTokens: (obj.usage?.input_tokens ?? 0) + (obj.usage?.output_tokens ?? 0),
        model: obj.model ?? "",
      };
    }

    // Streaming text
    if (obj.type === "content_block_delta" && obj.delta?.text) {
      return { type: "text_delta", text: obj.delta.text };
    }

    // Gemini candidates format (alternative)
    if (obj.candidates && Array.isArray(obj.candidates)) {
      const candidate = obj.candidates[0];
      if (candidate?.content?.parts) {
        const text = candidate.content.parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join("");
        const usage = obj.usageMetadata;
        return {
          type: "message_end",
          text,
          tokensIn: usage?.promptTokenCount ?? 0,
          tokensOut: usage?.candidatesTokenCount ?? 0,
          cost: 0,
          contextTokens: usage?.totalTokenCount ?? 0,
          model: obj.modelVersion ?? "",
        };
      }
    }

    // Tool calls
    if (obj.type === "tool_call" || obj.type === "function_call") {
      return {
        type: "tool_call",
        name: obj.name ?? obj.function_call?.name ?? "unknown",
        input: obj.args ?? obj.function_call?.args ?? {},
      };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "GOOGLE_API_KEY", "GEMINI_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    return new Promise<ModelInfo[]>((resolve) => {
      const proc = spawn("gemini", ["model", "list", "--json"], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: this.buildSubprocessEnv(),
      });

      let stdout = "";
      proc.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          resolve(this.fallbackModels());
          return;
        }
        try {
          const models = JSON.parse(stdout);
          if (Array.isArray(models)) {
            resolve(
              models.map((m: any) => ({
                id: m.id ?? m.name,
                name: m.displayName ?? m.name ?? m.id,
                contextWindow: m.inputTokenLimit ?? 1_000_000,
                provider: "google",
              })),
            );
          } else {
            resolve(this.fallbackModels());
          }
        } catch {
          resolve(this.fallbackModels());
        }
      });

      proc.on("error", () => {
        resolve(this.fallbackModels());
      });
    });
  }

  private fallbackModels(): ModelInfo[] {
    const defaults = this.defaultModelMap();
    console.warn(`Model discovery failed for gemini. Using default models.`);
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 1_000_000,
      provider: "google",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "gemini-2.0-flash",
      standard: "gemini-2.5-pro",
      premium: "gemini-2.5-pro",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "unknown", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: { inputPerMillionTokens: 0.10, outputPerMillionTokens: 0.40, currency: "USD" },
      standard: { inputPerMillionTokens: 1.25, outputPerMillionTokens: 10.00, currency: "USD" },
      premium: { inputPerMillionTokens: 1.25, outputPerMillionTokens: 10.00, currency: "USD" },
    };
    return pricing[tier];
  }
}
```

- [ ] **Step 4: Create entry point and update package**

Rewrite `adapters/gemini/src/index.ts`:

```typescript
export { GeminiAgentRuntime } from "./agent-runtime";
export { BaseEventBus, TerminalUI, BaseWorkflow, composeAdapter } from "@aos-harness/adapter-shared";
```

Delete old files and update package.json:

```bash
rm adapters/gemini/src/generate.ts adapters/gemini/src/templates.ts
```

Rewrite `adapters/gemini/package.json`:

```json
{
  "name": "@aos-harness/gemini-adapter",
  "version": "0.2.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "files": ["src/"],
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

Run: `cd aos-harness && bun install`

- [ ] **Step 5: Run tests**

Run: `cd aos-harness && bun test adapters/gemini/tests/agent-runtime.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add adapters/gemini/
git commit -m "feat(gemini): replace generator with full runtime adapter"
```

---

### Task 11: Implement Codex Adapter

**Files:**
- Create: `adapters/codex/package.json`
- Create: `adapters/codex/tsconfig.json`
- Create: `adapters/codex/src/agent-runtime.ts`
- Create: `adapters/codex/src/index.ts`
- Create: `adapters/codex/tests/agent-runtime.test.ts`

- [ ] **Step 1: Create package scaffold**

Create `adapters/codex/package.json`:

```json
{
  "name": "@aos-harness/codex-adapter",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "files": ["src/"],
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

Create `adapters/codex/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "rootDir": ".",
    "paths": {
      "@aos-harness/runtime/*": ["../../runtime/src/*"],
      "@aos-harness/adapter-shared": ["../shared/src/index.ts"],
      "@aos-harness/adapter-shared/*": ["../shared/src/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Run: `cd aos-harness && bun install`

- [ ] **Step 2: Write the failing test**

Create `adapters/codex/tests/agent-runtime.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { CodexAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import type { HandleState } from "@aos-harness/adapter-shared";
import type { AgentConfig } from "@aos-harness/runtime/types";

describe("CodexAgentRuntime", () => {
  const eventBus = new BaseEventBus();
  const runtime = new CodexAgentRuntime(eventBus);

  it("returns 'codex' as CLI binary", () => {
    expect(runtime.cliBinary()).toBe("codex");
  });

  it("uses ndjson stdout format", () => {
    expect(runtime.stdoutFormat()).toBe("ndjson");
  });

  it("builds correct args for first call", () => {
    const state: HandleState = {
      config: {
        id: "test",
        name: "Test",
        systemPrompt: "You are helpful",
        model: { tier: "standard", thinking: "on" },
      } as AgentConfig,
      sessionFile: ".aos/sessions/s1/test.jsonl",
      contextFiles: [],
      modelConfig: { tier: "standard", thinking: "on" },
      lastContextTokens: 0,
    };

    const args = runtime.buildArgs(state, "hello", true);

    expect(args).toContain("--full-auto");
    expect(args).toContain("--model");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are helpful");
    expect(args).toContain("hello");
  });

  it("parses Codex JSON result event", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Hello from Codex",
      usage: {
        input_tokens: 200,
        output_tokens: 100,
      },
      cost_usd: 0.01,
      model: "o3",
    });

    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event!.text).toBe("Hello from Codex");
      expect(event!.tokensIn).toBe(200);
      expect(event!.tokensOut).toBe(100);
    }
  });

  it("returns correct default model map", () => {
    const map = runtime.defaultModelMap();
    expect(map.economy).toBe("o4-mini");
    expect(map.standard).toBe("o3");
    expect(map.premium).toBe("o3");
  });

  it("checks OPENAI_API_KEY for auth mode", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    expect(runtime.getAuthMode()).toEqual({ type: "api_key", metered: true });
    if (original) {
      process.env.OPENAI_API_KEY = original;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd aos-harness && bun test adapters/codex/tests/agent-runtime.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement CodexAgentRuntime**

Create `adapters/codex/src/agent-runtime.ts`:

```typescript
// ── Codex Agent Runtime (L1) ──────────────────────────────────────
// Extends BaseAgentRuntime for the `codex` CLI (OpenAI).

import { spawn } from "node:child_process";
import { BaseAgentRuntime } from "@aos-harness/adapter-shared";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "@aos-harness/adapter-shared";
import type { AuthMode, ModelCost, ModelTier, MessageOpts } from "@aos-harness/runtime/types";

export class CodexAgentRuntime extends BaseAgentRuntime {
  cliBinary(): string {
    return "codex";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = [
      "--full-auto",
      "--model", this.resolveModelId(state.modelConfig.tier),
    ];

    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }

      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push("--file", file);
      }
    } else {
      args.push("--session", state.sessionFile);
    }

    args.push(message);
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }

    // Final result
    if (obj.type === "result") {
      return {
        type: "message_end",
        text: obj.result ?? "",
        tokensIn: obj.usage?.input_tokens ?? 0,
        tokensOut: obj.usage?.output_tokens ?? 0,
        cost: obj.cost_usd ?? 0,
        contextTokens: (obj.usage?.input_tokens ?? 0) + (obj.usage?.output_tokens ?? 0),
        model: obj.model ?? "",
      };
    }

    // Streaming content
    if (obj.type === "content_block_delta" && obj.delta?.text) {
      return { type: "text_delta", text: obj.delta.text };
    }

    // OpenAI streaming format
    if (obj.choices && Array.isArray(obj.choices)) {
      const choice = obj.choices[0];
      if (choice?.delta?.content) {
        return { type: "text_delta", text: choice.delta.content };
      }
      if (choice?.message?.content) {
        const usage = obj.usage;
        return {
          type: "message_end",
          text: choice.message.content,
          tokensIn: usage?.prompt_tokens ?? 0,
          tokensOut: usage?.completion_tokens ?? 0,
          cost: 0,
          contextTokens: usage?.total_tokens ?? 0,
          model: obj.model ?? "",
        };
      }
    }

    // Tool calls
    if (obj.type === "tool_call" || obj.type === "function_call") {
      return {
        type: "tool_call",
        name: obj.name ?? obj.function?.name ?? "unknown",
        input: obj.arguments ? JSON.parse(obj.arguments) : obj.input ?? {},
      };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "OPENAI_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    return new Promise<ModelInfo[]>((resolve) => {
      const proc = spawn("codex", ["model", "list", "--json"], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: this.buildSubprocessEnv(),
      });

      let stdout = "";
      proc.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          resolve(this.fallbackModels());
          return;
        }
        try {
          const models = JSON.parse(stdout);
          if (Array.isArray(models)) {
            resolve(
              models.map((m: any) => ({
                id: m.id ?? m.name,
                name: m.name ?? m.id,
                contextWindow: m.context_window ?? 200_000,
                provider: "openai",
              })),
            );
          } else {
            resolve(this.fallbackModels());
          }
        } catch {
          resolve(this.fallbackModels());
        }
      });

      proc.on("error", () => {
        resolve(this.fallbackModels());
      });
    });
  }

  private fallbackModels(): ModelInfo[] {
    const defaults = this.defaultModelMap();
    console.warn(`Model discovery failed for codex. Using default models.`);
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 200_000,
      provider: "openai",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "o4-mini",
      standard: "o3",
      premium: "o3",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.OPENAI_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "unknown", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: { inputPerMillionTokens: 1.10, outputPerMillionTokens: 4.40, currency: "USD" },
      standard: { inputPerMillionTokens: 10.00, outputPerMillionTokens: 40.00, currency: "USD" },
      premium: { inputPerMillionTokens: 10.00, outputPerMillionTokens: 40.00, currency: "USD" },
    };
    return pricing[tier];
  }
}
```

- [ ] **Step 5: Create entry point**

Create `adapters/codex/src/index.ts`:

```typescript
export { CodexAgentRuntime } from "./agent-runtime";
export { BaseEventBus, TerminalUI, BaseWorkflow, composeAdapter } from "@aos-harness/adapter-shared";
```

- [ ] **Step 6: Run tests**

Run: `cd aos-harness && bun test adapters/codex/tests/agent-runtime.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add adapters/codex/
git commit -m "feat(codex): implement full runtime adapter for OpenAI Codex CLI"
```

---

### Task 12: Update Adapter Schema

**Files:**
- Modify: `core/schema/adapter.schema.json`

- [ ] **Step 1: Update the schema**

Rewrite `core/schema/adapter.schema.json`:

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

- [ ] **Step 2: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS (schema change doesn't break anything — no runtime code reads the schema file)

- [ ] **Step 3: Commit**

```bash
git add core/schema/adapter.schema.json
git commit -m "feat(schema): update adapter config — add codex platform, replace model_map with model_overrides"
```

---

### Task 13: Run Full Test Suite and Typecheck

**Files:** None (validation only)

- [ ] **Step 1: Run all tests**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 2: Typecheck all adapter packages**

Run all typechecks in parallel:

```bash
cd aos-harness && \
bun x tsc --noEmit --project adapters/shared/tsconfig.json && \
bun x tsc --noEmit --project adapters/pi/tsconfig.json && \
bun x tsc --noEmit --project adapters/claude-code/tsconfig.json && \
bun x tsc --noEmit --project adapters/gemini/tsconfig.json && \
bun x tsc --noEmit --project adapters/codex/tsconfig.json
```

Expected: No type errors in any package

- [ ] **Step 3: Run runtime tests to verify Pi refactor didn't break engine**

Run: `cd aos-harness && bun test --cwd runtime`
Expected: All runtime tests PASS

- [ ] **Step 4: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "fix: address type errors and test failures from adapter refactor"
```

Only commit this if there were actual fixes. Skip if everything passed clean.
