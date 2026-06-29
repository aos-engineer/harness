import { describe, it, expect } from "bun:test";
import { fuzzyScore } from "../src/fuzzy-match";

describe("fuzzyScore", () => {
  it("returns 1.0 for exact match", () => {
    expect(fuzzyScore("auth migration", "auth migration")).toBe(1.0);
  });

  it("returns high score for word reordering", () => {
    const score = fuzzyScore("migration auth", "auth migration");
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns moderate score for partial match", () => {
    const score = fuzzyScore("auth", "auth migration to Clerk");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1.0);
  });

  it("returns low score for unrelated strings", () => {
    const score = fuzzyScore("database sharding", "frontend CSS styling");
    expect(score).toBeLessThan(0.2);
  });

  it("handles typos via Levenshtein", () => {
    const score = fuzzyScore("authetication", "authentication");
    expect(score).toBeGreaterThan(0.7);
  });

  it("is case-insensitive", () => {
    const score = fuzzyScore("Auth Migration", "auth migration");
    expect(score).toBe(1.0);
  });

  it("returns 0 for empty query", () => {
    expect(fuzzyScore("", "some content")).toBe(0);
  });

  it("returns 0 for empty content", () => {
    expect(fuzzyScore("query", "")).toBe(0);
  });
});
