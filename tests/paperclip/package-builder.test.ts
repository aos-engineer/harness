import { test, expect, describe } from "bun:test";
import { buildWorkProduct, failedPassComment } from "../../cli/src/paperclip/package-builder";
import type { PassResult } from "../../cli/src/paperclip/types";

function passWith(pkg: string): PassResult {
  return { package: pkg, costUsd: 0.0123, rounds: 4, elapsedMinutes: 1.2, sections: {} };
}

describe("buildWorkProduct", () => {
  test("includes the provenance header, cost, and the package body", () => {
    const wp = buildWorkProduct(passWith("## Plan\n1. Add the endpoint."));
    expect(wp.comment).toContain("in review");
    expect(wp.comment).toContain("$0.0123");
    expect(wp.comment).toContain("rounds: 4");
    expect(wp.comment).toContain("Add the endpoint.");
  });
});

describe("canned comments", () => {
  test("failed carries the reason and an action", () => {
    const c = failedPassComment("boom");
    expect(c).toContain("boom");
    expect(c.toLowerCase()).toContain("action needed");
    expect(c.toLowerCase()).toContain("nothing was published");
  });
});
