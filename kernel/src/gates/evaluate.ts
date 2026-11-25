// Gate evaluation: a pure function of run state and the current tree. Each gap is phrased as an
// instruction the agent (or the human) can act on, because hooks hand this text straight to them.
import { stageDef } from "../projection.ts";
import { oracleDiff, oracleFreeze } from "../tree/oracle.ts";
import type { Gap, GapKind, GateResult, GateVerdict, OraclePin, Requirement, RunState, StoredEvidence, TreeState } from "../types.ts";
import { PROVENANCE_RANK } from "../types.ts";

const REVIEW_FEEDBACK_CHARS = 200;

export function evaluateGate(state: RunState, stage: string, tree: TreeState): GateResult {
  const { gate } = stageDef(state, stage);
  const gaps: Gap[] = [];
  // Action policies evaluate later gates live (push waits on verify), so a stage the run has not
  // reached must never pass, or evidence alone would skip the gates before it.
  if (state.stages.indexOf(stage) > state.current.index) {
    const current = state.current.stage;
    gaps.push({
      kind: "missing", who: "agent", requirement: `stage:${stage}`,
      text: `The run is at ${current}; the ${stage} stage has not been reached. Pass the ${current} gate and call aos_stage_advance.`,
    });
  }
  const pin = frozenPin(state, stage);
  for (const req of gate.requires) {
    const gap = checkRequirement(state, req, tree, pin);
    if (gap !== null) gaps.push(gap);
  }
  if (gate.tasks === "all") {
    for (const t of state.tasks) {
      if (t.stage === stage && !t.done) {
        gaps.push({ kind: "missing", who: "agent", requirement: `tasks:${t.id}`, text: `Task ${t.id} "${oneLine(t.title)}" is not completed.` });
      }
    }
  }
  gaps.push(...oracleGaps(state, stage, tree));
  if (gate.decider === "human") {
    const gap = checkApproval(state, stage, tree);
    if (gap !== null) gaps.push(gap);
  }
  const verdict: GateVerdict = gaps.some((g) => g.kind === "failed") ? "fail" : gaps.length > 0 ? "pending" : "pass";
  return { stage, verdict, gaps, fingerprint: tree.fingerprint, weakFreshness: tree.weak };
}

export function hasAgentGaps(result: GateResult): boolean {
  return result.gaps.some((g) => g.who === "agent");
}

// Keyed on requirement, kind, and who, not text: the stale text embeds an edit count that grows with
// every edit, and that must not look like progress to stall detection. Who is part of the key because
// an approval gap moving from the agent (not requested) to the human (waiting) is progress.
export function gapKey(result: GateResult): string {
  return result.verdict + "|" + result.gaps.map((g) => `${g.requirement}:${g.kind}:${g.who}`).sort().join(",");
}

// From the freeze stage on, a command counts only if it was the role's command exactly, run against the oracle as
// pinned. Arguments can narrow what a runner runs (one file, -t, -k), and a run against an edited oracle proves
// nothing even once the edit is undone.
function frozenPin(state: RunState, stage: string): OraclePin | null {
  const freeze = oracleFreeze(state);
  if (freeze === null || state.oracle === undefined) return null;
  return state.stages.indexOf(stage) >= freeze.index ? state.oracle : null;
}

function checkRequirement(state: RunState, req: Requirement, tree: TreeState, pin: OraclePin | null): Gap | null {
  const label = requirementLabel(req);
  const gap = (kind: GapKind, text: string): Gap => ({ kind, who: "agent", requirement: label, text });

  const matching = state.evidence.filter((ev) => satisfiesKind(req, ev) && meetsProvenance(req, ev));
  const candidates = pin === null ? matching : matching.filter((ev) => ev.kind !== "command" || (ev.exact === true && ev.oracle === pin.digest));
  const newest = latest(candidates, evidenceSeq);
  if (newest === null) {
    if (candidates.length === matching.length) return gap("missing", missingText(state, req));
    // Runs exist but none counts against the frozen oracle. A masked last run has the more useful explanation.
    const last = latest(matching, evidenceSeq)!;
    return gap("missing", last.kind === "command" && last.masked ? maskedText(last.role) : frozenRunText(state, req));
  }
  const decider = req.fresh ? latest(candidates.filter((ev) => ev.fingerprint === tree.fingerprint), evidenceSeq) : newest;
  if (decider === null) return gap("stale", staleText(req, state.changes - newest.changes));

  if (decider.kind === "command") {
    const role = quoted(decider.role);
    if (decider.masked) return gap("missing", maskedText(decider.role));
    if (decider.exitCode !== 0) {
      const ended = decider.exitCode === null ? "ended without an exit code" : `exited ${decider.exitCode}`;
      return gap("failed", `The last observed ${role} run ${ended}. Fix the failures and re-run it.`);
    }
  }
  if (decider.kind === "review" && req.kind === "review" && decider.status !== req.status) {
    const feedback = trimPeriod(oneLine(decider.feedback).slice(0, REVIEW_FEEDBACK_CHARS));
    const detail = feedback === "" ? "" : `: ${feedback}`;
    return gap("failed", `The latest review is "${decider.status}"${detail}. Address it and record a new review.`);
  }
  return null;
}

function checkApproval(state: RunState, stage: string, tree: TreeState): Gap | null {
  const gap = (kind: GapKind, who: Gap["who"], text: string): Gap => ({ kind, who, requirement: "approval", text });
  // Only requests made since the stage was last entered count, so re-entering a stage needs a new approval.
  const request = latest(state.approvals.filter((a) => a.stage === stage && a.requestedSeq > state.current.enteredSeq), (a) => a.requestedSeq);
  if (request === null) {
    return gap("missing", "agent", `Approval not requested. Present the ${stage} to the human, then call aos_request_approval.`);
  }
  // A request made before the freeze names the oracle the human is shown. If it changed since, an approval
  // would let tests the human never saw be pinned.
  if (request.oracle !== undefined && tree.oracle?.().digest !== request.oracle) {
    return gap("missing", "agent", `The oracle changed after approval was requested, so the human has not seen it. Present the ${stage} again, then call aos_request_approval.`);
  }
  // Only a human decides. A decision logged by any other actor is treated as no decision at all, so
  // a forged grant cannot pass the gate and a forged denial cannot stand in for the human's answer.
  const decision = request.decision?.actor.kind === "human" ? request.decision : null;
  if (decision === null) {
    return gap("missing", "human", `Waiting on the human. They approve with: aos approve ${state.run} ${stage} --root ${shellQuote(state.root)}`);
  }
  if (!decision.granted) {
    const reason = trimPeriod(oneLine(decision.reason ?? ""));
    const detail = reason === "" ? "" : `: ${reason}`;
    return gap("failed", "agent", `The human denied approval${detail}. Revise, then request approval again.`);
  }
  return null;
}

const ORACLE_UNREAD = "AOS could not read the oracle, so it cannot tell whether the tests changed. Run aos doctor.";
const LIST_MAX = 5;

function oracleGaps(state: RunState, stage: string, tree: TreeState): Gap[] {
  const freeze = oracleFreeze(state);
  if (freeze === null) return [];
  const gap = (kind: GapKind, requirement: string, text: string): Gap => ({ kind, who: "agent", requirement, text });
  const index = state.stages.indexOf(stage);
  if (index === freeze.index - 1) {
    // The gate that leads into the freeze needs something to freeze.
    const snapshot = tree.oracle?.();
    if (snapshot === undefined) return [gap("failed", "oracle", ORACLE_UNREAD)];
    const gaps: Gap[] = [];
    if (snapshot.invalid.length > 0) {
      gaps.push(gap("missing", "oracle:manifest", `${freeze.manifest} has lines AOS cannot use: ${listed(snapshot.invalid)}. Fix them.`));
    }
    if (snapshot.present === 0) {
      gaps.push(gap("missing", "oracle:declared", `Nothing to freeze when ${freeze.stage} begins. List the acceptance tests, and the config and scripts they run through, in ${freeze.manifest}, one path per line, and make sure they exist.`));
    }
    return gaps;
  }
  // Earlier stages are the authoring window. A later stage the run has not reached already carries its own
  // gap, and its oracle check applies once the pin exists.
  if (index < freeze.index || state.current.index < freeze.index) return [];
  const pin = state.oracle;
  if (pin === undefined) {
    return [gap("failed", "oracle", `The run reached ${freeze.stage} without pinning its oracle, so its tests cannot be trusted. Ask the human to cancel the run.`)];
  }
  const snapshot = tree.oracle?.();
  if (snapshot === undefined) return [gap("failed", "oracle", ORACLE_UNREAD)];
  const changed = oracleDiff(pin.files, snapshot.files);
  if (changed.length === 0) return [];
  return [gap("failed", "oracle", `The frozen oracle changed since ${pin.stage} began: ${listed(changed)}. Revert those changes. If the oracle itself is wrong, stop and tell the human; only a new run can change it.`)];
}

function maskedText(role: string): string {
  return `The last ${quoted(role)} run's exit status was hidden by a pipe or chain, so it does not count. Re-run it as its own command.`;
}

// Only command evidence is filtered by the pin, so this is only reached for a command requirement.
function frozenRunText(state: RunState, req: Requirement): string {
  const role = req.kind === "command" ? req.role : req.kind;
  const prefixes = req.kind === "command" ? (state.pack.roles[req.role] ?? []).join(", ") : "";
  return `No ${quoted(role)} run since the oracle was frozen counts: only a full run against the frozen oracle does. Run one of: ${prefixes}, exactly as written with nothing added, and leave the oracle as it was frozen.`;
}

function listed(items: string[]): string {
  const shown = items.slice(0, LIST_MAX).join(", ");
  return items.length > LIST_MAX ? `${shown}, and ${items.length - LIST_MAX} more` : shown;
}

function satisfiesKind(req: Requirement, ev: StoredEvidence): boolean {
  switch (req.kind) {
    case "command":
      return ev.kind === "command" && ev.role === req.role;
    case "review":
      return ev.kind === "review";
    default: {
      if (ev.kind !== req.kind) return false;
      if (req.match === null) return true;
      const match = req.match;
      const fields = ev.kind === "artifact" ? [ev.path] : ev.kind === "citation" ? [ev.path, ev.note] : ev.kind === "skill" ? [ev.skill] : [];
      return fields.some((f) => f.includes(match));
    }
  }
}

// A provenance this kernel does not know (a newer log, or a prototype name like "constructor") has no
// rank, on either side, so it never satisfies a requirement.
function meetsProvenance(req: Requirement, ev: StoredEvidence): boolean {
  if (!Object.hasOwn(PROVENANCE_RANK, ev.provenance) || !Object.hasOwn(PROVENANCE_RANK, req.provenance)) return false;
  return PROVENANCE_RANK[ev.provenance] >= PROVENANCE_RANK[req.provenance];
}

function requirementLabel(req: Requirement): string {
  switch (req.kind) {
    case "command":
      return `command:${req.role}`;
    case "review":
      return "review";
    default:
      return req.match === null ? req.kind : `${req.kind}:${req.match}`;
  }
}

function missingText(state: RunState, req: Requirement): string {
  switch (req.kind) {
    case "command": {
      const prefixes = (state.pack.roles[req.role] ?? []).join(", ");
      return `No observed ${quoted(req.role)} run at the current tree. Run one of: ${prefixes}. Run it as its own command, not piped or chained with |, ||, ; or &.`;
    }
    case "review":
      return REVIEW_MISSING;
    default:
      return `Missing ${req.provenance} ${req.kind} evidence${matchSuffix(req.match)}.`;
  }
}

function staleText(req: Requirement, edits: number): string {
  const since = `(${edits} file ${edits === 1 ? "edit" : "edits"} since, plus any shell changes)`;
  switch (req.kind) {
    case "command":
      return `The last observed ${quoted(req.role)} run predates the current tree ${since}. Re-run it.`;
    case "review":
      return REVIEW_MISSING;
    default:
      return `The last ${req.provenance} ${req.kind} evidence${matchSuffix(req.match)} predates the current tree ${since}. Record it again.`;
  }
}

const REVIEW_MISSING = 'No approved review at the current tree. Review the change and record it with aos_evidence_record (kind "review").';

const quoted = (s: string) => `"${s}"`;
const matchSuffix = (match: string | null) => (match === null ? "" : ` matching "${match}"`);

/** Highest-seq item, or null. Evidence and approvals are appended in seq order, but do not rely on it. */
function latest<T>(xs: T[], seqOf: (x: T) => number): T | null {
  let best: T | null = null;
  for (const x of xs) if (best === null || seqOf(x) > seqOf(best)) best = x;
  return best;
}

const evidenceSeq = (ev: StoredEvidence) => ev.seq;

// Free text from agents and humans goes inside one-line gap messages.
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function trimPeriod(s: string): string {
  return s.replace(/[.\s]+$/, "");
}

// The approve command is meant to be pasted into a shell. Keep the readable double-quoted form for
// ordinary paths, and fall back to single quotes when the path holds characters a shell would expand.
function shellQuote(path: string): string {
  return /["$`\\!]/.test(path) ? `'${path.replace(/'/g, `'\\''`)}'` : `"${path}"`;
}
