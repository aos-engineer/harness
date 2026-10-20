// The run store: the log plus a state.json snapshot of its projection. The log is the source of truth, and
// every read replays it. The snapshot is a convenience for people and tools reading a run's state at a
// glance; `aos doctor` reports one that differs from the log.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventDraft, EventEnvelope, Projector, RunLocation, RunState, StateFile } from "../types.ts";
import { ChainError, OpError, RunNotFoundError } from "../util/errors.ts";
import { sha256Tag } from "../util/hash.ts";
import { withLock } from "./lock.ts";
import { aosDir, runPaths } from "./paths.ts";
import { appendQuietly, errCode, fsyncDir, refuseSymlinks } from "./fs-internal.ts";
import { appendLocked, checkAgainstState, checkChain, checkLines, parseLines, readLogBytes, readStateFile, scanLog } from "./log-internal.ts";

function project(projector: Projector, base: RunState | null, events: EventEnvelope[]): RunState | null {
  let state = base;
  for (const e of events) state = projector.apply(state, e);
  return state;
}

/**
 * Replays the full log after verifying its chain against the snapshot that was read before it. Throws
 * ChainError on any break, so a tampered run fails closed instead of being quietly re-projected.
 */
function rebuild(loc: RunLocation, projector: Projector, file: StateFile | null): { state: RunState | null; lines: string[] } {
  const { lines } = scanLog(readLogBytes(loc));
  const check = checkChain(lines, file);
  if (!check.ok) throw new ChainError(`run ${loc.run}: ${check.reason}`, check.badSeq);
  return { state: project(projector, null, parseLines(lines)), lines };
}

// Best effort, in the same line format the hooks use, so `aos doctor` surfaces it with theirs.
// Nowhere left to report a failure of this; the lagging snapshot still rebuilds on the next read.
function trace(root: string, message: string): void {
  appendQuietly(root, join(aosDir(root), "hook-errors.log"), `${new Date().toISOString()} store ${message}\n`);
}

// The snapshot is a cache that loadState can always rebuild, so it is renamed into place without an fsync.
function writeStateFile(loc: RunLocation, body: string): void {
  const path = runPaths(loc).state;
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    // "wx" refuses a planted file or symlink at the temporary name; the rename replaces a link at `path`.
    writeFileSync(tmp, body, { flag: "wx" });
    renameSync(tmp, path);
    fsyncDir(dirname(path));
  } catch (e) {
    rmSync(tmp, { force: true });
    // The events are already durable in the log, so the append succeeded. Reporting failure here would
    // invite a retry that duplicates them; a lagging snapshot is rebuilt by the next reader instead.
    if (errCode(e) === undefined) throw e;
    trace(loc.root, `run ${loc.run}: state.json not written (${errCode(e)}): ${(e as Error).message}`);
  }
}

/**
 * A new directory survives a crash only once its parent is synced. Syncs the parent of `dir`, and every
 * ancestor up to the parent of `firstCreated` (what a recursive mkdir just made, if anything).
 */
function syncNewEntries(dir: string, firstCreated: string | undefined): void {
  let d = dirname(dir);
  fsyncDir(d);
  if (firstCreated === undefined) return;
  while (d !== dirname(firstCreated) && dirname(d) !== d) {
    d = dirname(d);
    fsyncDir(d);
  }
}

export function createRun(loc: RunLocation, started: EventDraft<"run.started">, projector: Projector): StateFile {
  const paths = runPaths(loc);
  refuseSymlinks(loc.root, paths.dir);
  const firstCreated = mkdirSync(dirname(paths.dir), { recursive: true });
  try {
    mkdirSync(paths.dir);
  } catch (e) {
    if (errCode(e) === "EEXIST") throw new OpError("refused", `run ${loc.run} already exists`, { cause: e });
    throw e;
  }
  try {
    syncNewEntries(paths.dir, firstCreated);
    const { file } = appendEvents(loc, [started], projector);
    // The snapshot rename syncs this directory too, but it can be skipped; the log's own entry must last.
    fsyncDir(paths.dir);
    return file;
  } catch (e) {
    // The directory is ours alone (the exclusive mkdir above), so a failed start leaves nothing behind.
    rmSync(paths.dir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Appends drafts under the run's lock and updates the snapshot. The batch is projected before it is written,
 * so an event the projector rejects never reaches the log. The snapshot is trusted as the starting point
 * only when it pins the current end of the log; otherwise the full log is verified and replayed.
 */
export interface AppendOptions {
  /**
   * Runs under the lock against the run's current state, before anything is written. Throw to refuse the
   * batch: the log stays untouched. Operations use it to re-check what they read (status, stage, ids), so a
   * concurrent writer cannot slip between an operation's read and its append.
   */
  precondition?: (state: RunState) => void;
}

export function appendEvents(loc: RunLocation, drafts: EventDraft[], projector: Projector, opts: AppendOptions = {}): { events: EventEnvelope[]; file: StateFile } {
  const paths = runPaths(loc);
  if (!existsSync(paths.dir)) throw new RunNotFoundError(`no run ${loc.run} under ${loc.root}`);
  // Before the lock: a symlinked run directory would put the lock file, then every event, somewhere else.
  refuseSymlinks(loc.root, paths.lock);
  // The full verified replay is the costly part of an append, so it runs before the lock; under the lock
  // only what other writers appended since is checked and applied. Replaying under the lock made holds
  // long enough that writers contending for one run timed out.
  const before = replayUnlocked(loc, projector);
  return withLock(paths.lock, (held) => {
    const snapshot = readStateFile(paths.state);
    // Filled in by the check, which runs before the batch is written: a projection or serialization that
    // throws there leaves the log untouched.
    const out: { file: StateFile | null; body: string } = { file: null, body: "" };
    const { events } = appendLocked(loc, drafts, { held, check: (sealed, lastLine) => {
      // Replayed, never taken from state.json, for the same reason as loadState: the precondition and the
      // next snapshot must build on what the log says, not on an edited cache.
      const base = catchUp(loc, projector, before, snapshot, sealed[0].seq - 1);
      if (opts.precondition) {
        if (base === null) throw new RunNotFoundError(`run ${loc.run} has no events to check against`);
        opts.precondition(base);
      }
      const next = project(projector, base, sealed);
      if (next === null) throw new Error("the projector returned no state for a non-empty batch");
      out.file = { v: 1, seq: sealed[sealed.length - 1].seq, head: sha256Tag(lastLine), state: next };
      out.body = JSON.stringify(out.file);
    } });
    if (events.length === 0) return { events, file: loadState(loc, projector) };
    if (out.file === null) throw new Error("unreachable: a non-empty append was not projected");
    // A snapshot written after losing the lock could overwrite a newer one; skipping it only makes it lag.
    if (held()) writeStateFile(loc, out.body);
    return { events, file: out.file };
  });
}

/**
 * A verified replay taken without the lock: the state, the seq and hash of the last line it covers, and a
 * digest of every line up to it, so a later reuse can tell that no earlier line has changed since.
 */
interface Replay { state: RunState | null; seq: number; head: string; prefix: string }

function prefixDigest(lines: string[], seq: number): string {
  return sha256Tag(lines.slice(0, seq).join("\n"));
}

// The last state this process verified from each run's log, per projector, so a long-lived writer (the
// MCP server, or a script appending in a loop) catches up on what others appended since instead of
// replaying the whole log for every append. It only ever holds state replayed from the log by this process,
// never anything read from state.json. A one-shot hook process starts empty and replays in full.
const verified = new WeakMap<Projector, Map<string, Replay>>();

function remember(loc: RunLocation, projector: Projector, replay: Replay): Replay {
  let runs = verified.get(projector);
  if (runs === undefined) verified.set(projector, (runs = new Map()));
  runs.set(runPaths(loc).log, replay);
  return replay;
}

function replayUnlocked(loc: RunLocation, projector: Projector): Replay | null {
  try {
    const known = verified.get(projector)?.get(runPaths(loc).log);
    if (known !== undefined) {
      const { lines } = scanLog(readLogBytes(loc));
      // Every line it covered is unchanged: chain-check and apply only the lines after it. Any edit to an
      // earlier line changes the digest and falls through to a full replay, which reports it.
      if (lines.length >= known.seq && prefixDigest(lines, known.seq) === known.prefix && checkLines(lines, known.seq, known.head).ok) {
        const state = project(projector, known.state, parseLines(lines.slice(known.seq)));
        return remember(loc, projector, { state, seq: lines.length, head: sha256Tag(lines[lines.length - 1]), prefix: prefixDigest(lines, lines.length) });
      }
    }
    // The snapshot is read before the log, as rebuild expects: a writer may be mid-append right now.
    const { state, lines } = rebuild(loc, projector, readStateFile(runPaths(loc).state));
    return lines.length === 0 ? null : remember(loc, projector, { state, seq: lines.length, head: sha256Tag(lines[lines.length - 1]), prefix: prefixDigest(lines, lines.length) });
  } catch {
    return null; // replayed again under the lock, which reports the problem
  }
}

/**
 * The state at `lastSeq`, the log's end as the lock holder sees it. When `before` is a prefix of the
 * current log (same line at its seq), only the lines after it are chain-checked and applied; otherwise the
 * whole log is replayed. The snapshot's pin on the end of the log is checked either way, since that is what
 * catches an edited last event.
 */
function catchUp(loc: RunLocation, projector: Projector, before: Replay | null, snapshot: StateFile | null, lastSeq: number): RunState | null {
  if (before === null || before.seq > lastSeq) return rebuild(loc, projector, snapshot).state;
  const { lines } = scanLog(readLogBytes(loc));
  if (lines.length !== lastSeq || sha256Tag(lines[before.seq - 1]) !== before.head) return rebuild(loc, projector, snapshot).state;
  const links = checkLines(lines, before.seq, before.head);
  const check = links.ok ? checkAgainstState(lines, snapshot) : links;
  if (!check.ok) throw new ChainError(`run ${loc.run}: ${check.reason}`, check.badSeq);
  return project(projector, before.state, parseLines(lines.slice(before.seq)));
}

/**
 * Returns the run's state without taking the lock: the log, verified and replayed in memory. state.json is
 * never trusted for its contents. Anything can rewrite it without touching the hash chain, so returning it
 * whenever it pinned the last event let a one-field edit pass a gate. A replay of a thousand events takes a
 * few milliseconds. Nothing is written, because repairs belong to writers holding the lock.
 */
export function loadState(loc: RunLocation, projector: Projector): StateFile {
  const snapshot = readStateFile(runPaths(loc).state);
  const { state, lines } = rebuild(loc, projector, snapshot);
  if (state === null) throw new RunNotFoundError(`run ${loc.run} has no events`);
  return { v: 1, seq: lines.length, head: sha256Tag(lines[lines.length - 1]), state };
}

// run ids, sorted ascending
export function listRuns(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(aosDir(root), "runs"));
  } catch (e) {
    if (errCode(e) === "ENOENT") return [];
    throw e;
  }
  // A directory counts as a run once its name is a valid id and it holds a log; a start that crashed
  // between mkdir and the first append leaves neither.
  return names.filter((run) => {
    try {
      return existsSync(runPaths({ root, run }).log);
    } catch {
      return false;
    }
  }).sort();
}
