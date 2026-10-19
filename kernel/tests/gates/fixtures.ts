// Shared test fixtures for projection and gate tests: a pack literal shaped like the reference
// feature-delivery pack (spike and bounded tiers), and builders that turn event drafts into a
// sequenced log. The real pack lives in packs/feature-delivery; this copy keeps these tests pure.
import type { Actor, EventDataMap, EventDraft, EventEnvelope, EventType, ResolvedPack, Tier } from "../../src/types.ts";
import { GENESIS_PREV } from "../../src/types.ts";

export const RUN = "01JAQ7Z3K8M2N4P6R8T0V2X4Y6";
export const ROOT = "/work/app";
export const T1 = "git:" + "1".repeat(40);
export const T2 = "git:" + "2".repeat(40);

export const HOOK: Actor = { kind: "hook", id: "claude-code", agent: null };
export const AGENT: Actor = { kind: "agent", id: "claude-code", agent: null };
export const HUMAN: Actor = { kind: "human", id: "owner", agent: null };
export const KERNEL: Actor = { kind: "kernel", id: "aos", agent: null };

export const TEST_COMMANDS = ["bun test", "npm test", "pytest", "go test"];

export const PACK: ResolvedPack = {
  name: "feature-delivery",
  version: "1.0.0",
  roles: { test: TEST_COMMANDS },
  classify: { rules: [{ tier: "spike", any: ["spike", "prototype", "explore"] }], default: "bounded" },
  tiers: {
    spike: {
      stages: [
        { name: "frame", writes: [], gate: { decider: "human", requires: [], tasks: "none" }, bind: ["brainstorming"], model: "reasoning" },
        { name: "probe", writes: "any", gate: { decider: "rule", requires: [], tasks: "none" }, bind: [], model: "fast" },
      ],
    },
    bounded: {
      stages: [
        {
          name: "design", writes: ["docs/specs/"], bind: ["brainstorming"], model: "reasoning",
          gate: { decider: "human", requires: [], tasks: "none" },
        },
        {
          name: "build", writes: "any", bind: ["writing-plans", "test-driven-development"], model: "fast",
          gate: {
            decider: "rule", tasks: "all",
            requires: [{ kind: "command", role: "test", result: "exit_zero", provenance: "observed", fresh: true }],
          },
        },
        {
          name: "verify", writes: "any", bind: ["verification-before-completion", "requesting-code-review"], model: "reasoning",
          gate: {
            decider: "rule", tasks: "none",
            requires: [
              { kind: "command", role: "test", result: "exit_zero", provenance: "observed", fresh: true },
              { kind: "review", status: "approved", provenance: "claimed", fresh: true },
            ],
          },
        },
      ],
    },
  },
  actions: {
    commit: { patterns: ["git commit"], policy: { spike: { allow: "always" }, bounded: { allow: "in_stages", stages: ["build", "verify"] } } },
    push: { patterns: ["git push"], policy: { spike: { allow: "after_gate", gate: "verify" }, bounded: { allow: "after_gate", gate: "verify" } } },
    pr_create: { patterns: ["gh pr create"], policy: { spike: { allow: "never" }, bounded: { allow: "after_gate", gate: "verify" } } },
    deploy: { patterns: ["deploy"], policy: { spike: { allow: "never" }, bounded: { allow: "never" } } },
  },
  budget: { iterations: 20 },
  integrity: "sha256:" + "a".repeat(64),
  instructions: {
    "spike/frame": "Frame the question.", "spike/probe": "Probe it.",
    "bounded/design": "Write a short design.", "bounded/build": "Build it test first.", "bounded/verify": "Verify and review.",
  },
};

function draft<T extends EventType>(type: T, actor: Actor, data: EventDataMap[T]): EventDraft<T> {
  return { type, actor, data };
}

/**
 * Sequence drafts into envelopes: seq from 1, one second apart. The prev field is a placeholder
 * because projection never reads it; the hash chain is the store's concern.
 */
export function log(...drafts: EventDraft[]): EventEnvelope[] {
  return drafts.map((d, i) => at(i + 1, d));
}

/** One envelope at a given seq, for applying a single event to an existing state. */
export function at(seq: number, d: EventDraft): EventEnvelope {
  const ts = new Date(Date.UTC(2026, 9, 19, 0, 0, seq)).toISOString();
  return { v: 1, seq, id: `ev-${seq}`, run: RUN, ts, prev: seq === 1 ? GENESIS_PREV : `sha256:${String(seq - 1).padStart(64, "0")}`, ...d };
}

/** An event as a newer kernel might write it, parsed the way the store reads any log line. */
export function unknownEvent(type: string, data: unknown): EventDraft {
  return JSON.parse(JSON.stringify({ type, actor: KERNEL, data }));
}

export const started = (tier: Tier = "bounded") =>
  draft("run.started", KERNEL, {
    brief: "add a health endpoint", tier, tierReason: tier === "spike" ? 'keyword "spike"' : "pack default",
    root: ROOT, git: true, host: "claude-code", pack: PACK,
  });
export const entered = (stage: string, index: number) => draft("stage.entered", KERNEL, { stage, index });
export const completed = (stage: string) => draft("run.completed", KERNEL, { stage });
export const cancelled = (reason: string) => draft("run.cancelled", HUMAN, { reason });
export const taskAdded = (task: string, stage: string, title: string) => draft("task.added", AGENT, { task, stage, title });
export const taskCompleted = (task: string, evidence: string[] = []) => draft("task.completed", AGENT, { task, evidence });
export const charged = (gapKey: string | null, amount = 1) => draft("budget.charged", KERNEL, { dimension: "iterations", amount, gapKey });
export const budgetWarning = (used: number, limit = 20) => draft("budget.warning", KERNEL, { dimension: "iterations", used, limit });
export const budgetExceeded = (used: number, limit = 20) => draft("budget.exceeded", KERNEL, { dimension: "iterations", used, limit });
export const worktreeChanged = (path: string) => draft("worktree.changed", HOOK, { path, tool: "Edit" });
export const sessionBound = (session: string, host = "claude-code") => draft("session.bound", HOOK, { host, session });
export const requested = (request: string, stage = "design", summary = "short design for the health endpoint") =>
  draft("approval.requested", AGENT, { request, stage, summary });
export const granted = (request: string, stage = "design", reason: string | null = null) =>
  draft("approval.granted", HUMAN, { request, stage, reason });
export const denied = (request: string, reason: string, stage = "design") => draft("approval.denied", HUMAN, { request, stage, reason });
