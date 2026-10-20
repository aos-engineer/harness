// Seeded generator of valid run logs for property tests. "Valid" means what projection relies on:
// run.started first, contiguous seq, and ids that refer back to tasks, requests, and evidence that
// earlier events created. Everything else is random, including event types this kernel does not know.
import type { ActionName, EventDraft, EventEnvelope, Evidence, Gap, GateResult, Tier } from "../../src/types.ts";
import { AGENT, HOOK, HUMAN, KERNEL, PACK, T1, T2, at, started, unknownEvent } from "../gates/fixtures.ts";

/** mulberry32: small, fast, and good enough to spread test inputs; not for anything secret. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FINGERPRINTS = [T1, T2, "counter:3"];
const SESSIONS = ["s1", "s2", "s3"];
const ACTIONS: ActionName[] = ["commit", "push", "pr_create", "deploy"];

export function genEvents(seed: number, n: number): EventEnvelope[] {
  const rand = mulberry32(seed);
  const int = (max: number) => Math.floor(rand() * max);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
  const chance = (p: number) => rand() < p;

  const tier: Tier = chance(0.3) ? "spike" : "bounded";
  const stages = (PACK.tiers[tier]?.stages ?? []).map((s) => s.name);
  const tasks: string[] = [];
  const requests: string[] = [];
  const evidence: string[] = [];
  let changes = 0;

  const gap = (): Gap => ({
    kind: pick(["missing", "stale", "failed"] as const), who: pick(["agent", "human"] as const),
    requirement: pick(["command:test", "review", "approval", "tasks:t1"]), text: `gap ${int(1000)}`,
  });

  const evidenceItem = (): Evidence => {
    const id = `ev${evidence.length + 1}`;
    evidence.push(id);
    const base = {
      id, provenance: pick(["claimed", "observed", "attested"] as const), fingerprint: pick(FINGERPRINTS),
      changes, stage: pick(stages), agent: chance(0.2) ? "reviewer" : null,
    };
    switch (pick(["command", "artifact", "review", "citation", "skill"] as const)) {
      case "command": {
        const masked = chance(0.2);
        return { ...base, kind: "command", role: "test", command: "bun test", exitCode: masked ? null : pick([0, 0, 1]), masked, outputSha256: `sha256:${int(1e9)}`, tail: "ok" };
      }
      case "artifact": return { ...base, kind: "artifact", path: "docs/specs/health.md", sha256: `sha256:${int(1e9)}` };
      case "review": return { ...base, kind: "review", status: pick(["approved", "rejected", "needs-revision"] as const), feedback: "looks fine", reviewer: "code-reviewer" };
      case "citation": return { ...base, kind: "citation", path: "src/app.ts", line: 1 + int(200), note: "entry point" };
      case "skill": return { ...base, kind: "skill", skill: pick(["brainstorming", "test-driven-development"]) };
    }
  };

  const gateResult = (): GateResult => ({
    stage: pick(stages), verdict: pick(["pending", "pass", "fail"] as const),
    gaps: Array.from({ length: int(4) }, gap), fingerprint: pick(FINGERPRINTS), weakFreshness: chance(0.2),
  });

  // One factory per event type, so a log mixes every type the projection must handle.
  const factories: Array<() => EventDraft> = [
    () => { const index = int(stages.length); return { type: "stage.entered", actor: KERNEL, data: { stage: stages[index], index } }; },
    () => { const task = `t${tasks.length + 1}`; tasks.push(task); return { type: "task.added", actor: AGENT, data: { task, stage: pick(stages), title: `task ${task}` } }; },
    () => tasks.length === 0 ? factories[1]() : { type: "task.completed", actor: AGENT, data: { task: pick(tasks), evidence: evidence.filter(() => chance(0.3)) } },
    () => ({ type: "evidence.recorded", actor: HOOK, data: evidenceItem() }),
    () => ({ type: "gate.evaluated", actor: KERNEL, data: gateResult() }),
    () => { const request = `r${requests.length + 1}`; requests.push(request); return { type: "approval.requested", actor: AGENT, data: { request, stage: pick(stages), summary: "please review" } }; },
    () => requests.length === 0 ? factories[5]() : { type: "approval.granted", actor: HUMAN, data: { request: pick(requests), stage: pick(stages), reason: chance(0.5) ? "fine" : null } },
    () => requests.length === 0 ? factories[5]() : { type: "approval.denied", actor: HUMAN, data: { request: pick(requests), stage: pick(stages), reason: "not yet" } },
    () => ({ type: "budget.charged", actor: KERNEL, data: { dimension: "iterations", amount: 1, gapKey: chance(0.2) ? null : `pending|command:test:${pick(["missing", "stale"])}` } }),
    () => ({ type: "budget.warning", actor: KERNEL, data: { dimension: "iterations", used: 16, limit: 20 } }),
    () => ({ type: "budget.exceeded", actor: KERNEL, data: { dimension: "iterations", used: 20, limit: 20 } }),
    () => ({ type: "action.blocked", actor: HOOK, data: { action: pick([...ACTIONS, "write", "human-only", "aos-dir"] as const), tool: "Bash", reason: "gate pending" } }),
    () => ({ type: "action.allowed", actor: HOOK, data: { action: pick(ACTIONS), tool: "Bash", gate: chance(0.5) ? "verify" : null } }),
    () => { changes++; return { type: "worktree.changed", actor: HOOK, data: { path: `src/f${int(5)}.ts`, tool: "Edit" } }; },
    () => ({ type: "session.bound", actor: HOOK, data: { host: "claude-code", session: pick(SESSIONS) } }),
    () => ({ type: "log.repaired", actor: KERNEL, data: { droppedBytes: int(100), droppedSha256: `sha256:${int(1e9)}` } }),
    () => unknownEvent("context.issued", { stage: pick(stages), bytes: int(4096) }),
  ];

  const drafts: EventDraft[] = [started(tier)];
  while (drafts.length < n - 1) drafts.push(pick(factories)());
  // A run ends at most once, and only at the end of its log.
  if (n > 1) {
    const end = int(3);
    drafts.push(end === 0 ? { type: "run.completed", actor: KERNEL, data: { stage: pick(stages) } }
      : end === 1 ? { type: "run.cancelled", actor: HUMAN, data: { reason: "abandoned" } }
      : pick(factories)());
  }
  return drafts.map((d, i) => at(i + 1, d));
}
