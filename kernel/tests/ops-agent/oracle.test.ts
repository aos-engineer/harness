// The oracle end to end on a real repository: what a human approves at design is what build and verify
// are judged by, and editing the tests instead of the code fails the gate.
import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { evaluateGate } from "../../src/gates/evaluate.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import type { OpContext } from "../../src/ops/context.ts";
import { gateCheck, requestApproval, runStart, stageAdvance } from "../../src/ops/agent.ts";
import { approve, humanActor } from "../../src/ops/human.ts";
import type { HookDecision } from "../../src/types.ts";
import { ORACLE_MANIFEST, ORACLE_TEST, writeFile } from "../helpers.ts";
import { ALLOW, bashTool, bound, input, writeTool } from "../hooks/helpers.ts";
import { append, lastEvent, loc, observeTests, reviewApproved, setup, state } from "./fixtures.ts";

let repo: string;
let ctx: OpContext;
beforeEach(() => ({ repo, ctx } = setup()));

const start = (brief = "Add a widget") => runStart(ctx, { brief }).runId;
const ask = (run: string) => requestApproval(ctx, { runId: run, summary: "the design and the tests that will judge it" });
const grant = (run: string) => approve(loc(ctx, run), { actor: humanActor(), reason: null });
const advance = (run: string) => stageAdvance(ctx, { runId: run });
const gate = (run: string) => gateCheck(ctx, { runId: run }).gate;
const pre = (tool: ReturnType<typeof writeTool>) => handleHook(input({ event: "pre-tool", cwd: repo, tool }));
const reason = (d: HookDecision) => (d.kind === "deny" ? d.reason : "");

function toBuild(): string {
  const run = start();
  ask(run);
  grant(run);
  expect(advance(run)).toMatchObject({ advanced: true, stage: "build" });
  return run;
}

describe("the pin", () => {
  test("entering build pins the oracle the human approved, in the advance's own append", () => {
    const run = toBuild();
    const pinned = lastEvent(ctx, run);
    if (pinned.type !== "oracle.pinned") throw new Error(`expected oracle.pinned, got ${pinned.type}`);
    expect(pinned.data).toMatchObject({ stage: "build", manifest: ORACLE_MANIFEST, entries: ["tests/acceptance"], weak: false });
    expect(Object.keys(pinned.data.files)).toEqual([ORACLE_MANIFEST, ORACLE_TEST]);
    expect(state(ctx, run).approvals[0]?.oracle).toBe(pinned.data.digest);
    expect(state(ctx, run).oracle).toMatchObject({ stage: "build", digest: pinned.data.digest, seq: pinned.seq });
  });

  test("a spike run records no oracle", () => {
    const run = start("spike: is it possible to stream the export");
    expect(state(ctx, run).tier).toBe("spike");
    ask(run);
    const requested = lastEvent(ctx, run);
    expect(requested.type).toBe("approval.requested");
    expect(Object.hasOwn(requested.data, "oracle")).toBe(false);
  });
});

describe("editing the tests instead of the code", () => {
  test("a weakened frozen test that then runs green fails the gate", () => {
    const run = toBuild();
    // A shell write, which the file-tool guard never sees.
    writeFile(repo, ORACLE_TEST, "// test.skip: the assertion that kept failing\n");
    observeTests(ctx, run);
    const g = gate(run);
    expect(g.verdict).toBe("fail");
    // The run does not count, since it ran against an edited oracle, and the edit itself fails the gate.
    expect(g.gaps).toEqual([
      expect.objectContaining({ kind: "missing", requirement: "command:test" }),
      expect.objectContaining({ kind: "failed", who: "agent", requirement: "oracle" }),
    ]);
    expect(g.gaps[1]!.text).toContain(`${ORACLE_TEST} (changed)`);
    expect(advance(run)).toMatchObject({ advanced: false, stage: "build" });
  });

  test("putting the test back passes the gate again", () => {
    const run = toBuild();
    const approved = readFileSync(join(repo, ORACLE_TEST), "utf8");
    writeFile(repo, ORACLE_TEST, "// weakened\n");
    writeFile(repo, ORACLE_TEST, approved);
    observeTests(ctx, run);
    expect(gate(run).verdict).toBe("pass");
  });

  test("an added oracle file re-blocks a push that verify had allowed, and fresh evidence does not help", () => {
    const run = toBuild();
    observeTests(ctx, run);
    expect(advance(run)).toMatchObject({ advanced: true, stage: "verify" });
    observeTests(ctx, run);
    reviewApproved(ctx, run);
    bound(repo, run);
    expect(pre(bashTool("git push"))).toEqual(ALLOW);
    writeFile(repo, "tests/acceptance/extra.test.ts", "// a test nobody approved\n");
    observeTests(ctx, run);
    reviewApproved(ctx, run);
    const d = pre(bashTool("git push"));
    expect(d.kind).toBe("deny");
    expect(reason(d)).toContain("tests/acceptance/extra.test.ts (added)");
  });

  test("a pointer entry lets package.json change but pins the script the test role runs", () => {
    writeFile(repo, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
    writeFile(repo, ORACLE_MANIFEST, "tests/acceptance/\npackage.json#/scripts/test\n");
    const run = toBuild();
    bound(repo, run);
    expect(pre(writeTool("package.json"))).toEqual(ALLOW);
    writeFile(repo, "package.json", JSON.stringify({ scripts: { test: "bun test" }, dependencies: { zod: "^4" } }));
    observeTests(ctx, run);
    expect(gate(run).verdict).toBe("pass");
    writeFile(repo, "package.json", JSON.stringify({ scripts: { test: "true" } }));
    observeTests(ctx, run);
    expect(gate(run).gaps.find((g) => g.requirement === "oracle")?.text).toContain("package.json#/scripts/test (changed)");
  });
});

describe("the write guard", () => {
  test("the oracle is writable before build, whatever the scope, and refused from build on", () => {
    const run = start();
    bound(repo, run);
    expect(pre(writeTool("tests/acceptance/widget.test.ts"))).toEqual(ALLOW);
    expect(pre(writeTool(ORACLE_MANIFEST))).toEqual(ALLOW);
    expect(pre(writeTool("src/widget.ts")).kind).toBe("deny");
    ask(run);
    grant(run);
    advance(run);
    expect(reason(pre(writeTool(ORACLE_TEST)))).toBe(
      `AOS: ${ORACLE_TEST} is part of the oracle frozen when build began. Leave it unchanged. If it is wrong, stop and tell the human.`,
    );
    expect(lastEvent(ctx, run)).toMatchObject({ type: "action.blocked", data: { action: "oracle", tool: "Write" } });
    expect(pre(writeTool(ORACLE_MANIFEST)).kind).toBe("deny");
    expect(pre(writeTool("Tests/Acceptance/readme.test.ts")).kind).toBe("deny");
    expect(pre(writeTool("src/widget.ts"))).toEqual(ALLOW);
    expect(pre(writeTool("tests/unit/widget.test.ts"))).toEqual(ALLOW);
  });

  // Root reads any file, so the unreadable manifest this needs cannot exist for it.
  test.skipIf(process.getuid?.() === 0)("a manifest the guard cannot read leaves the stage's own write scope in force", () => {
    writeFile(repo, ORACLE_MANIFEST, "src/\n");
    const run = start();
    bound(repo, run);
    expect(pre(writeTool("src/widget.ts"))).toEqual(ALLOW);
    chmodSync(join(repo, ORACLE_MANIFEST), 0o000);
    try {
      expect(pre(writeTool("src/widget.ts")).kind).toBe("deny");
    } finally {
      chmodSync(join(repo, ORACLE_MANIFEST), 0o644);
    }
  });
});

describe("what counts as a test run once the oracle is frozen", () => {
  // Through the observer hook, which is where test evidence comes from.
  const ran = (command: string) =>
    handleHook(input({ event: "post-tool", cwd: repo, tool: bashTool(command), result: { exitCode: 0, output: "1 pass\n0 fail\n", raw: {} } }));

  test("a run narrowed by arguments does not count, and the role's command as listed does", () => {
    const run = toBuild();
    bound(repo, run);
    ran("bun test tests/unit/easy.test.ts");
    const narrowed = gate(run);
    expect(narrowed.verdict).toBe("pending");
    expect(narrowed.gaps).toEqual([expect.objectContaining({ kind: "missing", requirement: "command:test" })]);
    expect(narrowed.gaps[0]!.text).toContain("exactly as written with nothing added");
    ran("bun test");
    expect(gate(run).verdict).toBe("pass");
  });

  test("a run against an edited oracle file git ignores does not count once the edit is undone", () => {
    writeFile(repo, ".gitignore", "fixtures/\n");
    writeFile(repo, "fixtures/expected.json", '{"total": 3}\n');
    writeFile(repo, ORACLE_MANIFEST, "tests/acceptance/\nfixtures/expected.json\n");
    const run = toBuild();
    bound(repo, run);
    // Freshness cannot see this file, so only the digest stamped on the run tells the two runs apart.
    writeFile(repo, "fixtures/expected.json", '{"total": 2}\n');
    ran("bun test");
    writeFile(repo, "fixtures/expected.json", '{"total": 3}\n');
    const g = gate(run);
    expect(g.verdict).toBe("pending");
    expect(g.gaps.map((x) => x.requirement)).toEqual(["command:test"]);
    ran("bun test");
    expect(gate(run).verdict).toBe("pass");
  });
});

describe("approving the oracle", () => {
  test("an oracle changed after the request voids the approval until it is requested again", () => {
    const run = start();
    ask(run);
    writeFile(repo, ORACLE_TEST, "// swapped after the human looked\n");
    grant(run);
    const r = advance(run);
    expect(r.advanced).toBe(false);
    expect(r.gate.gaps).toEqual([expect.objectContaining({ requirement: "approval", who: "agent" })]);
    expect(r.gate.gaps[0]!.text).toContain("The oracle changed after approval was requested");
    ask(run);
    grant(run);
    expect(advance(run)).toMatchObject({ advanced: true, stage: "build" });
  });

  test("pointer entries alone are not an oracle: they pin how tests run, not what they check", () => {
    writeFile(repo, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
    writeFile(repo, ORACLE_MANIFEST, "package.json#/scripts/test\n");
    const run = start();
    ask(run);
    grant(run);
    expect(advance(run).gate.gaps.map((g) => g.requirement)).toEqual(["oracle:declared"]);
  });

  test("design cannot advance without an oracle", () => {
    rmSync(join(repo, ORACLE_MANIFEST));
    const run = start();
    ask(run);
    grant(run);
    const r = advance(run);
    expect(r.advanced).toBe(false);
    expect(r.gate.gaps.map((g) => g.requirement)).toEqual(["oracle:declared"]);
  });

  test("unusable manifest lines are reported before the freeze", () => {
    writeFile(repo, ORACLE_MANIFEST, "tests/acceptance/\n../outside\n");
    const run = start();
    ask(run);
    grant(run);
    const { gaps } = advance(run).gate;
    expect(gaps.map((g) => g.requirement)).toEqual(["oracle:manifest"]);
    expect(gaps[0]!.text).toContain("line 2:");
  });
});

describe("failing closed", () => {
  test("a run that reached build without a pin fails its gates", () => {
    const run = start();
    append(ctx, run, [{ type: "stage.entered", actor: humanActor(), data: { stage: "build", index: 1 } }]);
    observeTests(ctx, run);
    expect(gate(run).gaps).toEqual([expect.objectContaining({ kind: "failed", requirement: "oracle" })]);
  });

  test("a tree that was never given the oracle cannot pass a gate that reads it", () => {
    const run = start();
    ask(run);
    grant(run);
    const g = evaluateGate(state(ctx, run), "design", { fingerprint: "counter:0", weak: true });
    expect(g.verdict).toBe("fail");
    expect(g.gaps.map((x) => x.requirement)).toContain("oracle");
  });
});
