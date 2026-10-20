// Another writer (a hook, the human's CLI, a second tool call) can append between an operation's read and
// its append. These tests land that write inside the window through the context's afterRead hook.
import { beforeEach, describe, expect, test } from "bun:test";
import type { OpContext } from "../../src/ops/context.ts";
import { evidenceRecord, gateCheck, requestApproval, runStart, stageAdvance, taskAdd, taskComplete } from "../../src/ops/agent.ts";
import { ulid } from "../../src/util/ulid.ts";
import { writeFile } from "../helpers.ts";
import { HOOK, HUMAN, append, approveCurrent, events, eventTypes, observeTests, setup, state, toBuild } from "./fixtures.ts";

let repo: string;
let ctx: OpContext;
let runId: string;
beforeEach(() => {
  ({ repo, ctx } = setup());
  runId = runStart(ctx, { brief: "Fix the README typo" }).runId;
});

const code = (code: string) => expect.objectContaining({ name: "OpError", code });

/** A context whose afterRead runs `write` on the first `times` reads, and counts every read. */
function racing(write: () => void, times = 1): { ctx: OpContext; reads: () => number } {
  let n = 0;
  return {
    ctx: { ...ctx, afterRead: () => { if (n++ < times) write(); } },
    reads: () => n,
  };
}

const cancel = () => append(ctx, runId, [{ type: "run.cancelled", actor: HUMAN, data: { reason: "stop" } }]);
const edit = (n: number) => () => {
  writeFile(repo, `src/edit-${n}.ts`, `export const n = ${n};\n`);
  append(ctx, runId, [{ type: "worktree.changed", actor: HOOK, data: { path: `src/edit-${n}.ts`, tool: "Write" } }]);
};
let edits = 0;
const anEdit = () => edit(++edits)();
const entered = (stage: string) => events(ctx, runId).filter((e) => e.type === "stage.entered" && e.data.stage === stage).length;

describe("a human cancel wins over an agent operation in flight", () => {
  test("a cancel landing mid-advance refuses the advance and the run stays cancelled", () => {
    approveCurrent(ctx, runId);
    const r = racing(cancel);
    expect(() => stageAdvance(r.ctx, { runId })).toThrow(code("refused"));
    expect(state(ctx, runId).status).toBe("cancelled");
    expect(eventTypes(ctx, runId).at(-1)).toBe("run.cancelled");
    expect(entered("build")).toBe(0);
  });

  test("a cancel is final: the operation does not retry", () => {
    approveCurrent(ctx, runId);
    const r = racing(cancel);
    expect(() => stageAdvance(r.ctx, { runId })).toThrow(/cancelled/);
    expect(r.reads()).toBe(1);
  });

  test("a cancel landing mid-call refuses every appending operation", () => {
    const ops: Array<(c: OpContext) => unknown> = [
      (c) => gateCheck(c, { runId }),
      (c) => taskAdd(c, { runId, title: "a" }),
      (c) => evidenceRecord(c, { runId, kind: "skill", skill: "x" }),
      (c) => requestApproval(c, { runId, summary: "s" }),
    ];
    for (const op of ops) {
      ({ ctx } = setup());
      runId = runStart(ctx, { brief: "Fix the README typo" }).runId;
      const before = events(ctx, runId).length;
      expect(() => op(racing(cancel).ctx)).toThrow(code("refused"));
      expect(events(ctx, runId).length).toBe(before + 1);
    }
  });

  test("a cancel landing mid-completion refuses taskComplete", () => {
    taskAdd(ctx, { runId, title: "a" });
    expect(() => taskComplete(racing(cancel).ctx, { runId, task: "t1" })).toThrow(code("refused"));
    expect(state(ctx, runId).tasks[0]?.done).toBe(false);
  });
});

describe("concurrent agent calls", () => {
  test("a double advance enters the next stage exactly once", () => {
    approveCurrent(ctx, runId);
    const r = racing(() => void stageAdvance(ctx, { runId }));
    const outer = stageAdvance(r.ctx, { runId });
    expect(entered("build")).toBe(1);
    expect(outer).toMatchObject({ advanced: false, stage: "build" });
    expect(state(ctx, runId).current.stage).toBe("build");
  });

  test("a duplicate task id goes to the next id", () => {
    const r = racing(() => void taskAdd(ctx, { runId, title: "first" }));
    expect(taskAdd(r.ctx, { runId, title: "second" })).toEqual({ task: "t2", stage: "design" });
    expect(state(ctx, runId).tasks.map((t) => [t.id, t.title])).toEqual([["t1", "first"], ["t2", "second"]]);
  });

  test("a task completed by another call is not completed twice", () => {
    taskAdd(ctx, { runId, title: "a" });
    const r = racing(() => void taskComplete(ctx, { runId, task: "t1" }));
    expect(() => taskComplete(r.ctx, { runId, task: "t1" })).toThrow(/already completed/);
    expect(eventTypes(ctx, runId).filter((t) => t === "task.completed")).toHaveLength(1);
  });

  test("an approval request is not logged for a stage the run has left", () => {
    approveCurrent(ctx, runId);
    const r = racing(() => void stageAdvance(ctx, { runId }));
    expect(() => requestApproval(r.ctx, { runId, summary: "design" })).toThrow(code("invalid"));
    expect(state(ctx, runId).approvals.filter((a) => a.stage === "build")).toEqual([]);
  });

  test("a task added mid-advance holds the gate it would otherwise have skipped", () => {
    toBuild(ctx, runId, (run) => stageAdvance(ctx, { runId: run }));
    observeTests(ctx, runId);
    const r = racing(() => void taskAdd(ctx, { runId, title: "late" }));
    expect(stageAdvance(r.ctx, { runId })).toMatchObject({ advanced: false, stage: "build" });
    expect(entered("verify")).toBe(0);
  });
});

describe("edits and evidence in the window", () => {
  test("an edit observed mid-advance makes the gate re-evaluate, and stale tests hold it", () => {
    toBuild(ctx, runId, (run) => stageAdvance(ctx, { runId: run }));
    observeTests(ctx, runId);
    const r = racing(anEdit);
    const result = stageAdvance(r.ctx, { runId });
    expect(r.reads()).toBe(2);
    expect(result).toMatchObject({ advanced: false, stage: "build" });
    expect(result.message).toContain("predates the current tree");
  });

  test("evidence landing mid-advance does not make it retry", () => {
    toBuild(ctx, runId, (run) => stageAdvance(ctx, { runId: run }));
    observeTests(ctx, runId);
    const r = racing(() => append(ctx, runId, [{
      type: "evidence.recorded", actor: HOOK,
      data: { id: ulid(), kind: "skill", provenance: "observed", fingerprint: "git:x", changes: 0, stage: "build", agent: null, skill: "x" },
    }]));
    expect(stageAdvance(r.ctx, { runId })).toMatchObject({ advanced: true, stage: "verify" });
    expect(r.reads()).toBe(1);
  });

  test("an edit observed mid-check makes gateCheck re-read", () => {
    const r = racing(anEdit);
    expect(gateCheck(r.ctx, { runId }).gate.verdict).toBe("pending");
    expect(r.reads()).toBe(2);
  });

  test("a run that keeps changing is refused after three tries", () => {
    approveCurrent(ctx, runId);
    const r = racing(anEdit, Infinity);
    expect(() => stageAdvance(r.ctx, { runId })).toThrow(/run changed while this call ran; call aos_status and try again/);
    expect(() => stageAdvance(racing(anEdit, Infinity).ctx, { runId })).toThrow(code("refused"));
    expect(r.reads()).toBe(3);
    expect(entered("build")).toBe(0);
  });
});
