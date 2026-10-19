// The one entry point every host calls for every hook. An unbound session costs one binding lookup and
// nothing else, so AOS is invisible until a run starts. Once bound, the call goes to the guard
// (before a tool), the observer (after one), or the Stop and SessionStart handlers.
import { projector } from "../projection.ts";
import { findBinding } from "../store/sessions.ts";
import { loadState } from "../store/store.ts";
import type { HookDecision, HookInput, TreeState } from "../types.ts";
import { bindOnRunStart } from "./bind.ts";
import { allow, hookContext } from "./context.ts";
import { failsafeDecision } from "./failsafe.ts";
import { guard } from "./guard.ts";
import { observe } from "./observe.ts";
import { logHookError, nearestAosRoot } from "./report.ts";
import { sessionStart } from "./session-start.ts";
import { stop } from "./stop.ts";

export interface HookDeps { tree?: (root: string, o: { git: boolean; changes: number }) => TreeState }  // defaults to treeFingerprint

// never throws
export function handleHook(input: HookInput, deps: HookDeps = {}): HookDecision {
  let root: string | null = null;
  try {
    const bound = bindOnRunStart(input);
    if (bound !== null) return bound;

    const binding = findBinding(input.cwd, input.host, input.session);
    if (binding === null) return allow();
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
    return failSafely(input, root, err);
  }
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
