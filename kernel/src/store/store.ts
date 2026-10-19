// Stub: real implementation lands later; signatures are the agreed contract.
import type { EventDraft, EventEnvelope, Projector, RunLocation, StateFile } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function createRun(loc: RunLocation, started: EventDraft<"run.started">, projector: Projector): StateFile {
  return notImplemented("A");
}

export function appendEvents(loc: RunLocation, drafts: EventDraft[], projector: Projector): { events: EventEnvelope[]; file: StateFile } {
  return notImplemented("A");
}

export function loadState(loc: RunLocation, projector: Projector): StateFile {
  return notImplemented("A");
}

// run ids, sorted ascending
export function listRuns(root: string): string[] {
  return notImplemented("A");
}
