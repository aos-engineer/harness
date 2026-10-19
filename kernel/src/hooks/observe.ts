// PostToolUse and PostToolUseFailure: the only place observed evidence comes from. Role-matched commands
// become command evidence, file writes become worktree changes, and skill calls become skill evidence.
// It runs on completed runs too, so a test run after completion can still block or re-open a push.
import { matchRole } from "../shell/match.ts";
import { captureOutput, redact } from "../shell/redact.ts";
import type { CommandEvidence, Evidence, HookDecision, HookTool, SkillEvidence } from "../types.ts";
import { ulid } from "../util/ulid.ts";
import { allow, type HookContext } from "./context.ts";
import { rootRelative } from "./paths.ts";

const MASKED_TEXT = "AOS: this test run's exit status was hidden by a pipe or chain, so it does not count as evidence. Re-run the test command on its own.";
const NO_EXIT_CODE_TEXT =
  "AOS: this test run produced no exit code (it was backgrounded, interrupted, or timed out), so it does not count. Run the test command in the foreground on its own.";

export function observe(ctx: HookContext): HookDecision {
  const tool = ctx.input.tool;
  const succeeded = ctx.input.event === "post-tool";
  switch (tool?.kind) {
    case "bash":
      return observeCommand(ctx, tool);
    case "write":
      return succeeded ? observeWrite(ctx, tool) : allow();
    case "skill":
      return succeeded ? observeSkill(ctx, tool) : allow();
    default:
      return allow();
  }
}

function observeCommand(ctx: HookContext, tool: HookTool): HookDecision {
  if (tool.command === null) return allow();
  const hit = matchRole(tool.command, ctx.state.pack.roles);
  if (hit === null) return allow();
  const result = ctx.input.result;
  const exitCode = result?.exitCode ?? null;
  // A backgrounded, interrupted, or timed-out run has no status to judge. Recording it would add a
  // failure the agent did not cause, so it is skipped and the agent is told how to get a real one.
  if (!hit.masked && exitCode === null) return allow(NO_EXIT_CODE_TEXT);
  const evidence: CommandEvidence = {
    ...observed(ctx),
    kind: "command",
    role: hit.role,
    command: redact(tool.command),
    masked: hit.masked,
    // A pipe or chain reports some other command's status, so a masked run never carries one.
    exitCode: hit.masked ? null : exitCode,
    ...captureOutput(result?.output ?? ""),
  };
  record(ctx, evidence);
  return allow(hit.masked ? MASKED_TEXT : null);
}

function observeWrite(ctx: HookContext, tool: HookTool): HookDecision {
  if (tool.path === null) return allow();
  const rel = rootRelative(ctx.state.root, tool.path);
  if (rel === null) return allow();
  ctx.append([{ type: "worktree.changed", actor: ctx.actor, data: { path: rel, tool: tool.name } }]);
  return allow();
}

function observeSkill(ctx: HookContext, tool: HookTool): HookDecision {
  if (tool.skill === null) return allow();
  const evidence: SkillEvidence = { ...observed(ctx), kind: "skill", skill: tool.skill };
  record(ctx, evidence);
  return allow();
}

function observed(ctx: HookContext): { id: string; provenance: "observed"; fingerprint: string; changes: number; stage: string; agent: string | null } {
  const { state, input } = ctx;
  return { id: ulid(), provenance: "observed", fingerprint: ctx.tree().fingerprint, changes: state.changes, stage: state.current.stage, agent: input.agent };
}

function record(ctx: HookContext, evidence: Evidence): void {
  ctx.append([{ type: "evidence.recorded", actor: ctx.actor, data: evidence }]);
}
