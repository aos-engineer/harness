// Stub: real implementation lands later; signatures are the agreed contract.
import type { RunLocation } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

// <root>/.aos
export function aosDir(root: string): string {
  return notImplemented("A");
}

export function runPaths(loc: RunLocation): { dir: string; log: string; state: string; lock: string; artifacts: string } {
  return notImplemented("A");
}
