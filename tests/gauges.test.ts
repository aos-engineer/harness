import { test, expect } from "bun:test";
import { renderTextGauge, renderRoundOneLiner } from "../cli/src/gauges";

test("renderTextGauge produces a labeled bar with min/max", () => {
  const out = renderTextGauge("TIME", 4.2, 2, 10, "min");
  expect(out).toContain("TIME");
  expect(out).toContain("4.2");
  expect(out).toContain("min: 2");
  expect(out).toContain("max: 10");
});

test("renderRoundOneLiner produces a compact summary", () => {
  const out = renderRoundOneLiner({ round: 3, maxRounds: 8, minutes: 4.2, dollars: 0.45 });
  expect(out).toContain("Round 3/8");
  expect(out).toContain("4.2min");
  expect(out).toContain("$0.45");
});
