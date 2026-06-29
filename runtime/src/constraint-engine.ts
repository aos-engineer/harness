/**
 * Constraint Engine — evaluates time/budget/rounds against profile constraints.
 *
 * Constraint priority (spec Section 6.6):
 * 1. budget_max (hard ceiling, always wins)
 * 2. time_max (hard ceiling, always wins)
 * 3. rounds_max (hard ceiling, always wins)
 * 4-6. Soft floors overridden by any max ceiling
 *
 * Auth-aware (spec Section 6.7):
 * - metered: true → budget fully tracked
 * - metered: false OR budget: null → budget disabled, fields zeroed
 */

import type { ProfileConstraints, AuthMode, ConstraintState, ModelCost } from "./types";
import { createDefaultConstraintState } from "./types";

export class ConstraintEngine {
  private state: ConstraintState;
  private constraints: ProfileConstraints;
  private budgetEnabled: boolean;

  constructor(constraints: ProfileConstraints, authMode: AuthMode) {
    this.constraints = constraints;
    this.budgetEnabled = authMode.metered && constraints.budget !== null;
    this.state = createDefaultConstraintState();
    this.state.metered = authMode.metered;

    // If budget disabled, mark min as always met
    if (!this.budgetEnabled) {
      this.state.past_min_budget = true;
    }
  }

  /**
   * Record the result of a completed round.
   * @param roundCost - Total cost of this round (ignored if budget disabled)
   * @param elapsedMinutes - ABSOLUTE elapsed time from session start
   */
  recordRound(roundCost: number, elapsedMinutes: number): void {
    this.state.rounds_completed += 1;
    this.state.elapsed_minutes = Math.max(this.state.elapsed_minutes, elapsedMinutes);

    if (this.budgetEnabled) {
      this.state.budget_spent += roundCost;
    }

    this.evaluate();
  }

  updateTime(elapsedMinutes: number): void {
    this.state.elapsed_minutes = elapsedMinutes;
    this.evaluate();
  }

  getState(): ConstraintState {
    return { ...this.state };
  }

  estimateRoundCost(
    agentCount: number,
    estimatedTokensPerAgent: number,
    modelCost: ModelCost,
  ): number {
    const inputCost = agentCount * estimatedTokensPerAgent * (modelCost.inputPerMillionTokens / 1_000_000);
    const outputCost = agentCount * estimatedTokensPerAgent * (modelCost.outputPerMillionTokens / 1_000_000);
    return inputCost + outputCost;
  }

  /**
   * Check if a round with estimated cost would exceed remaining budget.
   * Safety margin applied to the ESTIMATE (not the remaining budget).
   * Returns remaining headroom (negative = would exceed).
   */
  checkBudgetHeadroom(estimatedCost: number, safetyMargin: number): number {
    if (!this.budgetEnabled || !this.constraints.budget) return Infinity;
    const remaining = this.constraints.budget.max - this.state.budget_spent;
    const estimateWithMargin = estimatedCost * (1 + safetyMargin);
    return remaining - estimateWithMargin;
  }

  updateBias(biasRatio: number, mostAddressed: string[], leastAddressed: string[], blocked: boolean): void {
    this.state.bias_ratio = biasRatio;
    this.state.most_addressed = [...mostAddressed];
    this.state.least_addressed = [...leastAddressed];
    this.state.bias_blocked = blocked;
  }

  /**
   * Check if progress toward a minimum is significantly below the threshold.
   * A conflict is only flagged when less than half the minimum has been achieved,
   * indicating a structural tension between constraints rather than a minor shortfall.
   */
  private isSignificantMinGap(current: number, min: number): boolean {
    if (min <= 0) return false;
    return current / min < 0.5;
  }

  private evaluate(): void {
    const { time, budget, rounds } = this.constraints;
    const s = this.state;

    // ── Minimums ──
    s.past_min_time = s.elapsed_minutes >= time.min_minutes;
    s.past_min_rounds = s.rounds_completed >= rounds.min;

    if (this.budgetEnabled && budget) {
      s.past_min_budget = s.budget_spent >= budget.min;
    }

    s.past_all_minimums = s.past_min_time && s.past_min_budget && s.past_min_rounds;

    // ── Approaching maximums (80%+) ──
    s.approaching_max_time = s.elapsed_minutes >= time.max_minutes * 0.8;
    s.approaching_max_rounds = s.rounds_completed >= rounds.max * 0.8;

    if (this.budgetEnabled && budget) {
      s.approaching_max_budget = s.budget_spent >= budget.max * 0.8;
    } else {
      s.approaching_max_budget = false;
    }

    s.approaching_any_maximum = s.approaching_max_time || s.approaching_max_budget || s.approaching_max_rounds;

    // ── Hard maximums ──
    const hitTime = s.elapsed_minutes >= time.max_minutes;
    const hitBudget = this.budgetEnabled && budget ? s.budget_spent >= budget.max : false;
    const hitRounds = s.rounds_completed >= rounds.max;

    s.hit_maximum = hitTime || hitBudget || hitRounds;

    if (s.hit_maximum) {
      // Check for constraint conflict: a max is hit while another dimension's
      // min is far from being met (< 50% progress), indicating structural tension
      // between the profile constraints.
      const conflicts: string[] = [];

      if (hitBudget && this.isSignificantMinGap(s.elapsed_minutes, time.min_minutes)) {
        conflicts.push("budget_max hit before time_min met");
      }
      if (hitBudget && this.isSignificantMinGap(s.rounds_completed, rounds.min)) {
        conflicts.push("budget_max hit before rounds_min met");
      }
      if (hitTime && this.budgetEnabled && budget && this.isSignificantMinGap(s.budget_spent, budget.min)) {
        conflicts.push("time_max hit before budget_min met");
      }
      if (hitTime && this.isSignificantMinGap(s.rounds_completed, rounds.min)) {
        conflicts.push("time_max hit before rounds_min met");
      }
      if (hitRounds && this.isSignificantMinGap(s.elapsed_minutes, time.min_minutes)) {
        conflicts.push("rounds_max hit before time_min met");
      }
      if (hitRounds && this.budgetEnabled && budget && this.isSignificantMinGap(s.budget_spent, budget.min)) {
        conflicts.push("rounds_max hit before budget_min met");
      }

      if (conflicts.length > 0) {
        s.hit_reason = "constraint_conflict";
        s.conflict_detail = conflicts.join("; ");
      } else if (hitBudget) {
        s.hit_reason = "budget";
      } else if (hitTime) {
        s.hit_reason = "time";
      } else {
        s.hit_reason = "rounds";
      }
    } else {
      s.hit_reason = "none";
      s.conflict_detail = undefined;
    }

    // ── Can end? ──
    s.can_end = s.past_all_minimums || s.hit_maximum;
  }
}
