// Stub: real implementation lands later; signatures are the agreed contract.
import type { HookDecision, HookEvent } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

// [/\bgit\b[^;&|]*\bpush\b/, /\bgh\s+pr\s+create\b/, /\bdeploy\b/]
export const CONSEQUENTIAL: readonly RegExp[] = [];

export function failsafeDecision(event: HookEvent, rawCommand: string | null, err: unknown): HookDecision {
  return notImplemented("G");
}
