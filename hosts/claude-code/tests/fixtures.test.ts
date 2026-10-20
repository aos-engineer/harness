import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { basename } from "node:path";
import { fixtureNames, fx } from "./fixture.ts";

const EVENT_PREFIX: Record<string, string> = {
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  "post-tool-use-failure": "PostToolUseFailure",
  "session-start": "SessionStart",
  "post-compact": "PostCompact",
  stop: "Stop",
  "subagent-start": "SubagentStart",
  "subagent-stop": "SubagentStop",
};

// Longest prefix first, so post-tool-use-failure-* is not read as post-tool-use.
function eventOf(name: string): string | undefined {
  const prefix = Object.keys(EVENT_PREFIX)
    .sort((a, b) => b.length - a.length)
    .find((p) => name === p || name.startsWith(p + "-"));
  return prefix === undefined ? undefined : EVENT_PREFIX[prefix];
}

describe("fixtures", () => {
  const names = fixtureNames();

  test("exist", () => expect(names.length).toBeGreaterThan(0));

  for (const name of names) {
    describe(name, () => {
      const payload = fx(name) as Record<string, unknown>;

      test("say where their shape came from", () => expect(["captured", "docs"]).toContain(payload._source as string));

      test("carry the hook event their file name claims", () => expect(payload.hook_event_name).toBe(eventOf(name)));

      test("carry the placeholder session and repo", () => {
        expect(payload.session_id).toMatch(/^SESSION(-\d+)?$/);
        expect(payload.cwd).toBe("/repo");
      });

      test("hold no path or name from this machine", () => {
        const text = JSON.stringify(payload);
        const home = homedir();
        expect(text).not.toContain(home);
        const user = basename(home);
        if (user.length >= 3 && user !== "user") expect(text).not.toContain(user);
      });
    });
  }
});
