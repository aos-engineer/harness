// Stub: real implementation lands later; signatures are the agreed contract.
import type { EventEnvelope, RunLocation } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export interface LogRead { events: EventEnvelope[]; lines: string[]; tornBytes: number }

export interface ChainReport { ok: boolean; events: number; badSeq: number | null; reason: string | null }

export function readLog(loc: RunLocation): LogRead {
  return notImplemented("A");
}

export function verifyChain(loc: RunLocation): ChainReport {
  return notImplemented("A");
}
