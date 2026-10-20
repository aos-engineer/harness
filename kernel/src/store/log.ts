import type { EventEnvelope, Projector, RunLocation, RunState, StateFile } from "../types.ts";
import { checkChain, parseLines, readLogBytes, readStateFile, scanLog } from "./log-internal.ts";
import { runPaths } from "./paths.ts";

export interface LogRead { events: EventEnvelope[]; lines: string[]; tornBytes: number }

export interface ChainReport { ok: boolean; events: number; badSeq: number | null; reason: string | null }

/**
 * Reads the whole log without writing. A torn tail is left out and counted in `tornBytes`; the next append
 * repairs it. A last event that is whole but lost its newline is kept. Throws ChainError when a line before the tail is not JSON, since no event can stand in for it.
 */
export function readLog(loc: RunLocation): LogRead {
  const { lines, tornBytes } = scanLog(readLogBytes(loc));
  return { events: parseLines(lines), lines, tornBytes };
}

/**
 * Replays the hash chain and checks it against state.json. Detects edits, deletions, and truncation; it
 * cannot prevent them, and an agent that rewrites the whole chain and snapshot is not detected. Given a
 * projector, it also replays the events state.json reflects and reports a snapshot whose contents differ.
 * That leaves `ok` alone: no reader trusts those contents, and a different AOS version can project the same
 * events differently, so a stale snapshot is not by itself tampering.
 */
export function verifyChain(loc: RunLocation, projector?: Projector): ChainReport {
  const file = readStateFile(runPaths(loc).state);
  const { lines, tornBytes } = scanLog(readLogBytes(loc));
  const check = checkChain(lines, file);
  // Torn bytes are crash damage, not tampering, so they leave `ok` alone; they are still worth reporting.
  const torn = tornBytes > 0 ? `the log ends in ${tornBytes} torn bytes, which the next append saves as an artifact and drops` : null;
  const drift = check.ok && projector !== undefined && file !== null && !snapshotMatches(lines, file, projector)
    ? "state.json does not match what the log replays to (it was edited, or written by another AOS version); AOS ignores its contents and the next append rewrites it"
    : null;
  const reason = [check.reason, drift, torn].filter((r) => r !== null).join("; ") || null;
  return { ok: check.ok, events: lines.length, badSeq: check.badSeq, reason };
}

/** Whether the snapshot's state is what the log's first `file.seq` events replay to. */
function snapshotMatches(lines: string[], file: StateFile, projector: Projector): boolean {
  let state: RunState | null = null;
  for (const e of parseLines(lines.slice(0, file.seq))) state = projector.apply(state, e);
  // Through JSON, as the snapshot was: undefined fields drop out the same way.
  return sameJson(JSON.parse(JSON.stringify(state)), file.state);
}

/** Deep equality of parsed JSON values, ignoring key order. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  return keys.length === Object.keys(rb).length && keys.every((k) => Object.hasOwn(rb, k) && sameJson(ra[k], rb[k]));
}
