// Stub: real implementation lands later; signatures are the agreed contract.
import type { HookEvent } from "@aos-harness/kernel";

export type ClaudeEventName = "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "SessionStart" | "Stop";

// "pre-tool-use" -> "PreToolUse", ...
export const CLI_EVENTS: Readonly<Record<string, ClaudeEventName>> = {} as Readonly<Record<string, ClaudeEventName>>;

export const HOOK_EVENT: Readonly<Record<ClaudeEventName, HookEvent>> = {} as Readonly<Record<ClaudeEventName, HookEvent>>;
