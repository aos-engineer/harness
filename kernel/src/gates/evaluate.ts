// Gate evaluation: a pure function of run state and the current tree. Each gap is phrased as an
// instruction the agent (or the human) can act on, because hooks hand this text straight to them.
import { stageDef } from "../projection.ts";
import type { Gap, GapKind, GateResult, GateVerdict, Requirement, RunState, StoredEvidence, TreeState } from "../types.ts";
import { PROVENANCE_RANK } from "../types.ts";

const REVIEW_FEEDBACK_CHARS = 200;

export function evaluateGate(state: RunState, stage: string, tree: TreeState): GateResult {
  const { gate } = stageDef(state, stage);
  const gaps: Gap[] = [];
  for (const req of gate.requires) {
    const gap = checkRequirement(state, req, tree);
    if (gap !== null) gaps.push(gap);
  }
  if (gate.tasks === "all") {
    for (const t of state.tasks) {
      if (t.stage === stage && !t.done) {
        gaps.push({ kind: "missing", who: "agent", requirement: `tasks:${t.id}`, text: `Task ${t.id} "${oneLine(t.title)}" is not completed.` });
      }
    }
  }
  if (gate.decider === "human") {
    const gap = checkApproval(state, stage);
    if (gap !== null) gaps.push(gap);
  }
  const verdict: GateVerdict = gaps.some((g) => g.kind === "failed") ? "fail" : gaps.length > 0 ? "pending" : "pass";
  return { stage, verdict, gaps, fingerprint: tree.fingerprint, weakFreshness: tree.weak };
}

export function hasAgentGaps(result: GateResult): boolean {
  return result.gaps.some((g) => g.who === "agent");
}

// Keyed on requirement and kind, not text: the stale text embeds an edit count that grows with every
// edit, and that must not look like progress to stall detection.
export function gapKey(result: GateResult): string {
  return result.verdict + "|" + result.gaps.map((g) => `${g.requirement}:${g.kind}`).sort().join(",");
}

function checkRequirement(state: RunState, req: Requirement, tree: TreeState): Gap | null {
  const label = requirementLabel(req);
  const gap = (kind: GapKind, text: string): Gap => ({ kind, who: "agent", requirement: label, text });

  const candidates = state.evidence.filter((ev) => satisfiesKind(req, ev) && meetsProvenance(req, ev));
  const newest = latest(candidates, evidenceSeq);
  if (newest === null) return gap("missing", missingText(state, req));
  const decider = req.fresh ? latest(candidates.filter((ev) => ev.fingerprint === tree.fingerprint), evidenceSeq) : newest;
  if (decider === null) return gap("stale", staleText(req, state.changes - newest.changes));

  if (decider.kind === "command") {
    const role = quoted(decider.role);
    if (decider.masked) {
      return gap("missing", `The last ${role} run's exit status was hidden by a pipe or chain, so it does not count. Re-run it as its own command.`);
    }
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

function checkApproval(state: RunState, stage: string): Gap | null {
  const gap = (kind: GapKind, who: Gap["who"], text: string): Gap => ({ kind, who, requirement: "approval", text });
  // Only requests made since the stage was last entered count, so re-entering a stage needs a new approval.
  const request = latest(state.approvals.filter((a) => a.stage === stage && a.requestedSeq > state.current.enteredSeq), (a) => a.requestedSeq);
  if (request === null) {
    return gap("missing", "agent", `Approval not requested. Present the ${stage} to the human, then call aos_request_approval.`);
  }
  if (request.decision === null) {
    return gap("missing", "human", `Waiting on the human. They approve with: aos approve ${state.run} ${stage} --root ${shellQuote(state.root)}`);
  }
  if (!request.decision.granted) {
    const reason = trimPeriod(oneLine(request.decision.reason ?? ""));
    const detail = reason === "" ? "" : `: ${reason}`;
    return gap("failed", "agent", `The human denied approval${detail}. Revise, then request approval again.`);
  }
  return null;
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

// An unknown provenance from a newer log has no rank, so it never satisfies a requirement.
function meetsProvenance(req: Requirement, ev: StoredEvidence): boolean {
  const rank = PROVENANCE_RANK[ev.provenance];
  return rank !== undefined && rank >= PROVENANCE_RANK[req.provenance];
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
