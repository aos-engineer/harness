// The per-wake heartbeat procedure for the Paperclip worker.
//
// Faithful to Paperclip's documented contract, in order:
//   1. identity  2. approval (if any)  3. inbox  4. checkout  5. run pass
//   6. work product + comment, status in_review  7. cost  8. liveness
//
// The worker NEVER sets an issue to done and NEVER publishes — it leaves the
// result in review for a human. All collaborators are injected (PaperclipClient,
// RunPass), so tests exercise the full loop against a mocked Paperclip and a fake
// pass — no real secrets, no `claude` CLI, no network.

import { PaperclipClient, PaperclipConflictError } from "./paperclip-client";
import { buildWorkProduct, failedPassComment } from "./package-builder";
import type { AgentBudget, Issue, RunOutcome, RunPass, WakeRequest } from "./types";

export interface WorkerDeps {
  paperclip: PaperclipClient;
  runPass: RunPass;
  logger?: (msg: string) => void;
}

export class WorkerRunner {
  constructor(private deps: WorkerDeps) {}

  private log(msg: string): void {
    (this.deps.logger ?? ((m) => console.error(`[worker] ${m}`)))(msg);
  }

  /** Run the full heartbeat for one wake. Returns an outcome for logging. */
  async handleWake(wake: WakeRequest): Promise<RunOutcome> {
    const { paperclip } = this.deps;

    // 1. Identity
    const identity = await paperclip.getIdentity();
    const agentId = identity.id;
    const companyId = identity.companyId ?? wake.companyId ?? "";
    const runId = wake.runId ?? process.env.PAPERCLIP_RUN_ID ?? `run-${Date.now().toString(36)}`;

    // Budget gate: a hard-capped, exhausted agent must do no new work.
    if (isBudgetExhausted(identity.budget)) {
      this.log("budget exhausted; no-op");
      await this.safeLiveness(runId, "blocked", "budget_exhausted");
      return { kind: "skipped", reason: "budget_exhausted" };
    }

    // 2. Approval first, if present (operator approves from the dashboard; the
    //    worker only reads it so it never blocks the run).
    const approvalId = wake.approvalId ?? process.env.PAPERCLIP_APPROVAL_ID;
    if (approvalId) {
      try {
        await paperclip.getApproval(approvalId);
        this.log(`approval ${approvalId} read (operator-driven; no auto-close)`);
      } catch (err) {
        this.log(`approval read failed (non-fatal): ${asMessage(err)}`);
      }
    }

    // 3. Inbox -> resolve the issue to work.
    const issue = await this.resolveIssue(wake, companyId, agentId);
    if (!issue) {
      this.log("no eligible issue in inbox; no-op");
      await this.safeLiveness(runId, "empty_response", "no_issue");
      return { kind: "skipped", reason: "no_issue" };
    }

    // 4. Checkout (409 => another run owns it; never retry).
    try {
      await paperclip.checkout(issue.id, runId, agentId);
    } catch (err) {
      if (err instanceof PaperclipConflictError) {
        this.log(`checkout conflict on ${issue.id}; another run owns it`);
        return { kind: "skipped", reason: "checkout_conflict" };
      }
      throw err;
    }

    // 5. Run one Council+Crew pass (the part Paperclip never sees).
    let result;
    try {
      result = await this.deps.runPass({ issue });
    } catch (err) {
      const reason = asMessage(err);
      this.log(`pass failed: ${reason}`);
      await paperclip.postComment(issue.id, runId, failedPassComment(reason));
      await paperclip.setStatus(issue.id, runId, "blocked", "Worker pass failed; see comment.");
      await this.safeCost(agentId, companyId, runId, 0);
      await this.safeLiveness(runId, "failed", "pass_failed");
      return { kind: "failed", issueId: issue.id, reason, costUsd: 0 };
    }

    // Empty package => treat as a failed/empty run, leave blocked for the operator.
    if (!result.package || result.package.trim() === "") {
      this.log("pass produced an empty package");
      await paperclip.postComment(issue.id, runId, failedPassComment("pass produced an empty package"));
      await paperclip.setStatus(issue.id, runId, "blocked", "Worker produced no package.");
      await this.safeCost(agentId, companyId, runId, result.costUsd);
      await this.safeLiveness(runId, "empty_response", "empty_package");
      return { kind: "failed", issueId: issue.id, reason: "empty_package", costUsd: result.costUsd };
    }

    // 6. Work product + comment, then status -> in_review (NEVER done).
    const wp = buildWorkProduct(result);
    await paperclip.postComment(issue.id, runId, wp.comment);
    await paperclip.setStatus(
      issue.id,
      runId,
      "in_review",
      "Work product ready for review. Not published.",
    );

    // 7. Cost.
    await this.safeCost(agentId, companyId, runId, result.costUsd);

    // 8. Liveness.
    await this.safeLiveness(runId, "completed", "package_in_review");

    this.log(`completed ${issue.id} (cost $${result.costUsd.toFixed(4)})`);
    return { kind: "completed", issueId: issue.id, costUsd: result.costUsd };
  }

  private async resolveIssue(
    wake: WakeRequest,
    companyId: string,
    agentId: string,
  ): Promise<Issue | null> {
    if (wake.issueId) {
      return this.deps.paperclip.getIssue(wake.issueId);
    }
    const inbox = await this.deps.paperclip.getInbox(companyId, agentId);
    return pickIssue(inbox);
  }

  private async safeCost(
    agentId: string,
    companyId: string,
    runId: string,
    costUsd: number,
  ): Promise<void> {
    try {
      await this.deps.paperclip.reportCost({ agentId, companyId, runId, costUsd });
    } catch (err) {
      this.log(`cost report failed (non-fatal): ${asMessage(err)}`);
    }
  }

  private async safeLiveness(
    runId: string,
    liveness: Parameters<PaperclipClient["reportLiveness"]>[1],
    outcome: string,
  ): Promise<void> {
    try {
      await this.deps.paperclip.reportLiveness(runId, liveness, outcome);
    } catch (err) {
      this.log(`liveness report failed (non-fatal): ${asMessage(err)}`);
    }
  }
}

/** Work in_progress first, then in_review, then todo; tie-break by priority. */
export function pickIssue(issues: Issue[]): Issue | null {
  if (!issues || issues.length === 0) return null;
  const rank: Record<string, number> = { in_progress: 0, in_review: 1, todo: 2, blocked: 3 };
  const sorted = [...issues].sort((a, b) => {
    const ra = rank[a.status ?? "todo"] ?? 4;
    const rb = rank[b.status ?? "todo"] ?? 4;
    if (ra !== rb) return ra - rb;
    return (a.priority ?? 0) - (b.priority ?? 0);
  });
  return sorted[0] ?? null;
}

export function isBudgetExhausted(budget?: AgentBudget | null): boolean {
  if (!budget) return false;
  if (budget.exhausted === true) return true;
  if (budget.state && ["paused", "hard_stopped", "stopped"].includes(budget.state)) return true;
  if (
    typeof budget.remainingUsd === "number" &&
    budget.remainingUsd <= 0 &&
    typeof budget.monthlyCapUsd === "number" &&
    budget.monthlyCapUsd > 0
  ) {
    return true;
  }
  return false;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
