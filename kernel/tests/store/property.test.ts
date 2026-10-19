import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { EventDraft, RunLocation, RunState, StateFile } from "../../src/types.ts";
import { runPaths } from "../../src/store/paths.ts";
import { readLog, verifyChain } from "../../src/store/log.ts";
import { appendEvents, createRun, loadState } from "../../src/store/store.ts";
import { tmpDir } from "../helpers.ts";
import { appendRawBytes, range, startedDraft, stripFinalNewline, taskDraft, worktreeDraft, writeStale } from "./fixtures.ts";
import { testProjector } from "./test-projector.ts";

// Seeded so a failing sequence can be replayed exactly.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function replay(loc: RunLocation): RunState | null {
  let state: RunState | null = null;
  for (const e of readLog(loc).events) state = testProjector.apply(state, e);
  // Compare through JSON, the form state.json holds.
  return JSON.parse(JSON.stringify(state)) as RunState | null;
}

function snapshot(loc: RunLocation): StateFile {
  return JSON.parse(readFileSync(runPaths(loc).state, "utf8")) as StateFile;
}

/**
 * Drives one run through appends interleaved with the disturbances the store must absorb: a torn tail, a
 * last event that lost its newline, a lagging snapshot, a missing snapshot. Torn bytes and a stripped
 * newline are only injected where a crash could leave them, so no real event is ever destroyed here.
 */
function drive(seed: number): void {
  const rand = mulberry32(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const loc: RunLocation = { root: tmpDir("aos-property-"), run: "01JRUN0000000000000000000A" };
  createRun(loc, startedDraft(), testProjector);
  let endsClean = true;
  let n = 0;

  for (const _ of range(8 + pick(16))) {
    const roll = rand();
    if (roll < 0.55) {
      const drafts: EventDraft[] = range(1 + pick(4)).map(() => (rand() < 0.5 ? worktreeDraft(n++) : taskDraft(n++)));
      appendEvents(loc, drafts, testProjector);
      endsClean = true;
      const expected = replay(loc);
      expect(snapshot(loc).state).toEqual(expected as RunState);
      expect(loadState(loc, testProjector).state).toEqual(expected as RunState);
    } else if (roll < 0.65 && endsClean) {
      appendRawBytes(loc, '{"v":1,"seq":'.slice(0, 1 + pick(12)));
      endsClean = false;
    } else if (roll < 0.75 && endsClean) {
      stripFinalNewline(loc);
      endsClean = false;
    } else if (roll < 0.88 && existsSync(runPaths(loc).state)) {
      writeStale(loc, pick(snapshot(loc).seq + 1));
    } else {
      rmSync(runPaths(loc).state, { force: true });
    }
  }

  appendEvents(loc, [worktreeDraft(n++)], testProjector);
  expect(snapshot(loc).state).toEqual(replay(loc) as RunState);
  expect(verifyChain(loc)).toMatchObject({ ok: true, reason: null });
  rmSync(runPaths(loc).state);
  expect(loadState(loc, testProjector).state).toEqual(replay(loc) as RunState);
}

test.each(range(25).map((i) => i + 1))("property: incremental state equals a full replay (seed %i)", (seed) => {
  drive(seed);
});
