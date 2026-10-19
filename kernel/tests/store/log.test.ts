import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { GENESIS_PREV } from "../../src/types.ts";
import type { EventDraft, EventEnvelope, RunLocation } from "../../src/types.ts";
import { aosDir, runPaths } from "../../src/store/paths.ts";
import { withLock } from "../../src/store/lock.ts";
import { readLog, verifyChain } from "../../src/store/log.ts";
import { appendLocked } from "../../src/store/log-internal.ts";
import { ChainError, LockTimeoutError, RunNotFoundError } from "../../src/util/errors.ts";
import { sha256Tag } from "../../src/util/hash.ts";
import { tmpDir } from "../helpers.ts";
import { appendRawBytes, deleteLine, mutateLine, range, replaceLine, stripFinalNewline, worktreeDraft } from "./fixtures.ts";

let loc: RunLocation;

beforeEach(() => {
  loc = { root: tmpDir("aos-log-"), run: "R1" };
  mkdirSync(runPaths(loc).dir, { recursive: true });
});

function appendDrafts(drafts: EventDraft[]): { events: EventEnvelope[]; lastLine: string | null } {
  return withLock(runPaths(loc).lock, (held) => appendLocked(loc, drafts, { held }));
}

function append(n: number): { events: EventEnvelope[]; lastLine: string | null } {
  return appendDrafts(range(n).map((i) => worktreeDraft(i)));
}

describe("paths", () => {
  test("lay out a run under .aos/runs/<run>", () => {
    expect(aosDir("/repo")).toBe("/repo/.aos");
    expect(runPaths({ root: "/repo", run: "R1" })).toEqual({
      dir: "/repo/.aos/runs/R1", log: "/repo/.aos/runs/R1/log.jsonl", state: "/repo/.aos/runs/R1/state.json",
      lock: "/repo/.aos/runs/R1/log.lock", artifacts: "/repo/.aos/runs/R1/artifacts",
    });
  });

  test.each(["../escape", "a/b", "", ".", "..", "R1\0"])("reject run id %j", (run) => {
    expect(() => runPaths({ root: "/repo", run })).toThrow(RunNotFoundError);
  });
});

describe("a fresh log", () => {
  test("assigns contiguous seq from 1 and chains prev", () => {
    const { events } = append(3);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[0].prev).toBe(GENESIS_PREV);
    expect(events[1].prev).toBe(sha256Tag(readLog(loc).lines[0]));
    expect(events[2].prev).toBe(sha256Tag(readLog(loc).lines[1]));
  });

  test("stamps run, id, ts and keeps the draft", () => {
    const [e] = append(1).events;
    expect(e).toMatchObject({ v: 1, run: "R1", type: "worktree.changed", data: { path: "src/f0.ts", tool: "Write" } });
    expect(e.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(new Date(e.ts).toISOString()).toBe(e.ts);
  });

  test("returned events equal what readLog parses back", () => {
    const { events, lastLine } = append(2);
    expect(readLog(loc).events).toEqual(events);
    expect(lastLine).toBe(readLog(loc).lines[1]);
  });

  test("continues seq and chain across separate appends", () => {
    append(2);
    const { events } = append(2);
    expect(events.map((e) => e.seq)).toEqual([3, 4]);
    expect(events[0].prev).toBe(sha256Tag(readLog(loc).lines[1]));
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 4 });
  });

  test("chains across lines longer than the tail window", () => {
    appendDrafts([worktreeDraft(0, "x".repeat(200_000))]);
    appendDrafts([worktreeDraft(1, "y".repeat(150_000))]);
    const { events } = append(1);
    expect(events[0].seq).toBe(3);
    expect(events[0].prev).toBe(sha256Tag(readLog(loc).lines[1]));
    expect(verifyChain(loc).ok).toBe(true);
  });

  test("readLog throws RunNotFoundError when the run has no log", () => {
    expect(() => readLog(loc)).toThrow(RunNotFoundError);
    expect(() => readLog({ root: loc.root, run: "NOPE" })).toThrow(RunNotFoundError);
  });
});

describe("a tail that lost only its newline", () => {
  test("keeps the first event when it is the only line", () => {
    append(1);
    stripFinalNewline(loc);
    expect(readLog(loc)).toMatchObject({ tornBytes: 0 });
    expect(readLog(loc).events.map((e) => e.seq)).toEqual([1]);
    const { events } = append(1);
    expect(events.map((e) => [e.seq, e.type])).toEqual([[2, "worktree.changed"]]);
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 2 });
  });
});

describe("a five-event log", () => {
  beforeEach(() => {
    append(5);
  });

  test("serializes envelope keys in the fixed hashing order", () => {
    expect(Object.keys(JSON.parse(readLog(loc).lines[0]))).toEqual(["v", "seq", "id", "run", "ts", "actor", "type", "data", "prev"]);
  });

  test("verifyChain passes on an untouched log", () => {
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 5, badSeq: null, reason: null });
  });

  test("detects a mutated middle event", () => {
    mutateLine(loc, 1);
    expect(verifyChain(loc)).toMatchObject({ ok: false, badSeq: 3 });
  });

  test("detects a deleted event", () => {
    deleteLine(loc, 2);
    expect(verifyChain(loc)).toMatchObject({ ok: false, badSeq: 3 });
  });

  test("detects a reordered seq", () => {
    replaceLine(loc, 1, readLog(loc).lines[1].replace('"seq":2', '"seq":7'));
    expect(verifyChain(loc)).toMatchObject({ ok: false, badSeq: 2 });
  });

  test("drops a torn trailing line on read", () => {
    appendRawBytes(loc, '{"v":1,"seq":');
    const r = readLog(loc);
    expect(r.events.length).toBe(5);
    expect(r.lines.length).toBe(5);
    expect(r.tornBytes).toBe(13);
  });

  test("readLog never writes", () => {
    appendRawBytes(loc, '{"v":1,"seq":');
    const before = statSync(runPaths(loc).log).size;
    readLog(loc);
    verifyChain(loc);
    expect(statSync(runPaths(loc).log).size).toBe(before);
  });

  test("a complete last line that is not JSON counts as torn", () => {
    appendRawBytes(loc, "garbage\n");
    expect(readLog(loc)).toMatchObject({ tornBytes: 8 });
    expect(readLog(loc).events.length).toBe(5);
  });

  test("an unparseable middle line is a chain failure, not a torn tail", () => {
    replaceLine(loc, 2, "not json");
    expect(() => readLog(loc)).toThrow(ChainError);
    expect(verifyChain(loc)).toMatchObject({ ok: false, badSeq: 3 });
  });

  test("repairs a torn tail on the next append", () => {
    appendRawBytes(loc, '{"v":1,"seq":');
    const { events } = append(1);
    expect(events.map((e) => e.type)).toEqual(["log.repaired", "worktree.changed"]);
    expect(events[0].data).toMatchObject({ droppedBytes: 13, droppedSha256: sha256Tag('{"v":1,"seq":') });
    expect(events[0].actor).toEqual({ kind: "kernel", id: "store", agent: null });
    expect(events[0].seq).toBe(6);
    expect(readLog(loc)).toMatchObject({ tornBytes: 0 });
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 7 });
  });

  test("restores the newline of a complete event that chains, instead of dropping it", () => {
    stripFinalNewline(loc);
    expect(readLog(loc)).toMatchObject({ tornBytes: 0 });
    expect(readLog(loc).events.length).toBe(5);
    const { events } = append(1);
    expect(events.map((e) => [e.seq, e.type])).toEqual([[6, "worktree.changed"]]);
    expect(events[0].prev).toBe(sha256Tag(readLog(loc).lines[4]));
    expect(readFileSync(runPaths(loc).log, "utf8").split("\n").length).toBe(7);
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 6, reason: null });
  });

  test("drops a complete-looking tail that does not chain, and saves it", () => {
    const stray = readLog(loc).lines[2];
    appendRawBytes(loc, stray);
    const { events } = append(1);
    expect(events.map((e) => e.type)).toEqual(["log.repaired", "worktree.changed"]);
    expect(events[0].data).toMatchObject({ droppedBytes: Buffer.byteLength(stray), droppedSha256: sha256Tag(stray) });
    expect(readFileSync(join(runPaths(loc).artifacts, sha256Tag(stray).slice(7)), "utf8")).toBe(stray);
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 7 });
  });

  test("saves the bytes a repair drops as an artifact", () => {
    appendRawBytes(loc, '{"v":1,"seq":');
    expect(existsSync(runPaths(loc).artifacts)).toBe(false);
    append(1);
    expect(readFileSync(join(runPaths(loc).artifacts, sha256Tag('{"v":1,"seq":').slice(7)), "utf8")).toBe('{"v":1,"seq":');
  });

  test("verifyChain mentions torn bytes when there are any", () => {
    appendRawBytes(loc, '{"v":1,"seq":');
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 5 });
    expect(verifyChain(loc).reason).toMatch(/13 torn bytes/);
  });

  test("repairs a torn tail that follows a non-JSON last line", () => {
    appendRawBytes(loc, 'garbage\n{"v":1');
    const { events } = append(1);
    expect(events[0].data).toMatchObject({ droppedBytes: 14 });
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 7 });
  });

  test("an append that fails its pre-write check writes nothing, not even the repair", () => {
    appendRawBytes(loc, '{"v":1,"seq":');
    const before = statSync(runPaths(loc).log).size;
    const check = (): void => { throw new Error("rejected"); };
    expect(() => withLock(runPaths(loc).lock, (held) => appendLocked(loc, [worktreeDraft(9)], { held, check }))).toThrow("rejected");
    expect(statSync(runPaths(loc).log).size).toBe(before);
  });

  test("a JSON last line that is not an event stops the append with ChainError", () => {
    appendRawBytes(loc, "null\n");
    expect(() => append(1)).toThrow(ChainError);
  });

  test("an append that lost its lock before writing throws and writes nothing", () => {
    const before = readFileSync(runPaths(loc).log);
    // What a waiter does after judging a suspended holder stale: it takes the lock over.
    const steal = (): void => writeFileSync(runPaths(loc).lock, JSON.stringify({ pid: process.pid, host: hostname(), ts: Date.now(), nonce: "thief" }));
    expect(() => withLock(runPaths(loc).lock, (held) => appendLocked(loc, [worktreeDraft(9)], { held, check: steal }))).toThrow(LockTimeoutError);
    expect(readFileSync(runPaths(loc).log)).toEqual(before);
  });

  test("an append whose log grew after its tail read throws and writes nothing", () => {
    const seen: { log: string | null } = { log: null };
    // Another writer appends between this append's tail read and its write.
    const race = (): void => {
      appendLocked(loc, [worktreeDraft(7)], { held: () => true });
      seen.log = readFileSync(runPaths(loc).log).toString("base64");
    };
    appendRawBytes(loc, '{"v":1,"seq":');
    expect(() => withLock(runPaths(loc).lock, (held) => appendLocked(loc, [worktreeDraft(9)], { held, check: race }))).toThrow(LockTimeoutError);
    expect(seen.log).not.toBeNull();
    expect(readFileSync(runPaths(loc).log).toString("base64")).toBe(seen.log ?? "");
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 7 });
  });

  test("an empty append writes nothing", () => {
    const before = statSync(runPaths(loc).log).size;
    expect(appendDrafts([]).events).toEqual([]);
    expect(statSync(runPaths(loc).log).size).toBe(before);
  });
});
