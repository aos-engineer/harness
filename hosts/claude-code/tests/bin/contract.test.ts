// The host contract in process: each fixture-shaped payload goes through normalize and handleHook, so the
// kernel's decisions are checked against what Claude Code sends, not only against hand-built inputs.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { findBinding, handleHook, type HookDecision, type RunLocation } from "@aos-harness/kernel";
import { at, bound, events, lastEvent, startRun, state, SESSION } from "../../../../kernel/tests/hooks/helpers.ts";
import { tmpGitRepo } from "../../../../kernel/tests/helpers.ts";
import type { ClaudeEventName } from "../../src/events.ts";
import { normalize } from "../../src/payload.ts";
import { payload, runStartPayload, type Patch } from "./support.ts";

const NO_EXIT_CODE = "AOS: this test run produced no exit code";

let repo: string;
let run: string;
let loc: RunLocation;

beforeEach(() => {
  repo = tmpGitRepo();
  run = startRun(repo, "bounded");
  loc = { root: repo, run };
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const EVENT_OF: Record<string, ClaudeEventName> = {
  "pre-tool-use": "PreToolUse", "post-tool-use-failure": "PostToolUseFailure", "post-tool-use": "PostToolUse",
  "session-start": "SessionStart", stop: "Stop",
};

/** The Claude event a fixture belongs to, read from its name prefix. */
function eventOf(name: string): ClaudeEventName {
  const prefix = Object.keys(EVENT_OF).find((p) => name.startsWith(p));
  if (prefix === undefined) throw new Error(`no event for fixture ${name}`);
  return EVENT_OF[prefix]!;
}

const send = (name: string, patch?: Patch): HookDecision => handleHook(normalize(eventOf(name), payload(name, repo, patch)));
const evidenceCount = () => state(loc).evidence.length;

describe("observer", () => {
  beforeEach(() => {
    bound(repo, run);
    at(loc, "build");
  });

  test("a foreground test run's PostToolUse is observed exit 0", () => {
    expect(send("post-tool-use-bash-true", { command: "bun test" })).toEqual({ kind: "allow", notice: null });
    expect(state(loc).evidence.at(-1)).toMatchObject({ kind: "command", role: "test", exitCode: 0, provenance: "observed" });
  });

  test("a test run's PostToolUseFailure records the exit code from the error text", () => {
    send("post-tool-use-failure-bash-test-fail");
    expect(state(loc).evidence.at(-1)).toMatchObject({ kind: "command", exitCode: 1, masked: false });
  });

  test("a backgrounded test run records nothing and says why", () => {
    const n = evidenceCount();
    expect(send("post-tool-use-bash-background")).toMatchObject({ kind: "allow", notice: expect.stringContaining(NO_EXIT_CODE) });
    expect(evidenceCount()).toBe(n);
  });

  test("an interrupted test run records nothing", () => {
    const n = evidenceCount();
    expect(send("post-tool-use-failure-bash-test-fail", { top: { is_interrupt: true } })).toMatchObject({ notice: expect.stringContaining(NO_EXIT_CODE) });
    expect(evidenceCount()).toBe(n);
  });

  test("a result the Bash tool explained instead of reporting a code records nothing", () => {
    const n = evidenceCount();
    expect(send("post-tool-use-bash-grep-no-match", { command: "bun test" })).toMatchObject({ notice: expect.stringContaining(NO_EXIT_CODE) });
    expect(evidenceCount()).toBe(n);
  });

  test("a Write PostToolUse is a worktree change at its repo-relative path", () => {
    send("post-tool-use-write");
    expect(lastEvent(loc)).toMatchObject({ type: "worktree.changed", data: { path: "a.txt", tool: "Write" } });
  });

  test("a Skill PostToolUse is observed skill evidence", () => {
    send("post-tool-use-skill");
    expect(state(loc).evidence.at(-1)).toMatchObject({ kind: "skill", skill: "superpowers:brainstorming", provenance: "observed" });
  });
});

describe("guard", () => {
  beforeEach(() => bound(repo, run));

  test("Edit and NotebookEdit are scope-checked in design", () => {
    expect(send("pre-tool-use-edit").kind).toBe("deny");
    expect(send("pre-tool-use-notebook-edit").kind).toBe("deny");
  });

  test("a subagent's push is denied and attributed to it", () => {
    expect(send("pre-tool-use-bash-subagent", { command: "git push" }).kind).toBe("deny");
    expect(lastEvent(loc)).toMatchObject({ type: "action.blocked", actor: { kind: "hook", agent: "AGENT-1" }, data: { action: "push" } });
  });

  test("a subagent's harmless command passes", () => {
    expect(send("pre-tool-use-bash-subagent")).toEqual({ kind: "allow", notice: null });
  });
});

describe("session start and stop", () => {
  beforeEach(() => bound(repo, run));

  test("every SessionStart fixture re-injects the run", () => {
    for (const name of ["session-start-startup", "session-start-resume", "session-start-compact"]) {
      expect(send(name)).toMatchObject({ kind: "allow", notice: expect.stringContaining(`Run id: ${run}`) });
    }
  });

  test("Stop blocks on the open gaps, with or without stop_hook_active", () => {
    expect(send("stop-hook-active").kind).toBe("block-stop");
    // The same prompt and gaps: handed back rather than blocked again.
    expect(send("stop").kind).toBe("allow");
  });
});

describe("binding from aos_run_start", () => {
  const shapes: Record<string, (id: string) => unknown> = {
    "a content array": (id) => [{ type: "text", text: JSON.stringify({ runId: id, tier: "bounded" }) }],
    "a result object with pretty-printed text": (id) => ({ content: [{ type: "text", text: JSON.stringify({ runId: id }, null, 2) }] }),
    "structured content": (id) => ({ content: [{ type: "text", text: "started" }], structuredContent: { runId: id } }),
    "a plain string": (id) => JSON.stringify({ runId: id }),
  };

  for (const [name, shape] of Object.entries(shapes)) {
    test(`binds from ${name}`, () => {
      const d = handleHook(normalize("PostToolUse", runStartPayload(repo, shape(run))));
      expect(d).toMatchObject({ kind: "allow", notice: expect.stringContaining(run) });
      expect(findBinding(repo, "claude-code", SESSION)?.run).toBe(run);
      expect(events(loc).some((e) => e.type === "session.bound")).toBe(true);
    });
  }
});
