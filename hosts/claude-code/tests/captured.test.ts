// Contract tests against hook payloads captured from a real Claude Code session (sanitized with
// tools/sanitize-fixture.ts). The docs-shaped fixtures pin what the docs say; these pin what Claude Code
// actually sends, so a payload change in a new Claude Code version fails here instead of silently
// disabling a gate. Re-capture after a Claude Code version bump (see tools/README.md).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvents, createRun, findBinding, handleHook, loadPack, projector } from "@aos-harness/kernel";
import type { Actor, HookInput } from "@aos-harness/kernel";
import { CLI_EVENTS, type ClaudeEventName } from "../src/events.ts";
import { normalize } from "../src/payload.ts";
import { tmpGitRepo } from "../../../kernel/tests/helpers.ts";

const DIR = join(import.meta.dir, "fixtures", "captured");
const PACK = join(import.meta.dir, "../../../packs/feature-delivery");
const cap = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));
const norm = (name: string, over: Record<string, unknown> = {}): HookInput => {
  const raw = { ...cap(name), ...over };
  return normalize(raw.hook_event_name as ClaudeEventName, raw);
};

test("every captured fixture is tagged as captured and normalizes without throwing", () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  expect(names.length).toBeGreaterThanOrEqual(30);
  for (const f of names) {
    const raw = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    expect(raw._source).toBe("captured");
    expect(Object.values(CLI_EVENTS)).toContain(raw.hook_event_name);
    expect(() => normalize(raw.hook_event_name, raw)).not.toThrow();
  }
});

describe("Bash exit codes as Claude Code really reports them", () => {
  test.each([
    ["post-tool-use-bash-true", 0],
    ["post-tool-use-bash-bun-test-pass", 0],
    ["post-tool-use-failure-bash-exit3", 3],
    ["post-tool-use-failure-bash-bun-test-fail", 1],
    // Never a pass: the command has not finished, or Claude Code reinterpreted a non-zero exit.
    ["post-tool-use-bash-background", null],
    ["post-tool-use-bash-grep-no-match", null],
    ["post-tool-use-bash-test-false", null],
    ["post-tool-use-bash-diff", null],
  ])("%s -> exit %p", (name, exitCode) => {
    expect(norm(name).result?.exitCode).toBe(exitCode);
  });
});

describe("tool shapes", () => {
  test("file tools resolve to an absolute path", () => {
    for (const name of ["pre-tool-use-write", "pre-tool-use-edit", "pre-tool-use-notebook-edit"]) {
      const t = norm(name).tool;
      expect(t?.kind).toBe("write");
      expect(t?.path?.startsWith("/repo/")).toBe(true);
    }
  });

  test("the Skill tool carries the skill name", () => {
    expect(norm("pre-tool-use-skill").tool).toMatchObject({ kind: "skill", skill: "hello" });
  });

  test("subagent tool calls carry the parent session and an agent id", () => {
    const main = norm("pre-tool-use-bash-true");
    const sub = norm("pre-tool-use-bash-subagent-true");
    expect(sub.session).toBe(main.session);
    expect(sub.agent).not.toBeNull();
    expect(main.agent).toBeNull();
  });

  test("every tool event carries a prompt id", () => {
    for (const f of readdirSync(DIR).filter((n) => n.startsWith("pre-") || n.startsWith("post-"))) {
      expect(norm(f.slice(0, -5)).promptId).not.toBeNull();
    }
  });

  test("SessionStart and Stop", () => {
    expect(norm("session-start-startup").source).toBe("startup");
    expect(norm("session-start-resume").source).toBe("resume");
    expect(norm("stop").stopHookActive).toBe(false);
  });

  test("the aos MCP tool is recognized under its plugin name", () => {
    expect(norm("post-tool-use-aos-run-start").tool).toMatchObject({ kind: "aos-mcp", aosTool: "aos_run_start" });
  });
});

test("the real aos_run_start response (a plain string) binds the session", () => {
  const response = cap("post-tool-use-aos-run-start").tool_response as string;
  const run = /"runId":"([0-9A-HJKMNP-TV-Z]{26})"/.exec(response)?.[1];
  expect(run).toBeDefined();
  const repo = tmpGitRepo();
  const pack = loadPack(PACK);
  const actor: Actor = { kind: "agent", id: "test", agent: null };
  const loc = { root: repo, run: run as string };
  createRun(loc, { type: "run.started", actor, data: { brief: "b", tier: "bounded", tierReason: "t", root: repo, git: true, host: "claude-code", pack } }, projector);
  appendEvents(loc, [{ type: "stage.entered", actor, data: { stage: "design", index: 0 } }], projector);

  const d = handleHook(norm("post-tool-use-aos-run-start", { cwd: repo }));
  expect(d.kind).toBe("allow");
  expect(d.kind === "allow" && d.notice).toContain(run as string);
  expect(findBinding(repo, "claude-code", "SESSION")?.run).toBe(run);
  expect(existsSync(join(repo, ".aos", "hook-errors.log"))).toBe(false);
});
