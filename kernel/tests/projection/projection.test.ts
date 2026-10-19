import { describe, expect, test } from "bun:test";
import { applyEvent, project, projector, stageDef } from "../../src/projection.ts";
import type { CommandEvidence, EventDraft, GateResult } from "../../src/types.ts";
import {
  HOOK, HUMAN, KERNEL, ROOT, RUN, T1, at, budgetExceeded, budgetWarning, cancelled, charged, completed, denied,
  entered, granted, log, requested, sessionBound, started, taskAdded, taskCompleted, unknownEvent, worktreeChanged,
} from "../gates/fixtures.ts";

const testRun: CommandEvidence = {
  id: "ev-a", kind: "command", provenance: "observed", fingerprint: T1, changes: 0, stage: "build", agent: null,
  role: "test", command: "bun test", exitCode: 0, masked: false, outputSha256: "sha256:" + "b".repeat(64), tail: "3 pass",
};
const recorded = (ev: CommandEvidence): EventDraft => ({ type: "evidence.recorded", actor: HOOK, data: ev });
const evaluated = (result: GateResult): EventDraft => ({ type: "gate.evaluated", actor: KERNEL, data: result });

describe("run.started", () => {
  test("enters the first stage of the tier", () =>
    expect(project(log(started("bounded"))).current).toEqual({ stage: "design", index: 0, enteredSeq: 1 }));

  test("takes identity, stages, and the iteration budget from the event and its pack", () => {
    const s = project(log(started("spike")));
    expect(s).toMatchObject({
      run: RUN, status: "active", tier: "spike", tierReason: 'keyword "spike"', brief: "add a health endpoint",
      root: ROOT, git: true, host: "claude-code", stages: ["frame", "probe"],
      budget: { iterations: { used: 0, limit: 20, warned: false, exceeded: false } },
      tasks: [], evidence: [], approvals: [], lastGate: {}, sessions: [], changes: 0, stop: { lastGapKey: null },
      startedAt: "2026-10-19T00:00:01.000Z", updatedAt: "2026-10-19T00:00:01.000Z", seq: 1,
    });
    expect(s.pack.name).toBe("feature-delivery");
  });

  test("throws when the first event is not run.started", () => expect(() => project(log(entered("build", 1)))).toThrow(/must be run\.started/));
  test("throws on an empty log", () => expect(() => project([])).toThrow(/must be run\.started/));
  test("throws on a second run.started rather than resetting the run", () =>
    expect(() => project(log(started(), charged("k"), started()))).toThrow(/already started/));
  test("throws when the pack has no stages for the tier", () => {
    const d = started("bounded");
    if (d.type !== "run.started") throw new Error("fixture");
    const architectural = { ...d, data: { ...d.data, tier: "architectural" as const } };
    expect(() => project(log(architectural))).toThrow(/architectural/);
  });
});

describe("reducer rows", () => {
  test("stage.entered moves current and clears lastGapKey", () => {
    const s = project(log(started(), charged("k"), entered("build", 1)));
    expect(s.current).toEqual({ stage: "build", index: 1, enteredSeq: 3 });
    expect(s.stop.lastGapKey).toBeNull();
  });

  test("run.completed and run.cancelled set the status", () => {
    expect(project(log(started(), completed("verify"))).status).toBe("completed");
    expect(project(log(started(), cancelled("abandoned"))).status).toBe("cancelled");
  });

  test("task.added opens a task and task.completed closes only the matching one", () => {
    const s = project(log(started(), taskAdded("t1", "build", "add route"), taskAdded("t2", "build", "add test"), taskCompleted("t1", ["ev-a"])));
    expect(s.tasks).toEqual([
      { id: "t1", stage: "build", title: "add route", done: true, evidence: ["ev-a"] },
      { id: "t2", stage: "build", title: "add test", done: false, evidence: [] },
    ]);
  });

  test("evidence.recorded keeps the item with its seq", () =>
    expect(project(log(started(), worktreeChanged("a.ts"), recorded(testRun))).evidence).toEqual([{ ...testRun, seq: 3 }]));

  test("gate.evaluated keeps the latest result per stage", () => {
    const pending: GateResult = { stage: "build", verdict: "pending", gaps: [], fingerprint: T1, weakFreshness: false };
    const s = project(log(started(), evaluated(pending), evaluated({ ...pending, verdict: "pass" }), evaluated({ ...pending, stage: "design" })));
    expect(s.lastGate.build?.verdict).toBe("pass");
    expect(Object.keys(s.lastGate).sort()).toEqual(["build", "design"]);
  });

  test("approval decisions attach to their request", () =>
    expect(project(log(started(), requested("r1"), granted("r1"))).approvals[0]?.decision?.granted).toBe(true));

  test("approval decisions record reason, actor, and seq, and leave other requests open", () => {
    const s = project(log(started(), requested("r1"), requested("r2"), denied("r1", "too broad")));
    expect(s.approvals).toEqual([
      { request: "r1", stage: "design", summary: "short design for the health endpoint", requestedSeq: 2,
        decision: { granted: false, reason: "too broad", actor: HUMAN, seq: 4 } },
      { request: "r2", stage: "design", summary: "short design for the health endpoint", requestedSeq: 3, decision: null },
    ]);
  });

  test("budget.charged accumulates iterations and remembers the gap key", () => {
    const s = project(log(started(), charged("a"), charged("b", 2)));
    expect(s.budget.iterations.used).toBe(3);
    expect(s.stop.lastGapKey).toBe("b");
  });

  test("budget.warning and budget.exceeded set their flags", () => {
    expect(project(log(started(), budgetWarning(16))).budget.iterations).toMatchObject({ warned: true, exceeded: false });
    expect(project(log(started(), budgetExceeded(20))).budget.iterations).toMatchObject({ warned: false, exceeded: true });
  });

  test("worktree.changed counts edits", () =>
    expect(project(log(started(), worktreeChanged("a.ts"), worktreeChanged("a.ts"))).changes).toBe(2));

  test("session.bound adds a session once", () =>
    expect(project(log(started(), sessionBound("s1"), sessionBound("s1"), sessionBound("s2"))).sessions).toEqual([
      { host: "claude-code", session: "s1" }, { host: "claude-code", session: "s2" },
    ]));

  test("every event advances seq and updatedAt", () => {
    const s = project(log(started(), worktreeChanged("a.ts"), { type: "action.allowed", actor: HOOK, data: { action: "commit", tool: "Bash", gate: null } }));
    expect(s.seq).toBe(3);
    expect(s.updatedAt).toBe("2026-10-19T00:00:03.000Z");
    expect(s.startedAt).toBe("2026-10-19T00:00:01.000Z");
  });

  test("unknown event types only advance seq (forward compatibility)", () => {
    const s = project(log(started(), unknownEvent("context.issued", { stage: "build", index: 1 })));
    expect(s.current.stage).toBe("design");
    expect(s.seq).toBe(2);
  });
});

describe("purity", () => {
  test("does not mutate the input state", () => {
    const s = project(log(started(), taskAdded("t1", "build", "add route"), requested("r1"), sessionBound("s1")));
    const copy = structuredClone(s);
    for (const d of [entered("build", 1), taskCompleted("t1"), granted("r1"), charged("k"), budgetWarning(16), sessionBound("s2"), recorded(testRun), worktreeChanged("a.ts")]) {
      applyEvent(s, at(s.seq + 1, d));
    }
    expect(s).toEqual(copy);
  });

  test("does not mutate the events it reads", () => {
    const events = log(started(), taskAdded("t1", "build", "add route"), taskCompleted("t1", ["ev-a"]), requested("r1"), granted("r1"));
    const copy = structuredClone(events);
    const s = project(events);
    s.tasks[0]?.evidence.push("ev-b");
    expect(events).toEqual(copy);
  });

  test("projector.apply is the reducer", () =>
    expect(projector.apply(null, at(1, started()))).toEqual(project(log(started()))));
});

describe("stageDef", () => {
  test("defaults to the current stage", () => {
    expect(stageDef(project(log(started()))).name).toBe("design");
    expect(stageDef(project(log(started(), entered("build", 1)))).gate.tasks).toBe("all");
  });
  test("looks up a named stage in the run's tier", () =>
    expect(stageDef(project(log(started())), "verify").gate.requires.map((r) => r.kind)).toEqual(["command", "review"]));
  test("throws for a stage outside the run's tier", () =>
    expect(() => stageDef(project(log(started("spike"))), "verify")).toThrow(/verify/));
});
