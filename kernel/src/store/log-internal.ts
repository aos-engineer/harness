// Log internals shared by the log reader, the run store, and the store tests. Kept out of the package
// barrel: appending without the lock, or without projecting, would break the store's guarantees.
import { closeSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import type { Actor, EventDraft, EventEnvelope, EventType, RunLocation, StateFile } from "../types.ts";
import { GENESIS_PREV } from "../types.ts";
import { ChainError, LockTimeoutError, RunNotFoundError } from "../util/errors.ts";
import { sha256Tag } from "../util/hash.ts";
import { ulid } from "../util/ulid.ts";
import { writeArtifact } from "./artifacts.ts";
import { errCode } from "./fs-internal.ts";
import { runPaths } from "./paths.ts";

const NL = 0x0a;
const TAIL_WINDOW = 64 * 1024;
const STORE_ACTOR: Actor = { kind: "kernel", id: "store", agent: null };

function parses(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function seqIn(line: string): number | null {
  try {
    const v = JSON.parse(line) as { seq?: unknown } | null;
    const seq = v !== null && typeof v === "object" ? v.seq : undefined;
    return typeof seq === "number" && Number.isInteger(seq) && seq >= 1 ? seq : null;
  } catch {
    return null;
  }
}

/** True when `candidate` is a whole event that continues the chain from `prevLine` (null: the log start). */
function chainsOnto(prevLine: string | null, candidate: string): boolean {
  let e: { seq?: unknown; prev?: unknown } | null;
  try {
    e = JSON.parse(candidate) as { seq?: unknown; prev?: unknown } | null;
  } catch {
    return false;
  }
  if (e === null || typeof e !== "object") return false;
  const prevSeq = prevLine === null ? 0 : seqIn(prevLine);
  if (prevSeq === null) return false;
  return e.seq === prevSeq + 1 && e.prev === (prevLine === null ? GENESIS_PREV : sha256Tag(prevLine));
}

interface End { lastLine: string | null; goodEnd: number; restore: boolean }

/**
 * Classifies how the log ends. `buf` is the end of the file and either starts at the file start or holds the
 * last two complete lines in full. Only the last line can be the casualty of an interrupted write:
 * - a complete final line that is not JSON is torn, along with anything after it;
 * - bytes after the last newline that form a whole event chaining onto the line before only lost their
 *   newline, so they are kept (`restore`): dropping them would lose a real event;
 * - any other bytes after the last newline are torn.
 * Anything unreadable earlier is left for the chain check.
 */
function endOf(buf: Buffer): End {
  const n0 = buf.lastIndexOf(NL);
  const n1 = n0 > 0 ? buf.lastIndexOf(NL, n0 - 1) : -1;
  const n2 = n1 > 0 ? buf.lastIndexOf(NL, n1 - 1) : -1;
  const last = n0 >= 0 ? buf.subarray(n1 + 1, n0).toString("utf8") : null;
  if (last !== null && !parses(last)) {
    return { lastLine: n1 >= 0 ? buf.subarray(n2 + 1, n1).toString("utf8") : null, goodEnd: n1 + 1, restore: false };
  }
  const after = buf.subarray(n0 + 1).toString("utf8");
  if (after.length > 0 && chainsOnto(last, after)) return { lastLine: after, goodEnd: buf.length, restore: true };
  return { lastLine: last, goodEnd: n0 + 1, restore: false };
}

/** Splits log bytes into the lines that stay and the count of torn bytes the next append will drop. */
export function scanLog(buf: Buffer): { lines: string[]; tornBytes: number } {
  const end = endOf(buf);
  if (end.goodEnd === 0) return { lines: [], tornBytes: buf.length };
  // A restored tail has no newline yet; otherwise the kept bytes end in one.
  const kept = buf.subarray(0, end.restore ? end.goodEnd : end.goodEnd - 1).toString("utf8");
  return { lines: kept.split("\n"), tornBytes: buf.length - end.goodEnd };
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

/** The snapshot on disk, or null when it is missing or unreadable: it is a cache, so either means rebuild. */
export function readStateFile(path: string): StateFile | null {
  try {
    const f = JSON.parse(readFileSync(path, "utf8")) as Partial<StateFile> | null;
    if (f && f.v === 1 && Number.isInteger(f.seq) && typeof f.head === "string" && f.state && typeof f.state === "object") {
      return f as StateFile;
    }
  } catch {
    // Missing, torn by a crash before rename, or hand-edited: all mean the same thing here.
  }
  return null;
}

/**
 * The snapshot pins the log at the seq it reflects: the line at that seq must still hash to its head, and
 * the log cannot end before it. This is what catches an edited or removed last event, which no later prev
 * covers. Read the snapshot before the log: writers append first and snapshot second, so a snapshot read
 * first can only lag a log read after it, never lead it.
 */
export function checkAgainstState(lines: string[], file: StateFile | null): ChainCheck {
  if (file === null || file.seq < 1) return { ok: true, badSeq: null, reason: null };
  if (file.seq > lines.length) {
    return { ok: false, badSeq: lines.length + 1, reason: `state.json reflects seq ${file.seq} but the log ends at seq ${lines.length}` };
  }
  if (sha256Tag(lines[file.seq - 1]) !== file.head) {
    return { ok: false, badSeq: file.seq, reason: `seq ${file.seq} no longer matches the hash state.json recorded for it` };
  }
  return { ok: true, badSeq: null, reason: null };
}

/** Full chain check: contiguity and prev links, then the snapshot's pin on the end of the log. */
export function checkChain(lines: string[], file: StateFile | null): ChainCheck {
  const links = checkLines(lines);
  return links.ok ? checkAgainstState(lines, file) : links;
}

/**
 * The end of the log as an appender sees it: the last good line, the bytes a repair would drop, and whether
 * the last event only needs its newline back.
 */
export interface Tail { lastLine: string | null; lastSeq: number; goodSize: number; dropped: Buffer; restore: boolean }

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

function countNewlines(buf: Buffer, max: number): number {
  let count = 0;
  for (let from = buf.length - 1; count < max && from >= 0; count++) {
    const at = buf.lastIndexOf(NL, from);
    if (at < 0) break;
    from = at - 1;
  }
  return count;
}

/**
 * Reads only the end of the log, so an append costs the same on a long run as on a short one. The window
 * doubles until it holds three newlines (so the last two complete lines are whole) or reaches the file start.
 */
export function readTail(fd: number, size: number): Tail {
  for (let window = TAIL_WINDOW; ; window *= 2) {
    const start = Math.max(0, size - window);
    const buf = readAt(fd, start, size);
    if (start > 0 && countNewlines(buf, 3) < 3) continue;
    const end = endOf(buf);
    const dropped = end.restore ? Buffer.alloc(0) : buf.subarray(end.goodEnd);
    if (end.lastLine === null) return { lastLine: null, lastSeq: 0, goodSize: start + end.goodEnd, dropped, restore: end.restore };
    const lastSeq = seqIn(end.lastLine);
    if (lastSeq === null) {
      const why = parses(end.lastLine) ? "carries no valid seq" : "and the line after it are both unreadable";
      throw new ChainError(`the last good log line ${why}; this is not a torn write`, null);
    }
    return { lastLine: end.lastLine, lastSeq, goodSize: start + end.goodEnd, dropped, restore: end.restore };
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

/** Proof that the caller holds the run's lock, plus an optional look at the batch before it is written. */
export interface AppendGuard {
  held: () => boolean;
  check?: (events: EventEnvelope[], lastLine: string) => void;
}

/**
 * Appends drafts to the log. The caller must hold the run's lock. A torn tail is saved as an artifact,
 * truncated away, and recorded as a log.repaired event ahead of the drafts; a last event that only lost its
 * newline gets it back. `check` sees the sealed events before anything touches the log, so a rejected batch
 * leaves it exactly as it was.
 */
export function appendLocked(loc: RunLocation, drafts: EventDraft[], guard: AppendGuard): { events: EventEnvelope[]; lastLine: string | null } {
  const fd = openSync(runPaths(loc).log, "a+");
  try {
    const sizeAtRead = fstatSync(fd).size;
    const tail = readTail(fd, sizeAtRead);
    const repair = tail.dropped.length > 0;
    const all: EventDraft[] = repair
      ? [{ type: "log.repaired", actor: STORE_ACTOR, data: { droppedBytes: tail.dropped.length, droppedSha256: sha256Tag(tail.dropped) } }, ...drafts]
      : drafts;
    if (all.length === 0) return { events: [], lastLine: tail.lastLine };

    const events: EventEnvelope[] = [];
    const lines: string[] = [];
    let prev = tail.lastLine === null ? GENESIS_PREV : sha256Tag(tail.lastLine);
    let seq = tail.lastSeq;
    for (const d of all) {
      const e = seal(d, ++seq, loc.run, prev);
      const line = JSON.stringify(e);
      events.push(e);
      lines.push(line);
      prev = sha256Tag(line);
    }
    guard.check?.(events, lines[lines.length - 1]);
    // The dropped bytes go to an artifact first, so log.repaired's digest points at recoverable content.
    if (repair) writeArtifact(loc, tail.dropped);

    // A holder suspended past the stale age (laptop sleep, SIGSTOP) wakes to find its lock broken and maybe the
    // log extended. Writing a batch sealed against the old tail would fork the chain for good, so give up
    // instead. The window between this check and the write is microseconds, against seconds of suspension.
    if (fstatSync(fd).size !== sizeAtRead || !guard.held()) {
      throw new LockTimeoutError(`lost the lock on run ${loc.run} before writing; nothing was appended`);
    }

    if (repair) ftruncateSync(fd, tail.goodSize);
    // One write for the whole batch, then fsync: the state snapshot is written only after the log is durable.
    writeAll(fd, Buffer.from((tail.restore ? "\n" : "") + lines.map((l) => l + "\n").join("")));
    fsyncSync(fd);
    return { events, lastLine: lines[lines.length - 1] };
  } finally {
    closeSync(fd);
  }
}
