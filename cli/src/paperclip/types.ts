// Shared types for the Paperclip seam.
//
// This module is the narrow contract between Paperclip (the control plane) and
// the AOS-Harness worker. Nothing here holds secrets; values arrive at runtime
// via env / injected config.

/** Run liveness states Paperclip understands (heartbeat protocol). */
export type Liveness =
  | "completed"
  | "advanced"
  | "plan_only"
  | "empty_response"
  | "blocked"
  | "failed"
  | "needs_followup";

/** Body Paperclip POSTs to /paperclip/wake (fire-and-forget). */
export interface WakeRequest {
  runId?: string;
  issueId?: string;
  companyId?: string;
  agentId?: string;
  approvalId?: string;
}

/** GET /api/agents/me */
export interface AgentIdentity {
  id: string;
  companyId: string;
  role?: string;
  chainOfCommand?: unknown;
  budget?: AgentBudget | null;
}

export interface AgentBudget {
  monthlyCapUsd?: number;
  spentUsd?: number;
  remainingUsd?: number;
  /** True when the hard cap is reached and the agent is auto-paused. */
  exhausted?: boolean;
  state?: string; // "active" | "paused" | "hard_stopped" | ...
}

/** A Paperclip issue (subset we use). */
export interface Issue {
  id: string;
  title?: string;
  status?: string; // todo | in_progress | in_review | blocked | done | cancelled
  priority?: number;
  companyId?: string;
  goalId?: string;
  assigneeAgentId?: string;
  body?: string;
  definitionOfDone?: string;
}

/** Result of one AOS worker pass (the "thinking" Paperclip never sees). */
export interface PassResult {
  /** The assembled, review-ready work product (markdown). */
  package: string;
  /** Cost of the pass in USD (from the engine constraint state). */
  costUsd: number;
  rounds: number;
  elapsedMinutes: number;
  /** Raw step outputs, keyed by workflow step output id. */
  sections: Record<string, string>;
  /** Path to the brief the engine consumed. */
  briefPath?: string;
  transcriptPath?: string;
  outputPath?: string;
}

/** What the worker pass needs as input. */
export interface PassInput {
  issue: Issue;
}

/**
 * The function that actually runs one Council+Crew pass. Injected so tests can
 * substitute a fake (no real model, no `claude` CLI, no secrets).
 */
export type RunPass = (input: PassInput) => Promise<PassResult>;

/** Outcome of one full wake, for logging / reporting. */
export type RunOutcome =
  | { kind: "completed"; issueId: string; costUsd: number }
  | { kind: "blocked"; issueId: string; reason: string; costUsd: number }
  | { kind: "failed"; issueId: string; reason: string; costUsd: number }
  | { kind: "skipped"; reason: string };
