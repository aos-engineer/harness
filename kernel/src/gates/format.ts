// Stub: real implementation lands later; signatures are the agreed contract.
import type { GateResult, RunState } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function formatGate(result: GateResult, state: RunState, verb: string): string {
  return notImplemented("B");
}

export function renderSummary(state: RunState, gate: GateResult | null): string {
  return notImplemented("B");
}
