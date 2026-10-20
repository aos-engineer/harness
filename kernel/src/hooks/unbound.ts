// SessionStart for a session with no binding. A /clear or fork starts a new session id that the run's
// binding does not cover, so a run can be active in the project while this session is unenforced. Saying
// so keeps anyone from assuming gates apply. Only snapshots are read: this runs on every session start.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aosDir } from "../store/paths.ts";
import { physicalPath } from "./paths.ts";

const MAX_LISTED = 5;

interface ActiveRun { run: string; tier: string; stage: string; dir: string }

/** A notice naming the active runs in `.aos/runs` of these directories (not their parents), or null. */
export function unboundNotice(dirs: string[]): string | null {
  const active: ActiveRun[] = [];
  const seen = new Set<string>();
  for (const dir of dirs.map(physicalPath)) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const run of runNames(dir)) {
      const found = activeSnapshot(dir, run);
      if (found !== null) active.push(found);
    }
  }
  if (active.length === 0) return null;

  const oneDir = active.every((a) => a.dir === active[0]?.dir);
  const items = active.slice(0, MAX_LISTED).map((a) => `${a.run} (${a.tier}, stage ${a.stage})${oneDir ? "" : ` in ${a.dir}`}`);
  if (active.length > MAX_LISTED) items.push(`${active.length - MAX_LISTED} more`);
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  const one = active.length === 1;
  const where = oneDir ? ` in ${active[0]?.dir}` : "";
  return `AOS: ${one ? "run" : "runs"} ${list} ${one ? "is" : "are"} active${where}, but this session is not bound to ${one ? "it" : "them"}, so AOS gates do not apply to this session.`;
}

function runNames(dir: string): string[] {
  try {
    return readdirSync(join(aosDir(dir), "runs")).sort();
  } catch {
    return []; // no runs here
  }
}

/** The run from its state.json snapshot when it is active; null when it is not, or cannot be read. */
function activeSnapshot(dir: string, run: string): ActiveRun | null {
  try {
    const file = JSON.parse(readFileSync(join(aosDir(dir), "runs", run, "state.json"), "utf8")) as { state?: unknown };
    const s = file.state as { status?: unknown; tier?: unknown; current?: { stage?: unknown } } | undefined;
    if (s?.status !== "active" || typeof s.tier !== "string" || typeof s.current?.stage !== "string") return null;
    return { run, tier: s.tier, stage: s.current.stage, dir };
  } catch {
    return null; // a missing or unreadable snapshot is not evidence of an active run
  }
}
