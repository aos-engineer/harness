// Stub: real implementation lands later; signatures are the agreed contract.
import type { GateResult, RunState, TreeState } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function evaluateGate(state: RunState, stage: string, tree: TreeState): GateResult {
  return notImplemented("B");
}

export function hasAgentGaps(result: GateResult): boolean {
  return notImplemented("B");
}

export function gapKey(result: GateResult): string {
  return notImplemented("B");
}
