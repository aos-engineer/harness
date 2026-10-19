// Stub: real implementation lands later; signatures are the agreed contract.
import type { EventEnvelope, Projector, RunState, StageDef } from "./types.ts";
import { notImplemented } from "./util/errors.ts";

export function applyEvent(state: RunState | null, e: EventEnvelope): RunState {
  return notImplemented("B");
}

export function project(events: EventEnvelope[]): RunState {
  return notImplemented("B");
}

// { apply: applyEvent }
export const projector: Projector = { apply: () => notImplemented("B") };

// defaults to current stage
export function stageDef(state: RunState, stage?: string): StageDef {
  return notImplemented("B");
}
