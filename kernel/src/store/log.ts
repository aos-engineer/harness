import type { EventEnvelope, RunLocation } from "../types.ts";
import { checkLines, parseLines, readLogBytes, scanLog } from "./log-internal.ts";

export interface LogRead { events: EventEnvelope[]; lines: string[]; tornBytes: number }

export interface ChainReport { ok: boolean; events: number; badSeq: number | null; reason: string | null }

/**
 * Reads the whole log without writing. A torn tail is left out and counted in `tornBytes`; the next append
 * repairs it. Throws ChainError when a line before the tail is not JSON, since no event can stand in for it.
 */
export function readLog(loc: RunLocation): LogRead {
  const { lines, tornBytes } = scanLog(readLogBytes(loc));
  return { events: parseLines(lines), lines, tornBytes };
}

/** Replays the hash chain. Detects edits and deletions; it cannot prevent them. */
export function verifyChain(loc: RunLocation): ChainReport {
  const { lines } = scanLog(readLogBytes(loc));
  const check = checkLines(lines);
  return { ...check, events: lines.length };
}
