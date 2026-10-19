// Stub: real implementation lands later; signatures are the agreed contract.
import type { ResolvedPack, Tier } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function classifyTier(pack: ResolvedPack, brief: string): { tier: Tier; reason: string } {
  return notImplemented("C");
}
