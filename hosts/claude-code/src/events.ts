import type { HookEvent } from "@aos-harness/kernel";

/** The Claude Code hook events the plugin registers. */
export type ClaudeEventName = "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "SessionStart" | "Stop";

// hooks.json passes the event to bin/aos-hook.ts as a kebab-case argument. The table has no
// prototype, so a stray argument such as "constructor" looks up as undefined, not as an inherited
// function that a truthiness check would accept as an event.
export const CLI_EVENTS: Readonly<Record<string, ClaudeEventName>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ClaudeEventName>, {
    "pre-tool-use": "PreToolUse",
    "post-tool-use": "PostToolUse",
    "post-tool-use-failure": "PostToolUseFailure",
    "session-start": "SessionStart",
    stop: "Stop",
  }),
);

export const HOOK_EVENT: Readonly<Record<ClaudeEventName, HookEvent>> = Object.freeze({
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  PostToolUseFailure: "post-tool-failure",
  SessionStart: "session-start",
  Stop: "stop",
});
