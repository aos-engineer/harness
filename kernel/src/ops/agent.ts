// Operations the agent drives through MCP tools. Each one reads the run, checks it against policy, and
// appends events; none of them can approve, waive, lower a tier, or record observed evidence, because
// those belong to the human and to the hooks. Failures are OpErrors so the MCP layer can relay the class.
import { evaluateGate } from "../gates/evaluate.ts";
import { formatGate, renderSummary } from "../gates/format.ts";
import { classifyTier } from "../pack/classify.ts";
import { loadPack } from "../pack/load.ts";
import { projector } from "../projection.ts";
import { appendEvents, createRun, loadState } from "../store/store.ts";
import type { EventDraft, GateResult, ResolvedPack, RunLocation, RunState, RunStatus, Tier } from "../types.ts";
import { TIER_RANK } from "../types.ts";
import { notImplemented, OpError, RunNotFoundError } from "../util/errors.ts";
import { ulid } from "../util/ulid.ts";
import { agentActor } from "./context.ts";
import type { OpContext } from "./context.ts";

export interface RunStartResult { runId: string; tier: Tier; tierReason: string; stages: string[]; stage: string; instructions: string; notice: string }

export interface StatusResult { runId: string; status: RunStatus; tier: Tier; stage: string; stages: string[]; gate: GateResult; iterations: { used: number; limit: number }; summary: string }

export interface GateCheckResult { gate: GateResult; message: string | null }

export interface StageAdvanceResult { advanced: boolean; completed: boolean; gate: GateResult; stage: string; instructions: string | null; message: string | null }

export type EvidenceInput =
  | { kind: "artifact"; path: string }

  | { kind: "citation"; path: string; line: number; note: string }

  | { kind: "review"; status: "approved" | "rejected" | "needs-revision"; feedback: string; reviewer: string }

  | { kind: "skill"; skill: string };

const MAX_BRIEF_CHARS = 8000;

export function runStart(ctx: OpContext, p: { brief: string; tier?: Tier }): RunStartResult {
  const brief = text(p.brief, "brief", MAX_BRIEF_CHARS);
  if (p.tier !== undefined && !Object.hasOwn(TIER_RANK, p.tier)) {
    throw new OpError("invalid", `unknown tier ${JSON.stringify(p.tier)}; expected spike, bounded, or architectural`);
  }
  const pack = loadPack(ctx.packDir);
  const proposal = classifyTier(pack, brief);

  // A request may only raise the proposal: lowering the tier weakens the gates, so it takes a human.
  let tier = proposal.tier;
  let tierReason = proposal.reason;
  if (p.tier !== undefined && TIER_RANK[p.tier] < TIER_RANK[proposal.tier]) {
    throw new OpError("refused", `Lowering the proposed tier (${proposal.tier}: ${proposal.reason}) requires a human.`);
  }
  if (p.tier !== undefined && TIER_RANK[p.tier] > TIER_RANK[proposal.tier]) {
    tier = p.tier;
    tierReason = `${proposal.reason}; raised to ${tier} on request`;
  }

  // Running a tier the pack lacks under a weaker one would quietly drop the gates the brief called for.
  const stages = (pack.tiers[tier]?.stages ?? []).map((s) => s.name);
  const first = stages[0];
  if (first === undefined) {
    const why = tier === proposal.tier ? `proposed because ${proposal.reason}` : `requested; the brief alone proposed ${proposal.tier}: ${proposal.reason}`;
    throw new OpError("refused", `The ${tier} tier is not available in this version of AOS (${why}). Ask the human how to proceed.`);
  }

  const runId = ulid();
  const loc: RunLocation = { root: ctx.root, run: runId };
  const actor = agentActor("aos_run_start");
  createRun(loc, { type: "run.started", actor, data: { brief, tier, tierReason, root: ctx.root, git: ctx.git, host: ctx.host, pack } }, projector);
  append(loc, [{ type: "stage.entered", actor, data: { stage: first, index: 0 } }]);
  return {
    runId, tier, tierReason, stages, stage: first,
    instructions: instructionsFor(pack, tier, first),
    notice: `AOS run ${runId} started as ${tier} (${tierReason}). Tell the human the tier and why. This session is bound to the run once this call returns.`,
  };
}

export function runStatus(ctx: OpContext, p: { runId: string }): StatusResult {
  const { state } = read(ctx, p.runId);
  const gate = evaluate(ctx, state);
  const { used, limit } = state.budget.iterations;
  return {
    runId: state.run, status: state.status, tier: state.tier, stage: state.current.stage, stages: [...state.stages],
    gate, iterations: { used, limit }, summary: renderSummary(state, gate),
  };
}

export function gateCheck(ctx: OpContext, p: { runId: string }): GateCheckResult {
  const { loc, state } = readActive(ctx, p.runId);
  const gate = evaluate(ctx, state);
  append(loc, [{ type: "gate.evaluated", actor: agentActor("aos_gate_check"), data: gate }]);
  return { gate, message: gate.verdict === "pass" ? null : formatGate(gate, state, "advance") };
}

export function stageAdvance(ctx: OpContext, p: { runId: string }): StageAdvanceResult {
  const { loc, state } = readActive(ctx, p.runId);
  const actor = agentActor("aos_stage_advance");
  const gate = evaluate(ctx, state);
  const evaluated: EventDraft = { type: "gate.evaluated", actor, data: gate };
  const stage = state.current.stage;
  if (gate.verdict !== "pass") {
    append(loc, [evaluated]);
    return { advanced: false, completed: false, gate, stage, instructions: null, message: formatGate(gate, state, "advance") };
  }

  // The evaluation and the move land in one append, so the log never shows a stage entered without
  // the passing gate that allowed it.
  const index = state.current.index + 1;
  const next = state.stages[index];
  if (next === undefined) {
    append(loc, [evaluated, { type: "run.completed", actor, data: { stage } }]);
    return { advanced: true, completed: true, gate, stage, instructions: null, message: null };
  }
  append(loc, [evaluated, { type: "stage.entered", actor, data: { stage: next, index } }]);
  return { advanced: true, completed: false, gate, stage: next, instructions: instructionsFor(state.pack, state.tier, next), message: null };
}

export function taskAdd(ctx: OpContext, p: { runId: string; title: string }): { task: string; stage: string } {
  return notImplemented("F");
}

export function taskComplete(ctx: OpContext, p: { runId: string; task: string; evidence?: string[] }): { task: string; open: number } {
  return notImplemented("F");
}

export function evidenceRecord(ctx: OpContext, p: EvidenceInput & { runId: string }): { evidenceId: string; fingerprint: string } {
  return notImplemented("F");
}

export function requestApproval(ctx: OpContext, p: { runId: string; summary: string }): { request: string; stage: string; instructions: string } {
  return notImplemented("F");
}

// ---- helpers ----

function read(ctx: OpContext, runId: string): { loc: RunLocation; state: RunState } {
  if (typeof runId !== "string") throw new OpError("invalid", "runId must be a string");
  const loc: RunLocation = { root: ctx.root, run: runId };
  return { loc, state: notFound(() => loadState(loc, projector)).state };
}

// Status stays readable after a run ends; everything else would append to a finished log.
function readActive(ctx: OpContext, runId: string): { loc: RunLocation; state: RunState } {
  const r = read(ctx, runId);
  if (r.state.status !== "active") {
    throw new OpError("refused", `Run ${runId} is ${r.state.status}; only aos_status works on it. Start a new run with aos_run_start for further work.`);
  }
  return r;
}

function append(loc: RunLocation, drafts: EventDraft[]): void {
  notFound(() => appendEvents(loc, drafts, projector));
}

// The store reports unknown and malformed run ids alike, since both come from agent input.
function notFound<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RunNotFoundError) throw new OpError("not_found", e.message, { cause: e });
    throw e;
  }
}

// The run's own git setting decides freshness, so a context opened differently cannot change what counts.
function evaluate(ctx: OpContext, state: RunState): GateResult {
  return evaluateGate(state, state.current.stage, ctx.tree(state.root, { git: state.git, changes: state.changes }));
}

// The pack loader requires an instruction file for every stage, so the fallback never shows in practice.
function instructionsFor(pack: ResolvedPack, tier: Tier, stage: string): string {
  return pack.instructions[`${tier}/${stage}`] ?? "";
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new OpError("invalid", `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new OpError("invalid", `${field} must be 1 to ${max} characters after trimming (got ${trimmed.length})`);
  }
  return trimmed;
}
