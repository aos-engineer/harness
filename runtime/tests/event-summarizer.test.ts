import { describe, it, expect, beforeEach } from "bun:test";
import { EventSummarizer } from "../src/event-summarizer";
import type { TranscriptEntry } from "../src/types";

describe("EventSummarizer.templateSummary", () => {
  let summarizer: EventSummarizer;

  beforeEach(() => {
    summarizer = new EventSummarizer();
  });

  it("summarizes file_changed events", () => {
    const event: TranscriptEntry = {
      type: "file_changed",
      timestamp: new Date().toISOString(),
      agentId: "architect",
      operation: "modified",
      path: "src/types.ts",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("architect modified src/types.ts");
  });

  it("summarizes file_changed with defaults for missing fields", () => {
    const event: TranscriptEntry = {
      type: "file_changed",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("unknown changed file");
  });

  it("summarizes token_usage events", () => {
    const event: TranscriptEntry = {
      type: "token_usage",
      timestamp: new Date().toISOString(),
      agentId: "sentinel",
      tokensIn: 1200,
      tokensOut: 800,
      cost: 0.0125,
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("sentinel used 1200+800 tokens ($0.0125)");
  });

  it("summarizes token_usage with zero defaults", () => {
    const event: TranscriptEntry = {
      type: "token_usage",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("unknown used 0+0 tokens ($0.0000)");
  });

  it("summarizes agent_destroyed events", () => {
    const event: TranscriptEntry = {
      type: "agent_destroyed",
      timestamp: new Date().toISOString(),
      childAgentId: "backend-dev",
      reason: "task_complete",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("backend-dev finished (task_complete)");
  });

  it("summarizes agent_destroyed with defaults", () => {
    const event: TranscriptEntry = {
      type: "agent_destroyed",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("agent finished (done)");
  });

  it("summarizes constraint_check events", () => {
    const event: TranscriptEntry = {
      type: "constraint_check",
      timestamp: new Date().toISOString(),
      round: 3,
      elapsed_minutes: 12.567,
      budget_spent: 0.45,
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Round 3: 12.6min, $0.45 spent");
  });

  it("summarizes constraint_check with defaults", () => {
    const event: TranscriptEntry = {
      type: "constraint_check",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Round ?: 0.0min, $0.00 spent");
  });

  it("summarizes domain_access events", () => {
    const event: TranscriptEntry = {
      type: "domain_access",
      timestamp: new Date().toISOString(),
      agentId: "catalyst",
      operation: "read",
      path: "apps/web/src/index.ts",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("catalyst read apps/web/src/index.ts");
  });

  it("summarizes domain_access with defaults", () => {
    const event: TranscriptEntry = {
      type: "domain_access",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("unknown accessed path");
  });

  it("summarizes agent_spawn events", () => {
    const event: TranscriptEntry = {
      type: "agent_spawn",
      timestamp: new Date().toISOString(),
      agentId: "frontend-dev",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Spawned frontend-dev");
  });

  it("summarizes agent_destroy events", () => {
    const event: TranscriptEntry = {
      type: "agent_destroy",
      timestamp: new Date().toISOString(),
      agentId: "backend-dev",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Destroyed backend-dev");
  });

  it("summarizes session_start events", () => {
    const event: TranscriptEntry = {
      type: "session_start",
      timestamp: new Date().toISOString(),
      profile: "cto-execution",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Session started with profile cto-execution");
  });

  it("summarizes session_start with unknown profile", () => {
    const event: TranscriptEntry = {
      type: "session_start",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Session started with profile unknown");
  });

  it("summarizes session_end events", () => {
    const event: TranscriptEntry = {
      type: "session_end",
      timestamp: new Date().toISOString(),
      roundsCompleted: 5,
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Session ended (5 rounds)");
  });

  it("summarizes session_paused events", () => {
    const event: TranscriptEntry = {
      type: "session_paused",
      timestamp: new Date().toISOString(),
      reason: "budget_limit",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Session paused: budget_limit");
  });

  it("summarizes session_paused with default reason", () => {
    const event: TranscriptEntry = {
      type: "session_paused",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Session paused: user requested");
  });

  it("summarizes session_resumed events", () => {
    const event: TranscriptEntry = {
      type: "session_resumed",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("Session resumed from checkpoint");
  });

  it("returns null for delegation events", () => {
    const event: TranscriptEntry = {
      type: "delegation",
      timestamp: new Date().toISOString(),
      agentId: "orchestrator",
      message: "Analyze the requirements",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBeNull();
  });

  it("returns null for response events", () => {
    const event: TranscriptEntry = {
      type: "response",
      timestamp: new Date().toISOString(),
      agentId: "architect",
      text: "Here is my analysis...",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBeNull();
  });

  it("returns null for workflow_start events", () => {
    const event: TranscriptEntry = {
      type: "workflow_start",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBeNull();
  });

  it("returns null for gate_result events", () => {
    const event: TranscriptEntry = {
      type: "gate_result",
      timestamp: new Date().toISOString(),
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBeNull();
  });
});

describe("EventSummarizer.needsLLM", () => {
  let summarizer: EventSummarizer;

  beforeEach(() => {
    summarizer = new EventSummarizer();
  });

  it("returns true for delegation events", () => {
    const event: TranscriptEntry = { type: "delegation", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for response events", () => {
    const event: TranscriptEntry = { type: "response", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for child_delegation events", () => {
    const event: TranscriptEntry = { type: "child_delegation", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for child_response events", () => {
    const event: TranscriptEntry = { type: "child_response", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for domain_violation events", () => {
    const event: TranscriptEntry = { type: "domain_violation", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for expertise_updated events", () => {
    const event: TranscriptEntry = { type: "expertise_updated", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for final_statement events", () => {
    const event: TranscriptEntry = { type: "final_statement", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns true for review_submission events", () => {
    const event: TranscriptEntry = { type: "review_submission", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(true);
  });

  it("returns false for file_changed events", () => {
    const event: TranscriptEntry = { type: "file_changed", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(false);
  });

  it("returns false for token_usage events", () => {
    const event: TranscriptEntry = { type: "token_usage", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(false);
  });

  it("returns false for constraint_check events", () => {
    const event: TranscriptEntry = { type: "constraint_check", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(false);
  });

  it("returns false for session_start events", () => {
    const event: TranscriptEntry = { type: "session_start", timestamp: "" };
    expect(summarizer.needsLLM(event)).toBe(false);
  });
});

describe("EventSummarizer.isTemplateable", () => {
  let summarizer: EventSummarizer;

  beforeEach(() => {
    summarizer = new EventSummarizer();
  });

  it("returns true for file_changed events", () => {
    const event: TranscriptEntry = { type: "file_changed", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for token_usage events", () => {
    const event: TranscriptEntry = { type: "token_usage", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for domain_access events", () => {
    const event: TranscriptEntry = { type: "domain_access", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for agent_destroyed events", () => {
    const event: TranscriptEntry = { type: "agent_destroyed", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for constraint_check events", () => {
    const event: TranscriptEntry = { type: "constraint_check", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for agent_spawn events", () => {
    const event: TranscriptEntry = { type: "agent_spawn", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for agent_destroy events", () => {
    const event: TranscriptEntry = { type: "agent_destroy", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for session_start events", () => {
    const event: TranscriptEntry = { type: "session_start", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for session_end events", () => {
    const event: TranscriptEntry = { type: "session_end", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for session_paused events", () => {
    const event: TranscriptEntry = { type: "session_paused", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns true for session_resumed events", () => {
    const event: TranscriptEntry = { type: "session_resumed", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(true);
  });

  it("returns false for delegation events", () => {
    const event: TranscriptEntry = { type: "delegation", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(false);
  });

  it("returns false for response events", () => {
    const event: TranscriptEntry = { type: "response", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(false);
  });

  it("returns false for final_statement events", () => {
    const event: TranscriptEntry = { type: "final_statement", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(false);
  });

  it("returns false for workflow_start events (not in either set)", () => {
    const event: TranscriptEntry = { type: "workflow_start", timestamp: "" };
    expect(summarizer.isTemplateable(event)).toBe(false);
  });
});
