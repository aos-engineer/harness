import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONSEQUENTIAL, failsafeDecision, payloadFailsafe } from "../../src/hooks/failsafe.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { matchAction } from "../../src/shell/match.ts";
import { aosDir } from "../../src/store/paths.ts";
import { findBinding, sessionFileName } from "../../src/store/sessions.ts";
import type { HookEvent, HookInput, HookTool, RunLocation, TreeState } from "../../src/types.ts";
import { ulid } from "../../src/util/ulid.ts";
import { tmpDir, tmpGitRepo } from "../helpers.ts";
import { ALLOW, HOST, SESSION, append, at, bashTool, pack, bound, breakRun, input, linkTo, mcpTool, startRun, types, writeTool } from "./helpers.ts";

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

  test("with no .aos anywhere, the fallbacks only look: nothing is created and nothing fingerprints", () => {
    const [cwd, project, target] = [tmpDir(), tmpDir(), tmpDir()];
    try {
      const calls: Array<Partial<HookInput>> = [
        { event: "pre-tool", tool: writeTool(join(target, "x.ts")) },
        { event: "pre-tool", tool: bashTool(`git -C ${project} push`) },
        { event: "post-tool", tool: writeTool(join(target, "x.ts")) },
        { event: "stop", promptId: "P1" },
      ];
      for (const call of calls) expect(handleHook(input({ ...call, cwd }), { ...noTree, projectDir: project })).toEqual(ALLOW);
      for (const dir of [cwd, project, target]) expect(existsSync(join(dir, ".aos"))).toBe(false);
    } finally {
      for (const dir of [cwd, project, target]) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SessionStart names an active run this session is not bound to", () => {
    // A /clear or fork starts a new session id, which the run's binding does not cover.
    const d = handleHook(input({ event: "session-start", cwd: repo, source: "clear", session: "S2" }), noTree);
    expect(d).toEqual({
      kind: "allow",
      notice: `AOS: run ${run} (bounded, stage design) is active in ${repo}, but this session is not bound to it, so AOS gates do not apply to this session.`,
    });
  });

  test("SessionStart finds the active run through the project dir", () => {
    const outside = tmpDir();
    try {
      const d = handleHook(input({ event: "session-start", cwd: outside, source: "startup", session: "S2" }), { ...noTree, projectDir: repo });
      expect(d).toMatchObject({ kind: "allow", notice: expect.stringContaining(`run ${run} (bounded, stage design) is active in ${repo}`) });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("SessionStart lists every active run and skips finished or unreadable ones", () => {
    const second = startRun(repo, "spike");
    const done = startRun(repo, "bounded");
    append({ root: repo, run: done }, { type: "run.cancelled", actor: { kind: "human", id: "owner", agent: null }, data: { reason: "x" } });
    const broken = startRun(repo, "bounded");
    writeFileSync(join(aosDir(repo), "runs", broken, "state.json"), "{");
    const d = handleHook(input({ event: "session-start", cwd: repo, source: "fork", session: "S2" }), noTree);
    const [first, last] = [run, second].sort();
    expect(d.kind).toBe("allow");
    const text = d.kind === "allow" ? (d.notice ?? "") : "";
    expect(text).toStartWith(`AOS: runs ${first} (`);
    expect(text).toContain(` and ${last} (`);
    expect(text).toContain("are active in");
    expect(text).not.toContain(done);
    expect(text).not.toContain(broken);
  });

  test("other unbound events stay silent even with an active run around", () => {
    expect(handleHook(input({ event: "stop", cwd: repo, promptId: "P1", session: "S2" }), noTree)).toEqual(ALLOW);
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

  test("a run outside git, reached through a symlink, binds at its real path", () => {
    const plain = tmpDir();
    const { dir, path: logical } = linkTo(plain);
    try {
      const other = startRun(plain, "bounded");
      handleHook(runStartPost(shapes["a content array"]!(other), logical));
      expect(findBinding(logical, HOST, SESSION)?.root).toBe(plain);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(plain, { recursive: true, force: true });
    }
  });

  test("a run id with no run behind it binds nothing and says why", () => {
    const missing = ulid();
    const d = handleHook(runStartPost(shapes["a content array"]!(missing)));
    expect(d).toEqual({
      kind: "allow",
      notice: `AOS: could not bind this session to run ${missing}: there is no .aos/runs/${missing} under ${repo}. AOS gates do not apply to this session. The aos MCP server may be running from a different directory than this session.`,
    });
    expect(existsSync(join(aosDir(repo), "sessions"))).toBe(false);
  });

  test("bind looks under the project dir when the session's cwd has left the repo", () => {
    const outside = tmpDir();
    try {
      const d = handleHook(runStartPost(shapes["a content array"]!(run), outside), { projectDir: repo });
      expect(d).toMatchObject({ kind: "allow", notice: expect.stringContaining("bound to run") });
      expect(findBinding(repo, HOST, SESSION)?.run).toBe(run);
      expect(existsSync(join(outside, ".aos"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("the not-bound notice names every root it looked under", () => {
    const outside = tmpDir();
    try {
      const missing = ulid();
      const d = handleHook(runStartPost(shapes["a content array"]!(missing), outside), { projectDir: repo });
      expect(d).toMatchObject({ notice: expect.stringContaining(`under ${outside} or ${repo}.`) });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a run that is no longer active does not take over the session", () => {
    const active = startRun(repo, "bounded");
    bound(repo, active);
    append(loc, { type: "run.cancelled", actor: { kind: "human", id: "owner", agent: null }, data: { reason: "stuck" } });
    // Rebinding to the cancelled run would switch enforcement off for the session.
    expect(handleHook(runStartPost(shapes["a content array"]!(run)))).toEqual(ALLOW);
    expect(findBinding(repo, HOST, SESSION)?.run).toBe(active);
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

describe("binding lookup fallbacks", () => {
  let outside: string;
  beforeEach(() => {
    outside = tmpDir();
    bound(repo, run);
  });
  afterEach(() => rmSync(outside, { recursive: true, force: true }));

  test("the project dir finds the binding after the shell leaves the repo", () => {
    at(loc, "verify");
    const push = input({ event: "pre-tool", cwd: outside, tool: bashTool(`git -C ${repo} push`) });
    expect(handleHook(push, { projectDir: repo })).toMatchObject({ kind: "deny", reason: expect.stringContaining("push blocked") });
  });

  test("an absolute write into the repo finds the binding from its target", () => {
    expect(handleHook(input({ event: "pre-tool", cwd: outside, tool: writeTool(join(repo, "src/x.ts")) })).kind).toBe("deny");
    at(loc, "build");
    const aos = handleHook(input({ event: "pre-tool", cwd: outside, tool: writeTool(join(repo, `.aos/runs/${run}/log.jsonl`)) }));
    expect(aos).toMatchObject({ kind: "deny", reason: expect.stringContaining(".aos/ is kernel-owned") });
  });

  test("a write through a symlink to a deep directory finds the binding from its real target", () => {
    mkdirSync(join(repo, "src"));
    const { dir, path: link } = linkTo(join(repo, "src"));
    try {
      expect(handleHook(input({ event: "pre-tool", cwd: outside, tool: writeTool(join(link, "x.ts")) })).kind).toBe("deny");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the cwd's binding wins over the project dir's", () => {
    const other = tmpGitRepo();
    try {
      at(loc, "build"); // writes anywhere here
      bound(other, startRun(other, "bounded")); // design: src/ writes denied there
      const d = handleHook(input({ event: "pre-tool", cwd: repo, tool: writeTool("src/x.ts") }), { projectDir: other });
      expect(d).toEqual(ALLOW);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("an unreadable binding found through the project dir is logged there", () => {
    writeFileSync(join(aosDir(repo), "sessions", sessionFileName(HOST, SESSION)), "{");
    const d = handleHook(input({ event: "pre-tool", cwd: outside, tool: bashTool("git push") }), { projectDir: repo });
    expect(d.kind).toBe("deny");
    expect(readFileSync(join(repo, ".aos/hook-errors.log"), "utf8")).toContain("unreadable session binding");
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

describe("payloadFailsafe", () => {
  const err = new Error("hook payload has no session_id");
  const site = (cwd: string | null, projectDir: string | null, command: string | null = "git push") => ({ cwd, projectDir, command });

  test("denies a consequential command when .aos exists at or above the raw cwd", () => {
    const sub = join(repo, "src", "deep");
    mkdirSync(sub, { recursive: true });
    expect(payloadFailsafe("pre-tool", site(sub, null), err)).toMatchObject({ kind: "deny", reason: expect.stringContaining("aos doctor") });
  });

  test("denies when only the project dir has .aos", () => {
    const outside = tmpDir();
    try {
      expect(payloadFailsafe("pre-tool", site(outside, repo), err).kind).toBe("deny");
      expect(payloadFailsafe("pre-tool", site(null, repo), err).kind).toBe("deny");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("passes through where AOS has no state", () => {
    const fresh = tmpGitRepo();
    try {
      expect(payloadFailsafe("pre-tool", site(fresh, fresh), err)).toEqual(ALLOW);
      expect(payloadFailsafe("pre-tool", site(null, null), err)).toEqual(ALLOW);
      expect(existsSync(join(fresh, ".aos"))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("logs the failure in the .aos directory it found, and nowhere when there is none", () => {
    payloadFailsafe("pre-tool", site(join(repo, "src"), null, "ls"), err);
    expect(readFileSync(join(repo, ".aos/hook-errors.log"), "utf8")).toMatch(/ pre-tool Error: hook payload has no session_id\n$/);
    const fresh = tmpDir();
    try {
      payloadFailsafe("pre-tool", site(fresh, fresh), err);
      expect(existsSync(join(fresh, ".aos"))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("still fails open for harmless commands and other events", () => {
    expect(payloadFailsafe("pre-tool", site(repo, null, "ls"), err)).toEqual(ALLOW);
    expect(payloadFailsafe("pre-tool", site(repo, null, null), err)).toEqual(ALLOW);
    expect(payloadFailsafe("stop", site(repo, null), err)).toEqual(ALLOW);
  });
});

describe("failsafeDecision", () => {
  const err = new Error("state.json is unreadable");
  const denied = [
    "git push", "git -C repo push origin main", "cd x && git push", "gh pr create --fill", "vercel deploy --prod", "bun run deploy",
    // The spellings the shell layer also resolves: gh's other PR routes, an expanded command word, an alias
    "gh pr new", "gh api repos/o/r/pulls -f title=x", "G=git; $G push", "git -c alias.p=push p", "bash <<'EOF'\ngit push\nEOF",
  ];
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

  test("every deploy command the reference pack knows fails closed", () => {
    const deploys = [
      "vercel deploy --prod", "netlify deploy", "flyctl deploy", "fly deploy",
      "kubectl apply -f k8s.yaml", "kubectl rollout restart deployment/web", "terraform apply -auto-approve",
      "helm install web ./chart", "helm upgrade web ./chart", "gh workflow run release.yml",
      "python3 scripts/dokploy.py redeploy web", "dokploy upsert-compose web", "bun dokploy-cli.ts compose.stop web",
      "uv run dokploy compose.redeploy web",
    ];
    for (const cmd of deploys) {
      // Each example is one the pack itself treats as a deploy, so the two lists cannot drift apart unseen.
      expect(matchAction(cmd, pack().actions)).toBe("deploy");
      expect(failsafeDecision("pre-tool", cmd, err).kind).toBe("deny");
    }
  });

  test("the patterns stay raw-text checks that a quoted mention can trip", () => {
    expect(CONSEQUENTIAL.some((re) => re.test('git commit -m "push"'))).toBe(true);
  });
});
