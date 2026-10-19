// What a hook decides when the kernel itself failed. Consequential actions fail closed, so a broken run
// can never let a push through; everything else fails open, so a kernel bug never breaks the session.
import type { HookDecision, HookEvent } from "../types.ts";
import { errorMessage } from "./report.ts";

// Deliberately crude: these run when parsing, state, or the pack may be what failed, so they match the
// raw text. A quoted mention such as `git commit -m "push"` is denied too, which is acceptable while
// the kernel is in an error state.
export const CONSEQUENTIAL: readonly RegExp[] = Object.freeze([/\bgit\b[^;&|]*\bpush\b/, /\bgh\s+pr\s+create\b/, /\bdeploy\b/]);

export function failsafeDecision(event: HookEvent, rawCommand: string | null, err: unknown): HookDecision {
  if (event === "pre-tool" && typeof rawCommand === "string" && CONSEQUENTIAL.some((re) => re.test(rawCommand))) {
    return { kind: "deny", reason: `AOS error, run \`aos doctor\`: ${errorMessage(err)}` };
  }
  return { kind: "allow", notice: null };
}
