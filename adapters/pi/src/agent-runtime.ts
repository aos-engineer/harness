// ── Pi Agent Runtime (L1) ────────────────────────────────────────
// Extends BaseAgentRuntime with Pi-specific CLI integration.

import { existsSync } from "node:fs";
import type {
  AuthMode,
  ModelCost,
  ModelTier,
  MessageOpts,
} from "@aos-harness/runtime/types";
import { BaseAgentRuntime, type HandleState, type ParsedEvent, type StdoutFormat, type ModelInfo } from "@aos-harness/adapter-shared";
import type { BaseEventBus } from "@aos-harness/adapter-shared";

// ── Model tier resolution (exported for backward compat) ────────

export function resolveModelId(tier: ModelTier): string {
  const map: Record<ModelTier, string> = {
    economy: process.env.AOS_MODEL_ECONOMY || "anthropic/claude-haiku-4-5",
    standard: process.env.AOS_MODEL_STANDARD || "anthropic/claude-sonnet-4-6",
    premium: process.env.AOS_MODEL_PREMIUM || "anthropic/claude-opus-4-7",
  };
  return map[tier];
}

// ── PiAgentRuntime ───────────────────────────────────────────────

export class PiAgentRuntime extends BaseAgentRuntime {
  constructor(
    eventBus: BaseEventBus,
    modelOverrides?: Partial<Record<ModelTier, string>>,
    options: { useVendorDefaultModel?: boolean } = {},
  ) {
    super(eventBus, modelOverrides, options);
  }

  cliBinary(): string {
    return "pi";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = [
      "--mode", "json",
      "-p",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--session", state.sessionFile,
      "--thinking", state.modelConfig.thinking,
    ];

    // First call: session file doesn't exist — set system prompt, model, and context files
    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }
      const modelId = this.resolveModelId(state.modelConfig.tier);
      if (modelId) {
        args.push("--model", modelId);
      }

      // Inject context files via @file syntax
      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push(`@${file}`);
      }
    }

    // Final arg: the message
    args.push(message);
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    // Stream text deltas
    if (event.type === "message_update" && event.assistantMessageEvent) {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta" && (ame.delta || ame.text)) {
        return { type: "text_delta", text: ame.delta || ame.text };
      }
    }

    // Tool execution
    if (event.type === "tool_execution_start") {
      return { type: "tool_call", name: event.toolName ?? "unknown", input: event.input ?? {} };
    }

    // Final message with usage stats
    if (event.type === "message_end" && event.message) {
      const msg = event.message;
      if (msg.role === "assistant") {
        let text = "";
        if (msg.content && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              text = part.text;
            }
          }
        }

        const usage = msg.usage;
        return {
          type: "message_end",
          text,
          tokensIn: usage?.input || 0,
          tokensOut: usage?.output || 0,
          cost: usage?.cost?.total || 0,
          contextTokens: usage?.totalTokens || 0,
          model: msg.model || "",
        };
      }
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    // Pi doesn't have a model discovery API — return defaults
    const defaults = this.defaultModelMap();
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 200_000,
      provider: "pi",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "anthropic/claude-haiku-4-5",
      standard: "anthropic/claude-sonnet-4-6",
      premium: "anthropic/claude-opus-4-7",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.ANTHROPIC_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "subscription", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: {
        inputPerMillionTokens: 1.00,
        outputPerMillionTokens: 5.00,
        currency: "USD",
      },
      standard: {
        inputPerMillionTokens: 3.00,
        outputPerMillionTokens: 15.00,
        currency: "USD",
      },
      premium: {
        inputPerMillionTokens: 5.00,
        outputPerMillionTokens: 25.00,
        currency: "USD",
      },
    };
    return pricing[tier];
  }
}
