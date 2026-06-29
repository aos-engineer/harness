// ── GeminiAgentRuntime (L1) ────────────────────────────────────────
// Extends BaseAgentRuntime with Gemini CLI integration.

import { execSync } from "node:child_process";

import type {
  AuthMode,
  ModelCost,
  ModelTier,
  MessageOpts,
  VendorMcpServerSpec,
} from "@aos-harness/runtime/types";

export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
  /** Phase 1 Tier 2: declared external MCP servers to expose to the arbiter. */
  externalServers?: VendorMcpServerSpec[];
}
import {
  BaseAgentRuntime,
  type HandleState,
  type ParsedEvent,
  type StdoutFormat,
  type ModelInfo,
} from "@aos-harness/adapter-shared";
import type { BaseEventBus } from "@aos-harness/adapter-shared";

// ── GeminiAgentRuntime ────────────────────────────────────────────

export class GeminiAgentRuntime extends BaseAgentRuntime {
  constructor(
    eventBus: BaseEventBus,
    modelOverrides?: Partial<Record<ModelTier, string>>,
    options: { useVendorDefaultModel?: boolean } = {},
  ) {
    super(eventBus, modelOverrides, options);
  }

  cliBinary(): string {
    return "gemini";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = ["--output-format", "stream-json"];
    const modelId = this.resolveModelId(state.modelConfig.tier);
    if (modelId) {
      args.push("--model", modelId);
    }

    const sessionId = !isFirstCall ? this.getStoredSessionId(state) : null;
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(...(opts?.extraArgs ?? []));
    args.push("--prompt", this.formatPromptWithContext(state, message, opts, true));
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    if (typeof event.sessionId === "string") {
      return { type: "session_update", sessionId: event.sessionId };
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

    // Gemini REST-style candidates format
    if (Array.isArray(event.candidates)) {
      const candidate = event.candidates[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((p: any) => typeof p.text === "string")
        .map((p: any) => p.text)
        .join("");
      const meta = event.usageMetadata ?? {};
      return {
        type: "message_end",
        text,
        tokensIn: meta.promptTokenCount ?? 0,
        tokensOut: meta.candidatesTokenCount ?? 0,
        cost: 0,
        contextTokens: (meta.promptTokenCount ?? 0) + (meta.candidatesTokenCount ?? 0),
        model: event.modelVersion ?? "",
      };
    }

    // Tool call / function call
    if (event.type === "tool_call" || event.type === "function_call") {
      return { type: "tool_call", name: event.name ?? "unknown", input: event.input ?? event.args ?? {} };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "GOOGLE_API_KEY", "GEMINI_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const output = execSync("gemini model list --json", {
        encoding: "utf-8",
        timeout: 10_000,
        env: this.buildSubprocessEnv(),
      });
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any) => ({
          id: m.id ?? m.name,
          name: m.name ?? m.id,
          contextWindow: m.context_window ?? m.contextWindow ?? 1_000_000,
          provider: "gemini",
        }));
      }
    } catch {
      // Fall through to defaults
    }
    const defaults = this.defaultModelMap();
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 1_000_000,
      provider: "gemini",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "gemini-2.5-flash-lite",
      standard: "gemini-2.5-flash",
      premium: "gemini-2.5-pro",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "unknown", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: {
        inputPerMillionTokens: 0.10,
        outputPerMillionTokens: 0.40,
        currency: "USD",
      },
      standard: {
        inputPerMillionTokens: 1.25,
        outputPerMillionTokens: 10.00,
        currency: "USD",
      },
      premium: {
        inputPerMillionTokens: 1.25,
        outputPerMillionTokens: 10.00,
        currency: "USD",
      },
    };
    return pricing[tier];
  }

  buildMcpArgs(opts?: McpBridgeOptions): string[] {
    // Tier 2: additively allow declared external STDIO server names. Their
    // configs are written into .gemini/settings.json by writeMcpSettings.
    const names = ["aos"];
    for (const s of opts?.externalServers ?? []) {
      if (s.transport === "stdio") names.push(s.id);
    }
    return [
      "--yolo",
      "--allowed-mcp-server-names", names.join(","),
    ];
  }

  /**
   * Writes a project-local .gemini/settings.json with our MCP server config.
   * Returns a restore function that the caller MUST invoke on shutdown to
   * restore any pre-existing settings file.
   */
  writeMcpSettings(opts: McpBridgeOptions & { projectRoot: string }): () => void {
    const { mkdirSync, writeFileSync, existsSync, renameSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");

    const geminiDir = join(opts.projectRoot, ".gemini");
    const settingsPath = join(geminiDir, "settings.json");
    const backupPath = join(geminiDir, "settings.json.aos-backup");

    mkdirSync(geminiDir, { recursive: true });
    const hadBackup = existsSync(settingsPath);
    if (hadBackup) renameSync(settingsPath, backupPath);

    const mcpServers: Record<string, unknown> = {
      aos: {
        command: "bun",
        args: [opts.bridgeScriptPath],
        env: { AOS_BRIDGE_SOCKET: opts.socketPath },
        trust: true,
        timeout: 600000,
      },
    };
    // Tier 2: additively register declared external STDIO servers. The settings
    // file is project-local (not argv), so env values are not exposed via ps.
    for (const s of opts.externalServers ?? []) {
      if (s.transport !== "stdio") continue;
      mcpServers[s.id] = {
        command: s.command,
        args: s.args ?? [],
        ...(s.env ? { env: s.env } : {}),
        trust: true,
        timeout: 600000,
      };
    }
    writeFileSync(settingsPath, JSON.stringify({ mcpServers }, null, 2));

    return () => {
      try { unlinkSync(settingsPath); } catch { /* ignore */ }
      if (hadBackup) {
        try { renameSync(backupPath, settingsPath); } catch { /* ignore */ }
      }
    };
  }
}
