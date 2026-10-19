// Stub: real implementation lands later; signatures are the agreed contract.
import type { Actor, TreeState } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export interface OpContext { root: string; git: boolean; packDir: string; host: string; tree: (root: string, o: { git: boolean; changes: number }) => TreeState }

// root = gitRoot(cwd) ?? resolve(cwd); tree = treeFingerprint
export function openContext(o: { cwd: string; packDir: string; host: string }): OpContext {
  return notImplemented("F");
}

// { kind: "agent", id: `mcp:${tool}`, agent: null }
export function agentActor(tool: string): Actor {
  return notImplemented("F");
}
