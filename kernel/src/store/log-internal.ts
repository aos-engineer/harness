// Log internals shared by the log reader, the run store, and the store tests. Kept out of the package
// barrel: appending without the lock, or without projecting, would break the store's guarantees.
import { closeSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import type { Actor, EventDraft, EventEnvelope, EventType, RunLocation } from "../types.ts";
import { GENESIS_PREV } from "../types.ts";
import { ChainError, RunNotFoundError } from "../util/errors.ts";
import { sha256Tag } from "../util/hash.ts";
import { ulid } from "../util/ulid.ts";
import { runPaths } from "./paths.ts";

const NL = 0x0a;
const TAIL_WINDOW = 64 * 1024;
const STORE_ACTOR: Actor = { kind: "kernel", id: "store", agent: null };

export function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

function parses(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/**
 * Splits log bytes into complete lines and a torn tail. A crash mid-append leaves bytes after the last
 * newline; a complete last line that is not JSON is treated the same way, because only the last line can
 * be the casualty of an interrupted write. Anything unparseable earlier is left for the chain check.
 */
export function scanLog(buf: Buffer): { lines: string[]; tornBytes: number } {
  const lastNl = buf.lastIndexOf(NL);
  if (lastNl < 0) return { lines: [], tornBytes: buf.length };
  const prevNl = lastNl > 0 ? buf.lastIndexOf(NL, lastNl - 1) : -1;
  const goodEnd = parses(buf.subarray(prevNl + 1, lastNl).toString("utf8")) ? lastNl + 1 : prevNl + 1;
  const lines = goodEnd > 0 ? buf.subarray(0, goodEnd - 1).toString("utf8").split("\n") : [];
  return { lines, tornBytes: buf.length - goodEnd };
}

/** Reads a run's whole log. Throws RunNotFoundError when the run has no log file. */
export function readLogBytes(loc: RunLocation): Buffer {
  try {
    return readFileSync(runPaths(loc).log);
  } catch (e) {
    if (errCode(e) === "ENOENT") throw new RunNotFoundError(`no run ${loc.run} under ${loc.root}`, { cause: e });
    throw e;
  }
}

export interface ChainCheck { ok: boolean; badSeq: number | null; reason: string | null }

/** Parses lines into envelopes, throwing ChainError at the first line that is not JSON. */
export function parseLines(lines: string[]): EventEnvelope[] {
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as EventEnvelope;
    } catch (e) {
      throw new ChainError(`log line ${i + 1} is not valid JSON`, i + 1, { cause: e });
    }
  });
}

/** Checks seq contiguity from 1 and that every prev is the hash of the line before it. */
export function checkLines(lines: string[]): ChainCheck {
  let prev = GENESIS_PREV;
  for (let i = 0; i < lines.length; i++) {
    const want = i + 1;
    let e: { seq?: unknown; prev?: unknown };
    try {
      e = JSON.parse(lines[i]) as { seq?: unknown; prev?: unknown };
    } catch {
      return { ok: false, badSeq: want, reason: `line ${want} is not valid JSON` };
    }
    if (e === null || typeof e !== "object") return { ok: false, badSeq: want, reason: `line ${want} is not an event` };
    if (e.seq !== want) return { ok: false, badSeq: want, reason: `expected seq ${want}, found ${JSON.stringify(e.seq)}` };
    if (e.prev !== prev) return { ok: false, badSeq: want, reason: `seq ${want} does not chain to the line before it` };
    prev = sha256Tag(lines[i]);
  }
  return { ok: true, badSeq: null, reason: null };
}

/** The end of the log as an appender sees it: the last good line, and the bytes a repair would drop. */
export interface Tail { lastLine: string | null; lastSeq: number; goodSize: number; dropped: Buffer }

function readAt(fd: number, start: number, end: number): Buffer {
  const buf = Buffer.alloc(end - start);
  let off = 0;
  while (off < buf.length) {
    const n = readSync(fd, buf, off, buf.length - off, start + off);
    if (n === 0) break;
    off += n;
  }
  return buf.subarray(0, off);
}

function seqOf(line: string): number {
  const v = JSON.parse(line) as { seq?: unknown } | null;
  const seq = v !== null && typeof v === "object" ? v.seq : undefined;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
    throw new ChainError(`the last log line carries no valid seq (${JSON.stringify(seq)})`, null);
  }
  return seq;
}

/**
 * Reads only the end of the log, so an append costs the same on a long run as on a short one. The window
 * doubles until it holds the last two complete lines (the last one may turn out to be torn) or reaches the
 * start of the file.
 */
export function readTail(fd: number, size: number): Tail {
  for (let window = TAIL_WINDOW; ; window *= 2) {
    const start = Math.max(0, size - window);
    const buf = readAt(fd, start, size);
    const nls: number[] = [];
    for (let from = buf.length - 1; nls.length < 3 && from >= 0; ) {
      const at = buf.lastIndexOf(NL, from);
      if (at < 0) break;
      nls.push(at);
      from = at - 1;
    }
    if (nls.length < 3 && start > 0) continue;

    // lineStart(k) is where the line ending at nls[k] begins; nls.length < 3 implies start === 0 here.
    const lineStart = (k: number): number => (k + 1 < nls.length ? nls[k + 1] + 1 : 0);
    if (nls.length === 0) return { lastLine: null, lastSeq: 0, goodSize: start, dropped: buf };
    let goodEnd = nls[0] + 1;
    let lastLine = buf.subarray(lineStart(0), nls[0]).toString("utf8");
    if (!parses(lastLine)) {
      goodEnd = lineStart(0);
      if (nls.length < 2) return { lastLine: null, lastSeq: 0, goodSize: start, dropped: buf };
      lastLine = buf.subarray(lineStart(1), nls[1]).toString("utf8");
      if (!parses(lastLine)) throw new ChainError("the two last log lines are both unreadable; this is not a torn write", null);
    }
    return { lastLine, lastSeq: seqOf(lastLine), goodSize: start + goodEnd, dropped: buf.subarray(goodEnd) };
  }
}

// Generic so that each draft's data stays tied to its type without a cast.
function seal<T extends EventType>(d: EventDraft<T>, seq: number, run: string, prev: string): EventEnvelope<T> {
  // Key order is fixed here because it is what gets serialized and hashed.
  return { v: 1, seq, id: ulid(), run, ts: new Date().toISOString(), actor: d.actor, type: d.type, data: d.data, prev };
}

function writeAll(fd: number, buf: Buffer): void {
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
}

/**
 * Appends drafts to the log. The caller must hold the run's lock. A torn tail is truncated away and recorded
 * as a log.repaired event ahead of the drafts. `check` sees the sealed events before anything touches the
 * disk, so a rejected batch leaves the log exactly as it was.
 */
export function appendLocked(
  paths: { log: string }, run: string, drafts: EventDraft[], check?: (events: EventEnvelope[]) => void,
): { events: EventEnvelope[]; lastLine: string | null } {
  const fd = openSync(paths.log, "a+");
  try {
    const tail = readTail(fd, fstatSync(fd).size);
    const all: EventDraft[] = tail.dropped.length > 0
      ? [{ type: "log.repaired", actor: STORE_ACTOR, data: { droppedBytes: tail.dropped.length, droppedSha256: sha256Tag(tail.dropped) } }, ...drafts]
      : drafts;
    if (all.length === 0) return { events: [], lastLine: tail.lastLine };

    const events: EventEnvelope[] = [];
    const lines: string[] = [];
    let prev = tail.lastLine === null ? GENESIS_PREV : sha256Tag(tail.lastLine);
    let seq = tail.lastSeq;
    for (const d of all) {
      const e = seal(d, ++seq, run, prev);
      const line = JSON.stringify(e);
      events.push(e);
      lines.push(line);
      prev = sha256Tag(line);
    }
    check?.(events);

    if (tail.dropped.length > 0) ftruncateSync(fd, tail.goodSize);
    // One write for the whole batch, then fsync: the state snapshot is written only after the log is durable.
    writeAll(fd, Buffer.from(lines.map((l) => l + "\n").join("")));
    fsyncSync(fd);
    return { events, lastLine: lines[lines.length - 1] };
  } finally {
    closeSync(fd);
  }
}
