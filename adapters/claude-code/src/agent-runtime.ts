// ── ClaudeCodeAgentRuntime (L1) ───────────────────────────────────
// Extends BaseAgentRuntime with Claude Code CLI integration.

import { execSync } from "node:child_process";
import type {
  AuthMode,
  ModelCost,
  ModelTier,
  MessageOpts,
  VendorMcpServerSpec,
} from "@aos-harness/runtime/types";
import {
  BaseAgentRuntime,
  type HandleState,
  type ParsedEvent,
  type StdoutFormat,
  type ModelInfo,
} from "@aos-harness/adapter-shared";
import type { BaseEventBus } from "@aos-harness/adapter-shared";

// ── McpBridgeOptions ─────────────────────────────────────────────

export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
  /** Phase 1 Tier 2: declared external MCP servers to expose to the arbiter. */
  externalServers?: VendorMcpServerSpec[];
}

// ── ClaudeCodeAgentRuntime ────────────────────────────────────────

export class ClaudeCodeAgentRuntime extends BaseAgentRuntime {
  constructor(
    eventBus: BaseEventBus,
    modelOverrides?: Partial<Record<ModelTier, string>>,
    options: { useVendorDefaultModel?: boolean } = {},
  ) {
    super(eventBus, modelOverrides, options);
  }

  cliBinary(): string {
    return "claude";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = ["--print", "--output-format", "stream-json", "--verbose"];
    const modelId = this.resolveModelId(state.modelConfig.tier);
    if (modelId) {
      args.push("--model", modelId);
    }

    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }
    }

    const sessionId = !isFirstCall ? this.getStoredSessionId(state) : null;
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(...(opts?.extraArgs ?? []));
    args.push(this.formatPromptWithContext(state, message, opts, false));
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    if ((event.type === "system" || event.type === "session") && typeof event.session_id === "string") {
      return { type: "session_update", sessionId: event.session_id };
    }

    if (event.type === "assistant" && typeof event.message?.content?.[0]?.text === "string") {
      return { type: "text_delta", text: event.message.content[0].text };
    }

    if (event.type === "result") {
      const usage = event.usage ?? {};
      return {
        type: "message_end",
        text: event.result ?? "",
        tokensIn: usage.input_tokens ?? 0,
        tokensOut: usage.output_tokens ?? 0,
        cost: event.cost_usd ?? 0,
        contextTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        model: event.model ?? "",
      };
    }

    // Streaming text delta
    if (event.type === "content_block_delta" && event.delta?.text !== undefined) {
      return { type: "text_delta", text: event.delta.text };
    }

    // Tool call
    if (event.type === "tool_use") {
      return { type: "tool_call", name: event.name ?? "unknown", input: event.input ?? {} };
    }

    // Tool result — content or output field
    if (event.type === "tool_result") {
      const result = event.content ?? event.output ?? null;
      return { type: "tool_result", name: event.name ?? "unknown", input: {}, result };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "ANTHROPIC_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const output = execSync("claude model list --json", {
        encoding: "utf-8",
        timeout: 10_000,
        env: this.buildSubprocessEnv(),
      });
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any) => ({
          id: m.id ?? m.name,
          name: m.name ?? m.id,
          contextWindow: m.context_window ?? m.contextWindow ?? 200_000,
          provider: "claude",
        }));
      }
    } catch {
      // Fall through to defaults
    }
    const defaults = this.defaultModelMap();
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 200_000,
      provider: "claude",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "claude-haiku-4-5",
      standard: "claude-sonnet-4-6",
      premium: "claude-opus-4-7",
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

  buildMcpArgs(opts: McpBridgeOptions): string[] {
    const mcpServers: Record<string, unknown> = {
      aos: {
        command: "bun",
        args: [opts.bridgeScriptPath],
        env: { AOS_BRIDGE_SOCKET: opts.socketPath },
      },
    };
    // Tier 2: additively register declared external MCP servers (stdio + http).
    // When externalServers is empty this output is byte-identical to before.
    const allowed = ["mcp__aos__delegate", "mcp__aos__end"];
    for (const s of opts.externalServers ?? []) {
      if (s.transport === "stdio") {
        mcpServers[s.id] = {
          command: s.command,
          args: s.args ?? [],
          ...(s.env ? { env: s.env } : {}),
        };
      } else {
        mcpServers[s.id] = {
          type: s.transport === "sse" ? "sse" : "http",
          url: s.url,
          ...(s.headers ? { headers: s.headers } : {}),
        };
      }
      allowed.push(`mcp__${s.id}`); // allow all tools from this server
    }
    return [
      "--mcp-config", JSON.stringify({ mcpServers }),
      "--strict-mcp-config",
      "--allowedTools", allowed.join(" "),
      "--permission-mode", "bypassPermissions",
    ];
  }
}
