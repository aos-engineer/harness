// SessionStart: re-injects a short run summary on every source (startup, resume, clear, compact, fork),
// so compaction or a resumed session never loses track of the run. The log holds the state; this only
// reads it.
import { renderSummary } from "../gates/format.ts";
import type { HookDecision } from "../types.ts";
import { allow, type HookContext } from "./context.ts";
import { openGaps } from "./gaps.ts";

export function sessionStart(ctx: HookContext): HookDecision {
  const { state } = ctx;
  if (state.status === "active") {
    const summary = renderSummary(state, openGaps(state, ctx.tree()));
    return allow(`${summary}\nRun id: ${state.run}. Use aos_status for detail; follow the current stage's instructions.`);
  }
  if (state.status === "completed") {
    return allow(`AOS: run ${state.run} (${state.tier}) is completed; push and PR create still check their gates, so use aos_status for detail.`);
  }
  return allow();
}
