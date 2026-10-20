import { describe, expect, test } from "bun:test";
import { CLI_EVENTS, HOOK_EVENT } from "../src/events.ts";

describe("events", () => {
  test("CLI_EVENTS maps each hook command argument to its Claude Code event", () => {
    expect({ ...CLI_EVENTS }).toEqual({
      "pre-tool-use": "PreToolUse",
      "post-tool-use": "PostToolUse",
      "post-tool-use-failure": "PostToolUseFailure",
      "session-start": "SessionStart",
      stop: "Stop",
    });
  });

  test("HOOK_EVENT maps each Claude Code event to the kernel's host-agnostic event", () => {
    expect({ ...HOOK_EVENT }).toEqual({
      PreToolUse: "pre-tool",
      PostToolUse: "post-tool",
      PostToolUseFailure: "post-tool-failure",
      SessionStart: "session-start",
      Stop: "stop",
    });
  });

  test("CLI_EVENTS does not resolve inherited object keys, so a bad argument cannot pass as an event", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(CLI_EVENTS[key]).toBeUndefined();
  });

  test("both tables are frozen", () => {
    expect(Object.isFrozen(CLI_EVENTS)).toBe(true);
    expect(Object.isFrozen(HOOK_EVENT)).toBe(true);
  });
});
