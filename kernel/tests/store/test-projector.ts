// A stand-in projector so the store tests do not depend on the real projection. It builds a minimal run
// from run.started, then tracks seq and updatedAt (what the store relies on), counts worktree changes, and
// collects added tasks in order, so a skipped, repeated, or reordered event changes the state.
import type { Projector } from "../../src/types.ts";

export const testProjector: Projector = {
  apply(prev, e) {
    if (prev !== null) {
      const next = { ...prev, seq: e.seq, updatedAt: e.ts };
      if (e.type === "worktree.changed") return { ...next, changes: prev.changes + 1 };
      if (e.type === "task.added") {
        return { ...next, tasks: [...prev.tasks, { id: e.data.task, stage: e.data.stage, title: e.data.title, done: false, evidence: [] }] };
      }
      return next;
    }
    if (e.type !== "run.started") throw new Error(`a run must start with run.started, got ${e.type}`);
    const d = e.data;
    return {
      run: e.run, status: "active", tier: d.tier, tierReason: d.tierReason, brief: d.brief,
      root: d.root, git: d.git, host: d.host, pack: d.pack,
      stages: [], current: { stage: "", index: 0, enteredSeq: e.seq },
      tasks: [], evidence: [], approvals: [], lastGate: {},
      budget: { iterations: { used: 0, limit: d.pack.budget.iterations, warned: false, exceeded: false } },
      changes: 0, stop: { lastGapKey: null }, sessions: [],
      startedAt: e.ts, updatedAt: e.ts, seq: e.seq,
    };
  },
};
