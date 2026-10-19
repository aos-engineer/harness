// Stub: real implementation lands later; signatures are the agreed contract.
import type { HookDecision } from "@aos-harness/kernel";
import { notImplemented } from "@aos-harness/kernel";
import type { ClaudeEventName } from "./events.ts";

export function render(event: ClaudeEventName, decision: HookDecision): { stdout: string; exitCode: 0 } {
  return notImplemented("E");
}
