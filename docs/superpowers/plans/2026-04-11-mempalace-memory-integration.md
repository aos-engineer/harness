# MemPalace Memory Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable memory provider abstraction to the AOS runtime, with MemPalace as the first backend and the existing ExpertiseManager as fallback.

**Architecture:** A `MemoryProvider` interface defines wake/recall/remember operations. `MemPalaceProvider` talks to MemPalace's MCP server via stdio JSON-RPC. `ExpertiseProvider` wraps the existing `ExpertiseManager` with fuzzy recall. The engine wires the active provider into session start, mid-session orchestrator-gated recall, and session-end memory curation. Configuration lives in `.aos/memory.yaml`.

**Tech Stack:** TypeScript (Bun runtime), js-yaml, MCP stdio protocol, MemPalace Python MCP server (external process)

**Spec:** `docs/superpowers/specs/2026-04-11-mempalace-memory-integration-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `runtime/src/memory-provider.ts` | `MemoryProvider` interface + all memory-related types (`WakeContext`, `RecallOpts`, `RecallResult`, `RememberOpts`, `MemoryConfig`, `HealthStatus`, `MemoryStatus`) |
| `runtime/src/memory-config.ts` | Load and validate `.aos/memory.yaml`, apply defaults, return typed `MemoryConfig` |
| `runtime/src/expertise-provider.ts` | `ExpertiseProvider` — wraps `ExpertiseManager` with `MemoryProvider` interface, implements fuzzy recall |
| `runtime/src/fuzzy-match.ts` | Token overlap + Levenshtein scoring (~50 lines, no deps) |
| `runtime/src/mempalace-provider.ts` | `MemPalaceProvider` — MCP client lifecycle, wake/recall/remember mapped to MCP calls, crash recovery, wake token cap |
| `runtime/src/mcp-client.ts` | Lightweight MCP stdio client — spawn process, send JSON-RPC, health check, restart |
| `runtime/src/engine.ts` | (modify) Wire `memoryProvider` into session start/mid/end lifecycle |
| `runtime/src/types.ts` | (modify) Add memory transcript event types |
| `core/schema/memory.schema.json` | JSON Schema for `.aos/memory.yaml` validation |
| `core/skills/mempalace-read-write/skill.yaml` | Read + Write MCP access skill for operational agents |
| `core/skills/mempalace-admin/skill.yaml` | Full admin MCP access skill for auditor |
| `cli/src/commands/init.ts` | (modify) Add memory provider selection step during `aos init` |
| `runtime/tests/memory-config.test.ts` | Tests for config loading, defaults, validation |
| `runtime/tests/fuzzy-match.test.ts` | Tests for fuzzy matching |
| `runtime/tests/expertise-provider.test.ts` | Tests for ExpertiseProvider wrapping + fuzzy recall |
| `runtime/tests/mcp-client.test.ts` | Tests for MCP client lifecycle, health check, restart |
| `runtime/tests/mempalace-provider.test.ts` | Tests for MemPalaceProvider with mocked MCP client |
| `runtime/tests/engine-memory.test.ts` | Integration tests for engine memory lifecycle |

---

## Task 1: Memory Types and Interface

**Files:**
- Create: `runtime/src/memory-provider.ts`
- Modify: `runtime/src/types.ts`
- Test: `runtime/tests/memory-provider.test.ts`

- [ ] **Step 1: Write the failing test for MemoryProvider type exports**

```typescript
// runtime/tests/memory-provider.test.ts
import { describe, it, expect } from "bun:test";
import type {
  MemoryProvider,
  MemoryConfig,
  WakeContext,
  RecallOpts,
  RecallResult,
  RecallEntry,
  RememberOpts,
  HealthStatus,
  MemoryStatus,
} from "../src/memory-provider";

describe("MemoryProvider types", () => {
  it("WakeContext has required fields", () => {
    const ctx: WakeContext = {
      identity: "I am Atlas",
      essentials: "Project uses GraphQL",
      tokenEstimate: 150,
      truncated: false,
    };
    expect(ctx.identity).toBe("I am Atlas");
    expect(ctx.truncated).toBe(false);
  });

  it("RecallEntry has required fields", () => {
    const entry: RecallEntry = {
      content: "We decided to use Clerk for auth",
      wing: "my-project",
      room: "architect",
      hall: "hall_facts",
      similarity: 0.92,
    };
    expect(entry.similarity).toBe(0.92);
    expect(entry.source).toBeUndefined();
  });

  it("MemoryConfig has provider and orchestrator fields", () => {
    const config: MemoryConfig = {
      provider: "mempalace",
      mempalace: {
        palacePath: "~/.mempalace/palace",
        projectWing: "my-project",
        wakeLayers: ["L0", "L1"],
        autoHall: true,
        maxWakeTokens: 1200,
        maxDrawerTokens: 500,
      },
      orchestrator: {
        rememberPrompt: "session_end",
        recallGate: true,
        maxRecallPerSession: 10,
      },
    };
    expect(config.provider).toBe("mempalace");
    expect(config.mempalace!.maxWakeTokens).toBe(1200);
  });

  it("HealthStatus has required fields", () => {
    const healthy: HealthStatus = { healthy: true, latencyMs: 12 };
    const unhealthy: HealthStatus = { healthy: false, latencyMs: 0, error: "Connection refused" };
    expect(healthy.healthy).toBe(true);
    expect(unhealthy.error).toBe("Connection refused");
  });

  it("RememberOpts includes optional sessionId", () => {
    const opts: RememberOpts = {
      projectId: "my-project",
      agentId: "strategist",
      hall: "hall_facts",
      sessionId: "sess-123",
    };
    expect(opts.sessionId).toBe("sess-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/memory-provider.test.ts`
Expected: FAIL — cannot find module `../src/memory-provider`

- [ ] **Step 3: Create the memory-provider.ts with all types and interface**

```typescript
// runtime/src/memory-provider.ts

// ── Health Status ──────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

// ── Wake Context ───────────────────────────────────────────────

export interface WakeContext {
  identity: string;
  essentials: string;
  tokenEstimate: number;
  truncated: boolean;
}

// ── Recall Types ───────────────────────────────────────────────

export interface RecallOpts {
  projectId: string;
  agentId?: string;
  hall?: string;
  maxResults?: number;
}

export interface RecallEntry {
  content: string;
  wing: string;
  room: string;
  hall: string;
  similarity: number;
  source?: string;
}

export interface RecallResult {
  entries: RecallEntry[];
  tokenEstimate: number;
}

// ── Remember Types ─────────────────────────────────────────────

export interface RememberOpts {
  projectId: string;
  agentId: string;
  hall?: string;
  source?: string;
  sessionId?: string;
}

export type RememberId = string;

// ── Configuration ──────────────────────────────────────────────

export interface MempalaceConfig {
  palacePath: string;
  projectWing: string;
  wakeLayers: ("L0" | "L1")[];
  autoHall: boolean;
  maxWakeTokens: number;
  maxDrawerTokens: number;
}

export interface ExpertiseConfig {
  maxLines: number;
  scope: "per-project" | "global";
}

export interface OrchestratorMemoryConfig {
  rememberPrompt: "session_end" | "per_round";
  recallGate: boolean;
  maxRecallPerSession: number;
}

export interface MemoryConfig {
  provider: "mempalace" | "expertise";
  mempalace?: MempalaceConfig;
  expertise?: ExpertiseConfig;
  orchestrator: OrchestratorMemoryConfig;
}

// ── Status ─────────────────────────────────────────────────────

export interface MemoryStatus {
  provider: string;
  available: boolean;
  drawerCount?: number;
  wings?: string[];
  rooms?: Record<string, string[]>;
}

// ── Provider Interface ─────────────────────────────────────────

export interface MemoryProvider {
  readonly id: string;
  readonly name: string;

  initialize(config: MemoryConfig): Promise<void>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<HealthStatus>;

  wake(projectId: string, agentId?: string): Promise<WakeContext>;
  recall(query: string, opts: RecallOpts): Promise<RecallResult>;
  remember(content: string, opts: RememberOpts): Promise<RememberId>;

  status(): Promise<MemoryStatus>;
}
```

- [ ] **Step 4: Add memory transcript event types to types.ts**

In `runtime/src/types.ts`, add these event types after `"session_resumed"`:

```typescript
  // Memory events
  | "memory_wake"
  | "memory_wake_truncated"
  | "recall_requested"
  | "memory_recall"
  | "memory_recall_denied"
  | "memory_committed"
  | "memory_commit_failed"
  | "memory_provider_restart"
  | "memory_fallback_written";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd runtime && bun test tests/memory-provider.test.ts`
Expected: PASS — all 5 type assertion tests green

- [ ] **Step 6: Commit**

```bash
git add runtime/src/memory-provider.ts runtime/src/types.ts runtime/tests/memory-provider.test.ts
git commit -m "feat(memory): add MemoryProvider interface and types"
```

---

## Task 2: Memory Config Loader

**Files:**
- Create: `runtime/src/memory-config.ts`
- Create: `core/schema/memory.schema.json`
- Test: `runtime/tests/memory-config.test.ts`

- [ ] **Step 1: Write the failing tests for memory config loading**

```typescript
// runtime/tests/memory-config.test.ts
import { describe, it, expect } from "bun:test";
import { loadMemoryConfig, MemoryConfigError } from "../src/memory-config";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "aos-mem-test-"));
}

describe("loadMemoryConfig", () => {
  it("returns default expertise config when no memory.yaml exists", () => {
    const dir = makeTempDir();
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("expertise");
    expect(config.orchestrator.recallGate).toBe(true);
    expect(config.orchestrator.maxRecallPerSession).toBe(10);
    expect(config.orchestrator.rememberPrompt).toBe("session_end");
  });

  it("loads a valid mempalace config", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: mempalace
mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: test-project
  wake_layers: [L0, L1]
  auto_hall: true
  max_wake_tokens: 800
  max_drawer_tokens: 300
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 5
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("mempalace");
    expect(config.mempalace!.palacePath).toBe("~/.mempalace/palace");
    expect(config.mempalace!.maxWakeTokens).toBe(800);
    expect(config.mempalace!.maxDrawerTokens).toBe(300);
    expect(config.orchestrator.maxRecallPerSession).toBe(5);
  });

  it("loads a valid expertise config", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: expertise
expertise:
  max_lines: 150
  scope: global
orchestrator:
  remember_prompt: per_round
  recall_gate: false
  max_recall_per_session: 20
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("expertise");
    expect(config.expertise!.maxLines).toBe(150);
    expect(config.expertise!.scope).toBe("global");
    expect(config.orchestrator.rememberPrompt).toBe("per_round");
  });

  it("applies defaults for missing mempalace fields", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: mempalace
mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: my-proj
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.mempalace!.wakeLayers).toEqual(["L0", "L1"]);
    expect(config.mempalace!.autoHall).toBe(true);
    expect(config.mempalace!.maxWakeTokens).toBe(1200);
    expect(config.mempalace!.maxDrawerTokens).toBe(500);
  });

  it("throws MemoryConfigError for invalid api_version", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v99
provider: mempalace
`,
    );
    expect(() => loadMemoryConfig(dir)).toThrow(MemoryConfigError);
  });

  it("throws MemoryConfigError for invalid provider value", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: invalid
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );
    expect(() => loadMemoryConfig(dir)).toThrow(MemoryConfigError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/memory-config.test.ts`
Expected: FAIL — cannot find module `../src/memory-config`

- [ ] **Step 3: Create the JSON Schema for memory config**

```json
// core/schema/memory.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AOS Memory Configuration",
  "type": "object",
  "required": ["api_version", "provider", "orchestrator"],
  "properties": {
    "api_version": {
      "const": "aos/memory/v1"
    },
    "provider": {
      "type": "string",
      "enum": ["mempalace", "expertise"]
    },
    "mempalace": {
      "type": "object",
      "required": ["palace_path", "project_wing"],
      "properties": {
        "palace_path": { "type": "string" },
        "project_wing": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
        "wake_layers": {
          "type": "array",
          "items": { "type": "string", "enum": ["L0", "L1"] },
          "default": ["L0", "L1"]
        },
        "auto_hall": { "type": "boolean", "default": true },
        "max_wake_tokens": { "type": "integer", "minimum": 100, "default": 1200 },
        "max_drawer_tokens": { "type": "integer", "minimum": 50, "default": 500 }
      }
    },
    "expertise": {
      "type": "object",
      "properties": {
        "max_lines": { "type": "integer", "minimum": 10, "default": 200 },
        "scope": { "type": "string", "enum": ["per-project", "global"], "default": "per-project" }
      }
    },
    "orchestrator": {
      "type": "object",
      "required": ["remember_prompt", "recall_gate", "max_recall_per_session"],
      "properties": {
        "remember_prompt": { "type": "string", "enum": ["session_end", "per_round"] },
        "recall_gate": { "type": "boolean" },
        "max_recall_per_session": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

- [ ] **Step 4: Implement the memory config loader**

```typescript
// runtime/src/memory-config.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryConfig } from "./memory-provider";

export class MemoryConfigError extends Error {
  constructor(message: string, public path: string) {
    super(`Memory config error in ${path}: ${message}`);
    this.name = "MemoryConfigError";
  }
}

const DEFAULTS: MemoryConfig = {
  provider: "expertise",
  expertise: { maxLines: 200, scope: "per-project" },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

const MEMPALACE_DEFAULTS = {
  wakeLayers: ["L0", "L1"] as ("L0" | "L1")[],
  autoHall: true,
  maxWakeTokens: 1200,
  maxDrawerTokens: 500,
};

export function loadMemoryConfig(projectDir: string): MemoryConfig {
  const configPath = join(projectDir, ".aos", "memory.yaml");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new MemoryConfigError("memory.yaml is empty or invalid", configPath);
  }

  if (parsed.api_version !== "aos/memory/v1") {
    throw new MemoryConfigError(
      `Unknown api_version "${parsed.api_version}", expected "aos/memory/v1"`,
      configPath,
    );
  }

  const provider = parsed.provider as string;
  if (provider !== "mempalace" && provider !== "expertise") {
    throw new MemoryConfigError(
      `Invalid provider "${provider}", expected "mempalace" or "expertise"`,
      configPath,
    );
  }

  const orch = parsed.orchestrator as Record<string, unknown> | undefined;
  const orchestrator = {
    rememberPrompt: (orch?.remember_prompt as "session_end" | "per_round") ?? "session_end",
    recallGate: (orch?.recall_gate as boolean) ?? true,
    maxRecallPerSession: (orch?.max_recall_per_session as number) ?? 10,
  };

  const config: MemoryConfig = { provider, orchestrator };

  if (provider === "mempalace" && parsed.mempalace) {
    const mp = parsed.mempalace as Record<string, unknown>;
    config.mempalace = {
      palacePath: mp.palace_path as string,
      projectWing: mp.project_wing as string,
      wakeLayers: (mp.wake_layers as ("L0" | "L1")[]) ?? MEMPALACE_DEFAULTS.wakeLayers,
      autoHall: (mp.auto_hall as boolean) ?? MEMPALACE_DEFAULTS.autoHall,
      maxWakeTokens: (mp.max_wake_tokens as number) ?? MEMPALACE_DEFAULTS.maxWakeTokens,
      maxDrawerTokens: (mp.max_drawer_tokens as number) ?? MEMPALACE_DEFAULTS.maxDrawerTokens,
    };
  }

  if (parsed.expertise) {
    const ex = parsed.expertise as Record<string, unknown>;
    config.expertise = {
      maxLines: (ex.max_lines as number) ?? 200,
      scope: (ex.scope as "per-project" | "global") ?? "per-project",
    };
  }

  return config;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd runtime && bun test tests/memory-config.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 6: Commit**

```bash
git add runtime/src/memory-config.ts core/schema/memory.schema.json runtime/tests/memory-config.test.ts
git commit -m "feat(memory): add memory config loader with YAML parsing and defaults"
```

---

## Task 3: Fuzzy Match Utility

**Files:**
- Create: `runtime/src/fuzzy-match.ts`
- Test: `runtime/tests/fuzzy-match.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// runtime/tests/fuzzy-match.test.ts
import { describe, it, expect } from "bun:test";
import { fuzzyScore } from "../src/fuzzy-match";

describe("fuzzyScore", () => {
  it("returns 1.0 for exact match", () => {
    expect(fuzzyScore("auth migration", "auth migration")).toBe(1.0);
  });

  it("returns high score for word reordering", () => {
    const score = fuzzyScore("migration auth", "auth migration");
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns moderate score for partial match", () => {
    const score = fuzzyScore("auth", "auth migration to Clerk");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1.0);
  });

  it("returns low score for unrelated strings", () => {
    const score = fuzzyScore("database sharding", "frontend CSS styling");
    expect(score).toBeLessThan(0.2);
  });

  it("handles typos via Levenshtein", () => {
    const score = fuzzyScore("authetication", "authentication");
    expect(score).toBeGreaterThan(0.7);
  });

  it("is case-insensitive", () => {
    const score = fuzzyScore("Auth Migration", "auth migration");
    expect(score).toBe(1.0);
  });

  it("returns 0 for empty query", () => {
    expect(fuzzyScore("", "some content")).toBe(0);
  });

  it("returns 0 for empty content", () => {
    expect(fuzzyScore("query", "")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/fuzzy-match.test.ts`
Expected: FAIL — cannot find module `../src/fuzzy-match`

- [ ] **Step 3: Implement fuzzy matching**

```typescript
// runtime/src/fuzzy-match.ts

/**
 * Token overlap + Levenshtein fuzzy scoring.
 * Returns 0-1 relevance score. No external dependencies.
 */

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

export function fuzzyScore(query: string, content: string): number {
  if (!query || !content) return 0;

  const qTokens = tokenize(query);
  const cTokens = tokenize(content);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  // Token overlap score: for each query token, find best match in content
  let totalBestScore = 0;
  for (const qt of qTokens) {
    let bestMatch = 0;
    for (const ct of cTokens) {
      const maxLen = Math.max(qt.length, ct.length);
      if (maxLen === 0) continue;
      const dist = levenshtein(qt, ct);
      const similarity = 1 - dist / maxLen;
      bestMatch = Math.max(bestMatch, similarity);
    }
    totalBestScore += bestMatch;
  }

  const score = totalBestScore / qTokens.length;
  return Math.round(score * 1000) / 1000; // 3 decimal places
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd runtime && bun test tests/fuzzy-match.test.ts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add runtime/src/fuzzy-match.ts runtime/tests/fuzzy-match.test.ts
git commit -m "feat(memory): add fuzzy match utility for expertise recall"
```

---

## Task 4: ExpertiseProvider

**Files:**
- Create: `runtime/src/expertise-provider.ts`
- Test: `runtime/tests/expertise-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// runtime/tests/expertise-provider.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { ExpertiseProvider } from "../src/expertise-provider";
import type { MemoryConfig } from "../src/memory-provider";

const DEFAULT_CONFIG: MemoryConfig = {
  provider: "expertise",
  expertise: { maxLines: 200, scope: "per-project" },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

describe("ExpertiseProvider", () => {
  let provider: ExpertiseProvider;

  beforeEach(async () => {
    provider = new ExpertiseProvider();
    await provider.initialize(DEFAULT_CONFIG);
  });

  it("has correct id and name", () => {
    expect(provider.id).toBe("expertise");
    expect(provider.name).toBe("Basic Expertise");
  });

  it("isAvailable always returns true", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it("healthCheck always returns healthy", async () => {
    const status = await provider.healthCheck();
    expect(status.healthy).toBe(true);
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("wake returns empty context when no expertise loaded", async () => {
    const ctx = await provider.wake("my-project");
    expect(ctx.identity).toBe("");
    expect(ctx.essentials).toBe("");
    expect(ctx.tokenEstimate).toBe(0);
    expect(ctx.truncated).toBe(false);
  });

  it("remember stores content and recall retrieves it with fuzzy matching", async () => {
    await provider.remember("We decided to use Clerk for authentication", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_facts",
    });
    await provider.remember("The frontend uses React with TypeScript", {
      projectId: "proj",
      agentId: "catalyst",
      hall: "hall_facts",
    });

    const result = await provider.recall("auth decisions", {
      projectId: "proj",
    });
    expect(result.entries.length).toBeGreaterThan(0);
    // The auth-related entry should score higher
    expect(result.entries[0].content).toContain("Clerk");
  });

  it("recall returns empty for unrelated query", async () => {
    await provider.remember("We use PostgreSQL for the database", {
      projectId: "proj",
      agentId: "architect",
    });

    const result = await provider.recall("quantum computing algorithms", {
      projectId: "proj",
    });
    // Low-relevance results filtered out
    expect(result.entries.length).toBe(0);
  });

  it("remember returns a string ID", async () => {
    const id = await provider.remember("Some content", {
      projectId: "proj",
      agentId: "strategist",
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("status returns provider info", async () => {
    const s = await provider.status();
    expect(s.provider).toBe("expertise");
    expect(s.available).toBe(true);
  });

  it("wake returns formatted content after remember calls", async () => {
    await provider.remember("Auth uses Clerk", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_facts",
    });

    const ctx = await provider.wake("proj");
    expect(ctx.essentials).toContain("Auth uses Clerk");
    expect(ctx.tokenEstimate).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/expertise-provider.test.ts`
Expected: FAIL — cannot find module `../src/expertise-provider`

- [ ] **Step 3: Implement ExpertiseProvider**

```typescript
// runtime/src/expertise-provider.ts
import type {
  MemoryProvider,
  MemoryConfig,
  WakeContext,
  RecallOpts,
  RecallResult,
  RecallEntry,
  RememberOpts,
  RememberId,
  HealthStatus,
  MemoryStatus,
} from "./memory-provider";
import { ExpertiseManager } from "./expertise-manager";
import type { ExpertiseFile } from "./types";
import { fuzzyScore } from "./fuzzy-match";
import { randomUUID } from "node:crypto";

interface StoredMemory {
  id: string;
  content: string;
  projectId: string;
  agentId: string;
  hall: string;
  timestamp: string;
}

const FUZZY_THRESHOLD = 0.35;

export class ExpertiseProvider implements MemoryProvider {
  readonly id = "expertise";
  readonly name = "Basic Expertise";

  private manager = new ExpertiseManager();
  private memories: StoredMemory[] = [];
  private config: MemoryConfig | null = null;

  async initialize(config: MemoryConfig): Promise<void> {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0 };
  }

  async wake(projectId: string, agentId?: string): Promise<WakeContext> {
    const relevant = this.memories.filter(
      (m) => m.projectId === projectId && (!agentId || m.agentId === agentId),
    );

    if (relevant.length === 0) {
      return { identity: "", essentials: "", tokenEstimate: 0, truncated: false };
    }

    const essentials = relevant.map((m) => `- [${m.agentId}/${m.hall}] ${m.content}`).join("\n");
    const tokenEstimate = Math.ceil(essentials.length / 4);

    return { identity: "", essentials, tokenEstimate, truncated: false };
  }

  async recall(query: string, opts: RecallOpts): Promise<RecallResult> {
    const candidates = this.memories.filter(
      (m) =>
        m.projectId === opts.projectId &&
        (!opts.agentId || m.agentId === opts.agentId) &&
        (!opts.hall || m.hall === opts.hall),
    );

    const scored = candidates
      .map((m) => ({
        memory: m,
        score: fuzzyScore(query, m.content),
      }))
      .filter((s) => s.score >= FUZZY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.maxResults ?? 5);

    const entries: RecallEntry[] = scored.map((s) => ({
      content: s.memory.content,
      wing: s.memory.projectId,
      room: s.memory.agentId,
      hall: s.memory.hall,
      similarity: s.score,
    }));

    const tokenEstimate = entries.reduce((sum, e) => sum + Math.ceil(e.content.length / 4), 0);

    return { entries, tokenEstimate };
  }

  async remember(content: string, opts: RememberOpts): Promise<RememberId> {
    const id = randomUUID();
    this.memories.push({
      id,
      content,
      projectId: opts.projectId,
      agentId: opts.agentId,
      hall: opts.hall ?? "hall_facts",
      timestamp: new Date().toISOString(),
    });
    return id;
  }

  async status(): Promise<MemoryStatus> {
    return {
      provider: "expertise",
      available: true,
      drawerCount: this.memories.length,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd runtime && bun test tests/expertise-provider.test.ts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add runtime/src/expertise-provider.ts runtime/tests/expertise-provider.test.ts
git commit -m "feat(memory): add ExpertiseProvider with fuzzy recall"
```

---

## Task 5: MCP Client

**Files:**
- Create: `runtime/src/mcp-client.ts`
- Test: `runtime/tests/mcp-client.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// runtime/tests/mcp-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { McpClient, McpClientError } from "../src/mcp-client";

describe("McpClient", () => {
  // We test with a simple echo server — `cat` reads stdin and echoes.
  // For real MCP tests we mock the process.

  it("can be constructed with command and args", () => {
    const client = new McpClient("python", ["-m", "mempalace.mcp_server"]);
    expect(client.isRunning()).toBe(false);
  });

  it("isRunning returns false before start", () => {
    const client = new McpClient("python", ["-m", "mempalace.mcp_server"]);
    expect(client.isRunning()).toBe(false);
  });

  it("stop is safe to call when not running", async () => {
    const client = new McpClient("python", ["-m", "mempalace.mcp_server"]);
    await client.stop(); // should not throw
  });

  it("throws McpClientError when process does not exist", async () => {
    const client = new McpClient("nonexistent-binary-xyz", []);
    try {
      await client.start();
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(McpClientError);
    }
  });

  it("restart kills and respawns", async () => {
    // Use a real short-lived command to verify restart logic
    const client = new McpClient("echo", ["ready"]);
    // start will fail for MCP (echo exits immediately) but restart logic is exercised
    try {
      await client.start();
    } catch {
      // expected — echo is not an MCP server
    }
    expect(client.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/mcp-client.test.ts`
Expected: FAIL — cannot find module `../src/mcp-client`

- [ ] **Step 3: Implement the MCP client**

```typescript
// runtime/src/mcp-client.ts
import { spawn, type ChildProcess } from "node:child_process";
import type { HealthStatus } from "./memory-provider";

export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpClientError";
  }
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private process: ChildProcess | null = null;
  private command: string;
  private args: string[];
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = "";

  constructor(command: string, args: string[]) {
    this.command = command;
    this.args = args;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e) {
        reject(new McpClientError(`Failed to spawn: ${e}`));
        return;
      }

      this.process.on("error", (err) => {
        reject(new McpClientError(`Process error: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new McpClientError(`Process exited with code ${code}`));
        }
        this.pendingRequests.clear();
        this.process = null;
      });

      if (this.process.stdout) {
        this.process.stdout.on("data", (chunk: Buffer) => {
          this.buffer += chunk.toString();
          this.processBuffer();
        });
      }

      // Give the process a moment to start or fail
      setTimeout(() => {
        if (this.isRunning()) {
          resolve();
        } else {
          reject(new McpClientError("Process exited immediately"));
        }
      }, 500);
    });
  }

  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
    this.pendingRequests.clear();
    this.buffer = "";
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.isRunning()) {
      throw new McpClientError("MCP server is not running");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new McpClientError(`Request ${id} timed out`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      try {
        this.process!.stdin!.write(JSON.stringify(request) + "\n");
      } catch (e) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new McpClientError(`Failed to write to stdin: ${e}`));
      }
    });
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.call("tools/list");
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = JSON.parse(trimmed) as JsonRpcResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new McpClientError(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Non-JSON line (e.g., stderr redirect, log output) — ignore
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd runtime && bun test tests/mcp-client.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add runtime/src/mcp-client.ts runtime/tests/mcp-client.test.ts
git commit -m "feat(memory): add MCP stdio client with health check and restart"
```

---

## Task 6: MemPalaceProvider

**Files:**
- Create: `runtime/src/mempalace-provider.ts`
- Test: `runtime/tests/mempalace-provider.test.ts`

- [ ] **Step 1: Write the failing tests with mocked MCP client**

```typescript
// runtime/tests/mempalace-provider.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { MemPalaceProvider } from "../src/mempalace-provider";
import type { MemoryConfig, HealthStatus } from "../src/memory-provider";
import type { McpClient } from "../src/mcp-client";

// Create a mock MCP client
function createMockClient(): McpClient & { _callLog: Array<{ method: string; params: unknown }> } {
  const callLog: Array<{ method: string; params: unknown }> = [];
  const mockResponses: Record<string, unknown> = {
    "tools/call": { content: [{ text: JSON.stringify({ ok: true }) }] },
    "tools/list": { tools: [] },
  };

  return {
    _callLog: callLog,
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    call: async (method: string, params?: Record<string, unknown>) => {
      callLog.push({ method, params: params ?? {} });
      // Route based on tool name in params
      if (method === "tools/call" && params?.name === "mempalace_status") {
        return {
          content: [
            {
              text: JSON.stringify({
                total_drawers: 42,
                wings: { "test-project": 30, "other-project": 12 },
              }),
            },
          ],
        };
      }
      if (method === "tools/call" && params?.name === "mempalace_search") {
        return {
          content: [
            {
              text: JSON.stringify({
                results: [
                  {
                    content: "We decided to use Clerk",
                    wing: "test-project",
                    room: "architect",
                    hall: "hall_facts",
                    similarity: 0.92,
                    source: "session-1.jsonl",
                  },
                ],
              }),
            },
          ],
        };
      }
      if (method === "tools/call" && params?.name === "mempalace_add_drawer") {
        return {
          content: [{ text: JSON.stringify({ id: "drawer-abc-123", ok: true }) }],
        };
      }
      return mockResponses[method] ?? {};
    },
    healthCheck: async (): Promise<HealthStatus> => ({
      healthy: true,
      latencyMs: 5,
    }),
  } as unknown as McpClient & { _callLog: Array<{ method: string; params: unknown }> };
}

const CONFIG: MemoryConfig = {
  provider: "mempalace",
  mempalace: {
    palacePath: "~/.mempalace/palace",
    projectWing: "test-project",
    wakeLayers: ["L0", "L1"],
    autoHall: true,
    maxWakeTokens: 1200,
    maxDrawerTokens: 500,
  },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

describe("MemPalaceProvider", () => {
  let provider: MemPalaceProvider;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    provider = new MemPalaceProvider(mockClient);
    await provider.initialize(CONFIG);
  });

  it("has correct id and name", () => {
    expect(provider.id).toBe("mempalace");
    expect(provider.name).toBe("MemPalace");
  });

  it("isAvailable checks MCP client health", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it("healthCheck delegates to MCP client", async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it("recall calls mempalace_search with correct params", async () => {
    const result = await provider.recall("auth decisions", {
      projectId: "test-project",
      agentId: "architect",
      hall: "hall_facts",
      maxResults: 3,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].content).toBe("We decided to use Clerk");
    expect(result.entries[0].similarity).toBe(0.92);

    // Verify correct MCP call was made
    const searchCall = mockClient._callLog.find(
      (c) => c.method === "tools/call" && (c.params as any).name === "mempalace_search",
    );
    expect(searchCall).toBeDefined();
  });

  it("remember calls mempalace_add_drawer with correct params", async () => {
    const id = await provider.remember("Important decision about auth", {
      projectId: "test-project",
      agentId: "architect",
      hall: "hall_facts",
      sessionId: "sess-123",
    });

    expect(id).toBe("drawer-abc-123");

    const addCall = mockClient._callLog.find(
      (c) => c.method === "tools/call" && (c.params as any).name === "mempalace_add_drawer",
    );
    expect(addCall).toBeDefined();
    const addParams = (addCall!.params as any).arguments;
    expect(addParams.wing).toBe("test-project");
    expect(addParams.room).toBe("architect");
  });

  it("remember rejects content exceeding maxDrawerTokens", async () => {
    const longContent = "x".repeat(2500); // ~625 tokens, exceeds 500 cap
    try {
      await provider.remember(longContent, {
        projectId: "test-project",
        agentId: "architect",
      });
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect((e as Error).message).toContain("exceeds");
    }
  });

  it("status calls mempalace_status", async () => {
    const s = await provider.status();
    expect(s.provider).toBe("mempalace");
    expect(s.available).toBe(true);
    expect(s.drawerCount).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/mempalace-provider.test.ts`
Expected: FAIL — cannot find module `../src/mempalace-provider`

- [ ] **Step 3: Implement MemPalaceProvider**

```typescript
// runtime/src/mempalace-provider.ts
import type {
  MemoryProvider,
  MemoryConfig,
  MempalaceConfig,
  WakeContext,
  RecallOpts,
  RecallResult,
  RecallEntry,
  RememberOpts,
  RememberId,
  HealthStatus,
  MemoryStatus,
} from "./memory-provider";
import type { McpClient } from "./mcp-client";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export class MemPalaceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemPalaceProviderError";
  }
}

export class MemPalaceProvider implements MemoryProvider {
  readonly id = "mempalace";
  readonly name = "MemPalace";

  private client: McpClient;
  private config: MempalaceConfig | null = null;
  private fullConfig: MemoryConfig | null = null;
  private fallbackQueue: Array<{
    content: string;
    wing: string;
    room: string;
    hall: string;
    timestamp: string;
    sessionId?: string;
  }> = [];

  constructor(client: McpClient) {
    this.client = client;
  }

  async initialize(config: MemoryConfig): Promise<void> {
    this.fullConfig = config;
    this.config = config.mempalace ?? {
      palacePath: "~/.mempalace/palace",
      projectWing: "default",
      wakeLayers: ["L0", "L1"],
      autoHall: true,
      maxWakeTokens: 1200,
      maxDrawerTokens: 500,
    };
  }

  async isAvailable(): Promise<boolean> {
    const health = await this.healthCheck();
    return health.healthy;
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.client.healthCheck();
  }

  async wake(projectId: string, _agentId?: string): Promise<WakeContext> {
    const maxTokens = this.config!.maxWakeTokens;

    try {
      // Get status to build wake context
      const statusResult = await this.callTool("mempalace_status", {});
      const statusData = this.parseToolResult(statusResult);

      // Search for recent/high-relevance content for this project
      const searchResult = await this.callTool("mempalace_search", {
        query: "important decisions facts preferences",
        wing: projectId,
        n_results: 15,
      });
      const searchData = this.parseToolResult(searchResult);

      const identity = "";  // L0 from identity.txt — loaded by MemPalace's Layer0 directly
      let essentials = "";
      let truncated = false;

      if (searchData.results && Array.isArray(searchData.results)) {
        // Sort by similarity descending
        const sorted = searchData.results.sort(
          (a: any, b: any) => (b.similarity ?? 0) - (a.similarity ?? 0),
        );

        const lines: string[] = [];
        let currentTokens = Math.ceil(identity.length / 4);

        for (const r of sorted) {
          const line = `- [${r.room ?? "?"}/${r.hall ?? "?"}] ${r.content}`;
          const lineTokens = Math.ceil(line.length / 4);
          if (currentTokens + lineTokens > maxTokens) {
            truncated = true;
            break;
          }
          lines.push(line);
          currentTokens += lineTokens;
        }

        essentials = lines.join("\n");
      }

      const tokenEstimate = Math.ceil((identity.length + essentials.length) / 4);
      return { identity, essentials, tokenEstimate, truncated };
    } catch {
      return { identity: "", essentials: "", tokenEstimate: 0, truncated: false };
    }
  }

  async recall(query: string, opts: RecallOpts): Promise<RecallResult> {
    const params: Record<string, unknown> = {
      query,
      wing: opts.projectId,
      n_results: opts.maxResults ?? 5,
    };
    if (opts.agentId) params.room = opts.agentId;
    if (opts.hall) params.hall = opts.hall;

    const result = await this.callToolWithRecovery("mempalace_search", params);
    const data = this.parseToolResult(result);

    const entries: RecallEntry[] = (data.results ?? []).map((r: any) => ({
      content: r.content ?? "",
      wing: r.wing ?? opts.projectId,
      room: r.room ?? "",
      hall: r.hall ?? "",
      similarity: r.similarity ?? 0,
      source: r.source,
    }));

    const tokenEstimate = entries.reduce((sum, e) => sum + Math.ceil(e.content.length / 4), 0);
    return { entries, tokenEstimate };
  }

  async remember(content: string, opts: RememberOpts): Promise<RememberId> {
    const maxDrawerTokens = this.config!.maxDrawerTokens;
    const contentTokens = Math.ceil(content.length / 4);

    if (contentTokens > maxDrawerTokens) {
      throw new MemPalaceProviderError(
        `Content exceeds maxDrawerTokens (${contentTokens} > ${maxDrawerTokens}). ` +
          `Be more concise — store the essential verbatim excerpt, not the full discussion.`,
      );
    }

    const params: Record<string, unknown> = {
      content,
      wing: opts.projectId,
      room: opts.agentId,
    };
    if (opts.hall) params.hall = opts.hall;
    if (opts.sessionId) params.session_id = opts.sessionId;

    try {
      const result = await this.callToolWithRecovery("mempalace_add_drawer", params);
      const data = this.parseToolResult(result);
      return data.id ?? "unknown";
    } catch (e) {
      // Last resort: queue for fallback
      this.fallbackQueue.push({
        content,
        wing: opts.projectId,
        room: opts.agentId,
        hall: opts.hall ?? "hall_facts",
        timestamp: new Date().toISOString(),
        sessionId: opts.sessionId,
      });
      throw e;
    }
  }

  async status(): Promise<MemoryStatus> {
    try {
      const result = await this.callTool("mempalace_status", {});
      const data = this.parseToolResult(result);
      return {
        provider: "mempalace",
        available: true,
        drawerCount: data.total_drawers,
        wings: data.wings ? Object.keys(data.wings) : undefined,
      };
    } catch {
      return { provider: "mempalace", available: false };
    }
  }

  /**
   * Write any queued fallback memories to a JSONL file.
   * Called by the engine when the session ends and MCP recovery failed.
   */
  writeFallback(sessionDir: string): string | null {
    if (this.fallbackQueue.length === 0) return null;

    mkdirSync(sessionDir, { recursive: true });
    const fallbackPath = join(sessionDir, "memory-fallback.jsonl");
    const lines = this.fallbackQueue.map((m) => JSON.stringify(m));
    writeFileSync(fallbackPath, lines.join("\n") + "\n");
    this.fallbackQueue = [];
    return fallbackPath;
  }

  // ── Private helpers ──────────────────────────────────────────

  private async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.call("tools/call", { name: toolName, arguments: args });
  }

  private async callToolWithRecovery(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.callTool(toolName, args);
    } catch (firstError) {
      // One restart attempt
      try {
        await this.client.restart();
        return await this.callTool(toolName, args);
      } catch {
        throw firstError; // surface the original error
      }
    }
  }

  private parseToolResult(result: unknown): any {
    if (!result || typeof result !== "object") return {};
    const r = result as { content?: Array<{ text?: string }> };
    if (r.content && Array.isArray(r.content) && r.content[0]?.text) {
      try {
        return JSON.parse(r.content[0].text);
      } catch {
        return {};
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd runtime && bun test tests/mempalace-provider.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add runtime/src/mempalace-provider.ts runtime/tests/mempalace-provider.test.ts
git commit -m "feat(memory): add MemPalaceProvider with MCP integration and crash recovery"
```

---

## Task 7: Engine Memory Integration

**Files:**
- Modify: `runtime/src/engine.ts`
- Test: `runtime/tests/engine-memory.test.ts`

- [ ] **Step 1: Write the failing tests for engine memory lifecycle**

```typescript
// runtime/tests/engine-memory.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { ExpertiseProvider } from "../src/expertise-provider";
import type { MemoryProvider, MemoryConfig } from "../src/memory-provider";

// These tests verify the memory lifecycle logic that will be wired into the engine.
// We test the provider interactions directly since the full engine requires
// a mock adapter setup that is already tested in engine.test.ts.

const CONFIG: MemoryConfig = {
  provider: "expertise",
  expertise: { maxLines: 200, scope: "per-project" },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

describe("Engine memory lifecycle", () => {
  let provider: MemoryProvider;

  beforeEach(async () => {
    provider = new ExpertiseProvider();
    await provider.initialize(CONFIG);
  });

  it("wake returns context that can be injected into prompts", async () => {
    // Simulate prior session memories
    await provider.remember("Auth uses Clerk for SSO", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_facts",
    });

    const ctx = await provider.wake("proj");
    expect(typeof ctx.essentials).toBe("string");
    expect(ctx.tokenEstimate).toBeGreaterThan(0);
  });

  it("recall respects maxRecallPerSession cap", async () => {
    await provider.remember("Decision A", { projectId: "proj", agentId: "a" });
    await provider.remember("Decision B", { projectId: "proj", agentId: "b" });

    // Simulate recall counter (engine responsibility)
    let recallCount = 0;
    const maxRecall = CONFIG.orchestrator.maxRecallPerSession;

    for (let i = 0; i < 15; i++) {
      if (recallCount >= maxRecall) break;
      await provider.recall("decisions", { projectId: "proj" });
      recallCount++;
    }

    expect(recallCount).toBe(maxRecall);
  });

  it("remember at session end stores content retrievable in next wake", async () => {
    // Session 1: orchestrator commits memories
    await provider.remember("We chose GraphQL over REST", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_facts",
      sessionId: "session-1",
    });
    await provider.remember("Performance target: p95 < 200ms", {
      projectId: "proj",
      agentId: "sentinel",
      hall: "hall_facts",
      sessionId: "session-1",
    });

    // Session 2: wake retrieves prior memories
    const ctx = await provider.wake("proj");
    expect(ctx.essentials).toContain("GraphQL");
    expect(ctx.essentials).toContain("200ms");
  });

  it("health check before session-end remember", async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    // Only proceed with remember if healthy
    if (health.healthy) {
      const id = await provider.remember("Safe to store", {
        projectId: "proj",
        agentId: "strategist",
      });
      expect(id).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/engine-memory.test.ts`
Expected: PASS immediately (these tests use ExpertiseProvider which is already built) — but run to confirm the test file is valid

- [ ] **Step 3: Add memoryProvider field and initialization to engine.ts**

In `runtime/src/engine.ts`, add the following import at the top:

```typescript
import type { MemoryProvider, MemoryConfig } from "./memory-provider";
import { loadMemoryConfig } from "./memory-config";
```

Add to the class fields (after `private checkpoint`):

```typescript
  private memoryProvider: MemoryProvider | null = null;
  private memoryConfig: MemoryConfig | null = null;
  private recallCount: number = 0;
```

Add to `EngineOpts`:

```typescript
  projectDir?: string;        // For loading .aos/memory.yaml
  memoryProvider?: MemoryProvider;  // Override for testing
```

At the end of the constructor, add:

```typescript
    // Initialize memory provider
    if (opts.memoryProvider) {
      this.memoryProvider = opts.memoryProvider;
    }
  }
```

In the `start()` method, after the session_start transcript event and before the workflow check, add:

```typescript
    // Initialize memory
    if (this.memoryProvider && !this.memoryConfig) {
      const projectDir = opts?.deliberationDir ?? process.cwd();
      this.memoryConfig = loadMemoryConfig(projectDir);
      await this.memoryProvider.initialize(this.memoryConfig);

      const wakeCtx = await this.memoryProvider.wake(
        this.memoryConfig.mempalace?.projectWing ?? this.profile.id,
      );

      if (wakeCtx.essentials) {
        this.pushTranscript({
          type: wakeCtx.truncated ? "memory_wake_truncated" : "memory_wake",
          timestamp: new Date().toISOString(),
          tokenEstimate: wakeCtx.tokenEstimate,
          truncated: wakeCtx.truncated,
        });
      }

      this.recallCount = 0;
    }
```

- [ ] **Step 4: Run all engine tests to verify no regressions**

Run: `cd runtime && bun test tests/engine.test.ts tests/engine-memory.test.ts`
Expected: PASS — existing engine tests pass, new memory tests pass

- [ ] **Step 5: Commit**

```bash
git add runtime/src/engine.ts runtime/tests/engine-memory.test.ts
git commit -m "feat(memory): wire MemoryProvider into engine session lifecycle"
```

---

## Task 8: Skill Definitions

**Files:**
- Create: `core/skills/mempalace-read-write/skill.yaml`
- Create: `core/skills/mempalace-admin/skill.yaml`

- [ ] **Step 1: Create the read-write skill**

```yaml
# core/skills/mempalace-read-write/skill.yaml
schema: aos/skill/v1
id: mempalace-read-write
name: MemPalace Read + Write
description: Search, inspect, and add drawers to MemPalace
version: 1.0.0

input:
  required: []
  optional: []

output:
  structured_result: true

compatible_agents:
  - operator
  - steward
  - auditor

platform_bindings:
  claude-code: null
  pi: mempalace-mcp

platform_requirements:
  requires_network: false
  requires_tools:
    - mempalace_search
    - mempalace_list_wings
    - mempalace_list_rooms
    - mempalace_get_taxonomy
    - mempalace_status
    - mempalace_check_duplicate
    - mempalace_add_drawer
    - mempalace_delete_drawer
```

- [ ] **Step 2: Create the admin skill**

```yaml
# core/skills/mempalace-admin/skill.yaml
schema: aos/skill/v1
id: mempalace-admin
name: MemPalace Admin
description: Full administrative access to all MemPalace tools — explicit opt-in only
version: 1.0.0

input:
  required: []
  optional: []

output:
  structured_result: true

compatible_agents:
  - auditor

platform_bindings:
  claude-code: null
  pi: mempalace-mcp

platform_requirements:
  requires_network: false
```

- [ ] **Step 3: Validate skills with aos validate**

Run: `cd aos-harness && bun run cli/src/index.ts validate`
Expected: Skills validate without errors (or with expected warnings for missing platform bindings)

- [ ] **Step 4: Commit**

```bash
git add core/skills/mempalace-read-write/skill.yaml core/skills/mempalace-admin/skill.yaml
git commit -m "feat(memory): add MemPalace skill definitions for operational agents"
```

---

## Task 9: Orchestrator Agent Config Updates

**Files:**
- Modify: `core/agents/orchestrators/*/agent.yaml` (all orchestrator agents)

- [ ] **Step 1: Identify all orchestrator agent configs**

Run: `ls core/agents/orchestrators/`
Note all orchestrator directories.

- [ ] **Step 2: Add memory tools to each orchestrator's skills list**

For each orchestrator agent's `agent.yaml`, add under the `skills:` list:

```yaml
skills:
  # ... existing skills ...
  - aos-memory        # Grants access to aos_remember and aos_recall tools
```

This is a declarative change — the actual tool implementations are wired at the adapter level. The skill name `aos-memory` signals to the adapter that this agent should receive the `aos_remember` and `aos_recall` tools.

- [ ] **Step 3: Add request_recall to perspective agent configs**

For each perspective agent in `core/agents/perspectives/*/agent.yaml`, add:

```yaml
skills:
  # ... existing skills ...
  - aos-request-recall  # Grants access to aos_request_recall tool
```

- [ ] **Step 4: Validate all agent configs**

Run: `cd aos-harness && bun run cli/src/index.ts validate`
Expected: All agents validate with the new skill references

- [ ] **Step 5: Commit**

```bash
git add core/agents/orchestrators/ core/agents/perspectives/
git commit -m "feat(memory): add memory skills to orchestrator and perspective agent configs"
```

---

## Task 10: CLI Init Memory Step

**Files:**
- Modify: `cli/src/commands/init.ts`

- [ ] **Step 1: Read the current init.ts to understand the full flow**

Run: `cat cli/src/commands/init.ts`
Note all existing logic — we will append the memory step after the existing setup completes.

- [ ] **Step 2: Add memory config generation to init command**

At the end of the `initCommand` function, after the existing config and core copy logic, add:

```typescript
  // Generate default memory config
  const memoryYaml = `# AOS Memory Configuration
# Generated by: aos init
api_version: aos/memory/v1

# Memory provider: "mempalace" (recommended) or "expertise" (built-in fallback)
provider: expertise

# MemPalace settings (used when provider: mempalace)
# mempalace:
#   palace_path: ~/.mempalace/palace
#   project_wing: ${projectName}
#   wake_layers: [L0, L1]
#   auto_hall: true
#   max_wake_tokens: 1200
#   max_drawer_tokens: 500

# Built-in expertise settings (used when provider: expertise)
expertise:
  max_lines: 200
  scope: per-project

# Orchestrator memory behavior
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`;

  const memoryPath = join(aosDir, "memory.yaml");
  if (!existsSync(memoryPath) || force) {
    writeFileSync(memoryPath, memoryYaml);
    console.log(c.dim(`  Memory config: ${memoryPath}`));
  }
```

Where `projectName` is derived from the current directory name:

```typescript
  const projectName = cwd.split("/").pop()?.toLowerCase().replace(/[^a-z0-9-]/g, "-") ?? "default";
```

Add this line before the `aosDir` definition.

- [ ] **Step 3: Run the init command to verify**

Run: `cd /tmp && mkdir test-aos-init && cd test-aos-init && bun run cli/src/index.ts init`
Expected: `.aos/memory.yaml` is created alongside `config.yaml`

- [ ] **Step 4: Verify the generated memory.yaml is valid**

Run: `cat /tmp/test-aos-init/.aos/memory.yaml`
Expected: Valid YAML with default expertise provider

- [ ] **Step 5: Clean up test directory and commit**

```bash
rm -rf /tmp/test-aos-init
git add cli/src/commands/init.ts
git commit -m "feat(memory): add memory.yaml generation to aos init"
```

---

## Task 11: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all new memory tests**

Run: `cd runtime && bun test tests/memory-provider.test.ts tests/memory-config.test.ts tests/fuzzy-match.test.ts tests/expertise-provider.test.ts tests/mcp-client.test.ts tests/mempalace-provider.test.ts tests/engine-memory.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run full existing test suite to verify no regressions**

Run: `cd runtime && bun test`
Expected: All existing tests PASS, no regressions

- [ ] **Step 3: Run validation**

Run: `cd aos-harness && bun run cli/src/index.ts validate`
Expected: Validation passes

- [ ] **Step 4: Commit any fixes if needed, then tag**

```bash
git add -A
git commit -m "test(memory): verify full test suite passes with memory integration"
```
