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
