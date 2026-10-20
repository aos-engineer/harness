// What every bound hook handler works with: the input, the run, an actor for the events it appends,
// and a tree fingerprint computed at most once per call, because each one costs several git calls.
import { projector } from "../projection.ts";
import { appendEvents } from "../store/store.ts";
import { treeFingerprint } from "../tree/fingerprint.ts";
import type { Actor, EventDraft, HookDecision, HookInput, RunLocation, RunState, TreeState } from "../types.ts";
import type { HookDeps } from "./handle.ts";

export interface HookContext {
  readonly input: HookInput;
  readonly loc: RunLocation;
  readonly state: RunState;
  readonly actor: Actor;
  tree(): TreeState;
  append(drafts: EventDraft[]): RunState;
}

export function hookContext(input: HookInput, loc: RunLocation, state: RunState, deps: HookDeps): HookContext {
  const fingerprint = deps.tree ?? treeFingerprint;
  let tree: TreeState | null = null;
  return {
    input,
    loc,
    state,
    actor: hookActor(input),
    tree: () => {
      tree ??= fingerprint(state.root, { git: state.git, changes: state.changes });
      return tree;
    },
    append: (drafts) => appendEvents(loc, drafts, projector).file.state,
  };
}

export function hookActor(input: HookInput): Actor {
  return { kind: "hook", id: `${input.host}:${input.event}`, agent: input.agent };
}

export function allow(notice: string | null = null): HookDecision {
  return { kind: "allow", notice };
}
