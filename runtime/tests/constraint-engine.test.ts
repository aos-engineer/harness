import { describe, it, expect } from "bun:test";
import { ConstraintEngine } from "../src/constraint-engine";
import type { ProfileConstraints, AuthMode } from "../src/types";

const defaultConstraints: ProfileConstraints = {
  time: { min_minutes: 2, max_minutes: 10 },
  budget: { min: 1.0, max: 10.0, currency: "USD" },
  rounds: { min: 2, max: 8 },
};

const meteredAuth: AuthMode = { type: "api_key", metered: true };
const subscriptionAuth: AuthMode = { type: "subscription", metered: false, subscription_tier: "max" };

describe("ConstraintEngine", () => {
  it("initializes with zeroed state", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    const state = engine.getState();
    expect(state.elapsed_minutes).toBe(0);
    expect(state.budget_spent).toBe(0);
    expect(state.rounds_completed).toBe(0);
    expect(state.metered).toBe(true);
  });

  it("tracks elapsed time", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(0.5, 3.0);
    const state = engine.getState();
    expect(state.elapsed_minutes).toBe(3.0);
    expect(state.rounds_completed).toBe(1);
  });

  it("tracks budget", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(2.5, 1.0);
    expect(engine.getState().budget_spent).toBe(2.5);
  });

  it("detects past minimums", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(1.5, 3.0); // round 1: $1.5 cost, 3min elapsed
    engine.recordRound(0.5, 5.0); // round 2: $0.5 cost (2.0 total), 5min elapsed
    const state = engine.getState();
    expect(state.past_min_time).toBe(true);
    expect(state.past_min_budget).toBe(true);
    expect(state.past_min_rounds).toBe(true);
    expect(state.past_all_minimums).toBe(true);
    expect(state.can_end).toBe(true);
  });

  it("detects approaching maximum (80%+)", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(8.5, 8.5); // $8.5 of $10, 8.5 of 10 min
    engine.recordRound(0, 0); // round 2
    const state = engine.getState();
    expect(state.approaching_max_budget).toBe(true);
    expect(state.approaching_max_time).toBe(true);
    expect(state.approaching_any_maximum).toBe(true);
  });

  it("detects hit maximum - time", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(1.0, 11.0); // over 10 min max
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("time");
  });

  it("detects hit maximum - budget", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(11.0, 1.0); // over $10 max
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("budget");
  });

  it("detects constraint conflict - budget max before time min", () => {
    const constraints: ProfileConstraints = {
      time: { min_minutes: 5, max_minutes: 10 },
      budget: { min: 1.0, max: 2.0, currency: "USD" },
      rounds: { min: 2, max: 8 },
    };
    const engine = new ConstraintEngine(constraints, meteredAuth);
    engine.recordRound(3.0, 1.0); // $3 > $2 max, but only 1 min < 5 min min
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("constraint_conflict");
    expect(state.conflict_detail).toContain("budget");
    expect(state.can_end).toBe(true); // max overrides
  });

  it("can_end is false when minimums not met and no max hit", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(0.1, 0.5); // barely anything
    const state = engine.getState();
    expect(state.can_end).toBe(false);
  });

  it("disables budget in subscription mode", () => {
    const engine = new ConstraintEngine(defaultConstraints, subscriptionAuth);
    const state = engine.getState();
    expect(state.metered).toBe(false);
    engine.recordRound(999.0, 3.0); // huge "cost" but unmetered
    const after = engine.getState();
    expect(after.budget_spent).toBe(0);
    expect(after.hit_maximum).toBe(false);
  });

  it("disables budget when budget constraint is null", () => {
    const constraints: ProfileConstraints = {
      time: { min_minutes: 2, max_minutes: 10 },
      budget: null,
      rounds: { min: 2, max: 8 },
    };
    const engine = new ConstraintEngine(constraints, meteredAuth);
    engine.recordRound(999.0, 3.0);
    const state = engine.getState();
    expect(state.budget_spent).toBe(0);
    expect(state.past_min_budget).toBe(true);
  });

  it("detects rounds maximum", () => {
    const constraints: ProfileConstraints = {
      time: { min_minutes: 0, max_minutes: 100 },
      budget: null,
      rounds: { min: 1, max: 3 },
    };
    const engine = new ConstraintEngine(constraints, meteredAuth);
    engine.recordRound(0, 1);
    engine.recordRound(0, 1);
    engine.recordRound(0, 1);
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("rounds");
  });

  it("estimateCost returns cost for a round", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    const cost = engine.estimateRoundCost(8, 2000, {
      inputPerMillionTokens: 3.0,
      outputPerMillionTokens: 15.0,
      currency: "USD",
    });
    // 8 agents x 2000 input tokens x $3/M + 8 agents x 2000 output tokens x $15/M
    // = 8 x 0.006 + 8 x 0.03 = 0.048 + 0.24 = 0.288
    expect(cost).toBeCloseTo(0.288, 2);
  });
});
