// What a hook decides when the kernel itself failed. Consequential actions fail closed, so a broken run
// can never let a push through; everything else fails open, so a kernel bug never breaks the session.
import type { HookDecision, HookEvent } from "../types.ts";
import { isAbsolute } from "node:path";
import { errorMessage, logHookError, nearestAosRoot } from "./report.ts";

// Deliberately crude: these run when parsing, state, or the pack may be what failed, so they match the
// raw text. A quoted mention such as `git commit -m "push"` is denied too, which is acceptable while
// the kernel is in an error state. The deploy entries mirror the reference pack's deploy commands, since
// the pack may be the thing that failed to load.
export const CONSEQUENTIAL: readonly RegExp[] = Object.freeze([
  /\bgit\b[^;&|]*\bpush\b/,
  /[$`][^;&|]*\bpush\b/, // a command word from an expansion, as in `G=git; $G push`
  /\bgh\s+pr\s+(?:create|new)\b/,
  /\bgh\s+api\b.*\b(?:pulls|createPullRequest)\b/,
  /\bdeploy\b/,
  /\bterraform\s+apply\b/,
  /\bkubectl\s+(?:apply|rollout)\b/,
  /\bhelm\s+(?:install|upgrade)\b/,
  /\bgh\s+workflow\s+run\b/,
  /dokploy\S*(?:\s+\S+)*?\s+(?:deploy|redeploy|upsert-compose|compose\.(?:deploy|redeploy|stop))\b/,
]);

export function failsafeDecision(event: HookEvent, rawCommand: string | null, err: unknown): HookDecision {
  if (event === "pre-tool" && typeof rawCommand === "string" && CONSEQUENTIAL.some((re) => re.test(rawCommand))) {
    return { kind: "deny", reason: `AOS error, run \`aos doctor\`: ${errorMessage(err)}` };
  }
  return { kind: "allow", notice: null };
}

/** What a host still knows about a payload it could not parse or normalize. */
export interface PayloadSite { cwd: string | null; projectDir: string | null; command: string | null }

/**
 * The decision for a hook payload the host could not parse, normalize, or render, logged to the
 * hook-errors.log of that state. Failing closed protects AOS state, so a consequential command is denied
 * only when a .aos directory exists at or above the payload's cwd or the project dir, and only that
 * existing directory is logged to. Anywhere else a change in the host's payload format must not block a
 * push, and nothing is written.
 */
export function payloadFailsafe(event: HookEvent, site: PayloadSite, err: unknown): HookDecision {
  const root = aosRootOf(site);
  if (root === null) return { kind: "allow", notice: null };
  logHookError(root, event, err);
  return failsafeDecision(event, site.command, err);
}

function aosRootOf(site: PayloadSite): string | null {
  // A relative cwd would resolve against this process's own directory, which says nothing about the session.
  const cwd = site.cwd !== null && isAbsolute(site.cwd) ? nearestAosRoot(site.cwd) : null;
  return cwd ?? (site.projectDir !== null && isAbsolute(site.projectDir) ? nearestAosRoot(site.projectDir) : null);
}
