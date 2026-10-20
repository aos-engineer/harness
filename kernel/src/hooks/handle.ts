// The one entry point every host calls for every hook. An unbound session costs one binding lookup and
// nothing else, so AOS is invisible until a run starts. Once bound, the call goes to the guard
// (before a tool), the observer (after one), or the Stop and SessionStart handlers.
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { projector } from "../projection.ts";
import { findBinding } from "../store/sessions.ts";
import { loadState } from "../store/store.ts";
import type { Binding, HookDecision, HookInput, TreeState } from "../types.ts";
import { bindOnRunStart } from "./bind.ts";
import { allow, hookContext } from "./context.ts";
import { failsafeDecision } from "./failsafe.ts";
import { guard } from "./guard.ts";
import { observe } from "./observe.ts";
import { physicalPath } from "./paths.ts";
import { logHookError, nearestAosRoot } from "./report.ts";
import { sessionStart } from "./session-start.ts";
import { stop } from "./stop.ts";
import { unboundNotice } from "./unbound.ts";

export interface HookDeps {
  tree?: (root: string, o: { git: boolean; changes: number }) => TreeState;  // defaults to treeFingerprint
  /**
   * The directory the host session started in (Claude Code's CLAUDE_PROJECT_DIR). The agent's shell can
   * cd out of the repo, so the binding is also looked up from here when the cwd has none.
   */
  projectDir?: string;
}

// never throws
export function handleHook(input: HookInput, deps: HookDeps = {}): HookDecision {
  let root: string | null = null;
  try {
    const bound = bindOnRunStart(input, deps.projectDir ?? null);
    if (bound !== null) return bound;

    const binding = lookupBinding(input, deps.projectDir ?? null);
    if (binding === null) {
      return input.event === "session-start" ? allow(unboundNotice([input.cwd, ...(deps.projectDir === undefined ? [] : [deps.projectDir])])) : allow();
    }
    root = binding.root;

    const loc = { root: binding.root, run: binding.run };
    const { state } = loadState(loc, projector);
    if (state.status === "cancelled") return allow();

    const ctx = hookContext(input, loc, state, deps);
    switch (input.event) {
      case "pre-tool":
        return guard(ctx);
      case "post-tool":
      case "post-tool-failure":
        return observe(ctx);
      case "stop":
        return stop(ctx);
      case "session-start":
        return sessionStart(ctx);
      default:
        return allow();
    }
  } catch (err) {
    return failSafely(input, root ?? (deps.projectDir === undefined ? null : nearestAosRoot(deps.projectDir)), err);
  }
}

/**
 * The cwd first, then the project dir, then (for a file tool) the real directory of the file being
 * written, stopping at the first binding. A later start whose walk up is covered by an earlier one is
 * skipped, so an unbound session inside its project pays for one walk.
 */
function lookupBinding(input: HookInput, projectDir: string | null): Binding | null {
  const walked: string[] = [];
  const from = (dir: string): Binding | null => {
    const start = resolve(dir);
    if (walked.some((w) => isAtOrAbove(start, w))) return null;
    walked.push(start);
    return findBinding(start, input.host, input.session);
  };
  const first = from(input.cwd);
  if (first !== null) return first;
  const project = projectDir === null ? null : from(projectDir);
  if (project !== null) return project;
  const path = input.tool?.kind === "write" ? input.tool.path : null;
  return path === null ? null : from(dirname(physicalPath(path)));
}

/** True when `dir` is `walked` or one of its ancestors, so a walk from `walked` already checked it. */
function isAtOrAbove(dir: string, walked: string): boolean {
  const rel = relative(dir, walked);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function failSafely(input: HookInput, root: string | null, err: unknown): HookDecision {
  // The input may itself be what threw, so every read of it is guarded.
  let event: HookInput["event"] | null = null;
  let command: string | null = null;
  let cwd: string | null = null;
  try {
    event = input.event;
    command = input.tool?.command ?? null;
    cwd = input.cwd;
  } catch {
    // Keep whatever was read before the throw.
  }
  try {
    logHookError(root ?? (cwd === null ? null : nearestAosRoot(cwd)), String(event), err);
  } catch {
    // Logging is best effort.
  }
  return event === null ? allow() : failsafeDecision(event, command, err);
}
