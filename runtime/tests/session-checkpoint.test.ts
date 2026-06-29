import { describe, it, expect } from "bun:test";
import { SessionCheckpointManager } from "../src/session-checkpoint";
import type { TranscriptEntry, SessionCheckpoint } from "../src/types";
import { createDefaultConstraintState } from "../src/types";

describe("SessionCheckpointManager", () => {
  const manager = new SessionCheckpointManager();

  describe("extractConversationTail", () => {
    const transcript: TranscriptEntry[] = [
      { type: "session_start", timestamp: "t0", profile: "test" },
      { type: "delegation", timestamp: "t1", agentId: "arbiter", targets: ["sentinel"] },
      { type: "response", timestamp: "t2", agentId: "sentinel", content: "Analysis..." },
      { type: "delegation", timestamp: "t3", agentId: "arbiter", targets: ["catalyst"] },
      { type: "response", timestamp: "t4", agentId: "catalyst", content: "I think..." },
      { type: "response", timestamp: "t5", agentId: "sentinel", content: "Follow-up..." },
    ];

    it("extracts events for a specific agent", () => {
      const tail = manager.extractConversationTail(transcript, "sentinel", 50);
      expect(tail.length).toBeGreaterThan(0);
      expect(tail.every((e) => e.agentId === "sentinel" || (e.targets as string[])?.includes("sentinel"))).toBe(true);
    });

    it("respects max depth", () => {
      const tail = manager.extractConversationTail(transcript, "sentinel", 1);
      expect(tail).toHaveLength(1);
    });

    it("returns empty for unknown agent", () => {
      expect(manager.extractConversationTail(transcript, "unknown", 50)).toEqual([]);
    });
  });

  describe("createCheckpoint", () => {
    it("creates a valid checkpoint", () => {
      const state = createDefaultConstraintState();
      const handles = [
        { id: "h1", agentId: "sentinel", sessionId: "s1", depth: 0 },
        { id: "h2", agentId: "catalyst", sessionId: "s1", depth: 0 },
      ];
      const transcript: TranscriptEntry[] = [
        { type: "response", timestamp: "t1", agentId: "sentinel", content: "test" },
      ];
      const cp = manager.createCheckpoint("s1", state, handles, transcript, 3, 50);
      expect(cp.sessionId).toBe("s1");
      expect(cp.activeAgents).toHaveLength(2);
      expect(cp.roundsCompleted).toBe(3);
      expect(cp.transcriptReplayDepth).toBe(50);
    });
  });

  describe("serialize/deserialize", () => {
    it("round-trips a checkpoint", () => {
      const cp: SessionCheckpoint = {
        sessionId: "s1", constraintState: createDefaultConstraintState(),
        activeAgents: [{ agentId: "a1", depth: 0, conversationTail: [] }],
        roundsCompleted: 2, pendingDelegations: [],
        transcriptReplayDepth: 50, createdAt: "2026-04-10",
      };
      const json = manager.serialize(cp);
      const restored = manager.deserialize(json);
      expect(restored.sessionId).toBe("s1");
      expect(restored.activeAgents).toHaveLength(1);
    });
  });
});
