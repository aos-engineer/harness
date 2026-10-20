import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleHook, type HookDeps } from "../../src/hooks/handle.ts";
import type { HookDecision, HookTool, RunLocation, TreeState } from "../../src/types.ts";
import { tmpDir, tmpGitRepo, writeFile } from "../helpers.ts";
import { ALLOW, at, bashTool, bound, complete, events, input, lastEvent, linkTo, pass, startRun, writeTool } from "./helpers.ts";

const AOS_DIR = "AOS: .aos/ is kernel-owned. Read run state with the aos_status tool.";

let repo: string;
let loc: RunLocation;

beforeEach(() => {
  repo = tmpGitRepo();
  const run = startRun(repo, "bounded");
  loc = { root: repo, run };
  bound(repo, run);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const pre = (tool: HookTool, cwd = repo, deps?: HookDeps) => handleHook(input({ event: "pre-tool", cwd, tool }), deps);

function denied(d: HookDecision): string {
  expect(d.kind).toBe("deny");
  return d.kind === "deny" ? d.reason : "";
}

function spike(): void {
  const run = startRun(repo, "spike");
  loc = { root: repo, run };
  bound(repo, run);
}

describe("file writes", () => {
  test("design blocks src writes and allows docs/specs", () => {
    expect(denied(pre(writeTool("src/x.ts")))).toBe('AOS: stage "design" allows writes only under docs/specs/. Pass its gate with aos_stage_advance first.');
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "write", tool: "Write" } });
    expect(pre(writeTool("docs/specs/x.md"))).toEqual(ALLOW);
  });

  test("Edit and NotebookEdit get the same scope check", () => {
    expect(pre(writeTool("src/x.ts", "Edit")).kind).toBe("deny");
    expect(pre(writeTool("nb/x.ipynb", "NotebookEdit")).kind).toBe("deny");
  });

  test("a write from a subdirectory is checked against the run root", () => {
    const sub = join(repo, "docs");
    mkdirSync(sub);
    expect(pre(writeTool("specs/x.md"), sub)).toEqual(ALLOW);
    expect(pre(writeTool("notes.md"), sub).kind).toBe("deny");
  });

  test("a stage forged into state.json does not widen the write scope", () => {
    const path = join(repo, ".aos", "runs", loc.run, "state.json");
    const file = JSON.parse(readFileSync(path, "utf8")) as { state: { current: { stage: string; index: number } } };
    file.state.current = { ...file.state.current, stage: "build", index: 1 };
    writeFileSync(path, JSON.stringify(file));
    expect(pre(writeTool("src/x.ts")).kind).toBe("deny");
  });

  test("writes under .aos are denied in every stage", () => {
    for (const s of ["design", "build", "verify"]) {
      at(loc, s);
      expect(denied(pre(writeTool(".aos/runs/x/log.jsonl")))).toBe(AOS_DIR);
      expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "aos-dir" } });
    }
  });

  test("a differently cased .aos is denied too, since macOS folds case by default", () => {
    at(loc, "build");
    expect(denied(pre(writeTool(".AOS/runs/x/state.json")))).toBe(AOS_DIR);
    expect(denied(pre(writeTool(".ao\u017f/runs/x/state.json")))).toBe(AOS_DIR);
  });

  test("a path that only starts with .aos is an ordinary file", () => {
    at(loc, "build");
    expect(pre(writeTool(".aosrc"))).toEqual(ALLOW);
  });

  test("writes outside the root are allowed", () => {
    const outside = tmpDir();
    try {
      expect(pre(writeTool(join(outside, "scratch.md")))).toEqual(ALLOW);
      expect(pre(writeTool("../elsewhere/x.ts"))).toEqual(ALLOW);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("symlinked paths", () => {
  // git reports the run root with symlinks resolved; payload paths may not be.
  let linkDir: string;
  let logical: string;
  beforeEach(() => {
    ({ dir: linkDir, path: logical } = linkTo(repo));
  });
  afterEach(() => rmSync(linkDir, { recursive: true, force: true }));

  test("a write through a symlink to the repo gets the stage's scope", () => {
    expect(denied(pre(writeTool(join(logical, "src/x.ts")), logical))).toContain('stage "design"');
    expect(pre(writeTool(join(logical, "docs/specs/x.md")), logical)).toEqual(ALLOW);
  });

  test("a write to .aos through a symlink to the repo is denied", () => {
    at(loc, "build");
    expect(denied(pre(writeTool(join(logical, ".aos/runs/x/log.jsonl")), logical))).toBe(AOS_DIR);
  });

  test.skipIf(process.platform !== "darwin")("the unresolved macOS temp spelling gets the same checks", () => {
    const unresolved = repo.replace(/^\/private\//, "/");
    expect(unresolved).not.toBe(repo);
    expect(pre(writeTool(join(unresolved, "src/x.ts")), unresolved).kind).toBe("deny");
    at(loc, "build");
    expect(denied(pre(writeTool(join(unresolved, ".aos/runs/x/log.jsonl")), unresolved))).toBe(AOS_DIR);
  });

  test("a symlink inside the repo that points into .aos is denied", () => {
    at(loc, "build");
    symlinkSync(join(repo, ".aos"), join(repo, "sneaky"));
    expect(denied(pre(writeTool("sneaky/runs/x/log.jsonl")))).toBe(AOS_DIR);
  });

  test("a symlink inside the repo that points outside it is outside the root", () => {
    const outside = tmpDir();
    try {
      symlinkSync(outside, join(repo, "out"));
      expect(pre(writeTool("out/x.ts"))).toEqual(ALLOW);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("Bash commands", () => {
  test("the agent cannot self-approve through Bash", () => {
    expect(denied(pre(bashTool("aos approve R design")))).toBe("AOS: `aos approve` is a human-only command. Ask the human to run it in their own terminal.");
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "human-only", tool: "Bash" } });
    expect(denied(pre(bashTool("bunx aos-harness run cancel R")))).toContain("`aos run cancel`");
  });

  test("the agent cannot read or edit .aos through Bash", () => {
    expect(denied(pre(bashTool("cat .aos/runs/R/state.json")))).toBe(AOS_DIR);
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "aos-dir" } });
  });

  test("ordinary commands pass without touching the log or the tree", () => {
    const n = events(loc).length;
    const noTree: HookDeps = { tree: (): TreeState => { throw new Error("ls must not fingerprint the tree"); } };
    expect(pre(bashTool("ls -la"), repo, noTree)).toEqual(ALLOW);
    expect(events(loc).length).toBe(n);
  });

  test("tools other than Bash and file writes pass", () => {
    const read: HookTool = { name: "Read", kind: "other", input: { file_path: join(repo, ".aos/x") }, command: null, path: join(repo, ".aos/x"), skill: null, aosTool: null };
    expect(pre(read)).toEqual(ALLOW);
  });
});

describe("gated actions", () => {
  test("commit only in build or verify", () => {
    expect(denied(pre(bashTool("git commit -m x")))).toBe("AOS: commit is allowed only in stages build, verify; the current stage is design.");
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "commit" } });
    at(loc, "build");
    expect(pre(bashTool("git commit -m x"))).toEqual(ALLOW);
    expect(lastEvent(loc)).toMatchObject({ type: "action.allowed", data: { action: "commit", tool: "Bash", gate: null } });
  });

  test("a commit message that mentions git push or aos approve stays a commit", () => {
    at(loc, "build");
    expect(pre(bashTool('git commit -m "explain git push guard"'))).toEqual(ALLOW);
    expect(lastEvent(loc)).toMatchObject({ type: "action.allowed", data: { action: "commit" } });
    expect(pre(bashTool('git commit -m "add aos approve"'))).toEqual(ALLOW);
  });

  test("push waits for a fresh verify pass, and re-blocks after an edit", () => {
    at(loc, "verify");
    expect(denied(pre(bashTool("git push")))).toContain("push blocked: verify gate pending");
    pass(loc);
    expect(pre(bashTool("git push"))).toEqual(ALLOW);
    expect(lastEvent(loc)).toMatchObject({ type: "action.allowed", data: { action: "push", gate: "verify" } });
    writeFile(repo, "src/y.ts", "edit");
    expect(pre(bashTool("git push")).kind).toBe("deny");
  });

  test("push from build says the verify stage has not been reached", () => {
    at(loc, "build");
    expect(denied(pre(bashTool("git push")))).toContain("has not been reached");
  });

  test("a bash -c wrapped push is still guarded", () => {
    at(loc, "verify");
    expect(pre(bashTool("bash -c 'git push'")).kind).toBe("deny");
  });

  test("a push in a script fed to bash on a heredoc is guarded", () => {
    const heredoc = "bash <<'EOF'\ngit push -q origin main\nEOF";
    expect(denied(pre(bashTool(heredoc)))).toContain("push blocked");
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "push", tool: "Bash" } });
    expect(pre(bashTool("bash <<<'git push origin main'")).kind).toBe("deny");
    expect(pre(bashTool("echo 'git push origin main' | sh")).kind).toBe("deny");
    at(loc, "verify");
    pass(loc);
    expect(pre(bashTool(heredoc))).toEqual(ALLOW);
  });

  test("a push through a git alias or an expanded command word is guarded", () => {
    expect(denied(pre(bashTool("git -c alias.p=push p origin main")))).toContain("push blocked");
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "push" } });
    expect(pre(bashTool("G=git; $G push origin main")).kind).toBe("deny");
    expect(pre(bashTool("dash -c 'git push'")).kind).toBe("deny");
  });

  test("a heredoc commit message that mentions git push stays a commit", () => {
    at(loc, "build");
    expect(pre(bashTool("git commit -F - <<'EOF'\nfix: explain the git push guard\nEOF"))).toEqual(ALLOW);
    expect(lastEvent(loc)).toMatchObject({ type: "action.allowed", data: { action: "commit" } });
  });

  test("PR create follows the verify gate too", () => {
    at(loc, "verify");
    expect(denied(pre(bashTool("gh pr create --fill")))).toContain("pr_create blocked: verify gate pending");
    pass(loc);
    expect(pre(bashTool("gh pr create --fill"))).toEqual(ALLOW);
  });

  test("deploy is never allowed", () => {
    at(loc, "verify");
    pass(loc);
    expect(denied(pre(bashTool("vercel deploy --prod")))).toBe("AOS: deploy is not allowed in a bounded run.");
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", data: { action: "deploy" } });
  });

  test("a fingerprint failure on push fails closed", () => {
    at(loc, "verify");
    const broken: HookDeps = { tree: (): TreeState => { throw new Error("git hung"); } };
    expect(denied(pre(bashTool("git push"), repo, broken))).toContain("aos doctor");
  });
});

describe("spike runs", () => {
  test("frame allows no writes; probe writes anywhere; push and PR create always denied; commit allowed", () => {
    spike();
    expect(denied(pre(writeTool("src/x.ts")))).toBe('AOS: stage "frame" allows no file writes. Get its approval first (aos_request_approval).');
    at(loc, "probe");
    expect(pre(writeTool("src/x.ts"))).toEqual(ALLOW);
    expect(denied(pre(bashTool("git push")))).toBe(
      "AOS: push is not allowed in a spike run. Spike code is throwaway by design; start a bounded run to build it for real.",
    );
    expect(pre(bashTool("gh pr create")).kind).toBe("deny");
    expect(pre(bashTool("git commit -m x"))).toEqual(ALLOW);
  });
});

describe("completed runs", () => {
  test("write scopes lift, push still needs a fresh verify", () => {
    complete(loc);
    expect(pre(bashTool("git push"))).toEqual(ALLOW);
    expect(pre(writeTool("src/z.ts"))).toEqual(ALLOW);
    writeFile(repo, "src/z.ts", "x");
    expect(pre(bashTool("git push")).kind).toBe("deny");
    expect(pre(bashTool("git commit -m x"))).toEqual(ALLOW);
  });

  test(".aos stays kernel-owned after completion", () => {
    complete(loc);
    expect(denied(pre(writeTool(".aos/runs/x/state.json")))).toBe(AOS_DIR);
    expect(pre(bashTool("aos approve R verify")).kind).toBe("deny");
  });
});
