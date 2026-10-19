import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { handleHook } from "../../src/hooks/handle.ts";
import type { HookDecision, HookInput, HookTool, RunLocation } from "../../src/types.ts";
import { sha256Tag } from "../../src/util/hash.ts";
import { tmpDir, tmpGitRepo, writeFile } from "../helpers.ts";
import {
  ALLOW, at, bashTool, bound, complete, events, fp, input, lastEvent, lastEvidence, mcpTool, skillTool, startRun, state, writeTool,
} from "./helpers.ts";

const MASKED = "AOS: this test run's exit status was hidden by a pipe or chain, so it does not count as evidence. Re-run the test command on its own.";
const NO_EXIT_CODE =
  "AOS: this test run produced no exit code (it was backgrounded, interrupted, or timed out), so it does not count. Run the test command in the foreground on its own.";

let repo: string;
let loc: RunLocation;

beforeEach(() => {
  repo = tmpGitRepo();
  const run = startRun(repo, "bounded");
  loc = { root: repo, run };
  bound(repo, run);
  at(loc, "build");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

type Call = Pick<HookInput, "tool" | "result">;

const bashOk = (command: string, output = "1 pass\n0 fail\n"): Call => ({ tool: bashTool(command), result: { exitCode: 0, output, raw: {} } });
const bashNoCode = (command: string): Call => ({ tool: bashTool(command), result: { exitCode: null, output: "", raw: {} } });
const bashFail = (command: string, code: number | null): Call => ({ tool: bashTool(command), result: { exitCode: code, output: `Exit code ${code}\n0 pass\n1 fail`, raw: "" } });
const toolOnly = (tool: HookTool): Call => ({ tool, result: { exitCode: null, output: "", raw: {} } });

const post = (c: Call, extra: Partial<HookInput> = {}): HookDecision => handleHook(input({ event: "post-tool", cwd: repo, ...c, ...extra }));
const postFail = (c: Call): HookDecision => handleHook(input({ event: "post-tool-failure", cwd: repo, ...c }));
const count = () => events(loc).length;

describe("test runs", () => {
  test("bun test success records observed exit 0 at the current tree", () => {
    const output = "1 pass\n0 fail\n";
    expect(post(bashOk("bun test", output))).toEqual(ALLOW);
    expect(lastEvidence(loc)).toMatchObject({
      kind: "command", role: "test", command: "bun test", exitCode: 0, masked: false, provenance: "observed",
      fingerprint: fp(loc), changes: 0, stage: "build", agent: null, outputSha256: sha256Tag(output), tail: output,
    });
    expect(lastEvent(loc).actor).toEqual({ kind: "hook", id: "claude-code:post-tool", agent: null });
  });

  test("a failure records the parsed exit code", () => {
    expect(postFail(bashFail("bun test", 1))).toEqual(ALLOW);
    expect(lastEvidence(loc)).toMatchObject({ kind: "command", exitCode: 1, masked: false, provenance: "observed" });
  });

  test("a piped test run is masked and the agent is told at once", () => {
    expect(post(bashOk("bun test 2>&1 | tail -5"))).toEqual({ kind: "allow", notice: MASKED });
    expect(lastEvidence(loc)).toMatchObject({ kind: "command", masked: true, exitCode: null });
  });

  test("a chained or ||-guarded test run is masked even when it fails", () => {
    expect(post(bashOk("bun test || true"))).toEqual({ kind: "allow", notice: MASKED });
    expect(postFail(bashFail("bun test; false", 1))).toEqual({ kind: "allow", notice: MASKED });
    expect(lastEvidence(loc)).toMatchObject({ masked: true, exitCode: null });
  });

  test("an unmasked run with no exit code records nothing and says why", () => {
    const n = count();
    expect(post(bashNoCode("bun test"))).toEqual({ kind: "allow", notice: NO_EXIT_CODE });
    // An interrupted failure also arrives with no code.
    expect(postFail(bashFail("bun test", null))).toEqual({ kind: "allow", notice: NO_EXIT_CODE });
    expect(count()).toBe(n);
  });

  test("a masked run with no exit code is still recorded as masked", () => {
    expect(post(bashNoCode("bun test | tee out.txt"))).toEqual({ kind: "allow", notice: MASKED });
    expect(lastEvidence(loc)).toMatchObject({ masked: true, exitCode: null });
  });

  test("non-role commands record nothing", () => {
    const n = count();
    expect(post(bashOk("ls"))).toEqual(ALLOW);
    expect(postFail(bashFail("make lint", 2))).toEqual(ALLOW);
    expect(count()).toBe(n);
  });

  test("secrets in the command are redacted", () => {
    post(bashOk("API_KEY=sk-abcdefghijklmnop1234 bun test"));
    const ev = lastEvidence(loc);
    expect(ev.kind === "command" && ev.command).not.toContain("sk-abc");
  });

  test("secrets in the output stay out of the tail, and the digest covers the raw output", () => {
    const output = "token=ghp_abcdefghijklmnopqrstuvwxyz0123\n1 pass\n";
    post(bashOk("bun test", output));
    const ev = lastEvidence(loc);
    expect(ev.kind === "command" && ev.tail).not.toContain("ghp_");
    expect(ev.kind === "command" && ev.outputSha256).toBe(sha256Tag(output));
  });

  test("evidence names the subagent that ran it", () => {
    post(bashOk("bun test"), { agent: "agent-7" });
    expect(lastEvidence(loc).agent).toBe("agent-7");
    expect(lastEvent(loc).actor).toEqual({ kind: "hook", id: "claude-code:post-tool", agent: "agent-7" });
  });

  test("observation runs on completed runs, so a later test run can block and re-open a push", () => {
    complete(loc);
    const push = () => handleHook(input({ event: "pre-tool", cwd: repo, tool: bashTool("git push") })).kind;
    expect(push()).toBe("allow");
    postFail(bashFail("bun test", 1));
    expect(push()).toBe("deny");
    post(bashOk("bun test"));
    expect(push()).toBe("allow");
  });
});

describe("file writes", () => {
  test("writes count as worktree changes", () => {
    expect(post(toolOnly(writeTool("src/a.ts")))).toEqual(ALLOW);
    expect(state(loc).changes).toBe(1);
    expect(lastEvent(loc)).toMatchObject({ type: "worktree.changed", data: { path: "src/a.ts", tool: "Write" } });
    post(toolOnly(writeTool("src/b.ts", "Edit")));
    expect(state(loc).changes).toBe(2);
  });

  test("writes outside the root are not counted", () => {
    const outside = tmpDir();
    try {
      post(toolOnly(writeTool(`${outside}/x.md`)));
      expect(state(loc).changes).toBe(0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a failed write is not a change", () => {
    postFail(toolOnly(writeTool("src/a.ts")));
    expect(state(loc).changes).toBe(0);
  });

  test("a counted change does not alter the fingerprint until the file itself changes", () => {
    const before = fp(loc);
    post(toolOnly(writeTool("src/a.ts")));
    expect(fp(loc)).toBe(before);
    writeFile(repo, "src/a.ts", "x");
    expect(fp(loc)).not.toBe(before);
  });
});

describe("skills and other tools", () => {
  test("skill invocations are observed evidence", () => {
    expect(post(toolOnly(skillTool("superpowers:test-driven-development")))).toEqual(ALLOW);
    expect(lastEvidence(loc)).toMatchObject({
      kind: "skill", skill: "superpowers:test-driven-development", provenance: "observed", fingerprint: fp(loc), stage: "build",
    });
  });

  test("a skill call with no name records nothing", () => {
    const n = count();
    post(toolOnly({ ...skillTool("x"), skill: null }));
    expect(count()).toBe(n);
  });

  test("other tools record nothing", () => {
    const n = count();
    post(toolOnly(mcpTool("aos_status")));
    post(toolOnly({ name: "Read", kind: "other", input: {}, command: null, path: `${repo}/src/a.ts`, skill: null, aosTool: null }));
    expect(count()).toBe(n);
  });
});
