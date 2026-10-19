// How hook failures are described: a short line for the agent, and the full cause chain for
// hook-errors.log, where `aos doctor` and a human debugging the hook will look.
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { aosDir } from "../store/paths.ts";

const MAX_REASON_CHARS = 300;
const MAX_CAUSES = 5;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The error's own message on one line, capped: it goes inside a deny reason. */
export function errorMessage(err: unknown): string {
  const text = oneLine(err instanceof Error ? err.message : String(err));
  return text.length <= MAX_REASON_CHARS ? text : text.slice(0, MAX_REASON_CHARS - 3) + "...";
}

/** `Name: message <- Cause: message ...` on one line, so a wrapped git or fs failure keeps its cause. */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < MAX_CAUSES && cur !== undefined && cur !== null; i++) {
    parts.push(cur instanceof Error ? `${cur.name}: ${oneLine(cur.message)}` : oneLine(String(cur)));
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts.join(" <- ");
}

/**
 * The nearest directory at or above `cwd` that already has a `.aos` directory. Used only on the error path,
 * when the run's root is unknown (for example an unreadable binding), so logging never creates `.aos`.
 */
export function nearestAosRoot(cwd: string): string | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(aosDir(dir))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Best effort: a hook that cannot log its error still returns its fail-safe decision. */
export function logHookError(root: string | null, event: string, err: unknown): void {
  if (root === null) return;
  try {
    appendFileSync(join(aosDir(root), "hook-errors.log"), `${new Date().toISOString()} ${event} ${describeError(err)}\n`);
  } catch {
    // Nothing else to do: the log is the only place this could be reported.
  }
}
