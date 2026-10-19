import { expect, test } from "bun:test";
import { applyEvent, project } from "../../src/projection.ts";
import type { EventDataMap, RunState } from "../../src/types.ts";
import { genEvents } from "./gen.ts";

const SEEDS = 200;
const LENGTH = 60;

test("incremental apply equals full projection for 200 random logs", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const evs = genEvents(seed, LENGTH);
    const before = structuredClone(evs);
    const inc = evs.reduce<RunState | null>((s, e) => applyEvent(s, e), null);
    expect(inc).toEqual(project(evs));
    expect(evs).toEqual(before); // neither pass may write into the events it read
  }
});

// Hooks load state.json and apply only the new events, so the projection must survive a JSON round
// trip at any point in the log and still land on the same state as a full replay.
test("resuming from a JSON snapshot at any point equals full projection", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const evs = genEvents(seed, LENGTH);
    const cut = 1 + (seed % (LENGTH - 1));
    const snapshot: RunState = JSON.parse(JSON.stringify(project(evs.slice(0, cut))));
    const resumed = evs.slice(cut).reduce((s, e) => applyEvent(s, e), snapshot);
    expect(resumed).toEqual(project(evs));
  }
});

test("the generator is deterministic per seed and covers every event type", () => {
  expect(genEvents(7, LENGTH)).toEqual(genEvents(7, LENGTH));
  const seen = new Set<string>();
  for (let seed = 1; seed <= SEEDS; seed++) for (const e of genEvents(seed, LENGTH)) seen.add(e.type);
  // Every key of the event map, written out so a new event type forces a generator update.
  const all: Record<keyof EventDataMap, true> = {
    "run.started": true, "run.completed": true, "run.cancelled": true, "stage.entered": true, "task.added": true,
    "task.completed": true, "evidence.recorded": true, "gate.evaluated": true, "approval.requested": true,
    "approval.granted": true, "approval.denied": true, "budget.charged": true, "budget.warning": true,
    "budget.exceeded": true, "action.blocked": true, "action.allowed": true, "worktree.changed": true,
    "session.bound": true, "log.repaired": true,
  };
  for (const type of Object.keys(all)) expect([...seen]).toContain(type);
  expect([...seen]).toContain("context.issued");
});

test("generated logs are valid: run.started first and contiguous seq", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const evs = genEvents(seed, LENGTH);
    expect(evs).toHaveLength(LENGTH);
    expect(evs[0]?.type).toBe("run.started");
    expect(evs.map((e) => e.seq)).toEqual(Array.from({ length: LENGTH }, (_, i) => i + 1));
    expect(evs.slice(1).some((e) => e.type === "run.started")).toBe(false);
  }
});
