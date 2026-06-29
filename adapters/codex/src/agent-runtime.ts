// ── CodexAgentRuntime (L1) ────────────────────────────────────────
// Extends BaseAgentRuntime with OpenAI Codex CLI integration.

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

// ── McpBridgeOptions ──────────────────────────────────────────────

export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
  /** Phase 1 Tier 2: declared external MCP servers to expose to the arbiter. */
  externalServers?: VendorMcpServerSpec[];
}

// ── CodexAgentRuntime ─────────────────────────────────────────────

export class CodexAgentRuntime extends BaseAgentRuntime {
  constructor(
    eventBus: BaseEventBus,
    modelOverrides?: Partial<Record<ModelTier, string>>,
    options: { useVendorDefaultModel?: boolean } = {},
  ) {
    super(eventBus, modelOverrides, options);
  }

  cliBinary(): string {
    return "codex";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const modelId = this.resolveModelId(state.modelConfig.tier);
    const sessionId = !isFirstCall ? this.getStoredSessionId(state) : null;
    const args: string[] = sessionId
      ? ["exec", "resume", "--json", "--full-auto"]
      : ["exec", "--json", "--full-auto"];

    if (modelId) {
      args.push("--model", modelId);
    }

    args.push(...(opts?.extraArgs ?? []));

    if (sessionId) {
      args.push(sessionId);
      args.push(message);
      return args;
    }

    args.push(this.formatPromptWithContext(state, message, opts, true));
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      return { type: "session_update", sessionId: event.thread_id };
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return { type: "text_delta", text: event.item.text ?? "" };
    }

    if (event.type === "turn.completed") {
      const usage = event.usage ?? {};
      return {
        type: "message_end",
        text: "",
        tokensIn: usage.input_tokens ?? usage.inputTokens ?? 0,
        tokensOut: usage.output_tokens ?? usage.outputTokens ?? 0,
        cost: event.cost_usd ?? usage.total_cost_usd ?? 0,
        contextTokens: (usage.input_tokens ?? usage.inputTokens ?? 0) + (usage.output_tokens ?? usage.outputTokens ?? 0),
        model: event.model ?? "",
      };
    }

    if (event.msg?.type === "tool_call" || event.type === "tool_call" || event.type === "function_call") {
      return { type: "tool_call", name: event.name ?? event.msg?.name ?? "unknown", input: event.input ?? event.args ?? event.msg?.input ?? {} };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "OPENAI_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const output = execSync("codex model list --json", {
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
          provider: "codex",
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
      provider: "codex",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "gpt-5.1-codex-mini",
      standard: "gpt-5.2-codex",
      premium: "gpt-5.2-codex",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.OPENAI_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "unknown", metered: false };
  }

  // Paths are controlled by adapter-session.ts (temp sock in /tmp, script in installed package) — shell-safe characters guaranteed; no escaping needed.
  buildMcpArgs(opts: McpBridgeOptions): string[] {
    const args = [
      "-c", `mcp_servers.aos.command="bun"`,
      "-c", `mcp_servers.aos.args=["${opts.bridgeScriptPath}"]`,
      "-c", `mcp_servers.aos.env={AOS_BRIDGE_SOCKET="${opts.socketPath}"}`,
      "-c", `mcp_servers.aos.required=true`,
      "-c", `mcp_servers.aos.enabled_tools=["delegate","end"]`,
      "-c", `mcp_servers.aos.tool_timeout_sec=600`,
    ];
    // Tier 2: additively register declared external STDIO servers. http/sse are
    // not exposed via codex's `-c` config (no secret-safe inline form) — reach
    // those through the skill mcp_binding path or the claude-code arbiter.
    for (const s of opts.externalServers ?? []) {
      if (s.transport !== "stdio") continue;
      args.push("-c", `mcp_servers.${s.id}.command="${s.command}"`);
      args.push("-c", `mcp_servers.${s.id}.args=${JSON.stringify(s.args ?? [])}`);
      if (s.env && Object.keys(s.env).length > 0) {
        const env = Object.entries(s.env).map(([k, v]) => `${k}="${v}"`).join(",");
        args.push("-c", `mcp_servers.${s.id}.env={${env}}`);
      }
      args.push("-c", `mcp_servers.${s.id}.tool_timeout_sec=600`);
    }
    return args;
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: {
        inputPerMillionTokens: 1.10,
        outputPerMillionTokens: 4.40,
        currency: "USD",
      },
      standard: {
        inputPerMillionTokens: 10.00,
        outputPerMillionTokens: 40.00,
        currency: "USD",
      },
      premium: {
        inputPerMillionTokens: 10.00,
        outputPerMillionTokens: 40.00,
        currency: "USD",
      },
    };
    return pricing[tier];
  }
}
