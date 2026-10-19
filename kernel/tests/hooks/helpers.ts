// Builders for the hook tests: real runs on disk (store, projector, and the reference pack), host-agnostic
// HookInputs, and shortcuts that move a run to the state a test needs.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadPack } from "../../src/pack/load.ts";
import { projector } from "../../src/projection.ts";
import { readLog } from "../../src/store/log.ts";
import { runPaths } from "../../src/store/paths.ts";
import { bindSession } from "../../src/store/sessions.ts";
import { appendEvents, createRun, loadState } from "../../src/store/store.ts";
import { treeFingerprint } from "../../src/tree/fingerprint.ts";
import type {
  Actor, CommandEvidence, Evidence, EventDraft, EventEnvelope, HookDecision, HookInput, HookTool, ResolvedPack, ReviewEvidence, RunLocation, RunState,
  StoredEvidence, Tier,
} from "../../src/types.ts";
import { ulid } from "../../src/util/ulid.ts";

export const HOST = "claude-code";
export const SESSION = "S1";
export const ALLOW: HookDecision = { kind: "allow", notice: null };

// Resolved from this file, so the tests run from any checkout path.
const PACK_DIR = join(import.meta.dirname, "../../../packs/feature-delivery");
let packCache: ResolvedPack | null = null;

/** The reference pack, loaded once per test process. */
export function pack(): ResolvedPack {
  packCache ??= loadPack(PACK_DIR);
  return packCache;
}

// Setup events come from the test, not from a hook or an agent, so nothing here can pass for observed evidence.
const SETUP: Actor = { kind: "kernel", id: "test", agent: null };
const HOOK: Actor = { kind: "hook", id: "test:post-tool", agent: null };
const HUMAN: Actor = { kind: "human", id: "test-owner", agent: null };

/** Creates a run in `repo` and enters its first stage, the way starting a run does. Returns the run id. */
export function startRun(repo: string, tier: Tier): string {
  const run = ulid();
  const p = pack();
  const loc = { root: repo, run };
  const git = existsSync(join(repo, ".git"));
  createRun(loc, { type: "run.started", actor: SETUP, data: { brief: "test run", tier, tierReason: "test", root: repo, git, host: HOST, pack: p } }, projector);
  const first = p.tiers[tier]?.stages[0]?.name;
  if (first === undefined) throw new Error(`the reference pack has no ${tier} stages`);
  append(loc, { type: "stage.entered", actor: SETUP, data: { stage: first, index: 0 } });
  return run;
}

/** Binds session S1 of the test host to `run`. */
export function bound(repo: string, run: string): void {
  bindSession(repo, HOST, SESSION, run);
}

/** Leaves the run with no log and an unparseable snapshot, so loading its state throws. */
export function breakRun(loc: RunLocation): void {
  const paths = runPaths(loc);
  rmSync(paths.log);
  writeFileSync(paths.state, "{");
}

/**
 * A HookInput for session S1. A relative tool path resolves against `cwd`, as the host's normalizer does,
 * so tests can name files the way an agent would.
 */
export function input(p: Partial<HookInput> & { cwd: string }): HookInput {
  const tool = p.tool ?? null;
  const resolved = tool !== null && tool.path !== null && !isAbsolute(tool.path) ? { ...tool, path: resolve(p.cwd, tool.path) } : tool;
  return {
    host: HOST, event: "pre-tool", session: SESSION, promptId: null, agent: null, result: null, source: null, stopHookActive: false,
    ...p,
    tool: resolved,
  };
}

export function bashTool(command: string): HookTool {
  return { name: "Bash", kind: "bash", input: { command }, command, path: null, skill: null, aosTool: null };
}

export function writeTool(path: string, name = "Write"): HookTool {
  return { name, kind: "write", input: { file_path: path }, command: null, path, skill: null, aosTool: null };
}

export function skillTool(skill: string): HookTool {
  return { name: "Skill", kind: "skill", input: { skill }, command: null, path: null, skill, aosTool: null };
}

export function mcpTool(aosTool: string): HookTool {
  return { name: `mcp__plugin_aos_aos__${aosTool}`, kind: "aos-mcp", input: {}, command: null, path: null, skill: null, aosTool };
}

export function append(loc: RunLocation, ...drafts: EventDraft[]): RunState {
  return appendEvents(loc, drafts, projector).file.state;
}

export function state(loc: RunLocation): RunState {
  return loadState(loc, projector).state;
}

export function events(loc: RunLocation): EventEnvelope[] {
  return readLog(loc).events;
}

export function types(loc: RunLocation): string[] {
  return events(loc).map((e) => e.type);
}

export function lastEvent(loc: RunLocation): EventEnvelope {
  const all = events(loc);
  const last = all[all.length - 1];
  if (last === undefined) throw new Error("the run has no events");
  return last;
}

export function lastEvidence(loc: RunLocation): StoredEvidence {
  const ev = state(loc).evidence;
  const last = ev[ev.length - 1];
  if (last === undefined) throw new Error("the run has no evidence");
  return last;
}

/** The current tree's fingerprint, as a hook would compute it for this run. */
export function fp(loc: RunLocation): string {
  const s = state(loc);
  return treeFingerprint(s.root, { git: s.git, changes: s.changes }).fingerprint;
}

/** Moves the run to `stage` of its tier. */
export function at(loc: RunLocation, stage: string): void {
  const s = state(loc);
  const index = s.stages.indexOf(stage);
  if (index < 0) throw new Error(`stage ${stage} is not in the ${s.tier} tier`);
  append(loc, { type: "stage.entered", actor: SETUP, data: { stage, index } });
}

function evidenceBase(loc: RunLocation): { id: string; fingerprint: string; changes: number; stage: string; agent: null } {
  const s = state(loc);
  return { id: ulid(), fingerprint: fp(loc), changes: s.changes, stage: s.current.stage, agent: null };
}

function record(loc: RunLocation, data: Evidence): void {
  append(loc, { type: "evidence.recorded", actor: HOOK, data });
}

/** Observed test evidence at the current tree. */
export function testRun(loc: RunLocation, exitCode: number | null): void {
  const data: CommandEvidence = {
    ...evidenceBase(loc), kind: "command", role: "test", command: "bun test", exitCode, masked: false,
    outputSha256: "sha256:" + "0".repeat(64), tail: "", provenance: "observed",
  };
  record(loc, data);
}

/** An approved review at the current tree. */
export function review(loc: RunLocation): void {
  const data: ReviewEvidence = { ...evidenceBase(loc), kind: "review", status: "approved", feedback: "", reviewer: "test", provenance: "claimed" };
  record(loc, data);
}

/** Everything the bounded verify gate needs, fresh at the current tree. */
export function pass(loc: RunLocation): void {
  testRun(loc, 0);
  review(loc);
}

export function requestApproval(loc: RunLocation, stage = state(loc).current.stage): string {
  const request = ulid();
  append(loc, { type: "approval.requested", actor: { kind: "agent", id: "test", agent: null }, data: { request, stage, summary: "please review" } });
  return request;
}

export function grantApproval(loc: RunLocation, request: string, stage = state(loc).current.stage): void {
  append(loc, { type: "approval.granted", actor: HUMAN, data: { request, stage, reason: null } });
}

/** Passes verify and completes the run. */
export function complete(loc: RunLocation): void {
  at(loc, "verify");
  pass(loc);
  append(loc, { type: "run.completed", actor: SETUP, data: { stage: "verify" } });
}

/** Sets the iteration budget's used count, optionally marking it exceeded. */
export function setUsed(loc: RunLocation, used: number, exceeded: boolean): void {
  const drafts: EventDraft[] = [{ type: "budget.charged", actor: SETUP, data: { dimension: "iterations", amount: used - state(loc).budget.iterations.used, gapKey: null } }];
  if (exceeded) drafts.push({ type: "budget.exceeded", actor: SETUP, data: { dimension: "iterations", used, limit: state(loc).budget.iterations.limit } });
  append(loc, ...drafts);
}
