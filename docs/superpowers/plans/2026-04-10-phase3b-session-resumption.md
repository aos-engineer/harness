# Phase 3b: Session Resumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions can be paused and resumed with full agent context reconstruction. Checkpoints capture constraint state, active agents, and per-agent conversation tails so agents wake up with memory of what just happened.

**Architecture:** Engine gains `pauseSession()` and `resumeSession()` methods. Checkpoints are serialized to JSON and emitted as transcript events. On resume, agents are re-spawned and their conversation context is replayed from the checkpoint.

**Tech Stack:** TypeScript, Bun

**Spec:** `docs/specs/2026-04-10-harness-enhanced-capabilities-design.md` — Section 4C (Session Resumption)

---

## File Map

### Harness — New Files
| File | Responsibility |
|---|---|
| `runtime/src/session-checkpoint.ts` | Checkpoint serialization/deserialization, transcript tail extraction |
| `runtime/tests/session-checkpoint.test.ts` | Unit tests |

### Harness — Modified Files
| File | Change |
|---|---|
| `runtime/src/types.ts` | Add `SessionCheckpoint`, `AgentCheckpoint` types |
| `runtime/src/engine.ts` | Add `pauseSession()`, `resumeSession()` methods |
| `runtime/tests/engine.test.ts` | Tests for pause/resume |
| `runtime/package.json` | Export session-checkpoint module |

---

## Task 1: Add Checkpoint Types

**Files:**
- Modify: `runtime/src/types.ts`
- Test: `runtime/tests/types.test.ts`

- [ ] **Step 1: Write failing type tests**

Append to `runtime/tests/types.test.ts`:

```typescript
describe("Session checkpoint types", () => {
  it("AgentCheckpoint compiles", () => {
    const cp: import("../src/types").AgentCheckpoint = {
      agentId: "architect",
      depth: 0,
      conversationTail: [
        { type: "delegation", timestamp: "2026-04-10", agentId: "architect", message: "Design the API" },
        { type: "response", timestamp: "2026-04-10", agentId: "architect", content: "Here is my design..." },
      ],
    };
    expect(cp.conversationTail).toHaveLength(2);
  });

  it("SessionCheckpoint compiles", () => {
    const cp: import("../src/types").SessionCheckpoint = {
      sessionId: "session-abc",
      constraintState: {
        elapsed_minutes: 5, budget_spent: 0.5, rounds_completed: 3,
        past_min_time: true, past_min_budget: true, past_min_rounds: true, past_all_minimums: true,
        approaching_max_time: false, approaching_max_budget: false, approaching_max_rounds: false,
        approaching_any_maximum: false, hit_maximum: false, hit_reason: "none",
        can_end: true, bias_ratio: 1.2, most_addressed: ["sentinel"], least_addressed: ["catalyst"],
        bias_blocked: false, metered: true,
      },
      activeAgents: [{
        agentId: "architect", depth: 0, conversationTail: [],
      }],
      roundsCompleted: 3,
      pendingDelegations: [],
      transcriptReplayDepth: 50,
      createdAt: "2026-04-10T14:30:00Z",
    };
    expect(cp.activeAgents).toHaveLength(1);
    expect(cp.transcriptReplayDepth).toBe(50);
  });
});
```

- [ ] **Step 2: Add types to runtime/src/types.ts**

After the `PersistenceAdapter` interface, add:

```typescript
// ── Session Checkpoint Types ───────────────────────────────────

export interface AgentCheckpoint {
  agentId: string;
  parentAgentId?: string;
  depth: number;
  conversationTail: TranscriptEntry[];
  expertiseSnapshot?: string;
}

export interface PendingDelegation {
  target: string | string[];
  message: string;
  round: number;
}

export interface SessionCheckpoint {
  sessionId: string;
  constraintState: ConstraintState;
  activeAgents: AgentCheckpoint[];
  roundsCompleted: number;
  pendingDelegations: PendingDelegation[];
  transcriptReplayDepth: number;
  createdAt: string;
}
```

- [ ] **Step 3: Run tests, commit**

Run: `bun test runtime/tests/types.test.ts`

```bash
git add runtime/src/types.ts runtime/tests/types.test.ts
git commit -m "feat(types): add SessionCheckpoint and AgentCheckpoint types"
```

---

## Task 2: Implement SessionCheckpoint Module

**Files:**
- Create: `runtime/src/session-checkpoint.ts`
- Create: `runtime/tests/session-checkpoint.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// runtime/tests/session-checkpoint.test.ts
import { describe, it, expect } from "bun:test";
import { SessionCheckpointManager } from "../src/session-checkpoint";
import type { TranscriptEntry, AgentHandle, ConstraintState, SessionCheckpoint } from "../src/types";
import { createDefaultConstraintState } from "../src/types";

describe("SessionCheckpointManager", () => {
  const manager = new SessionCheckpointManager();

  describe("extractConversationTail", () => {
    const transcript: TranscriptEntry[] = [
      { type: "session_start", timestamp: "t0", profile: "test" },
      { type: "delegation", timestamp: "t1", agentId: "arbiter", targets: ["sentinel"] },
      { type: "response", timestamp: "t2", agentId: "sentinel", content: "My analysis..." },
      { type: "delegation", timestamp: "t3", agentId: "arbiter", targets: ["catalyst"] },
      { type: "response", timestamp: "t4", agentId: "catalyst", content: "I think..." },
      { type: "response", timestamp: "t5", agentId: "sentinel", content: "Follow-up..." },
      { type: "constraint_check", timestamp: "t6", round: 2 },
    ];

    it("extracts events relevant to a specific agent", () => {
      const tail = manager.extractConversationTail(transcript, "sentinel", 50);
      // sentinel appears in t2 (response), t5 (response), and t1 (target)
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
      state.rounds_completed = 3;
      const handles: AgentHandle[] = [
        { id: "h1", agentId: "sentinel", sessionId: "s1", depth: 0 },
        { id: "h2", agentId: "catalyst", sessionId: "s1", depth: 0 },
      ];
      const transcript: TranscriptEntry[] = [
        { type: "response", timestamp: "t1", agentId: "sentinel", content: "test" },
      ];

      const cp = manager.createCheckpoint("session-1", state, handles, transcript, 3, 50);
      expect(cp.sessionId).toBe("session-1");
      expect(cp.activeAgents).toHaveLength(2);
      expect(cp.roundsCompleted).toBe(3);
      expect(cp.transcriptReplayDepth).toBe(50);
      expect(cp.createdAt).toBeDefined();
    });
  });

  describe("serialize/deserialize", () => {
    it("round-trips a checkpoint through JSON", () => {
      const cp: SessionCheckpoint = {
        sessionId: "s1",
        constraintState: createDefaultConstraintState(),
        activeAgents: [{ agentId: "a1", depth: 0, conversationTail: [] }],
        roundsCompleted: 2,
        pendingDelegations: [],
        transcriptReplayDepth: 50,
        createdAt: "2026-04-10",
      };
      const json = manager.serialize(cp);
      const restored = manager.deserialize(json);
      expect(restored.sessionId).toBe("s1");
      expect(restored.activeAgents).toHaveLength(1);
      expect(restored.roundsCompleted).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Implement SessionCheckpointManager**

```typescript
// runtime/src/session-checkpoint.ts
import type {
  TranscriptEntry, AgentHandle, ConstraintState,
  SessionCheckpoint, AgentCheckpoint,
} from "./types";

export class SessionCheckpointManager {
  /**
   * Extract transcript events relevant to a specific agent.
   * Returns the last `maxDepth` events where the agent is involved.
   */
  extractConversationTail(
    transcript: TranscriptEntry[],
    agentId: string,
    maxDepth: number,
  ): TranscriptEntry[] {
    const relevant = transcript.filter((entry) => {
      if (entry.agentId === agentId) return true;
      if (entry.childAgentId === agentId) return true;
      const targets = entry.targets as string[] | undefined;
      if (targets?.includes(agentId)) return true;
      return false;
    });
    return relevant.slice(-maxDepth);
  }

  /**
   * Create a checkpoint from current engine state.
   */
  createCheckpoint(
    sessionId: string,
    constraintState: ConstraintState,
    activeHandles: AgentHandle[],
    transcript: TranscriptEntry[],
    roundsCompleted: number,
    replayDepth: number,
  ): SessionCheckpoint {
    const activeAgents: AgentCheckpoint[] = activeHandles.map((handle) => ({
      agentId: handle.agentId,
      parentAgentId: handle.parentAgentId,
      depth: handle.depth ?? 0,
      conversationTail: this.extractConversationTail(transcript, handle.agentId, replayDepth),
    }));

    return {
      sessionId,
      constraintState,
      activeAgents,
      roundsCompleted,
      pendingDelegations: [],
      transcriptReplayDepth: replayDepth,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Serialize checkpoint to JSON string.
   */
  serialize(checkpoint: SessionCheckpoint): string {
    return JSON.stringify(checkpoint);
  }

  /**
   * Deserialize checkpoint from JSON string.
   */
  deserialize(json: string): SessionCheckpoint {
    return JSON.parse(json) as SessionCheckpoint;
  }
}
```

- [ ] **Step 3: Run tests, export, commit**

Run: `bun test runtime/tests/session-checkpoint.test.ts`

Add to runtime/package.json exports: `"./session-checkpoint": "./src/session-checkpoint.ts"`

```bash
git add runtime/src/session-checkpoint.ts runtime/tests/session-checkpoint.test.ts runtime/package.json
git commit -m "feat(runtime): implement SessionCheckpointManager

Extracts per-agent conversation tails from transcript, creates
checkpoints with constraint state and active agent snapshots.
JSON serialize/deserialize for persistence."
```

---

## Task 3: Add pauseSession/resumeSession to AOSEngine

**Files:**
- Modify: `runtime/src/engine.ts`
- Test: `runtime/tests/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `runtime/tests/engine.test.ts`:

```typescript
describe("AOSEngine — session pause/resume", () => {
  it("pauseSession returns a checkpoint", async () => {
    const adapter = new MockAdapter();
    const events: TranscriptEntry[] = [];
    const engine = new AOSEngine(adapter, testProfileDir, {
      agentsDir: testAgentsDir,
      onTranscriptEvent: (e) => events.push(e),
    });
    const checkpoint = await engine.pauseSession();
    expect(checkpoint.sessionId).toBeDefined();
    expect(checkpoint.activeAgents).toBeDefined();
    expect(checkpoint.constraintState).toBeDefined();
    // Should have emitted session_paused event
    expect(events.some((e) => e.type === "session_paused")).toBe(true);
  });

  it("getCheckpoint returns null before pause", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(adapter, testProfileDir, { agentsDir: testAgentsDir });
    expect(engine.getCheckpoint()).toBeNull();
  });

  it("getCheckpoint returns checkpoint after pause", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(adapter, testProfileDir, { agentsDir: testAgentsDir });
    await engine.pauseSession();
    expect(engine.getCheckpoint()).not.toBeNull();
  });
});
```

- [ ] **Step 2: Add imports and methods to engine.ts**

Import at top:
```typescript
import { SessionCheckpointManager } from "./session-checkpoint";
import type { SessionCheckpoint } from "./types";
```

Add private fields:
```typescript
private checkpointManager: SessionCheckpointManager;
private checkpoint: SessionCheckpoint | null = null;
```

Initialize in constructor:
```typescript
this.checkpointManager = new SessionCheckpointManager();
```

Add methods:

```typescript
  async pauseSession(reason?: string): Promise<SessionCheckpoint> {
    const state = this.constraintEngine.getState();
    const activeHandles = Array.from(this.handles.values());
    
    this.checkpoint = this.checkpointManager.createCheckpoint(
      this.sessionId,
      state,
      activeHandles,
      this.transcript,
      this.roundNumber,
      50, // default replay depth
    );

    this.pushTranscript({
      type: "session_paused",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      reason: reason ?? "user_requested",
      checkpoint: this.checkpoint,
    });

    return this.checkpoint;
  }

  getCheckpoint(): SessionCheckpoint | null {
    return this.checkpoint;
  }
```

- [ ] **Step 3: Run tests, commit**

Run: `bun test runtime/tests/engine.test.ts`

```bash
git add runtime/src/engine.ts runtime/tests/engine.test.ts
git commit -m "feat(runtime): add pauseSession and getCheckpoint to AOSEngine

Creates checkpoint with constraint state, active agents, and
per-agent conversation tails. Emits session_paused event."
```

---

## Task 4: Final Verification

- [ ] **Step 1:** Run `bun test` in harness — all pass
- [ ] **Step 2:** Check harness git status — clean
- [ ] **Step 3:** Verify commit history
