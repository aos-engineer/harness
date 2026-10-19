import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { handleHook } from "../../src/hooks/handle.ts";
import type { HookDecision, RunLocation } from "../../src/types.ts";
import { tmpGitRepo } from "../helpers.ts";
import {
  ALLOW, append, at, bound, complete, events, grantApproval, input, lastEvent, pass, requestApproval, setUsed, startRun, state, testRun, types,
} from "./helpers.ts";

let repo: string;
let run: string;
let loc: RunLocation;

beforeEach(() => {
  repo = tmpGitRepo();
  run = startRun(repo, "bounded");
  loc = { root: repo, run };
  bound(repo, run);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const stop = (promptId: string | null): HookDecision => handleHook(input({ event: "stop", cwd: repo, promptId }));
const sessionStart = (source: string): HookDecision => handleHook(input({ event: "session-start", cwd: repo, source }));
const used = () => state(loc).budget.iterations.used;
const count = (type: string) => types(loc).filter((t) => t === type).length;

function blocked(d: HookDecision): string {
  expect(d.kind).toBe("block-stop");
  return d.kind === "block-stop" ? d.reason : "";
}

function notice(d: HookDecision): string {
  expect(d.kind).toBe("allow");
  return d.kind === "allow" ? (d.notice ?? "") : "";
}

describe("Stop", () => {
  test("blocks when tests are missing and charges an iteration", () => {
    at(loc, "build");
    const reason = blocked(stop("P1"));
    expect(reason).toStartWith("AOS: stop blocked: build gate pending.\n");
    expect(reason).toContain('No observed "test" run');
    expect(reason).toEndWith("\nKeep working on the gaps above.");
    expect(used()).toBe(1);
    expect(lastEvent(loc)).toMatchObject({
      type: "budget.charged", data: { dimension: "iterations", amount: 1, gapKey: "P1|pending|command:test:missing:agent" },
    });
  });

  test("does not block twice on the same gaps in one prompt", () => {
    at(loc, "build");
    stop("P1");
    const text = notice(stop("P1"));
    expect(text).toStartWith("AOS: no progress on these gaps since the last nudge, so handing back to you:\n- ");
    expect(text).toContain('No observed "test" run');
    expect(used()).toBe(1);
  });

  test("a new prompt gets a fresh nudge", () => {
    at(loc, "build");
    stop("P1");
    stop("P1");
    blocked(stop("P2"));
    expect(used()).toBe(2);
  });

  test("a missing prompt id still stops a repeat nudge", () => {
    at(loc, "build");
    blocked(stop(null));
    expect(stop(null).kind).toBe("allow");
  });

  test("progress changes the gap set and keeps the loop going", () => {
    at(loc, "build");
    stop("P1");
    testRun(loc, 1);
    expect(blocked(stop("P1"))).toContain("exited 1");
  });

  test("never blocks while only the human can act", () => {
    requestApproval(loc);
    const text = notice(stop("P1"));
    expect(text).toStartWith("AOS: waiting on the human.\n- ");
    expect(text).toContain(`aos approve ${run} design`);
    expect(count("budget.charged")).toBe(0);
  });

  test("approval not yet requested is an agent gap", () => {
    expect(blocked(stop("P1"))).toContain("aos_request_approval");
  });

  test("a passed but unadvanced gate blocks once, with a plain instruction", () => {
    at(loc, "build");
    testRun(loc, 0);
    expect(blocked(stop("P1"))).toBe("AOS: the build gate passes. Call aos_stage_advance to continue.");
    expect(notice(stop("P1"))).toContain("aos_stage_advance");
  });

  test("an approved design is a passed gate that still needs advancing", () => {
    grantApproval(loc, requestApproval(loc));
    expect(blocked(stop("P1"))).toBe("AOS: the design gate passes. Call aos_stage_advance to continue.");
  });

  test("the advance instruction still carries the budget line late in the budget", () => {
    at(loc, "build");
    testRun(loc, 0);
    setUsed(loc, 16, false);
    expect(blocked(stop("P1"))).toBe("AOS: the build gate passes. Call aos_stage_advance to continue.\nIteration budget: 17/20 used.");
  });

  test("a passing last stage lets the agent stop quietly", () => {
    at(loc, "verify");
    pass(loc);
    expect(stop("P1")).toEqual(ALLOW);
  });

  test("exhausted iteration budget lets the agent stop", () => {
    at(loc, "build");
    setUsed(loc, 20, true);
    const text = notice(stop("P9"));
    expect(text).toStartWith("AOS: iteration budget used (20/20). Open gaps:\n- ");
    expect(used()).toBe(20);
  });

  test("a used-up budget lets the agent stop even before it is marked exceeded", () => {
    at(loc, "build");
    setUsed(loc, 20, false);
    expect(stop("P9").kind).toBe("allow");
  });

  test("the charge that reaches the limit marks the budget exceeded", () => {
    at(loc, "build");
    setUsed(loc, 19, false);
    blocked(stop("P1"));
    expect(state(loc).budget.iterations).toMatchObject({ used: 20, exceeded: true });
    expect(lastEvent(loc)).toMatchObject({ type: "budget.exceeded", data: { dimension: "iterations", used: 20, limit: 20 } });
    expect(stop("P2").kind).toBe("allow");
  });

  test("warning fires once at 80 percent and the block says so", () => {
    at(loc, "build");
    setUsed(loc, 15, false);
    expect(blocked(stop("P1"))).toContain("Iteration budget: 16/20 used.");
    expect(count("budget.warning")).toBe(1);
    expect(lastEvent(loc)).toMatchObject({ type: "budget.warning", data: { dimension: "iterations", used: 16, limit: 20 } });
    blocked(stop("P2"));
    expect(count("budget.warning")).toBe(1);
  });

  test("no warning below 80 percent", () => {
    at(loc, "build");
    setUsed(loc, 14, false);
    expect(blocked(stop("P1"))).not.toContain("Iteration budget");
    expect(count("budget.warning")).toBe(0);
  });

  test("completed and cancelled runs never block", () => {
    complete(loc);
    expect(stop("P1")).toEqual(ALLOW);
    append(loc, { type: "run.cancelled", actor: { kind: "human", id: "owner", agent: null }, data: { reason: "done" } });
    expect(stop("P1")).toEqual(ALLOW);
  });
});

describe("SessionStart", () => {
  test("SessionStart (compact) re-injects run id, stage, and gaps", () => {
    at(loc, "build");
    const text = notice(sessionStart("compact"));
    expect(text).toContain(`AOS run ${run}`);
    expect(text).toContain("Stage 2/3: build.");
    expect(text).toContain('No observed "test" run');
    expect(text).toEndWith(`\nRun id: ${run}. Use aos_status for detail; follow the current stage's instructions.`);
  });

  test("every source gets the same summary", () => {
    at(loc, "build");
    const texts = ["startup", "resume", "clear", "compact", "fork"].map((s) => notice(sessionStart(s)));
    expect(new Set(texts).size).toBe(1);
  });

  test("a passed but unadvanced gate is re-injected as the next step", () => {
    at(loc, "build");
    testRun(loc, 0);
    expect(notice(sessionStart("compact"))).toContain("Call aos_stage_advance to continue.");
  });

  test("it reads state without logging anything", () => {
    at(loc, "build");
    const n = events(loc).length;
    sessionStart("startup");
    expect(events(loc).length).toBe(n);
  });

  test("a completed run gets a one-line notice", () => {
    complete(loc);
    const text = notice(sessionStart("resume"));
    expect(text).toContain(run);
    expect(text).toContain("completed");
    expect(text).not.toContain("\n");
  });
});
