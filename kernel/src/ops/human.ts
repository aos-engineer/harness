// Operations only a human may perform: deciding an approval request and cancelling a run. The CLI gates
// them behind a terminal check, and the kernel refuses any caller that passes a non-human actor. The kernel
// cannot tell who its caller really is, so a caller that passes a human actor is believed; the MCP server and
// the hooks, which act for the agent, never import these functions, and a test keeps it that way. Neither
// check is a security boundary against an agent with unrestricted shell access; both stop lazy or
// accidental bypass.
import { userInfo } from "node:os";
import { projector } from "../projection.ts";
import { verifyChain } from "../store/log.ts";
import { unbindRun } from "../store/sessions.ts";
import { appendEvents, loadState } from "../store/store.ts";
import type { Actor, ApprovalState, EventDraft, RunLocation, RunState } from "../types.ts";
import { ChainError, OpError } from "../util/errors.ts";

/** The person at this terminal, named by the OS account. */
export function humanActor(): Actor {
  return { kind: "human", id: userName(), agent: null };
}

// os.userInfo() throws in containers that run as a uid with no passwd entry. An approval must still
// work there, and the environment is the next best record of who typed it.
function userName(): string {
  try {
    const name = userInfo().username;
    if (name !== "") return name;
  } catch {
    // Fall through to the environment.
  }
  return process.env.USER || process.env.LOGNAME || "unknown";
}

/**
 * The request a human decision would answer: the latest request for `stage` made since the stage was last
 * entered, if it is still undecided. Gate evaluation looks only at that request, so an older or superseded
 * one is never pending; deciding it would change nothing. Only the current stage of an active run can have
 * a pending request.
 */
export function pendingApproval(state: RunState, stage?: string): ApprovalState | null {
  const target = stage ?? state.current.stage;
  if (state.status !== "active" || target !== state.current.stage) return null;
  const latest = latestRequest(state, target);
  return latest !== null && humanDecision(latest) === null ? latest : null;
}

// Gate evaluation counts only a human's decision; one logged by any other actor is no decision at all,
// so it must not stop the human from deciding either.
function humanDecision(a: ApprovalState): ApprovalState["decision"] {
  return a.decision?.actor.kind === "human" ? a.decision : null;
}

function latestRequest(state: RunState, stage: string): ApprovalState | null {
  let latest: ApprovalState | null = null;
  for (const a of state.approvals) {
    if (a.stage !== stage || a.requestedSeq <= state.current.enteredSeq) continue;
    if (latest === null || a.requestedSeq > latest.requestedSeq) latest = a;
  }
  return latest;
}

interface DecisionParams { stage?: string; actor: Actor; request?: string }

/**
 * Grants the pending request. Pass `request` with the id the human was shown: if the agent filed a newer
 * request in the meantime, granting "whatever is pending now" would approve text the human never read.
 */
export function approve(loc: RunLocation, p: DecisionParams & { reason: string | null }): { request: string; stage: string } {
  const pending = decidable(loc, p, "approve");
  const granted: EventDraft<"approval.granted"> = { type: "approval.granted", actor: { ...p.actor }, data: { request: pending.request, stage: pending.stage, reason: p.reason } };
  appendEvents(loc, [granted], projector, { precondition: stillPending(pending) });
  return { request: pending.request, stage: pending.stage };
}

/** Denies the pending request. A denial must say why, because the agent revises from the reason. */
export function deny(loc: RunLocation, p: DecisionParams & { reason: string }): { request: string; stage: string } {
  if (p.reason.trim() === "") throw new OpError("invalid", "a denial needs a reason the agent can act on");
  const pending = decidable(loc, p, "deny");
  const denied: EventDraft<"approval.denied"> = { type: "approval.denied", actor: { ...p.actor }, data: { request: pending.request, stage: pending.stage, reason: p.reason } };
  appendEvents(loc, [denied], projector, { precondition: stillPending(pending) });
  return { request: pending.request, stage: pending.stage };
}

/**
 * Ends an active run and unbinds every session bound to it, so those sessions return to pass-through.
 * The chain is not verified first: cancel is the way out of a run that has gone wrong, including one whose
 * log is damaged, and it grants nothing. The store still refuses to append when it cannot trust the log.
 */
export function cancelRun(loc: RunLocation, p: { actor: Actor; reason: string }): { unbound: number } {
  requireHuman(p.actor, "cancel a run");
  if (p.reason.trim() === "") throw new OpError("invalid", "cancelling a run needs a reason, which the log keeps");
  const { state } = loadState(loc, projector);
  if (state.status !== "active") throw new OpError("invalid", `run ${loc.run} is already ${state.status}`);
  const cancelled: EventDraft<"run.cancelled"> = { type: "run.cancelled", actor: { ...p.actor }, data: { reason: p.reason } };
  // Another terminal may end the run between the read above and this append; re-checked under the lock.
  appendEvents(loc, [cancelled], projector, { precondition: (now) => {
    if (now.status !== "active") throw new OpError("invalid", `run ${loc.run} is already ${now.status}`);
  } });
  return { unbound: unbindRun(loc.root, loc.run) };
}

/**
 * Re-checks the decision under the run lock, against the state the append extends. The read that chose the
 * request is not atomic with the append, so a request filed, a decision made by another terminal, or a
 * cancel landing in between would otherwise be decided over. A throw here leaves the log untouched.
 */
function stillPending(pending: ApprovalState): (state: RunState) => void {
  return (state) => {
    const now = pendingApproval(state, pending.stage);
    if (now?.request === pending.request) return;
    const why = now === null ? nothingPending(state, pending.stage) : `request ${now.request} replaced it`;
    throw new OpError("not_found", `request ${pending.request} for ${pending.stage} is no longer pending (${why}); nothing was recorded`);
  };
}

function requireHuman(actor: Actor, what: string): void {
  if (actor.kind !== "human") throw new OpError("invalid", `only a human can ${what}; got a ${actor.kind} actor (${actor.id})`);
}

/** The request to decide, after checking the actor, the log's integrity, and that the request is pending. */
function decidable(loc: RunLocation, p: DecisionParams, verb: "approve" | "deny"): ApprovalState {
  requireHuman(p.actor, `${verb} a gate`);
  // loadState checks the chain too; checking first makes the refusal say that no decision was recorded.
  const chain = verifyChain(loc);
  if (!chain.ok) {
    throw new ChainError(`run ${loc.run}: log tampered or corrupt at seq ${chain.badSeq} (${chain.reason}); not recording a decision`, chain.badSeq);
  }
  const { state } = loadState(loc, projector);
  const stage = p.stage ?? state.current.stage;
  const pending = pendingApproval(state, stage);
  if (pending === null) throw new OpError("not_found", nothingPending(state, stage));
  if (p.request !== undefined && p.request !== pending.request) {
    throw new OpError("not_found", `request ${p.request} is no longer the pending request for ${stage} (now ${pending.request}); review the new request first`);
  }
  return pending;
}

function nothingPending(state: RunState, stage: string): string {
  if (state.status !== "active") return `run ${state.run} is ${state.status}; it has nothing to decide`;
  if (stage !== state.current.stage) return `run ${state.run} is at ${state.current.stage}, not ${stage}; only the current stage can be decided`;
  const latest = latestRequest(state, stage);
  const decision = latest === null ? null : humanDecision(latest);
  if (decision) return `the latest approval request for ${stage} was already ${decision.granted ? "approved" : "denied"}`;
  return `run ${state.run} has no pending approval request for ${stage}; the agent files one with aos_request_approval`;
}
