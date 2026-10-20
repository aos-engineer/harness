// The launcher runs the plugin's bundled entry points under Bun. When Bun is missing it must step aside
// rather than fail: the Bash hook is registered fail-closed, so a crashing launcher would block every Bash
// call in every session, including sessions with no AOS run.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LAUNCHER = join(import.meta.dir, "../bin/aos.sh");
const payload = (event: string) =>
  JSON.stringify({ session_id: "S", cwd: tmpdir(), prompt_id: "P", hook_event_name: event, tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "t" });

/** The system directories only: they hold sh and the basic tools, and Bun never installs there. */
function pathWithoutBun(): string {
  const path = "/usr/bin:/bin";
  expect(spawnSync("/bin/sh", ["-c", "command -v bun"], { env: { PATH: path } }).status).not.toBe(0);
  return path;
}

const run = (args: string[], input: string, env: Record<string, string>) =>
  spawnSync("/bin/sh", [LAUNCHER, ...args], { input, encoding: "utf8", env: { HOME: tmpdir(), ...env } });

describe("with Bun on PATH", () => {
  test("an unbound session passes through silently", () => {
    const r = run(["hook", "pre-tool-use"], payload("PreToolUse"), { PATH: process.env.PATH ?? "" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("without Bun on PATH", () => {
  test("hooks pass through instead of blocking the tool call", () => {
    const r = run(["hook", "pre-tool-use"], payload("PreToolUse"), { PATH: pathWithoutBun() });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("SessionStart tells the model that AOS is off and why", () => {
    const r = run(["hook", "session-start"], payload("SessionStart"), { PATH: pathWithoutBun() });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("Bun is not on PATH");
  });

  test("the MCP server exits with a clear reason", () => {
    const r = run(["mcp"], "", { PATH: pathWithoutBun() });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("needs Bun");
  });
});

test("an unknown entry point is a no-op, never a blocked tool call", () => {
  const r = run(["bogus"], "", { PATH: process.env.PATH ?? "" });
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("unknown entry point");
});
