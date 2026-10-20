import type { ResolvedPack, Tier } from "../types.ts";

/**
 * Proposes a run tier from the brief. Rules run in pack order and the first rule with a matching pattern
 * wins, so a pack lists its riskiest tier first. The reason quotes the pattern, so the human deciding
 * whether to raise the tier can see exactly why it was proposed.
 */
export function classifyTier(pack: ResolvedPack, brief: string): { tier: Tier; reason: string } {
  for (const rule of pack.classify.rules) {
    const source = rule.any.find((src) => new RegExp(src, "i").test(brief));
    if (source !== undefined) return { tier: rule.tier, reason: `matched /${source}/ (${rule.tier} rule)` };
  }
  return { tier: pack.classify.default, reason: `no tier rule matched; pack default is ${pack.classify.default}` };
}
