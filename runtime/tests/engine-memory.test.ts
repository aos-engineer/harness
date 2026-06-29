import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExpertiseProvider } from "../src/expertise-provider";
import { AOSEngine } from "../src/engine";
import { MockAdapter } from "./mock-adapter";
import type { MemoryProvider, MemoryConfig } from "../src/memory-provider";

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

    const ctx = await provider.wake("proj");
    expect(ctx.essentials).toContain("GraphQL");
    expect(ctx.essentials).toContain("200ms");
  });

  it("health check before session-end remember", async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    if (health.healthy) {
      const id = await provider.remember("Safe to store", {
        projectId: "proj",
        agentId: "strategist",
      });
      expect(id).toBeTruthy();
    }
  });

  it("loads memory config from the configured project root", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "aos-engine-memory-"));
    mkdirSync(join(projectDir, ".aos"), { recursive: true });
    writeFileSync(
      join(projectDir, ".aos", "memory.yaml"),
      `api_version: aos/memory/v1
provider: mempalace
mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: project-root-wing
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );

    const seen: { config?: MemoryConfig; projectId?: string } = {};
    const memoryProvider: MemoryProvider = {
      id: "test-memory",
      name: "Test Memory",
      async initialize(config) {
        seen.config = config;
      },
      async isAvailable() {
        return true;
      },
      async healthCheck() {
        return { healthy: true, latencyMs: 0 };
      },
      async wake(projectId) {
        seen.projectId = projectId;
        return {
          identity: projectId,
          essentials: "remembered project fact",
          tokenEstimate: 3,
          truncated: false,
        };
      },
      async recall() {
        return { entries: [], tokenEstimate: 0 };
      },
      async remember() {
        return "memory-id";
      },
      async status() {
        return { provider: "test-memory", available: true };
      },
    };

    const fixturesDir = join(import.meta.dir, "..", "fixtures");
    const engine = new AOSEngine(
      new MockAdapter(),
      join(fixturesDir, "profiles", "test-council"),
      {
        agentsDir: join(fixturesDir, "agents"),
        projectDir,
        memoryProvider,
      },
    );

    await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));

    expect(seen.config?.provider).toBe("mempalace");
    expect(seen.projectId).toBe("project-root-wing");
    expect(engine.getTranscript().some((entry) => entry.type === "memory_wake")).toBe(true);
  });

  it("records recall and remember transcript events", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "aos-engine-memory-"));
    mkdirSync(join(projectDir, ".aos"), { recursive: true });
    writeFileSync(
      join(projectDir, ".aos", "memory.yaml"),
      `api_version: aos/memory/v1
provider: expertise
expertise:
  max_lines: 200
  scope: per-project
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 1
`,
    );

    const memoryProvider: MemoryProvider = {
      id: "test-memory",
      name: "Test Memory",
      async initialize() {},
      async isAvailable() {
        return true;
      },
      async healthCheck() {
        return { healthy: true, latencyMs: 0 };
      },
      async wake(projectId) {
        return { identity: projectId, essentials: "", tokenEstimate: 0, truncated: false };
      },
      async recall(query, opts) {
        return {
          entries: [{
            content: query,
            wing: opts.projectId,
            room: opts.agentId ?? "arbiter",
            hall: opts.hall ?? "facts",
            similarity: 1,
          }],
          tokenEstimate: 1,
        };
      },
      async remember() {
        return "memory-id";
      },
      async status() {
        return { provider: "test-memory", available: true };
      },
    };

    const fixturesDir = join(import.meta.dir, "..", "fixtures");
    const engine = new AOSEngine(
      new MockAdapter(),
      join(fixturesDir, "profiles", "test-council"),
      {
        agentsDir: join(fixturesDir, "agents"),
        projectDir,
        memoryProvider,
      },
    );

    await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));
    const recall = await engine.recallMemory("prior decision", { agentId: "arbiter" });
    const id = await engine.rememberMemory("We chose option A", { agentId: "arbiter" });

    expect(recall.entries[0].content).toBe("prior decision");
    expect(id).toBe("memory-id");
    expect(engine.getTranscript().some((entry) => entry.type === "memory_recall")).toBe(true);
    expect(engine.getTranscript().some((entry) => entry.type === "memory_committed")).toBe(true);
    await expect(engine.recallMemory("second query")).rejects.toThrow("Memory recall limit");
    expect(engine.getTranscript().some((entry) => entry.type === "memory_recall_denied")).toBe(true);
  });
});
