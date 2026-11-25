// PreToolUse: decides whether a tool call may run. File writes are checked against the stage's write
// scope; Bash commands against human-only commands, `.aos/`, and the pack's action policies. The first
// deny wins and is logged as action.blocked; an allowed guarded action is logged as action.allowed.
import { evaluateGate } from "../gates/evaluate.ts";
import { formatGate } from "../gates/format.ts";
import { stageDef } from "../projection.ts";
import { matchAction, matchHumanOnly, mentionsAosDir } from "../shell/match.ts";
import { oracleCovers, oracleFreeze, readManifest } from "../tree/oracle.ts";
import { TreeError } from "../util/errors.ts";
import { foldName } from "../util/fold.ts";
import type { ActionName, EventDataMap, HookDecision, HookTool } from "../types.ts";
import { allow, type HookContext } from "./context.ts";
import { rootRelative } from "./paths.ts";
import { logHookError } from "./report.ts";

const AOS_DIR_TEXT = "AOS: .aos/ is kernel-owned. Read run state with the aos_status tool.";
const SPIKE_TEXT = " Spike code is throwaway by design; start a bounded run to build it for real.";
// Matched against the folded path because the default macOS filesystem folds case, so `.AOS/` is the same
// directory.
const AOS_PATH = /^\.aos(\/|$)/;

type Blocked = EventDataMap["action.blocked"]["action"];

export function guard(ctx: HookContext): HookDecision {
  const tool = ctx.input.tool;
  if (tool?.kind === "write") return guardWrite(ctx, tool);
  if (tool?.kind === "bash") return guardBash(ctx, tool);
  return allow();
}

function guardWrite(ctx: HookContext, tool: HookTool): HookDecision {
  const { state } = ctx;
  // A write tool call with no path names nothing to check; the hook entry for file tools fails open anyway.
  if (tool.path === null) return allow();
  const rel = rootRelative(state.root, tool.path);
  // Paths outside the root are not AOS's concern.
  if (rel === null) return allow();
  if (AOS_PATH.test(foldName(rel))) return deny(ctx, tool, "aos-dir", AOS_DIR_TEXT);
  // A completed run keeps guarding actions, but its stages are over, so their write scopes no longer apply.
  if (state.status !== "active") return allow();
  const oracle = guardOracle(ctx, tool, rel);
  if (oracle !== null) return oracle;
  const { writes } = stageDef(state);
  if (writes === "any" || writes.some((prefix) => rel.startsWith(prefix))) return allow();
  const stage = state.current.stage;
  const reason = writes.length === 0
    ? `AOS: stage "${stage}" allows no file writes. Get its approval first (aos_request_approval).`
    : `AOS: stage "${stage}" allows writes only under ${writes.join(", ")}. Pass its gate with aos_stage_advance first.`;
  return deny(ctx, tool, "write", reason);
}

// Before the freeze stage the oracle is being written, so its files are writable whatever the stage's
// scope says. From the freeze on they are refused. A pointer entry pins one value inside a file the agent
// still needs to edit (package.json), so it never blocks a write; the gate compares the value instead.
// Shell writes are not seen here; the gate's re-hash catches them.
function guardOracle(ctx: HookContext, tool: HookTool, rel: string): HookDecision | null {
  const { state } = ctx;
  const freeze = oracleFreeze(state);
  if (freeze === null) return null;
  const entries = state.oracle?.entries ?? declaredEntries(state.root, freeze.manifest);
  const covered = oracleCovers(rel, freeze.manifest, entries);
  if (covered === null) return null;
  if (state.oracle !== undefined) {
    if (covered === "pointer") return null;
    return deny(ctx, tool, "oracle", `AOS: ${rel} is part of the oracle frozen when ${state.oracle.stage} began. Leave it unchanged. If it is wrong, stop and tell the human.`);
  }
  return state.current.index < freeze.index ? allow() : null;
}

// The guard must not fail open on a manifest it cannot read: it falls back to the stage's own write scope. No
// gate passes without reading the manifest itself.
function declaredEntries(root: string, manifest: string): string[] {
  try {
    return readManifest(root, manifest).entries;
  } catch (e) {
    if (e instanceof TreeError) return [];
    throw e;
  }
}

function guardBash(ctx: HookContext, tool: HookTool): HookDecision {
  const cmd = tool.command;
  if (cmd === null) return allow();
  const sub = matchHumanOnly(cmd);
  if (sub !== null) {
    return deny(ctx, tool, "human-only", `AOS: \`aos ${sub}\` is a human-only command. Ask the human to run it in their own terminal.`);
  }
  if (mentionsAosDir(cmd)) return deny(ctx, tool, "aos-dir", AOS_DIR_TEXT);

  const { state } = ctx;
  const action = matchAction(cmd, state.pack.actions);
  if (action === null) return allow();
  const tier = state.tier;
  const policy = state.pack.actions[action]?.policy[tier];
  // Pack validation requires a policy for every tier it defines, so this is a corrupt pack: fail closed.
  if (policy === undefined) return deny(ctx, tool, action, `AOS: the pack defines no ${action} policy for a ${tier} run.`);

  switch (policy.allow) {
    case "always":
      return allowed(ctx, tool, action, null);
    case "never":
      return deny(ctx, tool, action, `AOS: ${action} is not allowed in a ${tier} run.${tier === "spike" ? SPIKE_TEXT : ""}`);
    case "in_stages": {
      const stage = state.current.stage;
      if (state.status === "completed" || policy.stages.includes(stage)) return allowed(ctx, tool, action, null);
      return deny(ctx, tool, action, `AOS: ${action} is allowed only in stages ${policy.stages.join(", ")}; the current stage is ${stage}.`);
    }
    case "after_gate": {
      // Always against the live tree: an edit after the gate passed must block the action again.
      const result = evaluateGate(state, policy.gate, ctx.tree());
      if (result.verdict === "pass") return allowed(ctx, tool, action, policy.gate);
      return deny(ctx, tool, action, formatGate(result, state, action));
    }
  }
}

function deny(ctx: HookContext, tool: HookTool, action: Blocked, reason: string): HookDecision {
  try {
    ctx.append([{ type: "action.blocked", actor: ctx.actor, data: { action, tool: tool.name, reason } }]);
  } catch (err) {
    // The decision rests on state that loaded fine; failing to record it must not turn a deny into
    // the fail-open path that file tools get.
    logHookError(ctx.loc.root, ctx.input.event, err);
  }
  return { kind: "deny", reason };
}

function allowed(ctx: HookContext, tool: HookTool, action: ActionName, gate: string | null): HookDecision {
  // A failed append throws into the fail-safe path, which denies push, PR create, and deploy: an action
  // that cannot be recorded does not run.
  ctx.append([{ type: "action.allowed", actor: ctx.actor, data: { action, tool: tool.name, gate } }]);
  return allow();
}
