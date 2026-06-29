// ── Shared Adapter Types ──────────────────────────────────────────

import type { AgentConfig, ModelTier, ThinkingMode } from "@aos-harness/runtime/types";

// ── Stdout format declaration ────────────────────────────────────

export type StdoutFormat = "ndjson" | "sse" | "chunked-json";

// ── Parsed event normalization ───────────────────────────────────

export type ParsedEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "message_end";
      text: string;
      tokensIn: number;
      tokensOut: number;
      cost: number;
      contextTokens: number;
      model: string;
    }
  | { type: "session_update"; sessionId: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; input: unknown; result: unknown }
  | { type: "ignored" };

// ── Model info from CLI discovery ────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  provider: string;
}

// ── Per-handle state tracked by BaseAgentRuntime ─────────────────

export interface HandleState {
  config: AgentConfig;
  sessionFile: string;
  contextFiles: string[];
  modelConfig: { tier: ModelTier; thinking: ThinkingMode };
  lastContextTokens: number;
}

export interface RuntimeBehaviorOptions {
  useVendorDefaultModel?: boolean;
}
