// Shared setup for the agent operation tests. Events that only hooks or humans create (observed test runs,
// approval decisions) are appended straight to the store, the way those writers do it.
import { join } from "node:path";
import { openContext } from "../../src/ops/context.ts";
import type { OpContext } from "../../src/ops/context.ts";
import { projector } from "../../src/projection.ts";
import { readLog } from "../../src/store/log.ts";
import { appendEvents, loadState } from "../../src/store/store.ts";
import type { Actor, EventDraft, EventEnvelope, EventType, RunLocation, RunState } from "../../src/types.ts";
import { sha256Tag } from "../../src/util/hash.ts";
import { ulid } from "../../src/util/ulid.ts";
import { tmpGitRepo } from "../helpers.ts";

export const PACK = join(import.meta.dirname, "../../../packs/feature-delivery");
export const HUMAN: Actor = { kind: "human", id: "human:tester", agent: null };
export const HOOK: Actor = { kind: "hook", id: "hook:post-tool", agent: null };
const AGENT: Actor = { kind: "agent", id: "mcp:aos_request_approval", agent: null };

export function setup(): { repo: string; ctx: OpContext } {
  const repo = tmpGitRepo();
  return { repo, ctx: openContext({ cwd: repo, packDir: PACK, host: "test" }) };
}

export const loc = (ctx: OpContext, run: string): RunLocation => ({ root: ctx.root, run });
export const events = (ctx: OpContext, run: string): EventEnvelope[] => readLog(loc(ctx, run)).events;
export const eventTypes = (ctx: OpContext, run: string): EventType[] => events(ctx, run).map((e) => e.type);
export const lastEvent = (ctx: OpContext, run: string): EventEnvelope => {
  const all = events(ctx, run);
  const e = all[all.length - 1];
  if (e === undefined) throw new Error(`run ${run} has no events`);
  return e;
};
export const state = (ctx: OpContext, run: string): RunState => loadState(loc(ctx, run), projector).state;
export const append = (ctx: OpContext, run: string, drafts: EventDraft[]): void => void appendEvents(loc(ctx, run), drafts, projector);

/** Requests and grants approval for the current stage, as the agent and then the human would. */
export function approveCurrent(ctx: OpContext, run: string): void {
  const stage = state(ctx, run).current.stage;
  const request = ulid();
  append(ctx, run, [
    { type: "approval.requested", actor: AGENT, data: { request, stage, summary: `the ${stage}` } },
    { type: "approval.granted", actor: HUMAN, data: { request, stage, reason: null } },
  ]);
}

/** A test run the observer hook saw at the current tree. */
export function observeTests(ctx: OpContext, run: string, exitCode = 0): void {
  const s = state(ctx, run);
  const { fingerprint } = ctx.tree(s.root, { git: s.git, changes: s.changes });
  append(ctx, run, [{
    type: "evidence.recorded", actor: HOOK,
    data: {
      id: ulid(), kind: "command", provenance: "observed", fingerprint, changes: s.changes, stage: s.current.stage, agent: null,
      role: "test", command: "bun test", exitCode, masked: false, outputSha256: sha256Tag(""), tail: "",
    },
  }]);
}

/** A claimed review at the current tree, as aos_evidence_record writes it. */
export function reviewApproved(ctx: OpContext, run: string): void {
  const s = state(ctx, run);
  const { fingerprint } = ctx.tree(s.root, { git: s.git, changes: s.changes });
  append(ctx, run, [{
    type: "evidence.recorded", actor: { kind: "agent", id: "mcp:aos_evidence_record", agent: null },
    data: {
      id: ulid(), kind: "review", provenance: "claimed", fingerprint, changes: s.changes, stage: s.current.stage, agent: null,
      status: "approved", feedback: "Looks right.", reviewer: "reviewer",
    },
  }]);
}

/** Walks a fresh bounded run to the build stage. */
export function toBuild(ctx: OpContext, run: string, advance: (run: string) => unknown): void {
  approveCurrent(ctx, run);
  advance(run);
  if (state(ctx, run).current.stage !== "build") throw new Error(`run ${run} did not reach build`);
}
