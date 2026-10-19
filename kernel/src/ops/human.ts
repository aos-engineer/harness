// Stub: real implementation lands later; signatures are the agreed contract.
import type { Actor, ApprovalState, RunLocation, RunState } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

// { kind: "human", id: os.userInfo().username, agent: null }
export function humanActor(): Actor {
  return notImplemented("H");
}

// latest undecided request for stage (default current)
export function pendingApproval(state: RunState, stage?: string): ApprovalState | null {
  return notImplemented("H");
}

export function approve(loc: RunLocation, p: { stage?: string; actor: Actor; reason: string | null }): { request: string; stage: string } {
  return notImplemented("H");
}

export function deny(loc: RunLocation, p: { stage?: string; actor: Actor; reason: string }): { request: string; stage: string } {
  return notImplemented("H");
}

export function cancelRun(loc: RunLocation, p: { actor: Actor; reason: string }): { unbound: number } {
  return notImplemented("H");
}
