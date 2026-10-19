import type { EventEnvelope, RunLocation } from "../types.ts";
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
 * cannot prevent them, and an agent that rewrites the whole chain and snapshot is not detected.
 */
export function verifyChain(loc: RunLocation): ChainReport {
  const file = readStateFile(runPaths(loc).state);
  const { lines, tornBytes } = scanLog(readLogBytes(loc));
  const check = checkChain(lines, file);
  // Torn bytes are crash damage, not tampering, so they leave `ok` alone; they are still worth reporting.
  const torn = tornBytes > 0 ? `the log ends in ${tornBytes} torn bytes, which the next append saves as an artifact and drops` : null;
  const reason = [check.reason, torn].filter((r) => r !== null).join("; ") || null;
  return { ok: check.ok, events: lines.length, badSeq: check.badSeq, reason };
}
