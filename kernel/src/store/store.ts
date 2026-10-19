// The run store: the log plus a state.json snapshot of its projection. The log is the source of truth;
// the snapshot exists so hooks can read run state without replaying the log on every tool call.
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventDraft, EventEnvelope, Projector, RunLocation, RunState, StateFile } from "../types.ts";
import { ChainError, OpError, RunNotFoundError } from "../util/errors.ts";
import { sha256Tag } from "../util/hash.ts";
import { withLock } from "./lock.ts";
import { aosDir, runPaths } from "./paths.ts";
import { appendLocked, checkChain, errCode, parseLines, readLogBytes, readStateFile, readTail, scanLog } from "./log-internal.ts";
import type { Tail } from "./log-internal.ts";

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

function readLogTail(loc: RunLocation): Tail {
  let fd: number;
  try {
    fd = openSync(runPaths(loc).log, "r");
  } catch (e) {
    if (errCode(e) === "ENOENT") throw new RunNotFoundError(`no run ${loc.run} under ${loc.root}`, { cause: e });
    throw e;
  }
  try {
    return readTail(fd, fstatSync(fd).size);
  } finally {
    closeSync(fd);
  }
}

// The snapshot is a cache that loadState can always rebuild, so it is renamed into place without an fsync.
function writeStateFile(path: string, file: StateFile): void {
  const body = JSON.stringify(file);
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    // The events are already durable in the log, so the append succeeded. Reporting failure here would
    // invite a retry that duplicates them; a lagging snapshot is rebuilt by the next reader instead.
    if (errCode(e) === undefined) throw e;
  }
}

export function createRun(loc: RunLocation, started: EventDraft<"run.started">, projector: Projector): StateFile {
  const paths = runPaths(loc);
  mkdirSync(dirname(paths.dir), { recursive: true });
  try {
    mkdirSync(paths.dir);
  } catch (e) {
    if (errCode(e) === "EEXIST") throw new OpError("refused", `run ${loc.run} already exists`, { cause: e });
    throw e;
  }
  try {
    return appendEvents(loc, [started], projector).file;
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
export function appendEvents(loc: RunLocation, drafts: EventDraft[], projector: Projector): { events: EventEnvelope[]; file: StateFile } {
  const paths = runPaths(loc);
  if (!existsSync(paths.dir)) throw new RunNotFoundError(`no run ${loc.run} under ${loc.root}`);
  return withLock(paths.lock, (held) => {
    const snapshot = readStateFile(paths.state);
    let next: RunState | null = null;
    const { events, lastLine } = appendLocked(loc, drafts, { held, check: (sealed) => {
      const lastSeq = sealed[0].seq - 1;
      const pinned = snapshot !== null && lastSeq > 0 && snapshot.seq === lastSeq && snapshot.head === sealed[0].prev;
      const base = pinned ? snapshot.state : rebuild(loc, projector, snapshot).state;
      next = project(projector, base, sealed);
    } });
    if (events.length === 0) return { events, file: loadState(loc, projector) };
    if (next === null || lastLine === null) throw new Error("unreachable: a non-empty append was projected");
    const file: StateFile = { v: 1, seq: events[events.length - 1].seq, head: sha256Tag(lastLine), state: next };
    // A snapshot written after losing the lock could overwrite a newer one; skipping it only makes it lag.
    if (held()) writeStateFile(paths.state, file);
    return { events, file };
  });
}

/**
 * Returns the run's state without taking the lock. When state.json pins the end of the log, it is returned
 * as is: this is the hook fast path. Otherwise the log is verified and replayed in memory; nothing is
 * written, because repairs belong to writers holding the lock.
 */
export function loadState(loc: RunLocation, projector: Projector): StateFile {
  const paths = runPaths(loc);
  const snapshot = readStateFile(paths.state);
  const tail = readLogTail(loc);
  if (tail.lastLine !== null && snapshot !== null && snapshot.seq === tail.lastSeq && snapshot.head === sha256Tag(tail.lastLine)) {
    return snapshot;
  }
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
