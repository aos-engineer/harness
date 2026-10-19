import { beforeEach, describe, expect, test } from "bun:test";
import { agentActor, openContext } from "../../src/ops/context.ts";
import type { OpContext } from "../../src/ops/context.ts";
import { gateCheck, runStart, runStatus, stageAdvance } from "../../src/ops/agent.ts";
import { loadPack } from "../../src/pack/load.ts";
import { listRuns } from "../../src/store/store.ts";
import { tmpDir, writeFile } from "../helpers.ts";
import { PACK, approveCurrent, eventTypes, lastEvent, observeTests, reviewApproved, setup, state } from "./fixtures.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const pack = loadPack(PACK);

let repo: string;
let ctx: OpContext;
beforeEach(() => ({ repo, ctx } = setup()));

const start = (brief = "Fix the README typo") => runStart(ctx, { brief });
const code = (code: string) => expect.objectContaining({ name: "OpError", code });

describe("openContext", () => {
  test("roots a context at the repository top level, even from a subdirectory", () => {
    writeFile(repo, "src/deep/file.ts", "");
    const sub = openContext({ cwd: `${repo}/src/deep`, packDir: PACK, host: "test" });
    expect(sub).toMatchObject({ root: repo, git: true, packDir: PACK, host: "test" });
    expect(sub.tree(repo, { git: true, changes: 0 }).fingerprint).toStartWith("git:");
  });

  test("falls back to the directory itself outside git, with a weak tree", () => {
    const dir = tmpDir();
    const plain = openContext({ cwd: dir, packDir: PACK, host: "test" });
    expect(plain).toMatchObject({ root: dir, git: false });
    expect(plain.tree(dir, { git: false, changes: 3 })).toEqual({ fingerprint: "counter:3", weak: true });
  });

  test("resolves a relative pack directory against the working directory", () => {
    const dir = tmpDir();
    expect(openContext({ cwd: dir, packDir: "packs/x", host: "test" }).packDir).toBe(`${dir}/packs/x`);
  });

  test("agent actors name the tool that acted", () => {
    expect(agentActor("aos_run_start")).toEqual({ kind: "agent", id: "mcp:aos_run_start", agent: null });
  });
});

describe("runStart", () => {
  test("defaults to bounded and enters design", () => {
    const r = start();
    expect(r).toMatchObject({ tier: "bounded", stage: "design", stages: ["design", "build", "verify"] });
    expect(r.runId).toMatch(ULID);
    expect(r.instructions).toBe(pack.instructions["bounded/design"] ?? "missing");
    expect(r.tierReason).toContain("pack default is bounded");
    expect(eventTypes(ctx, r.runId)).toEqual(["run.started", "stage.entered"]);
  });

  test("records the trimmed brief, the context, and the acting tool", () => {
    const r = runStart(ctx, { brief: "  Fix the README typo \n" });
    const s = state(ctx, r.runId);
    expect(s).toMatchObject({ brief: "Fix the README typo", root: repo, git: true, host: "test", status: "active" });
    expect(s.pack.integrity).toBe(pack.integrity);
    expect(lastEvent(ctx, r.runId).actor).toEqual(agentActor("aos_run_start"));
  });

  test("the notice tells the agent to share the tier and reason", () => {
    const r = start();
    expect(r.notice).toBe(`AOS run ${r.runId} started as bounded (${r.tierReason}). Tell the human the tier and why. This session is bound to the run once this call returns.`);
  });

  test("spike by keyword", () => {
    const r = runStart(ctx, { brief: "Spike: can Bun stream SSE?" });
    expect(r).toMatchObject({ tier: "spike", stage: "frame", stages: ["frame", "probe"] });
    expect(r.tierReason).toContain("spike");
  });

  test("a requested tier may raise the proposal", () => {
    const r = runStart(ctx, { brief: "Spike: x", tier: "bounded" });
    expect(r.tier).toBe("bounded");
    expect(r.tierReason).toContain("raised to bounded on request");
  });

  test("requesting the proposed tier is not a raise", () => {
    expect(runStart(ctx, { brief: "Fix typo", tier: "bounded" }).tierReason).not.toContain("raised");
  });

  test("a requested tier may not lower the proposal, because lowering needs a human", () => {
    expect(() => runStart(ctx, { brief: "Fix typo", tier: "spike" })).toThrow(code("refused"));
    expect(() => runStart(ctx, { brief: "Fix typo", tier: "spike" })).toThrow(/Lowering the proposed tier \(bounded: .*\) requires a human/);
    expect(listRuns(ctx.root)).toEqual([]);
  });

  test("architectural proposals are refused with the reason", () => {
    expect(() => runStart(ctx, { brief: "Add a users migration" })).toThrow(/architectural tier is not available.*migration/);
    expect(() => runStart(ctx, { brief: "Add a users migration" })).toThrow(code("refused"));
    expect(listRuns(ctx.root)).toEqual([]);
  });

  test("a raise into a tier the pack lacks is refused too", () => {
    expect(() => runStart(ctx, { brief: "Fix typo", tier: "architectural" })).toThrow(/architectural tier is not available.*requested/);
  });

  test("empty brief is invalid", () => {
    expect(() => runStart(ctx, { brief: "  " })).toThrow(code("invalid"));
  });

  test("a brief over 8000 characters is invalid", () => {
    expect(() => runStart(ctx, { brief: "x".repeat(8001) })).toThrow(code("invalid"));
    expect(runStart(ctx, { brief: "x".repeat(8000) }).tier).toBe("bounded");
  });

  test("an unknown tier is invalid", () => {
    expect(() => runStart(ctx, { brief: "Fix typo", tier: "huge" as never })).toThrow(code("invalid"));
  });
});

describe("stageAdvance and gateCheck", () => {
  test("stageAdvance does not pass a pending human gate", () => {
    const { runId } = start();
    const r = stageAdvance(ctx, { runId });
    expect(r).toMatchObject({ advanced: false, completed: false, stage: "design", instructions: null });
    expect(r.gate.verdict).toBe("pending");
    expect(r.message).toContain("Approval not requested");
    expect(eventTypes(ctx, runId).slice(-1)).toEqual(["gate.evaluated"]);
  });

  test("stageAdvance moves on after approval and completes after the last stage", () => {
    const { runId } = start();
    approveCurrent(ctx, runId);
    expect(stageAdvance(ctx, { runId })).toMatchObject({
      advanced: true, completed: false, stage: "build", instructions: pack.instructions["bounded/build"], message: null,
    });
    expect(eventTypes(ctx, runId).slice(-2)).toEqual(["gate.evaluated", "stage.entered"]);

    const blocked = stageAdvance(ctx, { runId });
    expect(blocked).toMatchObject({ advanced: false, stage: "build" });
    expect(blocked.message).toStartWith("AOS: advance blocked: build gate pending.");

    observeTests(ctx, runId);
    expect(stageAdvance(ctx, { runId })).toMatchObject({ advanced: true, stage: "verify", instructions: pack.instructions["bounded/verify"] });

    reviewApproved(ctx, runId);
    const done = stageAdvance(ctx, { runId });
    expect(done).toMatchObject({ advanced: true, completed: true, stage: "verify", instructions: null, message: null });
    expect(done.gate.verdict).toBe("pass");
    expect(eventTypes(ctx, runId).slice(-2)).toEqual(["gate.evaluated", "run.completed"]);
    expect(state(ctx, runId).status).toBe("completed");
  });

  test("a failed test run fails the build gate", () => {
    const { runId } = start();
    approveCurrent(ctx, runId);
    stageAdvance(ctx, { runId });
    observeTests(ctx, runId, 1);
    const r = stageAdvance(ctx, { runId });
    expect(r).toMatchObject({ advanced: false, stage: "build" });
    expect(r.gate.verdict).toBe("fail");
    expect(r.message).toContain("exited 1");
  });

  test("gateCheck records the evaluation and explains a pending gate", () => {
    const { runId } = start();
    const r = gateCheck(ctx, { runId });
    expect(r.gate).toMatchObject({ stage: "design", verdict: "pending" });
    expect(r.message).toStartWith("AOS: advance blocked: design gate pending.");
    expect(lastEvent(ctx, runId)).toMatchObject({ type: "gate.evaluated", actor: agentActor("aos_gate_check") });
  });

  test("gateCheck returns no message once the gate passes, and does not advance", () => {
    const { runId } = start();
    approveCurrent(ctx, runId);
    expect(gateCheck(ctx, { runId })).toMatchObject({ gate: { verdict: "pass" }, message: null });
    expect(state(ctx, runId).current.stage).toBe("design");
  });
});

describe("runStatus", () => {
  test("runStatus appends nothing", () => {
    const { runId } = start();
    const before = eventTypes(ctx, runId).length;
    runStatus(ctx, { runId });
    expect(eventTypes(ctx, runId).length).toBe(before);
  });

  test("reports the stage, gate, budget, and a summary", () => {
    const { runId } = start();
    const r = runStatus(ctx, { runId });
    expect(r).toMatchObject({
      runId, status: "active", tier: "bounded", stage: "design", stages: ["design", "build", "verify"],
      iterations: { used: 0, limit: pack.budget.iterations },
    });
    expect(r.gate).toMatchObject({ stage: "design", verdict: "pending" });
    expect(r.summary).toContain(`AOS run ${runId} (bounded`);
    expect(r.summary).toContain("Approval not requested");
  });

  test("unknown run is not_found", () => {
    expect(() => runStatus(ctx, { runId: "01JZZZZZZZZZZZZZZZZZZZZZZZ" })).toThrow(code("not_found"));
  });

  test("a run id that tries to leave the runs directory is not_found", () => {
    expect(() => runStatus(ctx, { runId: "../../etc" })).toThrow(code("not_found"));
    expect(() => gateCheck(ctx, { runId: "" })).toThrow(code("not_found"));
  });
});

describe("finished runs", () => {
  test("only runStatus works on a run that is no longer active", () => {
    const { runId } = start();
    finish(runId);
    expect(runStatus(ctx, { runId }).status).toBe("completed");
    expect(() => gateCheck(ctx, { runId })).toThrow(code("refused"));
    expect(() => stageAdvance(ctx, { runId })).toThrow(code("refused"));
  });
});

function finish(runId: string): void {
  approveCurrent(ctx, runId);
  stageAdvance(ctx, { runId });
  observeTests(ctx, runId);
  stageAdvance(ctx, { runId });
  reviewApproved(ctx, runId);
  if (!stageAdvance(ctx, { runId }).completed) throw new Error("run did not complete");
}
