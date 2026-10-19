// Stub: real implementation lands later; signatures are the agreed contract.
import type { TreeState } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function gitRoot(cwd: string): string | null {
  return notImplemented("D");
}

export function treeFingerprint(root: string, opts: { git: boolean; changes: number }): TreeState {
  return notImplemented("D");
}
