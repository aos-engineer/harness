import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { GENESIS_PREV } from "../../src/types.ts";
import type { EventDraft, Projector, RunLocation, StateFile } from "../../src/types.ts";
import { runPaths } from "../../src/store/paths.ts";
import { readLog, verifyChain } from "../../src/store/log.ts";
import { appendEvents, createRun, listRuns, loadState } from "../../src/store/store.ts";
import { writeArtifact } from "../../src/store/artifacts.ts";
import { ChainError, LockTimeoutError, OpError, RunNotFoundError } from "../../src/util/errors.ts";
import { sha256Tag } from "../../src/util/hash.ts";
import { tmpDir } from "../helpers.ts";
import { appendRawBytes, deleteLine, mutateLine, range, startedDraft, stripFinalNewline, worktreeDraft, writeStale } from "./fixtures.ts";
import { testProjector } from "./test-projector.ts";

let root: string;
let loc: RunLocation;

beforeEach(() => {
  root = tmpDir("aos-store-");
  loc = { root, run: "01JRUN0000000000000000000A" };
});

function stateOnDisk(): StateFile {
  return JSON.parse(readFileSync(runPaths(loc).state, "utf8")) as StateFile;
}

function logSize(): number {
  return statSync(runPaths(loc).log).size;
}

describe("createRun", () => {
  test("writes log and state with head of the last line", () => {
    const f = createRun(loc, startedDraft(), testProjector);
    expect(f).toMatchObject({ v: 1, seq: 1 });
    expect(f.head).toBe(sha256Tag(readLog(loc).lines[0]));
    expect(stateOnDisk()).toEqual(f);
    expect(readLog(loc).events[0]).toMatchObject({ seq: 1, type: "run.started", run: loc.run, prev: GENESIS_PREV });
  });

  test("refuses an existing run id", () => {
    createRun(loc, startedDraft(), testProjector);
    expect(() => createRun(loc, startedDraft(), testProjector)).toThrow(OpError);
    expect(readLog(loc).events.length).toBe(1);
  });

  test("leaves no run behind when the projector rejects the start", () => {
    const rejecting: Projector = { apply() { throw new Error("bad start"); } };
    expect(() => createRun(loc, startedDraft(), rejecting)).toThrow("bad start");
    expect(existsSync(runPaths(loc).dir)).toBe(false);
    expect(createRun(loc, startedDraft(), testProjector).seq).toBe(1);
  });

  test("appendEvents updates state incrementally", () => {
    createRun(loc, startedDraft(), testProjector);
    const { events, file } = appendEvents(loc, [worktreeDraft()], testProjector);
    expect(file.seq).toBe(2);
    expect(events.map((e) => e.seq)).toEqual([2]);
    expect(file.head).toBe(sha256Tag(readLog(loc).lines[1]));
    expect(stateOnDisk()).toEqual(file);
  });
});

describe("a run with two events", () => {
  beforeEach(() => {
    createRun(loc, startedDraft(), testProjector);
    appendEvents(loc, [worktreeDraft()], testProjector);
  });

  test("loadState returns the snapshot when it matches the log", () => {
    const cur = stateOnDisk();
    writeFileSync(runPaths(loc).state, JSON.stringify({ ...cur, state: { ...cur.state, brief: "from snapshot" } }));
    expect(loadState(loc, testProjector).state.brief).toBe("from snapshot");
  });

  test("loadState rebuilds in memory when state.json lags, without writing", () => {
    writeStale(loc, 1);
    expect(loadState(loc, testProjector).seq).toBe(2);
    expect(stateOnDisk().seq).toBe(1);
  });

  test("loadState rebuilds when state.json is unparseable", () => {
    writeFileSync(runPaths(loc).state, "{");
    expect(loadState(loc, testProjector).seq).toBe(2);
  });

  test("loadState rebuilds when state.json is missing", () => {
    rmSync(runPaths(loc).state);
    expect(loadState(loc, testProjector)).toMatchObject({ seq: 2, head: sha256Tag(readLog(loc).lines[1]) });
  });

  test("loadState ignores a torn tail", () => {
    appendRawBytes(loc, '{"v":1,"se');
    expect(loadState(loc, testProjector).seq).toBe(2);
  });

  test("loadState throws RunNotFoundError for an unknown run", () => {
    expect(() => loadState({ root, run: "X" }, testProjector)).toThrow(RunNotFoundError);
  });

  test("a rebuild verifies the chain and throws ChainError on tampering", () => {
    mutateLine(loc, 0);
    writeStale(loc, 0);
    expect(() => loadState(loc, testProjector)).toThrow(ChainError);
  });

  test("verifyChain detects a mutated last event through state head", () => {
    mutateLine(loc, -1);
    expect(verifyChain(loc)).toMatchObject({ ok: false, badSeq: 2 });
    expect(() => loadState(loc, testProjector)).toThrow(ChainError);
  });

  test("verifyChain detects truncation through state seq", () => {
    deleteLine(loc, -1);
    expect(verifyChain(loc).ok).toBe(false);
    expect(() => loadState(loc, testProjector)).toThrow(ChainError);
  });

  test("verifyChain accepts a state.json that lags", () => {
    writeStale(loc, 1);
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 2 });
  });

  test("appendEvents brings a lagging state.json up to date under the lock", () => {
    writeStale(loc, 1);
    expect(appendEvents(loc, [worktreeDraft(1)], testProjector).file.seq).toBe(3);
    expect(stateOnDisk()).toMatchObject({ seq: 3, head: sha256Tag(readLog(loc).lines[2]) });
  });

  test("appendEvents repairs a torn tail and keeps state in step", () => {
    appendRawBytes(loc, '{"v":1,"se');
    const { events, file } = appendEvents(loc, [worktreeDraft(1)], testProjector);
    expect(events.map((e) => e.type)).toEqual(["log.repaired", "worktree.changed"]);
    expect(file.seq).toBe(4);
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 4 });
  });

  test("with state.json missing, a last event that lost only its newline survives the next append", () => {
    rmSync(runPaths(loc).state);
    stripFinalNewline(loc);
    expect(loadState(loc, testProjector).seq).toBe(2);
    const { events, file } = appendEvents(loc, [worktreeDraft(1)], testProjector);
    expect(events.map((e) => [e.seq, e.type])).toEqual([[3, "worktree.changed"]]);
    expect(file.seq).toBe(3);
    expect(verifyChain(loc)).toMatchObject({ ok: true, events: 3 });
  });

  test("appendEvents will not extend a tampered log", () => {
    mutateLine(loc, 0);
    writeStale(loc, 0);
    const before = logSize();
    expect(() => appendEvents(loc, [worktreeDraft(1)], testProjector)).toThrow(ChainError);
    expect(logSize()).toBe(before);
  });

  test("appendEvents will not absorb an edited last line", () => {
    mutateLine(loc, -1);
    const before = logSize();
    expect(() => appendEvents(loc, [worktreeDraft(1)], testProjector)).toThrow(ChainError);
    expect(logSize()).toBe(before);
  });

  test("appendEvents writes nothing when the projector rejects a draft", () => {
    const rejecting: Projector = { apply(prev, e) { if (e.type === "run.cancelled") throw new Error("no"); return testProjector.apply(prev, e); } };
    const before = logSize();
    const cancel: EventDraft<"run.cancelled"> = { type: "run.cancelled", actor: { kind: "human", id: "tty", agent: null }, data: { reason: "x" } };
    expect(() => appendEvents(loc, [worktreeDraft(1), cancel], rejecting)).toThrow("no");
    expect(logSize()).toBe(before);
    expect(stateOnDisk().seq).toBe(2);
  });

  test("appendEvents that loses its lock mid-append leaves log and snapshot untouched", () => {
    const thief: Projector = {
      apply(prev, e) {
        if (e.type === "worktree.changed" && e.data.path === "steal") {
          writeFileSync(runPaths(loc).lock, JSON.stringify({ pid: process.pid, host: hostname(), ts: Date.now(), nonce: "thief" }));
        }
        return testProjector.apply(prev, e);
      },
    };
    const log = readFileSync(runPaths(loc).log);
    const snapshot = stateOnDisk();
    expect(() => appendEvents(loc, [worktreeDraft(1, "steal")], thief)).toThrow(LockTimeoutError);
    expect(readFileSync(runPaths(loc).log)).toEqual(log);
    expect(stateOnDisk()).toEqual(snapshot);
  });

  test("appendEvents with no drafts returns the current state", () => {
    expect(appendEvents(loc, [], testProjector)).toMatchObject({ events: [], file: { seq: 2 } });
  });

  test("appendEvents throws RunNotFoundError for an unknown run", () => {
    expect(() => appendEvents({ root, run: "NOPE" }, [worktreeDraft()], testProjector)).toThrow(RunNotFoundError);
    expect(existsSync(join(root, ".aos/runs/NOPE"))).toBe(false);
  });

  test("a failed snapshot write does not fail an append that is already durable", () => {
    rmSync(runPaths(loc).state);
    mkdirSync(join(runPaths(loc).state, "blocker"), { recursive: true });
    const { events } = appendEvents(loc, [worktreeDraft(1)], testProjector);
    expect(events.map((e) => e.seq)).toEqual([3]);
    expect(readLog(loc).events.length).toBe(3);
    expect(loadState(loc, testProjector).seq).toBe(3);
    expect(readdirSync(runPaths(loc).dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const trace = readFileSync(join(root, ".aos/hook-errors.log"), "utf8");
    expect(trace).toMatch(/^\S+Z store run \S+: state\.json not written/);
    expect(trace.endsWith("\n")).toBe(true);
  });

  test("a state that cannot be serialized fails before anything reaches the log", () => {
    const unserializable: Projector = {
      apply(prev, e) {
        const state = testProjector.apply(prev, e);
        if (e.type !== "worktree.changed" || e.data.path !== "poison") return state;
        // JSON.stringify reads every enumerable property, so this getter makes the state fail to serialize.
        return Object.defineProperty({ ...state }, "brief", { enumerable: true, get: () => { throw new TypeError("cannot serialize"); } });
      },
    };
    const log = readFileSync(runPaths(loc).log);
    const snapshot = stateOnDisk();
    expect(() => appendEvents(loc, [worktreeDraft(1, "poison")], unserializable)).toThrow("cannot serialize");
    expect(readFileSync(runPaths(loc).log)).toEqual(log);
    expect(stateOnDisk()).toEqual(snapshot);
  });

  test("leaves no temp files beside state.json", () => {
    appendEvents(loc, [worktreeDraft(1)], testProjector);
    expect(readdirSync(runPaths(loc).dir).sort()).toEqual(["log.jsonl", "state.json"]);
  });
});

describe("listRuns", () => {
  test("returns run ids", () => {
    createRun(loc, startedDraft(), testProjector);
    expect(listRuns(root)).toEqual([loc.run]);
  });

  test("sorts ascending and skips directories that hold no log", () => {
    createRun({ root, run: "01B" }, startedDraft(), testProjector);
    createRun({ root, run: "01A" }, startedDraft(), testProjector);
    mkdirSync(join(root, ".aos/runs/01C"));
    mkdirSync(join(root, ".aos/runs/not.an.id"));
    expect(listRuns(root)).toEqual(["01A", "01B"]);
  });

  test("is empty when there is no .aos directory", () => {
    expect(listRuns(tmpDir())).toEqual([]);
  });
});

describe("writeArtifact", () => {
  beforeEach(() => {
    createRun(loc, startedDraft(), testProjector);
  });

  test("is content-addressed and idempotent", () => {
    const a = writeArtifact(loc, "x");
    expect(writeArtifact(loc, "x")).toBe(a);
    expect(a).toBe(sha256Tag("x"));
    expect(readFileSync(join(runPaths(loc).artifacts, a.slice(7)), "utf8")).toBe("x");
    expect(readdirSync(runPaths(loc).artifacts)).toEqual([a.slice(7)]);
  });

  test("stores bytes as given", () => {
    const bytes = new Uint8Array([0, 255, 10, 13]);
    const a = writeArtifact(loc, bytes);
    expect(a).toBe(sha256Tag(bytes));
    expect(new Uint8Array(readFileSync(join(runPaths(loc).artifacts, a.slice(7))))).toEqual(bytes);
  });

  test("throws RunNotFoundError for an unknown run", () => {
    expect(() => writeArtifact({ root, run: "NOPE" }, "x")).toThrow(RunNotFoundError);
  });
});

describe("property: any single-event mutation breaks the chain", () => {
  const n = 6;
  beforeEach(() => {
    createRun(loc, startedDraft(), testProjector);
    appendEvents(loc, range(n - 1).map((i) => worktreeDraft(i)), testProjector);
  });

  test.each(range(n))("mutating event %i is detected", (i) => {
    expect(verifyChain(loc).ok).toBe(true);
    mutateLine(loc, i);
    // An inner edit breaks the next event's prev; the last event is pinned by state.json's head.
    expect(verifyChain(loc)).toMatchObject({ ok: false, badSeq: i < n - 1 ? i + 2 : n });
  });

  test.each(range(n))("deleting event %i is detected", (i) => {
    deleteLine(loc, i);
    expect(verifyChain(loc).ok).toBe(false);
  });
});

// Operations validate against the state under the lock, so a concurrent writer cannot slip between an
// operation's read and its append (for example a human cancel landing during an agent's stage advance).
describe("appendEvents precondition", () => {
  beforeEach(() => {
    createRun(loc, startedDraft(), testProjector);
    appendEvents(loc, [worktreeDraft()], testProjector);
  });

  test("a precondition that throws leaves the log and the snapshot untouched", () => {
    const log = readFileSync(runPaths(loc).log, "utf8");
    const snap = readFileSync(runPaths(loc).state, "utf8");
    const refuse = () => { throw new OpError("refused", "the run changed"); };
    expect(() => appendEvents(loc, [worktreeDraft(1)], testProjector, { precondition: refuse })).toThrow("the run changed");
    expect(readFileSync(runPaths(loc).log, "utf8")).toBe(log);
    expect(readFileSync(runPaths(loc).state, "utf8")).toBe(snap);
  });

  test("the precondition sees the locked state, including appends made after the caller last read", () => {
    const readEarlier = loadState(loc, testProjector).state.seq;
    appendEvents(loc, [worktreeDraft(2)], testProjector);
    const seen: number[] = [];
    appendEvents(loc, [worktreeDraft(3)], testProjector, { precondition: (s) => void seen.push(s.seq) });
    expect(readEarlier).toBe(2);
    expect(seen).toEqual([3]);
  });

  test("a passing precondition appends normally", () => {
    expect(appendEvents(loc, [worktreeDraft(4)], testProjector, { precondition: () => {} }).file.seq).toBe(3);
  });
});
