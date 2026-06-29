import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { AOSEngine } from "../src/engine";
import { MockAdapter } from "./mock-adapter";
import type { TranscriptEntry } from "../src/types";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

describe("AOSEngine", () => {
  it("constructs with adapter and profile", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    expect(engine).toBeDefined();
  });

  it("getConstraintState returns initial state", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    const state = engine.getConstraintState();
    expect(state.rounds_completed).toBe(0);
    expect(state.metered).toBe(true);
  });

  it("getConstraintState reflects unmetered auth", () => {
    const adapter = new MockAdapter();
    adapter.authMode = { type: "subscription", metered: false, subscription_tier: "max" };
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    const state = engine.getConstraintState();
    expect(state.metered).toBe(false);
  });

  it("delegateMessage calls adapter and returns responses", async () => {
    const adapter = new MockAdapter();
    adapter.agentResponses.set("catalyst", "Ship it now.");
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    const responses = await engine.delegateMessage("all", "What should we do?");
    expect(responses.length).toBeGreaterThan(0);
    // catalyst is the only perspective, find its response
    expect(responses.some((r) => r.text === "Ship it now.")).toBe(true);
  });

  it("delegateMessage updates constraint state", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    await engine.delegateMessage("all", "First round");
    const state = engine.getConstraintState();
    expect(state.rounds_completed).toBe(1);
    expect(state.budget_spent).toBeGreaterThan(0);
  });

  it("delegateMessage passes the profile agent timeout to adapter calls", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );

    await engine.delegateMessage("all", "What should we do?");

    const sendMessageCall = adapter.calls.find((call) => call.method === "sendMessage");
    expect(sendMessageCall).toBeDefined();
    expect(sendMessageCall?.args[2]).toMatchObject({ timeoutMs: 60000 });
  });

  it("start() validates brief and initializes session", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));
    const transcript = engine.getTranscript();
    expect(transcript.length).toBe(1);
    expect(transcript[0].type).toBe("session_start");
    // Verify session_start includes all required fields (spec Section 6.10)
    expect(transcript[0].session_id).toBeDefined();
    expect(transcript[0].profile).toBe("test-council");
    expect(transcript[0].participants).toBeDefined();
    expect(transcript[0].constraints).toBeDefined();
    expect(transcript[0].auth_mode).toBeDefined();
    expect(transcript[0].brief_path).toBeDefined();
  });

  it("start() throws on invalid brief", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    expect(engine.start("/nonexistent/brief.md")).rejects.toThrow();
  });

  it("end() throws when minimums not met", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    expect(engine.end("Wrap up")).rejects.toThrow("Cannot end");
  });

  it("end() succeeds after minimums met", async () => {
    // Use a high mock cost so budget minimum (0.50) is met quickly.
    // With 1 perspective (catalyst), each round costs responseCost per agent.
    // We need total cost >= 0.50, and rounds >= 1 (min_rounds).
    // Set responseCost = 0.60 so one round meets budget min.
    const adapter = new MockAdapter();
    adapter.responseCost = 0.60;
    adapter.agentResponses.set("catalyst", "My final position.");

    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );

    // Start session to set startTime
    await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));

    // Run one round to meet min_rounds (1) and min_budget (0.50)
    await engine.delegateMessage("all", "Discuss the topic");

    // min_minutes is 1, but we can't wait 1 minute in a test.
    // However, once we hit max_rounds (4) it becomes can_end=true via hit_maximum.
    // We already have 1 round done. Need 3 more to hit max_rounds=4.
    await engine.delegateMessage("all", "Continue discussion");
    await engine.delegateMessage("all", "Any final thoughts?");
    // At this point rounds_completed = 3. After end() calls delegateMessage internally,
    // that will be round 4 = max_rounds, triggering hit_maximum.
    // But we need can_end BEFORE end() calls delegateMessage.
    // So we need 4 rounds before calling end().
    await engine.delegateMessage("all", "Last round before end");

    // Now rounds_completed = 4 = max_rounds, so hit_maximum = true => can_end = true
    const state = engine.getConstraintState();
    expect(state.can_end).toBe(true);

    const responses = await engine.end("Final closing statements");
    expect(responses.length).toBeGreaterThan(0);
  });

  describe("onTranscriptEvent hook", () => {
    it("calls the hook for each transcript event", async () => {
      const adapter = new MockAdapter();
      const events: any[] = [];
      const engine = new AOSEngine(
        adapter,
        join(fixturesDir, "profiles", "test-council"),
        {
          agentsDir: join(fixturesDir, "agents"),
          onTranscriptEvent: (entry) => { events.push(entry); },
        },
      );
      await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("session_start");
    });

    it("does not crash the engine when hook throws synchronously", async () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(
        adapter,
        join(fixturesDir, "profiles", "test-council"),
        {
          agentsDir: join(fixturesDir, "agents"),
          onTranscriptEvent: () => { throw new Error("sync boom"); },
        },
      );
      // Should not throw despite the hook throwing
      await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));
      const transcript = engine.getTranscript();
      expect(transcript.length).toBe(1);
      expect(transcript[0].type).toBe("session_start");
    });

    it("swallows async rejections from the hook silently", async () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(
        adapter,
        join(fixturesDir, "profiles", "test-council"),
        {
          agentsDir: join(fixturesDir, "agents"),
          onTranscriptEvent: async () => { throw new Error("async boom"); },
        },
      );
      // Should not throw or cause unhandled rejection
      await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));
      const transcript = engine.getTranscript();
      expect(transcript.length).toBe(1);
      expect(transcript[0].type).toBe("session_start");
    });
  });

  describe("AOSEngine — domain enforcement", () => {
    it("returns null enforcer for agents without domain rules", async () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(adapter, join(fixturesDir, "profiles", "test-council"), {
        agentsDir: join(fixturesDir, "agents"),
        onTranscriptEvent: () => {},
      });
      const enforcer = engine.getDomainEnforcer("arbiter");
      expect(enforcer).toBeNull();
    });
  });

  describe("AOSEngine — hierarchical delegation", () => {
    it("returns error when parent has no delegation config", async () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(adapter, join(fixturesDir, "profiles", "test-council"), {
        agentsDir: join(fixturesDir, "agents"),
        onTranscriptEvent: () => {},
      });
      const result = await engine.spawnChildAgent("arbiter", { name: "w1", role: "worker" });
      expect(result.success).toBe(false);
    });

    it("getChildAgents returns empty for agents without children", () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(adapter, join(fixturesDir, "profiles", "test-council"), {
        agentsDir: join(fixturesDir, "agents"),
      });
      expect(engine.getChildAgents("arbiter")).toEqual([]);
    });
  });

  describe("MockAdapter — enforceToolAccess", () => {
    it("records enforceToolAccess calls", async () => {
      const adapter = new MockAdapter();
      const result = await adapter.enforceToolAccess("arbiter", {
        tool: "write",
        path: "apps/web/page.tsx",
      });
      expect(result.allowed).toBe(true);
      expect(adapter.calls.some((c) => c.method === "enforceToolAccess")).toBe(true);
    });
  });

  describe("AOSEngine — session pause", () => {
    it("pauseSession returns a checkpoint", async () => {
      const adapter = new MockAdapter();
      const events: TranscriptEntry[] = [];
      const engine = new AOSEngine(adapter, join(fixturesDir, "profiles", "test-council"), {
        agentsDir: join(fixturesDir, "agents"),
        onTranscriptEvent: (e) => { events.push(e); },
      });
      const cp = await engine.pauseSession();
      expect(cp.sessionId).toBeDefined();
      expect(cp.activeAgents).toBeDefined();
      expect(events.some((e) => e.type === "session_paused")).toBe(true);
    });

    it("getCheckpoint returns null before pause", () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(adapter, join(fixturesDir, "profiles", "test-council"), { agentsDir: join(fixturesDir, "agents") });
      expect(engine.getCheckpoint()).toBeNull();
    });

    it("getCheckpoint returns checkpoint after pause", async () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(adapter, join(fixturesDir, "profiles", "test-council"), { agentsDir: join(fixturesDir, "agents") });
      await engine.pauseSession();
      expect(engine.getCheckpoint()).not.toBeNull();
    });
  });

  describe("workflow integration", () => {
    it("uses deliberation mode when workflow is null/undefined", () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(
        adapter,
        join(fixturesDir, "profiles", "test-council"),
        { agentsDir: join(fixturesDir, "agents") },
      );
      expect(engine.isWorkflowMode()).toBe(false);
      expect(engine.getWorkflowResults()).toBeNull();
    });

    it("detects workflow mode when profile has workflow field", () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(
        adapter,
        join(fixturesDir, "profiles", "workflow-council"),
        {
          agentsDir: join(fixturesDir, "agents"),
          workflowsDir: join(fixturesDir, "workflows"),
        },
      );
      expect(engine.isWorkflowMode()).toBe(true);
    });

    it("creates artifacts directory when workflow is present", async () => {
      const adapter = new MockAdapter();
      const engine = new AOSEngine(
        adapter,
        join(fixturesDir, "profiles", "workflow-council"),
        {
          agentsDir: join(fixturesDir, "agents"),
          workflowsDir: join(fixturesDir, "workflows"),
        },
      );

      const tmpDir = join(import.meta.dir, "..", ".tmp-test-workflow-" + Date.now());
      try {
        await engine.start(
          join(fixturesDir, "briefs", "test-brief", "brief.md"),
          { deliberationDir: tmpDir },
        );
        expect(existsSync(join(tmpDir, "artifacts"))).toBe(true);

        // Workflow should have produced results
        const results = engine.getWorkflowResults();
        expect(results).not.toBeNull();

        // Transcript should contain workflow events
        const transcript = engine.getTranscript();
        const workflowStart = transcript.find((e) => e.type === "workflow_start");
        const workflowEnd = transcript.find((e) => e.type === "workflow_end");
        const sessionEnd = transcript.find((e) => e.type === "session_end");
        expect(workflowStart).toBeDefined();
        expect(workflowEnd).toBeDefined();
        expect(sessionEnd).toBeDefined();
      } finally {
        if (existsSync(tmpDir)) {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });
  });
});
