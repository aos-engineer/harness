// Stop: the retry-until-verified loop. While the current gate has gaps the agent can close, stopping is
// blocked and the gaps are handed back as the next instruction. Three things end the loop so it can never
// trap a session: only the human can act, the same gaps were already nudged in this prompt, or the
// iteration budget is used up. Claude Code's stop_hook_active flag is not needed: the per-prompt gap key
// already stops a repeat block, while still allowing one when the agent made progress.
import { gapKey, hasAgentGaps } from "../gates/evaluate.ts";
import { formatGate } from "../gates/format.ts";
import type { EventDraft, HookDecision } from "../types.ts";
import { allow, type HookContext } from "./context.ts";
import { gapLines, onlyAdvanceLeft, openGaps } from "./gaps.ts";

const HANDING_BACK = "AOS: no progress on these gaps since the last nudge, so handing back to you:";

export function stop(ctx: HookContext): HookDecision {
  const { state, input } = ctx;
  if (state.status !== "active") return allow();
  const result = openGaps(state, ctx.tree());

  if (!hasAgentGaps(result)) {
    const human = result.gaps.filter((g) => g.who === "human");
    return allow(human.length === 0 ? null : ["AOS: waiting on the human.", ...gapLines(human)].join("\n"));
  }

  const key = (input.promptId ?? "-") + "|" + gapKey(result);
  if (key === state.stop.lastGapKey) return allow([HANDING_BACK, ...gapLines(result.gaps)].join("\n"));

  const { used, limit, warned, exceeded } = state.budget.iterations;
  // Checked on the count too, so a budget marked used up by count alone still lets the agent stop.
  if (exceeded || used >= limit) {
    return allow([`AOS: iteration budget used (${used}/${limit}). Open gaps:`, ...gapLines(result.gaps)].join("\n"));
  }

  const now = used + 1;
  const warnAt = Math.ceil((limit * 4) / 5);
  const drafts: EventDraft[] = [{ type: "budget.charged", actor: ctx.actor, data: { dimension: "iterations", amount: 1, gapKey: key } }];
  if (!warned && now >= warnAt) drafts.push({ type: "budget.warning", actor: ctx.actor, data: { dimension: "iterations", used: now, limit } });
  if (now >= limit) drafts.push({ type: "budget.exceeded", actor: ctx.actor, data: { dimension: "iterations", used: now, limit } });
  ctx.append(drafts);

  // A passed gate is not a list of failures to work through, so it gets a single plain instruction.
  const lines = onlyAdvanceLeft(result)
    ? [`AOS: the ${result.stage} gate passes. Call aos_stage_advance to continue.`]
    : [formatGate(result, state, "stop"), "Keep working on the gaps above."];
  if (now >= warnAt) lines.push(`Iteration budget: ${now}/${limit} used.`);
  return { kind: "block-stop", reason: lines.join("\n") };
}
