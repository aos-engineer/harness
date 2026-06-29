import type { TranscriptEntry } from "./types";

const TEMPLATE_TYPES = new Set([
  "file_changed", "token_usage", "domain_access", "agent_destroyed",
  "constraint_check", "agent_spawn", "agent_destroy", "session_start",
  "session_end", "session_paused", "session_resumed",
]);

const LLM_TYPES = new Set([
  "delegation", "response", "child_delegation", "child_response",
  "domain_violation", "expertise_updated", "gate_reached", "gate_result",
  "final_statement", "review_submission",
]);

export class EventSummarizer {
  templateSummary(event: TranscriptEntry): string | null {
    switch (event.type) {
      case "file_changed":
        return `${event.agentId ?? "unknown"} ${event.operation ?? "changed"} ${event.path ?? "file"}`;
      case "token_usage":
        return `${event.agentId ?? "unknown"} used ${event.tokensIn ?? 0}+${event.tokensOut ?? 0} tokens ($${((event.cost as number) ?? 0).toFixed(4)})`;
      case "agent_destroyed":
        return `${event.childAgentId ?? "agent"} finished (${event.reason ?? "done"})`;
      case "constraint_check":
        return `Round ${event.round ?? "?"}: ${((event.elapsed_minutes as number) ?? 0).toFixed(1)}min, $${((event.budget_spent as number) ?? 0).toFixed(2)} spent`;
      case "domain_access":
        return `${event.agentId ?? "unknown"} ${event.operation ?? "accessed"} ${event.path ?? "path"}`;
      case "agent_spawn":
        return `Spawned ${event.agentId ?? "agent"}`;
      case "agent_destroy":
        return `Destroyed ${event.agentId ?? "agent"}`;
      case "session_start":
        return `Session started with profile ${event.profile ?? "unknown"}`;
      case "session_end":
        return `Session ended (${event.roundsCompleted ?? 0} rounds)`;
      case "session_paused":
        return `Session paused: ${event.reason ?? "user requested"}`;
      case "session_resumed":
        return `Session resumed from checkpoint`;
      default:
        return null;
    }
  }

  needsLLM(event: TranscriptEntry): boolean {
    return LLM_TYPES.has(event.type);
  }

  isTemplateable(event: TranscriptEntry): boolean {
    return TEMPLATE_TYPES.has(event.type);
  }
}
