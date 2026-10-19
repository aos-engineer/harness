// Operations the agent drives through MCP tools. Each one reads the run, checks it against policy, and
// appends events; none of them can approve, waive, lower a tier, or record observed evidence, because
// those belong to the human and to the hooks. Failures are OpErrors so the MCP layer can relay the class.
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { evaluateGate } from "../gates/evaluate.ts";
import { formatGate, renderSummary } from "../gates/format.ts";
import { classifyTier } from "../pack/classify.ts";
import { loadPack } from "../pack/load.ts";
import { projector, stageDef } from "../projection.ts";
import { writeArtifact } from "../store/artifacts.ts";
import { appendEvents, createRun, loadState } from "../store/store.ts";
import { spawnGit } from "../tree/git.ts";
import type { EventDraft, Evidence, GateResult, ResolvedPack, RunLocation, RunState, RunStatus, Tier, TreeState } from "../types.ts";
import { TIER_RANK } from "../types.ts";
import { OpError, RunNotFoundError } from "../util/errors.ts";
import { sha256Tag } from "../util/hash.ts";
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
  append(loc, [{ type: "stage.entered", actor, data: { stage: first, index: 0 } }], (locked) => {
    if (locked.status !== "active") throw inactive(locked);
  });
  return {
    runId, tier, tierReason, stages, stage: first,
    instructions: instructionsFor(pack, tier, first),
    notice: `AOS run ${runId} started as ${tier} (${tierReason}). Tell the human the tier and why. This session is bound to the run once this call returns.`,
  };
}

export function runStatus(ctx: OpContext, p: { runId: string }): StatusResult {
  const { state } = read(ctx, p.runId);
  const { gate } = evaluate(ctx, state);
  const { used, limit } = state.budget.iterations;
  return {
    runId: state.run, status: state.status, tier: state.tier, stage: state.current.stage, stages: [...state.stages],
    gate, iterations: { used, limit }, summary: renderSummary(state, gate),
  };
}

export function gateCheck(ctx: OpContext, p: { runId: string }): GateCheckResult {
  return change(ctx, p.runId, (state) => {
    const { gate } = evaluate(ctx, state);
    return {
      drafts: [{ type: "gate.evaluated", actor: agentActor("aos_gate_check"), data: gate }],
      still: (locked) => sameStage(locked, state) && locked.changes === state.changes,
      result: { gate, message: gate.verdict === "pass" ? null : formatGate(gate, state, "advance") },
    };
  });
}

export function stageAdvance(ctx: OpContext, p: { runId: string }): StageAdvanceResult {
  return change(ctx, p.runId, (state): Change<StageAdvanceResult> => {
    const actor = agentActor("aos_stage_advance");
    const { gate, tree } = evaluate(ctx, state);
    const evaluated: EventDraft = { type: "gate.evaluated", actor, data: gate };
    const stage = state.current.stage;
    // An edit observed since the read makes the evaluation stale; evidence landing meanwhile does not.
    const unmoved = (locked: RunState) => sameStage(locked, state) && locked.changes === state.changes;
    if (gate.verdict !== "pass") {
      return {
        drafts: [evaluated], still: unmoved,
        result: { advanced: false, completed: false, gate, stage, instructions: null, message: formatGate(gate, state, "advance") },
      };
    }

    // The evaluation and the move land in one append, so the log never shows a stage entered without the
    // passing gate that allowed it. The gate is re-checked against the locked state at the same tree, so a
    // task or approval request added in the meantime cannot be skipped.
    const still = (locked: RunState) => unmoved(locked) && evaluateGate(locked, stage, tree).verdict === "pass";
    const index = state.current.index + 1;
    const next = state.stages[index];
    if (next === undefined) {
      return {
        drafts: [evaluated, { type: "run.completed", actor, data: { stage } }], still,
        result: { advanced: true, completed: true, gate, stage, instructions: null, message: null },
      };
    }
    return {
      drafts: [evaluated, { type: "stage.entered", actor, data: { stage: next, index } }], still,
      result: { advanced: true, completed: false, gate, stage: next, instructions: instructionsFor(state.pack, state.tier, next), message: null },
    };
  });
}

const MAX_TITLE_CHARS = 500;
const MAX_SUMMARY_CHARS = 4000;
const MAX_FEEDBACK_CHARS = 8000;
const MAX_NOTE_CHARS = 2000;
const MAX_NAME_CHARS = 200;
const MAX_TASK_EVIDENCE = 50;
// Larger artifacts are hashed but not copied, so one big file cannot bloat every run directory.
const COPY_LIMIT_BYTES = 1024 * 1024;
const REVIEW_STATUSES: readonly string[] = ["approved", "rejected", "needs-revision"];

export function taskAdd(ctx: OpContext, p: { runId: string; title: string }): { task: string; stage: string } {
  const title = text(p.title, "title", MAX_TITLE_CHARS);
  return change(ctx, p.runId, (state) => {
    // Ids count across the whole run, so a task id never means two different tasks.
    const task = `t${state.tasks.length + 1}`;
    const stage = state.current.stage;
    return {
      drafts: [{ type: "task.added", actor: agentActor("aos_task_add"), data: { task, stage, title } }],
      still: (locked) => sameStage(locked, state) && !locked.tasks.some((t) => t.id === task),
      result: { task, stage },
    };
  });
}

export function taskComplete(ctx: OpContext, p: { runId: string; task: string; evidence?: string[] }): { task: string; open: number } {
  return change(ctx, p.runId, (state) => planTaskComplete(state, p));
}

function planTaskComplete(state: RunState, p: { task: string; evidence?: string[] }): Change<{ task: string; open: number }> {
  const stage = state.current.stage;
  const task = state.tasks.find((t) => t.id === p.task);
  if (task === undefined) throw new OpError("invalid", `No task ${JSON.stringify(p.task)} in run ${state.run}. Add it with aos_task_add first.`);
  if (task.done) throw new OpError("invalid", `Task ${task.id} is already completed.`);
  if (task.stage !== stage) throw new OpError("invalid", `Task ${task.id} belongs to the ${task.stage} stage; the run is at ${stage}.`);
  const evidence = p.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.length > MAX_TASK_EVIDENCE) {
    throw new OpError("invalid", `evidence must be a list of at most ${MAX_TASK_EVIDENCE} evidence ids`);
  }
  // A task may cite only evidence the run holds, so a completion cannot point at proof that does not exist.
  const known = new Set(state.evidence.map((e) => e.id));
  const unknown = evidence.filter((id) => typeof id !== "string" || !known.has(id));
  if (unknown.length > 0) throw new OpError("invalid", `Unknown evidence ids: ${unknown.map((id) => JSON.stringify(id)).join(", ")}. Use ids returned by aos_evidence_record.`);

  const open = state.tasks.filter((t) => t.stage === stage && !t.done && t.id !== task.id).length;
  return {
    drafts: [{ type: "task.completed", actor: agentActor("aos_task_complete"), data: { task: task.id, evidence: [...evidence] } }],
    still: (locked) => sameStage(locked, state) && locked.tasks.some((t) => t.id === task.id && !t.done),
    result: { task: task.id, open },
  };
}

export function evidenceRecord(ctx: OpContext, p: EvidenceInput & { runId: string }): { evidenceId: string; fingerprint: string } {
  return change(ctx, p.runId, (state, loc) => planEvidence(ctx, state, loc, p));
}

// Evidence needs only an active run: it carries the tree it was taken at, so later events cannot make it wrong.
function planEvidence(ctx: OpContext, state: RunState, loc: RunLocation, p: EvidenceInput): Change<{ evidenceId: string; fingerprint: string }> {
  const { fingerprint } = treeOf(ctx, state);
  // Provenance is fixed here, not taken from input: only hooks observe, and agents can only claim.
  const base = { id: ulid(), provenance: "claimed" as const, fingerprint, changes: state.changes, stage: state.current.stage, agent: null };
  let data: Evidence;
  switch (p.kind) {
    case "artifact": {
      const file = insideRoot(state.root, p.path);
      const { sha256, small } = hashFile(file.abs);
      // An ignored file is often a secret (.env, credentials), and a copy under .aos/runs would outlive it
      // unredacted. Its hash still proves what was claimed.
      if (small !== null && !ignoredByGit(state, file.realRel)) writeArtifact(loc, small);
      data = { ...base, kind: "artifact", path: file.rel, sha256 };
      break;
    }
    case "citation": {
      const file = insideRoot(state.root, p.path);
      if (!Number.isInteger(p.line) || p.line < 1) throw new OpError("invalid", `line must be a whole number of at least 1 (got ${JSON.stringify(p.line)})`);
      const lines = lineCount(file.abs);
      if (p.line > lines) throw new OpError("invalid", `${file.rel} has ${lines} lines; line ${p.line} does not exist`);
      data = { ...base, kind: "citation", path: file.rel, line: p.line, note: text(p.note ?? "", "note", MAX_NOTE_CHARS, { allowEmpty: true }) };
      break;
    }
    case "review": {
      if (!REVIEW_STATUSES.includes(p.status)) throw new OpError("invalid", `status must be one of ${REVIEW_STATUSES.join(", ")}`);
      // An empty review cannot be weighed by anyone later, so it does not count as one.
      data = { ...base, kind: "review", status: p.status, feedback: text(p.feedback, "feedback", MAX_FEEDBACK_CHARS), reviewer: text(p.reviewer, "reviewer", MAX_NAME_CHARS) };
      break;
    }
    case "skill":
      data = { ...base, kind: "skill", skill: text(p.skill, "skill", MAX_NAME_CHARS) };
      break;
    default:
      throw new OpError("invalid", `kind must be artifact, citation, review, or skill (got ${JSON.stringify((p as { kind: unknown }).kind)}). Test runs are observed by AOS automatically.`);
  }
  return { drafts: [{ type: "evidence.recorded", actor: agentActor("aos_evidence_record"), data }], result: { evidenceId: data.id, fingerprint } };
}

export function requestApproval(ctx: OpContext, p: { runId: string; summary: string }): { request: string; stage: string; instructions: string } {
  return change(ctx, p.runId, (state) => {
    const stage = state.current.stage;
    if (stageDef(state, stage).gate.decider !== "human") {
      throw new OpError("invalid", `The ${stage} gate is decided by rules, not by a human. Call aos_gate_check to see what it needs.`);
    }
    const summary = text(p.summary, "summary", MAX_SUMMARY_CHARS);
    const request = ulid();
    return {
      drafts: [{ type: "approval.requested", actor: agentActor("aos_request_approval"), data: { request, stage, summary } }],
      // A request for a stage the run has already left would wait on an approval nothing can use.
      still: (locked) => sameStage(locked, state),
      result: {
        request, stage,
        instructions: `Ask the human to run, in their own terminal: aos approve ${state.run} ${stage} --root ${shellQuote(state.root)}. Then stop and wait; do not run it yourself.`,
      },
    };
  });
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
  if (r.state.status !== "active") throw inactive(r.state);
  return r;
}

const inactive = (state: RunState) =>
  new OpError("refused", `Run ${state.run} is ${state.status}; only aos_status works on it. Start a new run with aos_run_start for further work.`);

function append(loc: RunLocation, drafts: EventDraft[], precondition: (locked: RunState) => void): void {
  notFound(() => appendEvents(loc, drafts, projector, { precondition }));
}

// A few retries absorb ordinary overlap (a hook observing an edit mid-call); a run that keeps moving is
// left for the agent to re-read rather than chased forever.
const MAX_ATTEMPTS = 3;

/** Raised inside a precondition when another writer changed what the operation planned against. */
class RunChanged extends Error {}

interface Change<T> { drafts: EventDraft[]; result: T; still?: (locked: RunState) => boolean }

/**
 * Reads the active run, plans the events, and appends them only if, under the run's lock, the run is still
 * active and `still` holds. Another writer can append between the read and the append (a hook, the
 * human's CLI, a second tool call), so a plan that went stale is re-planned from a fresh read. A run that is
 * no longer active is final: the human ended it, and no retry may override that.
 */
function change<T>(ctx: OpContext, runId: string, plan: (state: RunState, loc: RunLocation) => Change<T>): T {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { loc, state } = readActive(ctx, runId);
    const c = plan(state, loc);
    ctx.afterRead?.(runId);
    try {
      append(loc, c.drafts, (locked) => {
        if (locked.status !== "active") throw inactive(locked);
        if (c.still !== undefined && !c.still(locked)) throw new RunChanged();
      });
      return c.result;
    } catch (e) {
      if (!(e instanceof RunChanged)) throw e;
    }
  }
  throw new OpError("refused", "The run changed while this call ran; call aos_status and try again.");
}

const sameStage = (locked: RunState, read: RunState) => locked.current.index === read.current.index;

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
function treeOf(ctx: OpContext, state: RunState): TreeState {
  return ctx.tree(state.root, { git: state.git, changes: state.changes });
}

function evaluate(ctx: OpContext, state: RunState): { gate: GateResult; tree: TreeState } {
  const tree = treeOf(ctx, state);
  return { gate: evaluateGate(state, state.current.stage, tree), tree };
}

// The pack loader requires an instruction file for every stage, so the fallback never shows in practice.
function instructionsFor(pack: ResolvedPack, tier: Tier, stage: string): string {
  return pack.instructions[`${tier}/${stage}`] ?? "";
}

function text(value: unknown, field: string, max: number, o: { allowEmpty?: boolean } = {}): string {
  if (typeof value !== "string") throw new OpError("invalid", `${field} must be a string`);
  const trimmed = value.trim();
  const min = o.allowEmpty === true ? 0 : 1;
  if (trimmed.length < min || trimmed.length > max) {
    throw new OpError("invalid", `${field} must be ${min} to ${max} characters after trimming (got ${trimmed.length})`);
  }
  return trimmed;
}

/**
 * Resolves an agent-supplied path to a regular file inside the run root and outside .aos/ and .git/. Symlinks
 * are resolved before the check, so a link cannot pass off a file from elsewhere (or the run log) as evidence.
 * The recorded path stays the one the agent named, made root-relative, because packs match on it.
 */
function insideRoot(root: string, path: unknown): { abs: string; rel: string; realRel: string } {
  if (typeof path !== "string" || path.trim() === "") throw new OpError("invalid", "path must be a non-empty string");
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  // Policy first, on the path as named, so a missing file under .aos/ is still refused rather than "missing".
  const policy = (r: string) => {
    if (isOutside(r)) throw new OpError("refused", `${path} is outside the repository at ${root}; evidence must come from inside it.`);
    const top = topDir(r);
    if (top === ".aos") throw new OpError("refused", `${path} is under .aos/, which holds AOS's own records and cannot be evidence.`);
    if (top === ".git") throw new OpError("refused", `${path} is under .git/, which is git's own store and cannot be evidence.`);
  };
  policy(rel);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch (e) {
    throw new OpError("invalid", `${rel} does not exist`, { cause: e });
  }
  const realRoot = realpathSync(root);
  const realRel = relative(realRoot, real);
  policy(realRel);
  if (!statSync(real).isFile()) throw new OpError("invalid", `${rel} is not a regular file`);
  return { abs: real, rel: rel.split(sep).join("/"), realRel };
}

const isOutside = (rel: string) => rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
// Compared without case: macOS and Windows file systems usually are, so .AOS/ is the same directory.
const topDir = (rel: string) => (rel.split(sep)[0] ?? "").toLowerCase();

/**
 * Whether git ignores the file. Anything short of git confirming it is not ignored (an error, a timeout)
 * counts as ignored, because the cost of guessing wrong is a stored copy of a secret. Outside git there are
 * no ignore rules, so nothing counts as ignored.
 */
function ignoredByGit(state: RunState, realRel: string): boolean {
  if (!state.git) return false;
  try {
    return spawnGit(state.root, ["check-ignore", "-q", "--", realRel]).status !== 1;
  } catch {
    return true;
  }
}

function hashFile(path: string): { sha256: string; small: Uint8Array | null } {
  if (statSync(path).size < COPY_LIMIT_BYTES) {
    const bytes = readFileSync(path);
    return { sha256: sha256Tag(bytes), small: bytes };
  }
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(COPY_LIMIT_BYTES);
    for (let n = readSync(fd, buf); n > 0; n = readSync(fd, buf)) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return { sha256: "sha256:" + hash.digest("hex"), small: null };
}

// Counts newline bytes chunk by chunk, so a citation into a large file never holds it in memory as a string.
// A newline byte can only ever be a newline in UTF-8, so no decoding is needed.
function lineCount(path: string): number {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    let breaks = 0;
    let last = -1;
    for (let n = readSync(fd, buf); n > 0; n = readSync(fd, buf)) {
      for (let i = 0; i < n; i++) if (buf[i] === 0x0a) breaks++;
      last = buf[n - 1] ?? -1;
    }
    // A final line without a trailing newline still counts; an empty file has no lines.
    return last === -1 || last === 0x0a ? breaks : breaks + 1;
  } finally {
    closeSync(fd);
  }
}

// The command is meant to be pasted into a shell, so it is quoted the way the gate's own text quotes it.
function shellQuote(path: string): string {
  return /["$`\\!]/.test(path) ? `'${path.replace(/'/g, `'\\''`)}'` : `"${path}"`;
}
