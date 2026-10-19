import { describe, expect, test } from "bun:test";
import { evaluateGate, gapKey, hasAgentGaps } from "../../src/gates/evaluate.ts";
import type { GateDef, Requirement, RunState } from "../../src/types.ts";
import {
  AGENT, HOOK, KERNEL, RUN, T1, T2, build, cmd, completed, deniedA, design, entered, evidence, g1, g2, grantedA, packWithGate, reenter, requestedA, review,
  taskAdded, taskCompleted, verify, withGaps, worktreeChanged,
} from "./fixtures.ts";

const gate = (state: RunState, fingerprint: string) => evaluateGate(state, state.current.stage, { fingerprint, weak: false });
const ruleGate = (...requires: Requirement[]): GateDef => ({ decider: "rule", requires, tasks: "none" });

describe("command requirements", () => {
  test("no test evidence: pending with an agent gap", () =>
    expect(gate(build([]), T1)).toMatchObject({ verdict: "pending", gaps: [{ kind: "missing", who: "agent", requirement: "command:test" }] }));
  test("fresh observed exit 0: pass", () => expect(gate(build([cmd(0, T1)]), T1).verdict).toBe("pass"));
  test("evidence at an older tree: stale", () => expect(gate(build([cmd(0, T1)]), T2).gaps[0]?.kind).toBe("stale"));
  test("fresh failure: fail", () => expect(gate(build([cmd(1, T1)]), T1).verdict).toBe("fail"));
  test("masked run never passes", () => {
    const g = gate(build([cmd(null, T1, { masked: true })]), T1);
    expect(g.verdict).toBe("pending");
    expect(g.gaps[0]?.text).toContain("hidden by a pipe");
  });
  test("a masked run with exit 0 still does not count", () =>
    expect(gate(build([cmd(0, T1, { masked: true })]), T1).gaps[0]).toMatchObject({ kind: "missing", requirement: "command:test" }));
  test("claimed command evidence does not satisfy observed", () =>
    expect(gate(build([cmd(0, T1, { provenance: "claimed" })]), T1).verdict).toBe("pending"));
  test("attested evidence outranks observed", () => expect(gate(build([cmd(0, T1, { provenance: "attested" })]), T1).verdict).toBe("pass"));
  test("evidence for another role does not count", () => expect(gate(build([cmd(0, T1, { role: "lint" })]), T1).verdict).toBe("pending"));
  test("latest fresh wins: pass at T1, fail at T2, back at T1 passes", () =>
    expect(gate(build([cmd(0, T1), cmd(1, T2)]), T1).verdict).toBe("pass"));
  test("flaky at the same tree: latest fails", () => expect(gate(build([cmd(0, T1), cmd(1, T1)]), T1).verdict).toBe("fail"));
  test("a later fresh pass clears an earlier failure", () => expect(gate(build([cmd(1, T1), cmd(0, T1)]), T1).verdict).toBe("pass"));
});

describe("gap text the agent acts on", () => {
  test("missing command names the role's commands and forbids chaining", () =>
    expect(gate(build([]), T1).gaps[0]?.text).toBe(
      'No observed "test" run at the current tree. Run one of: bun test, npm test, pytest, go test. Run it as its own command, not piped or chained with |, ||, ; or &.',
    ));
  test("masked command", () =>
    expect(gate(build([cmd(null, T1, { masked: true })]), T1).gaps[0]?.text).toBe(
      'The last "test" run\'s exit status was hidden by a pipe or chain, so it does not count. Re-run it as its own command.',
    ));
  test("stale command counts file edits since the run", () => {
    const s = build([worktreeChanged("a.ts"), cmd(0, T1, { changes: 1 }), worktreeChanged("a.ts"), worktreeChanged("b.ts"), worktreeChanged("c.ts")]);
    expect(gate(s, T2).gaps[0]?.text).toBe(
      'The last observed "test" run predates the current tree (3 file edits since, plus any shell changes). Re-run it.',
    );
  });
  test("stale command after one edit reads in the singular", () =>
    expect(gate(build([cmd(0, T1), worktreeChanged("a.ts")]), T2).gaps[0]?.text).toContain("(1 file edit since, plus any shell changes)"));
  test("failed command reports the exit code", () =>
    expect(gate(build([cmd(2, T1)]), T1).gaps[0]?.text).toBe('The last observed "test" run exited 2. Fix the failures and re-run it.'));
  test("a command with no exit code and no mask fails without printing null", () => {
    const g = gate(build([cmd(null, T1)]), T1);
    expect(g.verdict).toBe("fail");
    expect(g.gaps[0]?.text).toBe('The last observed "test" run ended without an exit code. Fix the failures and re-run it.');
  });
  test("open task", () =>
    expect(gate(build([cmd(0, T1)], { openTask: true }), T1).gaps).toEqual([
      { kind: "missing", who: "agent", requirement: "tasks:t1", text: 'Task t1 "add the route" is not completed.' },
    ]));
  test("approval not requested", () =>
    expect(gate(design([]), T1).gaps[0]?.text).toBe("Approval not requested. Present the design to the human, then call aos_request_approval."));
  test("approval waiting gives the human the exact command", () =>
    expect(gate(design([requestedA("r1")]), T1).gaps[0]?.text).toBe(`Waiting on the human. They approve with: aos approve ${RUN} design --root "/work/app"`));
  test("approval denied carries the human's reason", () =>
    expect(gate(design([requestedA("r1"), deniedA("r1", "needs a rollback plan.")]), T1).gaps[0]?.text).toBe(
      "The human denied approval: needs a rollback plan. Revise, then request approval again.",
    ));
});

describe("review requirements", () => {
  test("verify needs a fresh approved review", () => {
    expect(gate(verify([cmd(0, T1)]), T1).verdict).toBe("pending");
    expect(gate(verify([cmd(0, T1), review("approved", T1)]), T1).verdict).toBe("pass");
    expect(gate(verify([cmd(0, T1), review("approved", T1)]), T2).verdict).toBe("pending");
  });
  test("rejected review fails", () => expect(gate(verify([cmd(0, T1), review("rejected", T1)]), T1).verdict).toBe("fail"));
  test("needs-revision fails too", () => expect(gate(verify([cmd(0, T1), review("needs-revision", T1)]), T1).verdict).toBe("fail"));
  test("missing and stale reviews say how to record one", () => {
    const text = 'No approved review at the current tree. Review the change and record it with aos_evidence_record (kind "review").';
    expect(gate(verify([cmd(0, T1)]), T1).gaps[0]).toEqual({ kind: "missing", who: "agent", requirement: "review", text });
    expect(gate(verify([cmd(0, T2), review("approved", T1)]), T2).gaps[0]).toEqual({ kind: "stale", who: "agent", requirement: "review", text });
  });
  test("a failed review quotes the first 200 characters of feedback on one line", () => {
    const feedback = "Missing a test\nfor the 503 path. " + "x".repeat(300);
    const text = gate(verify([cmd(0, T1), review("rejected", T1, { feedback })]), T1).gaps[0]?.text ?? "";
    const quoted = ("Missing a test for the 503 path. " + "x".repeat(300)).slice(0, 200);
    expect(text).toBe(`The latest review is "rejected": ${quoted}. Address it and record a new review.`);
  });
  test("a failed review with empty feedback still reads cleanly", () =>
    expect(gate(verify([cmd(0, T1), review("rejected", T1, { feedback: "  " })]), T1).gaps[0]?.text).toBe(
      'The latest review is "rejected". Address it and record a new review.',
    ));
});

describe("tasks", () => {
  test("open task blocks the build gate", () => expect(gate(build([cmd(0, T1)], { openTask: true }), T1).verdict).toBe("pending"));
  test("a completed task does not block", () =>
    expect(gate(build([cmd(0, T1), taskCompleted("t1")], { openTask: true }), T1).verdict).toBe("pass"));
  test("tasks of another stage do not block", () =>
    expect(gate(build([cmd(0, T1), taskAdded("t9", "verify", "later")]), T1).verdict).toBe("pass"));
  test("a failure outranks pending gaps", () => expect(gate(build([cmd(1, T1)], { openTask: true }), T1).verdict).toBe("fail"));
});

describe("human decider", () => {
  test("not requested is an agent gap", () => expect(gate(design([]), T1).gaps[0]).toMatchObject({ who: "agent", requirement: "approval" }));
  test("requested waits on the human", () => expect(gate(design([requestedA("r1")]), T1).gaps[0]?.who).toBe("human"));
  test("granted passes; denied fails; re-request after denial waits", () => {
    expect(gate(design([requestedA("r1"), grantedA("r1")]), T1).verdict).toBe("pass");
    expect(gate(design([requestedA("r1"), deniedA("r1")]), T1).verdict).toBe("fail");
    expect(gate(design([requestedA("r1"), deniedA("r1"), requestedA("r2")]), T1).gaps[0]?.who).toBe("human");
  });
  test("a grant by anyone but a human leaves the gate waiting on the human", () => {
    for (const actor of [AGENT, KERNEL, HOOK]) {
      const s = design([requestedA("r1"), { type: "approval.granted", actor, data: { request: "r1", stage: "design", reason: null } }]);
      expect(gate(s, T1)).toMatchObject({ verdict: "pending", gaps: [{ kind: "missing", who: "human", requirement: "approval" }] });
      expect(gate(s, T1).gaps[0]?.text).toStartWith("Waiting on the human.");
    }
  });
  test("a denial by anyone but a human does not count either", () => {
    const s = design([requestedA("r1"), { type: "approval.denied", actor: AGENT, data: { request: "r1", stage: "design", reason: "self-denied" } }]);
    expect(gate(s, T1)).toMatchObject({ verdict: "pending", gaps: [{ kind: "missing", who: "human" }] });
  });
  test("a newer request outranks an older grant", () =>
    expect(gate(design([requestedA("r1"), grantedA("r1"), requestedA("r2")]), T1).verdict).toBe("pending"));
  test("approvals from before a stage re-entry do not count", () =>
    expect(gate(design([requestedA("r1"), grantedA("r1"), reenter("design")]), T1).verdict).toBe("pending"));
  test("approvals for another stage do not count", () => {
    const s = design([{ type: "approval.requested", actor: { kind: "agent", id: "claude-code", agent: null }, data: { request: "r1", stage: "build", summary: "x" } }]);
    expect(gate(s, T1).gaps[0]).toMatchObject({ who: "agent", requirement: "approval" });
  });
  test("a root with shell metacharacters is single-quoted in the approve command", () => {
    const s = design([requestedA("r1")]);
    const g = gate({ ...s, root: "/work/$HOME's `app`" }, T1);
    expect(g.gaps[0]?.text).toBe(`Waiting on the human. They approve with: aos approve ${RUN} design --root '/work/$HOME'\\''s \`app\`'`);
  });
  // A past stage's approval was requested before the current stage began, so it does not count when
  // that stage is evaluated later. Conservative on purpose: a pass that matters is read from lastGate.
  test("a human gate evaluated after leaving its stage is pending", () => {
    const s = design([requestedA("r1"), grantedA("r1"), entered("build", 1)]);
    expect(evaluateGate(s, "design", { fingerprint: T1, weak: false }).verdict).toBe("pending");
  });
});

describe("other evidence kinds", () => {
  const skillGate = ruleGate({ kind: "skill", provenance: "observed", fresh: false, match: "brainstorming" });
  const skill = (name: string, provenance: "observed" | "claimed" = "observed", fingerprint = T1) =>
    evidence({ id: `sk-${name}`, kind: "skill", provenance, fingerprint, changes: 0, stage: "build", agent: null, skill: name });

  test("missing skill evidence names provenance, kind, and match", () =>
    expect(gate(build([], { pack: packWithGate("build", skillGate) }), T1).gaps).toEqual([
      { kind: "missing", who: "agent", requirement: "skill:brainstorming", text: 'Missing observed skill evidence matching "brainstorming".' },
    ]));
  test("a matching observed skill passes, even at an older tree when fresh is off", () =>
    expect(gate(build([skill("superpowers:brainstorming", "observed", T2)], { pack: packWithGate("build", skillGate) }), T1).verdict).toBe("pass"));
  test("a claimed skill does not satisfy observed; another skill does not match", () => {
    const pack = packWithGate("build", skillGate);
    expect(gate(build([skill("brainstorming", "claimed")], { pack }), T1).verdict).toBe("pending");
    expect(gate(build([skill("writing-plans")], { pack }), T1).verdict).toBe("pending");
  });
  test("artifact match reads the path; citation match reads path or note", () => {
    const art = ruleGate({ kind: "artifact", provenance: "claimed", fresh: false, match: "docs/specs/" });
    const cit = ruleGate({ kind: "citation", provenance: "claimed", fresh: false, match: "rollback" });
    const artifact = evidence({ id: "a1", kind: "artifact", provenance: "claimed", fingerprint: T1, changes: 0, stage: "build", agent: null, path: "docs/specs/health.md", sha256: "sha256:00" });
    const citation = evidence({ id: "c1", kind: "citation", provenance: "claimed", fingerprint: T1, changes: 0, stage: "build", agent: null, path: "src/db.ts", line: 12, note: "rollback hook" });
    expect(gate(build([artifact], { pack: packWithGate("build", art) }), T1).verdict).toBe("pass");
    expect(gate(build([citation], { pack: packWithGate("build", cit) }), T1).verdict).toBe("pass");
  });
  test("a requirement without match is labelled by kind alone", () =>
    expect(gate(build([], { pack: packWithGate("build", ruleGate({ kind: "artifact", provenance: "claimed", fresh: false, match: null })) }), T1).gaps[0])
      .toMatchObject({ requirement: "artifact", text: "Missing claimed artifact evidence." }));
  test("stale evidence of other kinds asks for a new record", () => {
    const pack = packWithGate("build", ruleGate({ kind: "skill", provenance: "observed", fresh: true, match: "brainstorming" }));
    expect(gate(build([skill("brainstorming", "observed", T1), worktreeChanged("a.ts")], { pack }), T2).gaps[0]).toEqual({
      kind: "stale", who: "agent", requirement: "skill:brainstorming",
      text: 'The last observed skill evidence matching "brainstorming" predates the current tree (1 file edit since, plus any shell changes). Record it again.',
    });
  });
});

describe("stage order", () => {
  const unreached = {
    kind: "missing", who: "agent", requirement: "stage:verify",
    text: "The run is at build; the verify stage has not been reached. Pass the build gate and call aos_stage_advance.",
  };
  test("a later stage's gate cannot pass while the run is at an earlier stage", () => {
    const s = build([cmd(0, T1), review("approved", T1)], { openTask: true });
    expect(evaluateGate(s, "verify", { fingerprint: T1, weak: false })).toMatchObject({ verdict: "pending", gaps: [unreached] });
  });
  test("the same evidence passes once the run is at that stage", () =>
    expect(gate(verify([taskAdded("t1", "build", "add the route"), cmd(0, T1), review("approved", T1)]), T1).verdict).toBe("pass"));
  test("a completed run still evaluates its last gate normally", () =>
    expect(gate(verify([cmd(0, T1), review("approved", T1), completed("verify")]), T1).verdict).toBe("pass"));
  test("an earlier stage gets no stage-order gap", () =>
    expect(evaluateGate(build([cmd(0, T1)]), "design", { fingerprint: T1, weak: false }).gaps.map((g) => g.requirement)).toEqual(["approval"]));
});

describe("result shape", () => {
  test("carries the stage and the tree it was evaluated at", () =>
    expect(evaluateGate(build([cmd(0, T1)]), "verify", { fingerprint: T1, weak: false })).toMatchObject({ stage: "verify", fingerprint: T1, weakFreshness: false }));
  test("weak freshness propagates", () =>
    expect(evaluateGate(build([cmd(0, "counter:3")]), "build", { fingerprint: "counter:3", weak: true }).weakFreshness).toBe(true));
  test("a stage outside the tier throws", () => expect(() => evaluateGate(build([]), "frame", { fingerprint: T1, weak: false })).toThrow(/frame/));
  test("an empty rule gate passes", () =>
    expect(gate(build([], { pack: packWithGate("build", ruleGate()) }), T1)).toMatchObject({ verdict: "pass", gaps: [] }));
});

describe("hasAgentGaps and gapKey", () => {
  test("hasAgentGaps is false when only the human can act", () => expect(hasAgentGaps(gate(design([requestedA("r1")]), T1))).toBe(false));
  test("hasAgentGaps is true when the agent has work", () => expect(hasAgentGaps(gate(design([]), T1))).toBe(true));
  test("gapKey ignores gap order and is stable", () => expect(gapKey(withGaps([g1, g2]))).toBe(gapKey(withGaps([g2, g1]))));
  test("gapKey is verdict plus sorted requirement:kind:who triples", () =>
    expect(gapKey(withGaps([g1, g2]))).toBe("pending|approval:missing:human,command:test:missing:agent"));
  test("gapKey tells a request the agent has not made from one waiting on the human", () => {
    const pack = packWithGate("design", {
      decider: "human", tasks: "none",
      requires: [{ kind: "command", role: "test", result: "exit_zero", provenance: "observed", fresh: true }],
    });
    const notRequested = gate(design([], pack), T1);
    const waiting = gate(design([requestedA("r1")], pack), T1);
    expect(hasAgentGaps(waiting)).toBe(true);
    expect(gapKey(notRequested)).not.toBe(gapKey(waiting));
  });
  test("gapKey ignores text, so a growing edit count is not progress", () => {
    const after1 = gate(build([cmd(0, T1), worktreeChanged("a.ts")]), T2);
    const after2 = gate(build([cmd(0, T1), worktreeChanged("a.ts"), worktreeChanged("b.ts")]), T2);
    expect(after1.gaps[0]?.text).not.toBe(after2.gaps[0]?.text);
    expect(gapKey(after1)).toBe(gapKey(after2));
  });
  test("gapKey changes with the verdict", () => expect(gapKey(withGaps([g1], "fail"))).not.toBe(gapKey(withGaps([g1]))));
  test("a passing gate has an empty key body", () => expect(gapKey(gate(build([cmd(0, T1)]), T1))).toBe("pass|"));
});

