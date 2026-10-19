// The open gaps the Stop and SessionStart hooks talk about. Both add one gap the gate itself does not
// have: a gate that passes is not done until the agent advances past it.
import { evaluateGate } from "../gates/evaluate.ts";
import type { Gap, GateResult, RunState, TreeState } from "../types.ts";

const MAX_GAP_LINES = 8;
const ADVANCE = "advance";

/** True when the gate passed and the only thing left is advancing past it. */
export function onlyAdvanceLeft(result: GateResult): boolean {
  return result.gaps.length === 1 && result.gaps[0]?.requirement === ADVANCE;
}

export function openGaps(state: RunState, tree: TreeState): GateResult {
  const stage = state.current.stage;
  const result = evaluateGate(state, stage, tree);
  // The last stage has nothing to advance to; once its gate passes, the agent may stop.
  if (result.verdict !== "pass" || state.current.index >= state.stages.length - 1) return result;
  const advance: Gap = { kind: "missing", who: "agent", requirement: ADVANCE, text: `The ${stage} gate passes. Call aos_stage_advance to continue.` };
  return { ...result, gaps: [...result.gaps, advance] };
}

/** One `- text` line per gap, agent gaps first, capped like a blocked-action message. */
export function gapLines(gaps: Gap[]): string[] {
  const ordered = [...gaps.filter((g) => g.who === "agent"), ...gaps.filter((g) => g.who !== "agent")];
  const shown = ordered.slice(0, MAX_GAP_LINES).map((g) => `- ${g.text}`);
  const hidden = ordered.length - shown.length;
  return hidden > 0 ? [...shown, `- (+${hidden} more; see aos_status)`] : shown;
}
