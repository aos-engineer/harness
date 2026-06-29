import { test, expect, describe } from "bun:test";
import {
  WorkerRunner,
  pickIssue,
  isBudgetExhausted,
  type WorkerDeps,
} from "../../cli/src/paperclip/worker-runner";
import { PaperclipConflictError } from "../../cli/src/paperclip/paperclip-client";
import type { AgentIdentity, Issue, PassInput, PassResult } from "../../cli/src/paperclip/types";

const ISSUE: Issue = { id: "ISS-1", title: "Add a /metrics endpoint", status: "todo", companyId: "C1" };

function goodPackage(): string {
  return "## Plan\n1. Add the endpoint.\n## Risks\n- None material.";
}

// ── A recording fake of PaperclipClient ────────────────────────────
class FakePaperclip {
  identity: AgentIdentity = { id: "A1", companyId: "C1", budget: null };
  inbox: Issue[] = [];
  issue: Issue = ISSUE;
  checkoutBehavior: "ok" | "conflict" = "ok";

  calls = {
    checkout: 0,
    comments: [] as { issueId: string; text: string }[],
    statuses: [] as { issueId: string; status: string; comment?: string }[],
    costs: [] as { costUsd: number }[],
    liveness: [] as { liveness: string; outcome?: string }[],
  };

  async getIdentity() {
    return this.identity;
  }
  async getApproval() {
    return {};
  }
  async getApprovalIssues() {
    return [];
  }
  async getInbox() {
    return this.inbox;
  }
  async getIssue() {
    return this.issue;
  }
  async checkout(issueId: string) {
    this.calls.checkout++;
    if (this.checkoutBehavior === "conflict") throw new PaperclipConflictError(issueId);
  }
  async postComment(issueId: string, _runId: string, text: string) {
    this.calls.comments.push({ issueId, text });
  }
  async setStatus(issueId: string, _runId: string, status: string, comment?: string) {
    this.calls.statuses.push({ issueId, status, comment });
  }
  async reportCost(r: { costUsd: number }) {
    this.calls.costs.push({ costUsd: r.costUsd });
  }
  async reportLiveness(_runId: string, liveness: string, outcome?: string) {
    this.calls.liveness.push({ liveness, outcome });
  }
}

function makeRunner(opts: {
  paperclip?: Partial<FakePaperclip>;
  pass?: (input: PassInput) => Promise<PassResult>;
} = {}) {
  const fake = Object.assign(new FakePaperclip(), opts.paperclip);
  const passCalls: PassInput[] = [];
  const runPass = async (input: PassInput): Promise<PassResult> => {
    passCalls.push(input);
    if (opts.pass) return opts.pass(input);
    return { package: goodPackage(), costUsd: 0.0123, rounds: 4, elapsedMinutes: 1.1, sections: {} };
  };
  const deps: WorkerDeps = {
    paperclip: fake as any,
    runPass,
    logger: () => {},
  };
  return { runner: new WorkerRunner(deps), fake, passCalls };
}

describe("WorkerRunner.handleWake", () => {
  test("happy path: completes, sets in_review (never done), posts package, reports cost + liveness", async () => {
    const { runner, fake, passCalls } = makeRunner();
    const out = await runner.handleWake({ runId: "R1", issueId: "ISS-1" });

    expect(out.kind).toBe("completed");
    expect(passCalls).toHaveLength(1);
    expect(passCalls[0].issue.id).toBe("ISS-1");
    expect(fake.calls.checkout).toBe(1);
    expect(fake.calls.comments.length).toBeGreaterThanOrEqual(1);
    const statuses = fake.calls.statuses.map((s) => s.status);
    expect(statuses).toContain("in_review");
    expect(statuses).not.toContain("done");
    expect(fake.calls.costs[0].costUsd).toBeCloseTo(0.0123, 4);
    expect(fake.calls.liveness.at(-1)?.liveness).toBe("completed");
  });

  test("409 checkout conflict: stops, runs no pass, mutates nothing", async () => {
    const { runner, fake, passCalls } = makeRunner({ paperclip: { checkoutBehavior: "conflict" } });
    const out = await runner.handleWake({ runId: "R1", issueId: "ISS-1" });

    expect(out.kind).toBe("skipped");
    expect((out as any).reason).toBe("checkout_conflict");
    expect(passCalls).toHaveLength(0);
    expect(fake.calls.comments).toHaveLength(0);
    expect(fake.calls.statuses).toHaveLength(0);
  });

  test("failed pass: liveness failed, issue blocked with owner + action", async () => {
    const { runner, fake } = makeRunner({
      pass: async () => {
        throw new Error("model exploded");
      },
    });
    const out = await runner.handleWake({ runId: "R1", issueId: "ISS-1" });

    expect(out.kind).toBe("failed");
    expect((out as any).reason).toContain("model exploded");
    expect(fake.calls.statuses.map((s) => s.status)).toContain("blocked");
    const comment = fake.calls.comments[0].text.toLowerCase();
    expect(comment).toContain("model exploded");
    expect(comment).toContain("owner: operator");
    expect(comment).toContain("action needed");
    expect(fake.calls.liveness.at(-1)?.liveness).toBe("failed");
  });

  test("budget exhausted: no-op, no checkout, no pass", async () => {
    const { runner, fake, passCalls } = makeRunner({
      paperclip: { identity: { id: "A1", companyId: "C1", budget: { exhausted: true } } },
    });
    const out = await runner.handleWake({ runId: "R1", issueId: "ISS-1" });

    expect(out.kind).toBe("skipped");
    expect((out as any).reason).toBe("budget_exhausted");
    expect(fake.calls.checkout).toBe(0);
    expect(passCalls).toHaveLength(0);
    expect(fake.calls.comments).toHaveLength(0);
    expect(fake.calls.liveness.at(-1)?.liveness).toBe("blocked");
  });

  test("empty package: blocked for the operator, liveness empty_response", async () => {
    const { runner, fake } = makeRunner({
      pass: async () => ({ package: "  ", costUsd: 0.002, rounds: 1, elapsedMinutes: 0.2, sections: {} }),
    });
    const out = await runner.handleWake({ runId: "R1", issueId: "ISS-1" });

    expect(out.kind).toBe("failed");
    expect((out as any).reason).toBe("empty_package");
    expect(fake.calls.statuses.map((s) => s.status)).toContain("blocked");
    expect(fake.calls.liveness.at(-1)?.liveness).toBe("empty_response");
  });

  test("inbox path: with no issueId, picks an issue from the inbox", async () => {
    const { runner, fake, passCalls } = makeRunner({
      paperclip: { inbox: [{ id: "ISS-9", status: "todo", companyId: "C1" }] },
    });
    const out = await runner.handleWake({ runId: "R1" });
    expect(out.kind).toBe("completed");
    expect(passCalls).toHaveLength(1);
    expect(fake.calls.statuses.map((s) => s.status)).toContain("in_review");
  });

  test("empty inbox: no-op, liveness empty_response", async () => {
    const { runner, fake, passCalls } = makeRunner({ paperclip: { inbox: [] } });
    const out = await runner.handleWake({ runId: "R1" });
    expect(out.kind).toBe("skipped");
    expect((out as any).reason).toBe("no_issue");
    expect(passCalls).toHaveLength(0);
    expect(fake.calls.liveness.at(-1)?.liveness).toBe("empty_response");
  });
});

describe("pickIssue", () => {
  test("prefers in_progress, then in_review, then todo", () => {
    const issues: Issue[] = [
      { id: "a", status: "todo" },
      { id: "b", status: "in_progress" },
      { id: "c", status: "in_review" },
    ];
    expect(pickIssue(issues)?.id).toBe("b");
  });
  test("returns null for an empty inbox", () => {
    expect(pickIssue([])).toBeNull();
  });
});

describe("isBudgetExhausted", () => {
  test("null budget is not exhausted", () => {
    expect(isBudgetExhausted(null)).toBe(false);
  });
  test("explicit exhausted flag", () => {
    expect(isBudgetExhausted({ exhausted: true })).toBe(true);
  });
  test("paused/hard_stopped states", () => {
    expect(isBudgetExhausted({ state: "hard_stopped" })).toBe(true);
    expect(isBudgetExhausted({ state: "paused" })).toBe(true);
  });
  test("remaining <= 0 against a positive cap", () => {
    expect(isBudgetExhausted({ remainingUsd: 0, monthlyCapUsd: 30 })).toBe(true);
    expect(isBudgetExhausted({ remainingUsd: 5, monthlyCapUsd: 30 })).toBe(false);
  });
});
