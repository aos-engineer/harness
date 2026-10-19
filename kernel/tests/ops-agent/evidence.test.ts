import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { agentActor } from "../../src/ops/context.ts";
import type { OpContext } from "../../src/ops/context.ts";
import { evidenceRecord, gateCheck, requestApproval, runStart, stageAdvance, taskAdd, taskComplete } from "../../src/ops/agent.ts";
import { runPaths } from "../../src/store/paths.ts";
import type { Evidence } from "../../src/types.ts";
import { sha256Tag } from "../../src/util/hash.ts";
import { tmpDir, writeFile } from "../helpers.ts";
import { approveCurrent, lastEvent, observeTests, reviewApproved, setup, state, toBuild } from "./fixtures.ts";

let repo: string;
let ctx: OpContext;
let runId: string;
beforeEach(() => {
  ({ repo, ctx } = setup());
  runId = runStart(ctx, { brief: "Fix the README typo" }).runId;
});

const code = (code: string) => expect.objectContaining({ name: "OpError", code });
const advance = (run: string) => stageAdvance(ctx, { runId: run });
const lastEvidence = (): Evidence => {
  const e = lastEvent(ctx, runId);
  if (e.type !== "evidence.recorded") throw new Error(`last event is ${e.type}`);
  return e.data;
};

describe("artifact evidence", () => {
  test("artifact evidence is claimed and hashed", () => {
    writeFile(repo, "docs/specs/x.md", "y");
    const r = evidenceRecord(ctx, { runId, kind: "artifact", path: "docs/specs/x.md" });
    const fingerprint = ctx.tree(repo, { git: true, changes: 0 }).fingerprint;
    expect(r).toEqual({ evidenceId: lastEvidence().id, fingerprint });
    expect(lastEvidence()).toMatchObject({
      kind: "artifact", provenance: "claimed", sha256: sha256Tag("y"), path: "docs/specs/x.md",
      fingerprint, changes: 0, stage: "design", agent: null,
    });
    expect(lastEvent(ctx, runId).actor).toEqual(agentActor("aos_evidence_record"));
  });

  test("a small artifact is copied into the run, so the evidence survives later edits", () => {
    writeFile(repo, "docs/specs/x.md", "y");
    evidenceRecord(ctx, { runId, kind: "artifact", path: "docs/specs/x.md" });
    expect(existsSync(join(runPaths({ root: repo, run: runId }).artifacts, sha256Tag("y").slice("sha256:".length)))).toBe(true);
  });

  test("an artifact of 1 MiB or more is hashed but not copied", () => {
    const big = "z".repeat(1024 * 1024);
    writeFile(repo, "big.txt", big);
    evidenceRecord(ctx, { runId, kind: "artifact", path: "big.txt" });
    expect(lastEvidence()).toMatchObject({ sha256: sha256Tag(big) });
    expect(existsSync(runPaths({ root: repo, run: runId }).artifacts)).toBe(false);
  });

  test("the recorded path is relative to the root, however it was written", () => {
    writeFile(repo, "docs/specs/x.md", "y");
    evidenceRecord(ctx, { runId, kind: "artifact", path: "./docs/../docs/specs/x.md" });
    expect(lastEvidence()).toMatchObject({ path: "docs/specs/x.md" });
    evidenceRecord(ctx, { runId, kind: "artifact", path: join(repo, "docs/specs/x.md") });
    expect(lastEvidence()).toMatchObject({ path: "docs/specs/x.md" });
  });

  test("artifact outside root or under .aos is refused", () => {
    const outside = tmpDir();
    writeFile(outside, "x", "secret");
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: "../x" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: join(outside, "x") })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: `.aos/runs/${runId}/log.jsonl` })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: ".aos" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: ".aos/runs/x" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: `.AOS/runs/${runId}/state.json` })).toThrow(code("refused"));
  });

  test("a symlink cannot smuggle in a file from outside the root or from .aos", () => {
    const outside = tmpDir();
    writeFile(outside, "x", "secret");
    symlinkSync(join(outside, "x"), join(repo, "link-out"));
    mkdirSync(join(repo, "docs"), { recursive: true });
    symlinkSync(join(repo, ".aos"), join(repo, "docs", "state"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: "link-out" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: `docs/state/runs/${runId}/log.jsonl` })).toThrow(code("refused"));
  });

  test("artifacts under .git/ are refused like .aos/", () => {
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: ".git/config" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: ".GIT/HEAD" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: ".git/nope" })).toThrow(code("refused"));
    expect(() => evidenceRecord(ctx, { runId, kind: "citation", path: ".git/HEAD", line: 1, note: "" })).toThrow(code("refused"));
    mkdirSync(join(repo, "docs"), { recursive: true });
    symlinkSync(join(repo, ".git"), join(repo, "docs", "g"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: "docs/g/config" })).toThrow(code("refused"));
  });

  test("a file git ignores is hashed and recorded but never copied into the run", () => {
    writeFile(repo, ".gitignore", ".env\n");
    writeFile(repo, ".env", "API_KEY=sk-live-123\n");
    evidenceRecord(ctx, { runId, kind: "artifact", path: ".env" });
    expect(lastEvidence()).toMatchObject({ kind: "artifact", path: ".env", sha256: sha256Tag("API_KEY=sk-live-123\n") });
    expect(existsSync(runPaths({ root: repo, run: runId }).artifacts)).toBe(false);
    writeFile(repo, "docs/specs/x.md", "y");
    evidenceRecord(ctx, { runId, kind: "artifact", path: "docs/specs/x.md" });
    expect(existsSync(runPaths({ root: repo, run: runId }).artifacts)).toBe(true);
  });

  test("a missing file or a directory is invalid", () => {
    mkdirSync(join(repo, "docs"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: "nope.md" })).toThrow(code("invalid"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: "docs" })).toThrow(code("invalid"));
    expect(() => evidenceRecord(ctx, { runId, kind: "artifact", path: "" })).toThrow(code("invalid"));
  });
});

describe("other claimed evidence", () => {
  test("a citation names an existing line of an existing file", () => {
    writeFile(repo, "src/a.ts", "one\ntwo\n");
    evidenceRecord(ctx, { runId, kind: "citation", path: "src/a.ts", line: 2, note: "the second line" });
    expect(lastEvidence()).toMatchObject({ kind: "citation", provenance: "claimed", path: "src/a.ts", line: 2, note: "the second line" });
    expect(() => evidenceRecord(ctx, { runId, kind: "citation", path: "src/a.ts", line: 0, note: "" })).toThrow(code("invalid"));
    expect(() => evidenceRecord(ctx, { runId, kind: "citation", path: "src/a.ts", line: 1.5, note: "" })).toThrow(code("invalid"));
    expect(() => evidenceRecord(ctx, { runId, kind: "citation", path: "src/a.ts", line: 3, note: "" })).toThrow(code("invalid"));
    expect(() => evidenceRecord(ctx, { runId, kind: "citation", path: "src/b.ts", line: 1, note: "" })).toThrow(code("invalid"));
  });

  // Lines are counted from the file's bytes in chunks, so the large cases cross several chunk boundaries.
  test.each([
    ["an empty file", "", 0],
    ["one line without a final newline", "a", 1],
    ["one line with a final newline", "a\n", 1],
    ["CRLF line endings", "a\r\nb\r\n", 2],
    ["empty lines", "\n\n", 2],
    ["multi-byte text", "\u00e9t\u00e9\n\u{1F600}\n", 2],
    ["many lines", "x\n".repeat(200_000), 200_000],
    ["a last line spanning chunks", "x\n".repeat(99_999) + "y".repeat(70_000), 100_000],
  ])("citations count the lines of %s", (_name, content, lines) => {
    writeFile(repo, "src/c.txt", content);
    if (lines > 0) evidenceRecord(ctx, { runId, kind: "citation", path: "src/c.txt", line: lines, note: "" });
    expect(() => evidenceRecord(ctx, { runId, kind: "citation", path: "src/c.txt", line: lines + 1, note: "" })).toThrow(`has ${lines} lines`);
  });

  test("review needs non-empty feedback", () => {
    expect(() => evidenceRecord(ctx, { runId, kind: "review", status: "approved", feedback: " ", reviewer: "r" })).toThrow(code("invalid"));
  });

  test("review needs a reviewer and a known status", () => {
    expect(() => evidenceRecord(ctx, { runId, kind: "review", status: "approved", feedback: "ok", reviewer: "" })).toThrow(code("invalid"));
    expect(() => evidenceRecord(ctx, { runId, kind: "review", status: "lgtm" as never, feedback: "ok", reviewer: "r" })).toThrow(code("invalid"));
    evidenceRecord(ctx, { runId, kind: "review", status: "needs-revision", feedback: " Rename x. ", reviewer: "code-reviewer" });
    expect(lastEvidence()).toMatchObject({ kind: "review", provenance: "claimed", status: "needs-revision", feedback: "Rename x.", reviewer: "code-reviewer" });
  });

  test("a skill needs a name", () => {
    expect(() => evidenceRecord(ctx, { runId, kind: "skill", skill: "  " })).toThrow(code("invalid"));
    evidenceRecord(ctx, { runId, kind: "skill", skill: "superpowers:brainstorming" });
    expect(lastEvidence()).toMatchObject({ kind: "skill", provenance: "claimed", skill: "superpowers:brainstorming" });
  });

  test("agent-recorded evidence is always claimed, whatever the caller passes", () => {
    evidenceRecord(ctx, { runId, kind: "skill", skill: "x", provenance: "observed" } as never);
    expect(lastEvidence().provenance).toBe("claimed");
  });

  test("command evidence cannot be recorded, because only hooks observe commands", () => {
    expect(() => evidenceRecord(ctx, { runId, kind: "command", command: "bun test", exitCode: 0 } as never)).toThrow(code("invalid"));
  });

  test("evidence records the tree it was taken at", () => {
    writeFile(repo, "src/a.ts", "one\n");
    evidenceRecord(ctx, { runId, kind: "skill", skill: "x" });
    expect(lastEvidence().fingerprint).toBe(ctx.tree(repo, { git: true, changes: 0 }).fingerprint);
  });
});

describe("approval requests", () => {
  test("requestApproval records a request the human can answer", () => {
    const r = requestApproval(ctx, { runId, summary: " Change the README heading. " });
    expect(r.stage).toBe("design");
    expect(lastEvent(ctx, runId)).toMatchObject({
      type: "approval.requested", actor: agentActor("aos_request_approval"),
      data: { request: r.request, stage: "design", summary: "Change the README heading." },
    });
    expect(gateCheck(ctx, { runId }).message).toContain("Waiting on the human");
  });

  test("requestApproval tells the agent not to approve itself", () => {
    const r = requestApproval(ctx, { runId, summary: "design" });
    expect(r.instructions).toBe(`Ask the human to run, in their own terminal: aos approve ${runId} design --root "${repo}". Then stop and wait; do not run it yourself.`);
  });

  test("requestApproval refuses a non-human gate", () => {
    toBuild(ctx, runId, advance);
    expect(() => requestApproval(ctx, { runId, summary: "s" })).toThrow(code("invalid"));
  });

  test("the summary is 1 to 4000 characters", () => {
    expect(() => requestApproval(ctx, { runId, summary: " " })).toThrow(code("invalid"));
    expect(() => requestApproval(ctx, { runId, summary: "x".repeat(4001) })).toThrow(code("invalid"));
    expect(requestApproval(ctx, { runId, summary: "x".repeat(4000) }).stage).toBe("design");
  });
});

describe("tasks", () => {
  test("task ids are sequential and completion counts open tasks", () => {
    expect(taskAdd(ctx, { runId, title: "a" })).toEqual({ task: "t1", stage: "design" });
    taskAdd(ctx, { runId, title: "b" });
    expect(taskComplete(ctx, { runId, task: "t1" })).toEqual({ task: "t1", open: 1 });
    expect(lastEvent(ctx, runId)).toMatchObject({ type: "task.completed", actor: agentActor("aos_task_complete"), data: { task: "t1", evidence: [] } });
  });

  test("task ids keep counting across stages, and tasks belong to the stage they were added in", () => {
    taskAdd(ctx, { runId, title: "a" });
    toBuild(ctx, runId, advance);
    expect(taskAdd(ctx, { runId, title: "b" })).toEqual({ task: "t2", stage: "build" });
    expect(() => taskComplete(ctx, { runId, task: "t1" })).toThrow(/design stage/);
  });

  test("completing an unknown or finished task is invalid", () => {
    taskAdd(ctx, { runId, title: "a" });
    expect(() => taskComplete(ctx, { runId, task: "t9" })).toThrow(code("invalid"));
    taskComplete(ctx, { runId, task: "t1" });
    expect(() => taskComplete(ctx, { runId, task: "t1" })).toThrow(code("invalid"));
  });

  test("a completion may cite evidence the run holds, and only that", () => {
    taskAdd(ctx, { runId, title: "a" });
    const { evidenceId } = evidenceRecord(ctx, { runId, kind: "skill", skill: "x" });
    expect(() => taskComplete(ctx, { runId, task: "t1", evidence: ["nope"] })).toThrow(code("invalid"));
    taskComplete(ctx, { runId, task: "t1", evidence: [evidenceId] });
    expect(state(ctx, runId).tasks[0]).toMatchObject({ id: "t1", done: true, evidence: [evidenceId] });
  });

  test("a task needs a title", () => {
    expect(() => taskAdd(ctx, { runId, title: " " })).toThrow(code("invalid"));
    taskAdd(ctx, { runId, title: "  Write the parser test " });
    expect(state(ctx, runId).tasks[0]?.title).toBe("Write the parser test");
  });

  test("open tasks hold the build gate until they are completed", () => {
    toBuild(ctx, runId, advance);
    taskAdd(ctx, { runId, title: "a" });
    observeTests(ctx, runId);
    expect(advance(runId)).toMatchObject({ advanced: false, message: expect.stringContaining("Task t1") });
    taskComplete(ctx, { runId, task: "t1" });
    expect(advance(runId)).toMatchObject({ advanced: true, stage: "verify" });
  });
});

test("nothing but status works on a finished run", () => {
  approveCurrent(ctx, runId);
  advance(runId);
  observeTests(ctx, runId);
  advance(runId);
  reviewApproved(ctx, runId);
  expect(advance(runId).completed).toBe(true);
  expect(() => taskAdd(ctx, { runId, title: "late" })).toThrow(code("refused"));
  expect(() => taskComplete(ctx, { runId, task: "t1" })).toThrow(code("refused"));
  expect(() => evidenceRecord(ctx, { runId, kind: "skill", skill: "x" })).toThrow(code("refused"));
  expect(() => requestApproval(ctx, { runId, summary: "s" })).toThrow(code("refused"));
});

test("unknown runs are not_found for every operation", () => {
  const ghost = "01JZZZZZZZZZZZZZZZZZZZZZZZ";
  expect(() => taskAdd(ctx, { runId: ghost, title: "a" })).toThrow(code("not_found"));
  expect(() => evidenceRecord(ctx, { runId: ghost, kind: "skill", skill: "x" })).toThrow(code("not_found"));
  expect(() => requestApproval(ctx, { runId: ghost, summary: "s" })).toThrow(code("not_found"));
});
