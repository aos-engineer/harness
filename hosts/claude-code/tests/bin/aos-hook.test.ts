// Runs the real hook entry point as Claude Code does: a child process, the payload on stdin, the event as
// its argument, and JSON (or nothing) on stdout.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { at, bound, startRun, state } from "../../../../kernel/tests/hooks/helpers.ts";
import { tmpDir, tmpGitRepo } from "../../../../kernel/tests/helpers.ts";
import { payload, runStartPayload } from "./support.ts";

const BIN = join(import.meta.dir, "../../bin/aos-hook.ts");

function runHook(event: string, stdin: string, env: Record<string, string> = {}): { stdout: string; code: number | null } {
  // The test runner may itself run under Claude Code, whose own project dir must not leak into the child.
  const base = { ...process.env };
  delete base.AOS_HOOK_CAPTURE_DIR;
  delete base.CLAUDE_PROJECT_DIR;
  const r = Bun.spawnSync([process.execPath, BIN, event], { stdin: Buffer.from(stdin), stdout: "pipe", stderr: "pipe", env: { ...base, ...env } });
  return { stdout: r.stdout.toString(), code: r.exitCode };
}

const json = (stdout: string) => JSON.parse(stdout) as Record<string, any>;

let repo: string;
beforeEach(() => {
  repo = tmpGitRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function bindRun(): string {
  const run = startRun(repo, "bounded");
  bound(repo, run);
  return run;
}

describe("pass-through", () => {
  test("unbound session: empty stdout, exit 0", () => {
    expect(runHook("pre-tool-use", JSON.stringify(payload("pre-tool-use-write", repo)))).toEqual({ stdout: "", code: 0 });
    expect(existsSync(join(repo, ".aos"))).toBe(false);
  });

  test("an unknown event writes nothing and exits 0, even for a push", () => {
    bindRun();
    const push = payload("pre-tool-use-bash-true", repo, { command: "git push" });
    expect(runHook("constructor", JSON.stringify(push))).toEqual({ stdout: "", code: 0 });
    expect(runHook("", JSON.stringify(push))).toEqual({ stdout: "", code: 0 });
  });
});

describe("bound sessions", () => {
  test("bound design stage: Write outside docs/specs is denied", () => {
    bindRun();
    const r = runHook("pre-tool-use", JSON.stringify(payload("pre-tool-use-write", repo, { file: "src/x.ts" })));
    expect(r.code).toBe(0);
    const out = json(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("docs/specs/");
  });

  test("an allowed Write prints nothing, so the user's own permission prompt still applies", () => {
    bindRun();
    expect(runHook("pre-tool-use", JSON.stringify(payload("pre-tool-use-write", repo, { file: "docs/specs/x.md" })))).toEqual({ stdout: "", code: 0 });
  });

  test("aos_run_start binds the session and tells the model", () => {
    const run = startRun(repo, "bounded");
    const response = [{ type: "text", text: JSON.stringify({ runId: run, tier: "bounded" }) }];
    const r = runHook("post-tool-use", JSON.stringify(runStartPayload(repo, response)));
    expect(json(r.stdout).hookSpecificOutput).toEqual({
      hookEventName: "PostToolUse",
      additionalContext: `AOS: this session is bound to run ${run} (bounded). Gates apply from now on.`,
    });
  });

  test("CLAUDE_PROJECT_DIR finds the binding after the shell leaves the repo", () => {
    const run = bindRun();
    at({ root: repo, run }, "verify");
    const outside = tmpDir();
    try {
      const push = payload("pre-tool-use-bash-true", repo, { command: `git -C ${repo} push`, top: { cwd: outside } });
      expect(runHook("pre-tool-use", JSON.stringify(push))).toEqual({ stdout: "", code: 0 });
      const out = json(runHook("pre-tool-use", JSON.stringify(push), { CLAUDE_PROJECT_DIR: repo }).stdout).hookSpecificOutput;
      expect(out.permissionDecision).toBe("deny");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a failed test run is recorded from PostToolUseFailure", () => {
    const run = bindRun();
    at({ root: repo, run }, "build");
    expect(runHook("post-tool-use-failure", JSON.stringify(payload("post-tool-use-failure-bash-test-fail", repo)))).toEqual({ stdout: "", code: 0 });
    const ev = state({ root: repo, run }).evidence.at(-1);
    expect(ev).toMatchObject({ kind: "command", role: "test", exitCode: 1, provenance: "observed" });
  });

  test("a masked failing test run reaches the model next to the tool result", () => {
    const run = bindRun();
    at({ root: repo, run }, "build");
    const r = runHook("post-tool-use-failure", JSON.stringify(payload("post-tool-use-failure-bash-test-fail", repo, { command: "bun test | tail -5" })));
    const out = json(r.stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe("PostToolUseFailure");
    expect(out.additionalContext).toContain("hidden by a pipe");
  });

  test("Stop blocks with the open gaps", () => {
    const run = bindRun();
    at({ root: repo, run }, "build");
    const out = json(runHook("stop", JSON.stringify(payload("stop", repo))).stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain('No observed "test" run');
  });

  test("SessionStart after compaction re-injects the run", () => {
    const run = bindRun();
    const out = json(runHook("session-start", JSON.stringify(payload("session-start-compact", repo))).stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toContain(`Run id: ${run}`);
  });
});

describe("malformed payloads", () => {
  // Missing session_id: normalize rejects it, so only the raw cwd, the project dir, and the command are known.
  const malformedPush = (cwd?: string) => JSON.stringify({ ...(cwd === undefined ? {} : { cwd }), tool_input: { command: "git push" } });

  test("a malformed payload with git push fails closed where AOS has state", () => {
    startRun(repo, "bounded");
    const r = runHook("pre-tool-use", malformedPush(join(repo, "src")));
    expect(r.code).toBe(0);
    const out = json(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("aos doctor");
  });

  test("a malformed push is denied when only the project dir has AOS state", () => {
    startRun(repo, "bounded");
    const out = json(runHook("pre-tool-use", malformedPush(), { CLAUDE_PROJECT_DIR: repo }).stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
  });

  test("a malformed push passes through in a repo AOS never touched", () => {
    expect(runHook("pre-tool-use", malformedPush(repo), { CLAUDE_PROJECT_DIR: repo })).toEqual({ stdout: "", code: 0 });
    expect(runHook("pre-tool-use", malformedPush())).toEqual({ stdout: "", code: 0 });
    expect(existsSync(join(repo, ".aos"))).toBe(false);
  });

  test("a malformed payload otherwise passes through", () => {
    expect(runHook("pre-tool-use", "not json")).toEqual({ stdout: "", code: 0 });
    expect(runHook("pre-tool-use", '{"tool_input":{"command":"ls"}}')).toEqual({ stdout: "", code: 0 });
    expect(runHook("stop", '{"tool_input":{"command":"git push"}}')).toEqual({ stdout: "", code: 0 });
  });

  test("an empty stdin passes through", () => {
    expect(runHook("pre-tool-use", "")).toEqual({ stdout: "", code: 0 });
  });
});

describe("capture", () => {
  test("AOS_HOOK_CAPTURE_DIR receives the raw payload", () => {
    const dir = join(tmpDir(), "captures");
    try {
      const raw = JSON.stringify(payload("pre-tool-use-write", repo));
      expect(runHook("pre-tool-use", raw, { AOS_HOOK_CAPTURE_DIR: dir })).toEqual({ stdout: "", code: 0 });
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/pre-tool-use/);
      expect(readFileSync(join(dir, files[0]!), "utf8")).toBe(raw);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  });
});
