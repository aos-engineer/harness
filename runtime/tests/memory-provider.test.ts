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
