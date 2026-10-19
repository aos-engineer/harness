// What every agent operation needs to know about where it runs. A context is opened once per MCP server
// (or CLI call), so the git root lookup is paid once rather than on every tool call.
import { resolve } from "node:path";
import { gitRoot, treeFingerprint } from "../tree/fingerprint.ts";
import type { Actor, TreeState } from "../types.ts";

export interface OpContext { root: string; git: boolean; packDir: string; host: string; tree: (root: string, o: { git: boolean; changes: number }) => TreeState }

/**
 * Runs live at the repository top level, so a server started in a subdirectory still finds the runs a hook
 * started from the root. Outside git the directory itself is the root and freshness falls back to a counter.
 */
export function openContext(o: { cwd: string; packDir: string; host: string }): OpContext {
  const top = gitRoot(o.cwd);
  return {
    root: top ?? resolve(o.cwd),
    git: top !== null,
    // A relative --pack is typed relative to where the command runs, not to the kernel's own location.
    packDir: resolve(o.cwd, o.packDir),
    host: o.host,
    tree: treeFingerprint,
  };
}

// The tool name in the actor id keeps the log readable: each agent event says which tool wrote it.
export function agentActor(tool: string): Actor {
  return { kind: "agent", id: `mcp:${tool}`, agent: null };
}
