// Paperclip heartbeat callback client.
//
// Implements the documented per-wake contract: identity, approval, inbox,
// checkout (with X-Paperclip-Run-Id), comment, status, cost, liveness. Every
// endpoint is defined here in one place so the wire shapes can be reconciled
// against the live Paperclip instance at M4 with a single-file change.
//
// Reference (paperclipai@2026.529.0, docs/guides/agent-developer/heartbeat-protocol.md):
//   GET   /api/agents/me
//   GET   /api/approvals/{id}            GET /api/approvals/{id}/issues
//   GET   /api/companies/{companyId}/issues?assigneeAgentId=&status=...
//   GET   /api/issues/{id}               GET /api/issues/{id}/comments
//   POST  /api/issues/{id}/checkout      (409 = another run owns it; never retry)
//   POST  /api/issues/{id}/comments      { text }
//   PATCH /api/issues/{id}               { status, comment }
//   POST  /api/costs                     { cost_cents, model, ... }
//   PATCH /api/heartbeat-runs/{runId}    { liveness_state, outcome }

import type { AgentIdentity, Issue, Liveness } from "./types";
import type { PaperclipApiConfig } from "./config";

export class PaperclipConflictError extends Error {
  constructor(public issueId: string) {
    super(`Checkout conflict (409) on issue ${issueId}; another run owns it`);
    this.name = "PaperclipConflictError";
  }
}

export class PaperclipHttpError extends Error {
  constructor(
    public status: number,
    public method: string,
    public path: string,
    public bodyText: string,
  ) {
    super(`Paperclip ${method} ${path} -> HTTP ${status}: ${bodyText.slice(0, 300)}`);
    this.name = "PaperclipHttpError";
  }
}

export interface CostReport {
  agentId: string;
  companyId: string;
  runId: string;
  costUsd: number;
  model?: string;
}

type FetchFn = typeof fetch;

export class PaperclipClient {
  constructor(
    private cfg: PaperclipApiConfig,
    private fetchFn: FetchFn = fetch,
  ) {}

  private url(path: string): string {
    return `${this.cfg.apiBase}${path}`;
  }

  private authHeaders(runId?: string): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    h[this.cfg.authHeader] = this.cfg.authScheme
      ? `${this.cfg.authScheme} ${this.cfg.apiKey}`
      : this.cfg.apiKey;
    if (runId) h["X-Paperclip-Run-Id"] = runId;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { runId?: string; body?: unknown; allow409?: boolean } = {},
  ): Promise<T> {
    const res = await this.fetchFn(this.url(path), {
      method,
      headers: this.authHeaders(opts.runId),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 409 && opts.allow409) {
      // Signalled to the caller via PaperclipConflictError below.
      throw new PaperclipConflictError(path);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PaperclipHttpError(res.status, method, path, text);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ── 1. Identity ────────────────────────────────────────────────
  async getIdentity(): Promise<AgentIdentity> {
    return this.request<AgentIdentity>("GET", "/api/agents/me");
  }

  // ── 2. Approval (handled first when PAPERCLIP_APPROVAL_ID is set) ─
  async getApproval(approvalId: string): Promise<unknown> {
    return this.request<unknown>("GET", `/api/approvals/${approvalId}`);
  }
  async getApprovalIssues(approvalId: string): Promise<Issue[]> {
    return this.request<Issue[]>("GET", `/api/approvals/${approvalId}/issues`);
  }

  // ── 3. Inbox ───────────────────────────────────────────────────
  async getInbox(
    companyId: string,
    agentId: string,
    statuses: string[] = ["todo", "in_progress", "in_review", "blocked"],
  ): Promise<Issue[]> {
    const q = new URLSearchParams({
      assigneeAgentId: agentId,
      status: statuses.join(","),
    });
    const raw = await this.request<Issue[] | { issues: Issue[] }>(
      "GET",
      `/api/companies/${companyId}/issues?${q.toString()}`,
    );
    return Array.isArray(raw) ? raw : (raw?.issues ?? []);
  }

  async getIssue(issueId: string): Promise<Issue> {
    return this.request<Issue>("GET", `/api/issues/${issueId}`);
  }

  // ── 4. Checkout (REQUIRED before work; 409 = stop, never retry) ──
  async checkout(issueId: string, runId: string, agentId: string): Promise<void> {
    await this.request<unknown>("POST", `/api/issues/${issueId}/checkout`, {
      runId,
      allow409: true,
      body: {
        agentId,
        expectedStatuses: ["todo", "backlog", "blocked", "in_review", "in_progress"],
      },
    });
  }

  // ── 6. Comment (the work product lands as a comment) ────────────
  async postComment(issueId: string, runId: string, text: string): Promise<void> {
    await this.request<unknown>("POST", `/api/issues/${issueId}/comments`, {
      runId,
      body: { text },
    });
  }

  // ── 7. Status (NEVER "done"; worker only sets in_review / blocked) ─
  async setStatus(
    issueId: string,
    runId: string,
    status: "in_review" | "blocked",
    comment?: string,
  ): Promise<void> {
    await this.request<unknown>("PATCH", `/api/issues/${issueId}`, {
      runId,
      body: comment !== undefined ? { status, comment } : { status },
    });
  }

  // ── 8. Cost ────────────────────────────────────────────────────
  async reportCost(report: CostReport): Promise<void> {
    const costCents = Math.round(report.costUsd * 100);
    await this.request<unknown>("POST", "/api/costs", {
      runId: report.runId,
      body: {
        agentId: report.agentId,
        companyId: report.companyId,
        heartbeatRunId: report.runId,
        cost_cents: costCents,
        model: report.model ?? "claude-code",
      },
    });
  }

  // ── 9. Liveness ────────────────────────────────────────────────
  async reportLiveness(runId: string, liveness: Liveness, outcome?: string): Promise<void> {
    await this.request<unknown>("PATCH", `/api/heartbeat-runs/${runId}`, {
      runId,
      body: { liveness_state: liveness, outcome: outcome ?? liveness },
    });
  }
}
