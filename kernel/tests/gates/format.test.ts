import { describe, expect, test } from "bun:test";
import { formatGate, renderSummary } from "../../src/gates/format.ts";
import type { Gap, GateResult } from "../../src/types.ts";
import { RUN, T1, build, cancelled, charged, design, evaluated, g1, g2, withGaps } from "./fixtures.ts";

const agentGap = (i: number, text = `Gap ${i} needs work.`): Gap => ({ kind: "missing", who: "agent", requirement: `artifact:${i}`, text });
const state = build([]);
const mixed: GateResult = {
  stage: "verify", verdict: "pending", fingerprint: T1, weakFreshness: false,
  gaps: [
    { kind: "missing", who: "human", requirement: "approval", text: "Waiting on the human. They approve with: aos approve x verify" },
    { kind: "missing", who: "agent", requirement: "command:test", text: 'No observed "test" run at the current tree.' },
  ],
};
const twelveGaps = withGaps(Array.from({ length: 12 }, (_, i) => agentGap(i + 1)));

describe("formatGate", () => {
  test("puts agent gaps first and names the verb", () => {
    const t = formatGate(mixed, state, "push");
    expect(t.split("\n")[0]).toBe("AOS: push blocked: verify gate pending.");
    expect(t.indexOf("Waiting on the human")).toBeGreaterThan(t.indexOf("No observed"));
  });
  test("caps gap lines at 8", () => expect(formatGate(twelveGaps, state, "stop").split("\n").length).toBe(10));
  test("renders one dash line per gap and counts the rest", () => {
    const lines = formatGate(twelveGaps, state, "stop").split("\n");
    expect(lines[1]).toBe("- Gap 1 needs work.");
    expect(lines[8]).toBe("- Gap 8 needs work.");
    expect(lines[9]).toBe("- (+4 more; see aos_status)");
  });
  test("keeps the original order within agent and human gaps", () =>
    expect(formatGate(withGaps([g2, agentGap(1), { ...g2, text: "Human two." }, agentGap(2)]), state, "commit").split("\n")).toEqual([
      "AOS: commit blocked: build gate pending.", "- Gap 1 needs work.", "- Gap 2 needs work.", "- Waiting on the human.", "- Human two.",
    ]));
  test("exactly 8 gaps need no overflow line", () =>
    expect(formatGate(withGaps(Array.from({ length: 8 }, (_, i) => agentGap(i))), state, "stop").split("\n")).toHaveLength(9));
  test("a failed gate says fail", () => expect(formatGate(withGaps([g1], "fail"), state, "push")).toBe("AOS: push blocked: build gate fail.\n- No observed test run."));
});

describe("renderSummary", () => {
  test("names run, pack, stage, gate, stage progress, and iterations", () => {
    const s = build([evaluated({ ...withGaps([], "pass"), stage: "design" }), charged("k"), charged("k"), charged("k")]);
    expect(renderSummary(s, withGaps([g2, g1]))).toBe([
      `AOS run ${RUN} (bounded, feature-delivery@1.0.0), active.`,
      "Stage 2/3: build. Gate: pending.",
      "- No observed test run.",
      "- Waiting on the human.",
      "Stages: design (passed), build (current), verify",
      "Iterations: 3/20.",
    ].join("\n"));
  });
  test("without a gate it says not evaluated and lists no gaps", () =>
    expect(renderSummary(design([cancelled("abandoned")]), null)).toBe([
      `AOS run ${RUN} (bounded, feature-delivery@1.0.0), cancelled.`,
      "Stage 1/3: design. Gate: not evaluated.",
      "Stages: design (current), build, verify",
      "Iterations: 0/20.",
    ].join("\n")));
  test("caps gap lines at 8 with an overflow line", () => {
    const lines = renderSummary(state, twelveGaps).split("\n");
    expect(lines.filter((l) => l.startsWith("- Gap"))).toHaveLength(8);
    expect(lines).toContain("- (+4 more; see aos_status)");
  });
  test("fits in 1200 chars and names stage and iterations", () => {
    const bigState = build([charged("k"), charged("k"), charged("k")]);
    const gateResult = withGaps(Array.from({ length: 12 }, (_, i) => agentGap(i, `Gap ${i}: ${"long detail ".repeat(25)}`)));
    const t = renderSummary(bigState, gateResult);
    expect(t.length).toBeLessThanOrEqual(1200);
    expect(t).toContain("Stage 2/3: build");
    expect(t).toContain("Iterations: 3/20.");
    expect(t).toMatch(/- \(\+\d+ more; see aos_status\)/);
  });
  test("a single oversized gap is cut rather than pushing out the iteration line", () => {
    const t = renderSummary(state, withGaps([agentGap(1, "x".repeat(5000))]));
    expect(t.length).toBeLessThanOrEqual(1200);
    expect(t).toContain("Stage 2/3: build");
    expect(t.endsWith("Iterations: 0/20.")).toBe(true);
    expect(t).toContain("- " + "x".repeat(100));
    expect(t).toMatch(/x\.\.\.\n/);
  });
});
