// Run state is a pure fold over the event log. The reducer never mutates its input and never hands
// out structure it shares with an event, so a state loaded from state.json and advanced one event at
// a time always equals a full replay of the log.
import type { EventEnvelope, Projector, RunState, StageDef } from "./types.ts";
import { OpError } from "./util/errors.ts";

export function applyEvent(state: RunState | null, e: EventEnvelope): RunState {
  if (state === null) {
    if (e.type !== "run.started") {
      throw new Error(`cannot project run ${e.run}: the first event must be run.started, got ${e.type} at seq ${e.seq}`);
    }
    return initialState(e);
  }
  return { ...reduce(state, e), seq: e.seq, updatedAt: e.ts };
}

export function project(events: EventEnvelope[]): RunState {
  let state: RunState | null = null;
  for (const e of events) state = applyEvent(state, e);
  if (state === null) throw new Error("cannot project an empty log: the first event must be run.started");
  return state;
}

export const projector: Projector = { apply: applyEvent };

export function stageDef(state: RunState, stage: string = state.current.stage): StageDef {
  const def = state.pack.tiers[state.tier]?.stages.find((s) => s.name === stage);
  if (def === undefined) {
    throw new OpError(
      "invalid",
      `stage "${stage}" is not part of the ${state.tier} tier of ${state.pack.name}@${state.pack.version} (stages: ${state.stages.join(", ")})`,
    );
  }
  return def;
}

function initialState(e: EventEnvelope<"run.started">): RunState {
  const { data } = e;
  const stages = (data.pack.tiers[data.tier]?.stages ?? []).map((s) => s.name);
  const first = stages[0];
  if (first === undefined) {
    throw new Error(`run ${e.run} starts in the ${data.tier} tier, but pack ${data.pack.name}@${data.pack.version} defines no stages for it`);
  }
  return {
    run: e.run, status: "active", tier: data.tier, tierReason: data.tierReason, brief: data.brief,
    root: data.root, git: data.git, host: data.host, pack: structuredClone(data.pack),
    stages, current: { stage: first, index: 0, enteredSeq: e.seq },
    tasks: [], evidence: [], approvals: [], lastGate: {},
    budget: { iterations: { used: 0, limit: data.pack.budget.iterations, warned: false, exceeded: false } },
    changes: 0, stop: { lastGapKey: null }, sessions: [],
    startedAt: e.ts, updatedAt: e.ts, seq: e.seq,
  };
}

function reduce(state: RunState, e: EventEnvelope): RunState {
  switch (e.type) {
    case "run.started":
      // Re-initializing would silently erase the run's evidence and approvals.
      throw new Error(`run ${state.run} already started; a second run.started at seq ${e.seq} means the log is corrupt`);
    case "stage.entered":
      return { ...state, current: { stage: e.data.stage, index: e.data.index, enteredSeq: e.seq }, stop: { ...state.stop, lastGapKey: null } };
    case "run.completed":
      return { ...state, status: "completed" };
    case "run.cancelled":
      return { ...state, status: "cancelled" };
    case "task.added":
      return { ...state, tasks: [...state.tasks, { id: e.data.task, stage: e.data.stage, title: e.data.title, done: false, evidence: [] }] };
    case "task.completed": {
      const { task, evidence } = e.data;
      return { ...state, tasks: state.tasks.map((t) => (t.id === task ? { ...t, done: true, evidence: [...evidence] } : t)) };
    }
    case "evidence.recorded":
      return { ...state, evidence: [...state.evidence, { ...e.data, seq: e.seq }] };
    case "gate.evaluated":
      return { ...state, lastGate: { ...state.lastGate, [e.data.stage]: { ...e.data, gaps: e.data.gaps.map((g) => ({ ...g })) } } };
    case "approval.requested": {
      const { request, stage, summary } = e.data;
      return { ...state, approvals: [...state.approvals, { request, stage, summary, requestedSeq: e.seq, decision: null }] };
    }
    case "approval.granted":
    case "approval.denied": {
      const decision = { granted: e.type === "approval.granted", reason: e.data.reason, actor: { ...e.actor }, seq: e.seq };
      return { ...state, approvals: state.approvals.map((a) => (a.request === e.data.request ? { ...a, decision } : a)) };
    }
    case "budget.charged": {
      const it = state.budget.iterations;
      return { ...state, budget: { iterations: { ...it, used: it.used + e.data.amount } }, stop: { ...state.stop, lastGapKey: e.data.gapKey } };
    }
    case "budget.warning":
      return { ...state, budget: { iterations: { ...state.budget.iterations, warned: true } } };
    case "budget.exceeded":
      return { ...state, budget: { iterations: { ...state.budget.iterations, exceeded: true } } };
    case "worktree.changed":
      return { ...state, changes: state.changes + 1 };
    case "session.bound": {
      const { host, session } = e.data;
      if (state.sessions.some((s) => s.host === host && s.session === session)) return state;
      return { ...state, sessions: [...state.sessions, { host, session }] };
    }
    default:
      // Unknown types come from newer kernels; they advance seq and nothing else.
      return state;
  }
}
