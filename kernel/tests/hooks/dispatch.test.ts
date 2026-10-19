import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONSEQUENTIAL, failsafeDecision } from "../../src/hooks/failsafe.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { aosDir } from "../../src/store/paths.ts";
import { findBinding, sessionFileName } from "../../src/store/sessions.ts";
import type { HookEvent, HookInput, HookTool, RunLocation, TreeState } from "../../src/types.ts";
import { ulid } from "../../src/util/ulid.ts";
import { tmpDir, tmpGitRepo } from "../helpers.ts";
import { ALLOW, HOST, SESSION, append, bashTool, bound, breakRun, input, mcpTool, startRun, types, writeTool } from "./helpers.ts";

let repo: string;
let run: string;
let loc: RunLocation;

beforeEach(() => {
  repo = tmpGitRepo();
  run = startRun(repo, "bounded");
  loc = { root: repo, run };
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const pre = (tool: HookTool, cwd = repo) => handleHook(input({ event: "pre-tool", cwd, tool }));

// A tree function that fails the test if anything computes a fingerprint.
const noTree = { tree: (): TreeState => { throw new Error("the unbound path must not fingerprint the tree"); } };

describe("unbound sessions", () => {
  test("every event passes through and no .aos directory appears", () => {
    const fresh = tmpGitRepo();
    try {
      const calls: Array<Partial<HookInput>> = [
        { event: "pre-tool", tool: bashTool("git push") },
        { event: "pre-tool", tool: writeTool("src/x.ts") },
        { event: "post-tool", tool: bashTool("bun test"), result: { exitCode: 0, output: "", raw: {} } },
        { event: "post-tool", tool: writeTool("src/x.ts") },
        { event: "post-tool-failure", tool: bashTool("bun test"), result: { exitCode: 1, output: "", raw: "Exit code 1" } },
        { event: "session-start", source: "startup" },
        { event: "stop", promptId: "P1" },
      ];
      for (const call of calls) expect(handleHook(input({ ...call, cwd: fresh }), noTree)).toEqual(ALLOW);
      expect(existsSync(join(fresh, ".aos"))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("a session bound in another repo is not bound here", () => {
    bound(repo, run);
    const other = tmpGitRepo();
    try {
      expect(handleHook(input({ event: "pre-tool", cwd: other, tool: bashTool("git push") }), noTree)).toEqual(ALLOW);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("binding on aos_run_start", () => {
  // The MCP tool_response shape in PostToolUse is undocumented, so binding must find the run id at any nesting.
  const shapes: Record<string, (id: string) => unknown> = {
    "a content array": (id) => [{ type: "text", text: JSON.stringify({ runId: id, tier: "bounded" }) }],
    "a result object with pretty-printed text": (id) => ({ content: [{ type: "text", text: JSON.stringify({ runId: id, tier: "bounded" }, null, 2) }] }),
    "structured content": (id) => ({ content: [], structuredContent: { runId: id, tier: "bounded" } }),
    "a plain string": (id) => JSON.stringify({ runId: id }),
  };
  const runStartPost = (raw: unknown, cwd = repo) =>
    input({ event: "post-tool", cwd, tool: mcpTool("aos_run_start"), result: { exitCode: null, output: "", raw } });

  for (const [name, shape] of Object.entries(shapes)) {
    test(`binds the session from ${name}`, () => {
      const d = handleHook(runStartPost(shape(run)));
      expect(d).toEqual({ kind: "allow", notice: `AOS: this session is bound to run ${run} (bounded). Gates apply from now on.` });
      expect(findBinding(repo, HOST, SESSION)?.run).toBe(run);
      expect(types(loc)).toContain("session.bound");
    });
  }

  test("binds at the repository root when the session is in a subdirectory", () => {
    const sub = join(repo, "src");
    mkdirSync(sub);
    handleHook(runStartPost(shapes["a content array"]!(run), sub));
    expect(findBinding(repo, HOST, SESSION)?.root).toBe(repo);
  });

  test("a run id with no run behind it binds nothing", () => {
    expect(handleHook(runStartPost(shapes["a content array"]!(ulid())))).toEqual(ALLOW);
    expect(existsSync(join(aosDir(repo), "sessions"))).toBe(false);
  });

  test("a response with no run id binds nothing", () => {
    expect(handleHook(runStartPost([{ type: "text", text: "Error: a run is already active" }]))).toEqual(ALLOW);
    expect(findBinding(repo, HOST, SESSION)).toBeNull();
  });

  test("other aos tools do not bind", () => {
    const d = handleHook(input({ event: "post-tool", cwd: repo, tool: mcpTool("aos_status"), result: { exitCode: null, output: "", raw: { runId: run } } }));
    expect(d).toEqual(ALLOW);
    expect(findBinding(repo, HOST, SESSION)).toBeNull();
  });
});

describe("bound sessions", () => {
  test("the binding is found from a subdirectory cwd", () => {
    bound(repo, run);
    breakRun(loc);
    const sub = join(repo, "src", "deep");
    mkdirSync(sub, { recursive: true });
    // Unbound, a push would pass through; denied, the walk up found the binding.
    expect(pre(bashTool("git push"), sub).kind).toBe("deny");
  });

  test("a cancelled run passes everything through", () => {
    bound(repo, run);
    append(loc, { type: "run.cancelled", actor: { kind: "human", id: "owner", agent: null }, data: { reason: "stuck" } });
    expect(pre(bashTool("git push"))).toEqual(ALLOW);
    expect(pre(writeTool(".aos/runs/x/log.jsonl"))).toEqual(ALLOW);
  });
});

describe("failing safe", () => {
  test("corrupt state + git push fails closed", () => {
    bound(repo, run);
    breakRun(loc);
    expect(pre(bashTool("git push origin main"))).toMatchObject({ kind: "deny", reason: expect.stringContaining("AOS error, run `aos doctor`") });
  });

  test("corrupt state + ls fails open", () => {
    bound(repo, run);
    breakRun(loc);
    expect(pre(bashTool("ls"))).toEqual(ALLOW);
  });

  test("corrupt state + Write fails open", () => {
    bound(repo, run);
    breakRun(loc);
    expect(pre(writeTool("src/x.ts"))).toEqual(ALLOW);
  });

  test("corrupt state fails open on every other event", () => {
    bound(repo, run);
    breakRun(loc);
    const calls: Array<Partial<HookInput>> = [
      { event: "post-tool", tool: bashTool("git push"), result: { exitCode: 0, output: "", raw: {} } },
      { event: "session-start", source: "compact" },
      { event: "stop", promptId: "P1" },
    ];
    for (const call of calls) expect(handleHook(input({ ...call, cwd: repo }))).toEqual(ALLOW);
  });

  test("an unreadable binding fails closed on push and open otherwise", () => {
    bound(repo, run);
    writeFileSync(join(aosDir(repo), "sessions", sessionFileName(HOST, SESSION)), "{");
    expect(pre(bashTool("git push")).kind).toBe("deny");
    expect(pre(bashTool("ls"))).toEqual(ALLOW);
  });

  test("errors are appended to .aos/hook-errors.log with their cause", () => {
    bound(repo, run);
    breakRun(loc);
    pre(bashTool("ls"));
    const log = readFileSync(join(repo, ".aos/hook-errors.log"), "utf8");
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T\S+Z pre-tool \S/);
    expect(log.endsWith("\n")).toBe(true);
    expect(log.trim().split("\n")).toHaveLength(1);
  });

  test("an unreadable binding is logged in the .aos directory that holds it", () => {
    bound(repo, run);
    writeFileSync(join(aosDir(repo), "sessions", sessionFileName(HOST, SESSION)), "{");
    const sub = join(repo, "src");
    mkdirSync(sub);
    pre(bashTool("ls"), sub);
    expect(readFileSync(join(repo, ".aos/hook-errors.log"), "utf8")).toContain("unreadable session binding");
    expect(existsSync(join(sub, ".aos"))).toBe(false);
  });

  test("a hook error outside any .aos directory is not logged anywhere", () => {
    const dir = tmpDir();
    try {
      const odd = input({ event: "pre-tool", cwd: dir, tool: bashTool("git push") });
      // A session id the store cannot turn into a file name would be a store bug; simulate any throw.
      const d = handleHook({ ...odd, get session(): string { throw new Error("boom"); } });
      expect(d.kind).toBe("deny");
      expect(existsSync(join(dir, ".aos"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("failsafeDecision", () => {
  const err = new Error("state.json is unreadable");
  const denied = ["git push", "git -C repo push origin main", "cd x && git push", "gh pr create --fill", "vercel deploy --prod", "bun run deploy"];
  const allowed = ["ls", "git status", "gh pr view", "bun test"];

  test("denies consequential commands on pre-tool with the doctor hint", () => {
    for (const cmd of denied) {
      expect(failsafeDecision("pre-tool", cmd, err)).toEqual({ kind: "deny", reason: "AOS error, run `aos doctor`: state.json is unreadable" });
    }
  });

  test("allows everything else, and every event other than pre-tool", () => {
    for (const cmd of allowed) expect(failsafeDecision("pre-tool", cmd, err)).toEqual(ALLOW);
    expect(failsafeDecision("pre-tool", null, err)).toEqual(ALLOW);
    const others: HookEvent[] = ["post-tool", "post-tool-failure", "session-start", "stop"];
    for (const ev of others) expect(failsafeDecision(ev, "git push", err)).toEqual(ALLOW);
  });

  test("a non-Error throw still produces a one-line reason", () => {
    expect(failsafeDecision("pre-tool", "git push", "line one\nline two")).toEqual({ kind: "deny", reason: "AOS error, run `aos doctor`: line one line two" });
  });

  test("the consequential patterns are the documented three", () => {
    expect(CONSEQUENTIAL.map(String)).toEqual([String(/\bgit\b[^;&|]*\bpush\b/), String(/\bgh\s+pr\s+create\b/), String(/\bdeploy\b/)]);
  });
});
