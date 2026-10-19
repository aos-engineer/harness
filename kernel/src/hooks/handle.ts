// Stub: real implementation lands later; signatures are the agreed contract.
import type { HookDecision, HookInput, TreeState } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export interface HookDeps { tree?: (root: string, o: { git: boolean; changes: number }) => TreeState }  // defaults to treeFingerprint

// never throws
export function handleHook(input: HookInput, deps?: HookDeps): HookDecision {
  return notImplemented("G");
}
