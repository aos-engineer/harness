// ── BaseAgentRuntime (L1) ─────────────────────────────────────────
// Abstract subprocess lifecycle for CLI-based adapters.
// Concrete implementations override CLI-specific methods.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentRuntimeAdapter,
  AgentHandle,
  AgentResponse,
  AgentConfig,
  ChildAgentConfig,
  MessageOpts,
  AuthMode,
  ModelCost,
  ModelTier,
  ThinkingMode,
  ContextUsage,
} from "@aos-harness/runtime/types";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo, RuntimeBehaviorOptions } from "./types";
import type { BaseEventBus } from "./base-event-bus";

export abstract class BaseAgentRuntime implements AgentRuntimeAdapter {
  protected handles = new Map<string, HandleState>();
  protected activeProcesses = new Set<ChildProcess>();
  protected orchestratorPrompt: string | undefined;
  protected eventBus: BaseEventBus;
  protected modelOverrides: Partial<Record<ModelTier, string>> = {};
  protected useVendorDefaultModel = false;
  private cachedModels: ModelInfo[] | null = null;
  private cleanupRegistered = false;

  constructor(
    eventBus: BaseEventBus,
    modelOverrides?: Partial<Record<ModelTier, string>>,
    options: RuntimeBehaviorOptions = {},
  ) {
    this.eventBus = eventBus;
    if (modelOverrides) this.modelOverrides = modelOverrides;
    this.useVendorDefaultModel = options.useVendorDefaultModel === true;
    this.registerCleanup();
  }

  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => {
      for (const proc of this.activeProcesses) {
        try { proc.kill("SIGTERM"); } catch {}
      }
    };

    process.on("beforeExit", cleanup);
    process.on("SIGTERM", () => { cleanup(); process.exit(143); });
    process.on("SIGINT", () => { cleanup(); process.exit(130); });
  }

  // ── Abstract methods ───────────────────────────────────────────

  abstract cliBinary(): string;
  abstract stdoutFormat(): StdoutFormat;
  abstract buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[];
  abstract parseEventLine(line: string): ParsedEvent | null;
  abstract buildSubprocessEnv(): Record<string, string>;
  abstract discoverModels(): Promise<ModelInfo[]>;
  abstract defaultModelMap(): Record<ModelTier, string>;
  abstract getAuthMode(): AuthMode;
  abstract getModelCost(tier: ModelTier): ModelCost;

  // ── Model resolution ───────────────────────────────────────────

  resolveModelId(tier: ModelTier): string | null {
    if (this.modelOverrides[tier]) return this.modelOverrides[tier]!;
    const envKeys: Record<ModelTier, string> = {
      economy: "AOS_MODEL_ECONOMY",
      standard: "AOS_MODEL_STANDARD",
      premium: "AOS_MODEL_PREMIUM",
    };
    const envVal = process.env[envKeys[tier]];
    if (envVal) return envVal;
    if (this.useVendorDefaultModel) return null;
    return this.defaultModelMap()[tier];
  }

  protected resolveModelOrFallback(tier: ModelTier): string {
    return this.resolveModelId(tier) ?? this.defaultModelMap()[tier];
  }

  protected getStoredSessionId(state: HandleState): string | null {
    if (!existsSync(state.sessionFile)) return null;
    try {
      const value = readFileSync(state.sessionFile, "utf-8").trim();
      return value || null;
    } catch {
      return null;
    }
  }

  protected storeSessionId(state: HandleState, sessionId: string): void {
    writeFileSync(state.sessionFile, `${sessionId}\n`, "utf-8");
  }

  protected readContextFiles(opts: MessageOpts | undefined, state: HandleState): string[] {
    return opts?.contextFiles?.length ? opts.contextFiles : state.contextFiles;
  }

  protected formatPromptWithContext(
    state: HandleState,
    message: string,
    opts?: MessageOpts,
    includeSystemPrompt: boolean = true,
  ): string {
    const sections: string[] = [];

    if (includeSystemPrompt) {
      const systemPrompt = state.config.systemPrompt?.trim();
      if (systemPrompt) {
        sections.push(["<system>", systemPrompt, "</system>"].join("\n"));
      }
    }

    for (const file of this.readContextFiles(opts, state)) {
      try {
        const content = readFileSync(file, "utf-8");
        sections.push([`<context_file path="${file}">`, content, "</context_file>"].join("\n"));
      } catch (err: any) {
        sections.push([`<context_file_error path="${file}">`, err?.message ?? "Unable to read file", "</context_file_error>"].join("\n"));
      }
    }

    sections.push(message);
    return sections.join("\n\n");
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;
    try {
      this.cachedModels = await this.discoverModels();
    } catch (err: any) {
      console.warn(`Model discovery failed for ${this.cliBinary()}: ${err.message}. Using default models.`);
      const defaults = this.defaultModelMap();
      this.cachedModels = Object.entries(defaults).map(([_tier, id]) => ({
        id, name: id, contextWindow: 200_000, provider: this.cliBinary(),
      }));
    }
    return this.cachedModels;
  }

  // ── AgentRuntimeAdapter ────────────────────────────────────────

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    const sessionDir = join(".aos", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, `${config.id}.jsonl`);

    const handle: AgentHandle = {
      id: `${sessionId}:${config.id}`,
      agentId: config.id,
      sessionId,
    };

    this.handles.set(handle.id, {
      config,
      sessionFile,
      contextFiles: [],
      modelConfig: { tier: config.model.tier, thinking: config.model.thinking },
      lastContextTokens: 0,
    });

    return handle;
  }

  async sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse> {
    return this.sendMessageWithRetry(handle, message, opts);
  }

  async sendMessageWithRetry(
    handle: AgentHandle, message: string, opts?: MessageOpts,
    maxRetries: number = 2, backoff: "exponential" | "linear" = "exponential",
  ): Promise<AgentResponse> {
    const timeoutMs = opts?.timeoutMs ?? 120000;
    let lastResponse: AgentResponse | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.sendMessageOnce(handle, message, opts, timeoutMs);
      if (response.status === "success") return response;
      lastResponse = response;
      if (response.status === "aborted") return response;
      if (attempt < maxRetries) {
        const delayMs = backoff === "exponential" ? 1000 * Math.pow(2, attempt) : 1000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return lastResponse!;
  }

  private async sendMessageOnce(
    handle: AgentHandle, message: string, opts?: MessageOpts, timeoutMs: number = 120000,
  ): Promise<AgentResponse> {
    const state = this.handles.get(handle.id);
    if (!state) {
      return { text: "", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "unknown", status: "failed", error: `No state found for handle ${handle.id}` };
    }

    const isFirstCall = !existsSync(state.sessionFile);
    const args = this.buildArgs(state, message, isFirstCall, opts);
    const format = this.stdoutFormat();

    return new Promise<AgentResponse>((resolve) => {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => { timeoutController.abort(); }, timeoutMs);

      const proc = spawn(this.cliBinary(), args, {
        shell: false, stdio: ["ignore", "pipe", "pipe"], env: this.buildSubprocessEnv(),
      });
      this.activeProcesses.add(proc);

      let buffer = "";
      let stderr = "";
      let accumulatedText = "";
      let finalResponse = "";
      let tokensIn = 0, tokensOut = 0, cost = 0, contextTokens = 0;
      let model = this.resolveModelOrFallback(state.modelConfig.tier);
      let wasAborted = false;

      const processEvent = (event: ParsedEvent) => {
        switch (event.type) {
          case "text_delta":
            accumulatedText += event.text;
            opts?.onStream?.(accumulatedText);
            break;
          case "message_end":
            finalResponse = event.text;
            tokensIn += event.tokensIn;
            tokensOut += event.tokensOut;
            cost += event.cost;
            contextTokens = event.contextTokens;
            if (event.model) model = event.model;
            break;
          case "session_update":
            this.storeSessionId(state, event.sessionId);
            break;
          case "tool_call":
            this.eventBus.fireToolCall(event.name, event.input);
            break;
          case "tool_result":
            this.eventBus.fireToolResult(event.name, event.input, event.result);
            break;
          case "ignored":
            break;
        }
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let jsonLine = line;
        if (format === "sse") {
          if (!line.startsWith("data:")) return;
          jsonLine = line.slice(5).trim();
          if (jsonLine === "[DONE]") return;
        }
        const event = this.parseEventLine(jsonLine);
        if (event) processEvent(event);
      };

      proc.stdout!.on("data", (data: Buffer) => {
        buffer += data.toString();
        if (format === "ndjson" || format === "sse") {
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) processLine(line);
        } else if (format === "chunked-json") {
          let braceDepth = 0;
          let start = -1;
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === "{") {
              if (braceDepth === 0) start = i;
              braceDepth++;
            } else if (buffer[i] === "}") {
              braceDepth--;
              if (braceDepth === 0 && start >= 0) {
                processLine(buffer.slice(start, i + 1));
                buffer = buffer.slice(i + 1);
                i = -1;
                start = -1;
              }
            }
          }
        }
      });

      proc.stderr!.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code: number | null) => {
        clearTimeout(timeoutId);
        if (buffer.trim()) processLine(buffer);
        this.activeProcesses.delete(proc);
        if (contextTokens > 0) state.lastContextTokens = contextTokens;
        if (tokensIn > 0 || tokensOut > 0 || cost > 0) {
          this.eventBus.fireMessageEnd({ cost, tokens: tokensIn + tokensOut });
        }
        if (wasAborted) {
          resolve({ text: accumulatedText, tokensIn, tokensOut, cost, contextTokens, model, status: "aborted", error: "Agent call was aborted" });
          return;
        }
        if (code !== 0) {
          resolve({
            text: finalResponse || accumulatedText,
            tokensIn,
            tokensOut,
            cost,
            contextTokens,
            model,
            status: "failed",
            error: `Process exited with code ${code}: ${stderr.slice(0, 500)}`,
          });
          return;
        }
        resolve({ text: finalResponse || accumulatedText, tokensIn, tokensOut, cost, contextTokens, model, status: "success" });
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);
        resolve({ text: "", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model, status: "failed", error: `Failed to spawn ${this.cliBinary()}: ${err.message}` });
      });

      timeoutController.signal.addEventListener("abort", () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);
        resolve({ text: accumulatedText, tokensIn, tokensOut, cost, contextTokens, model, status: "failed", error: `Agent timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, { once: true });

      if (opts?.signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (opts.signal.aborted) killProc();
        else opts.signal.addEventListener("abort", killProc, { once: true });
      }
    });
  }

  async destroyAgent(handle: AgentHandle): Promise<void> {
    this.handles.delete(handle.id);
  }

  setOrchestratorPrompt(prompt: string): void {
    this.orchestratorPrompt = prompt;
  }

  async injectContext(handle: AgentHandle, files: string[]): Promise<void> {
    const state = this.handles.get(handle.id);
    if (state) state.contextFiles = files;
  }

  getContextUsage(handle: AgentHandle): ContextUsage {
    const state = this.handles.get(handle.id);
    const tokens = state?.lastContextTokens || 0;
    return { tokens, percent: (tokens / 200_000) * 100 };
  }

  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void {
    const state = this.handles.get(handle.id);
    if (state) state.modelConfig = modelConfig;
  }

  abort(): void {
    for (const proc of this.activeProcesses) {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
    }
    this.activeProcesses.clear();
  }

  async spawnSubAgent(parentId: string, config: ChildAgentConfig, sessionId: string): Promise<AgentHandle> {
    const agentConfig = {
      schema: "aos/agent/v1",
      id: config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "child-agent",
      name: config.name,
      role: config.role,
      cognition: {
        objective_function: config.role,
        time_horizon: {
          primary: "session",
          secondary: "task",
          peripheral: "follow-up",
        },
        core_bias: "delegated execution",
        risk_tolerance: "moderate",
        default_stance: "pragmatic",
      },
      persona: {
        temperament: ["focused"],
        thinking_patterns: ["task-oriented"],
        heuristics: [],
        evidence_standard: {
          convinced_by: ["clear task instructions", "concrete evidence"],
          not_convinced_by: ["vague assumptions"],
        },
        red_lines: [],
      },
      tensions: [],
      report: { structure: "markdown" },
      tools: null,
      skills: [],
      expertise: [],
      model: { tier: config.modelTier ?? ("standard" as ModelTier), thinking: "on" as ThinkingMode },
      systemPrompt: config.systemPrompt,
      domain: config.domainRules,
    } as AgentConfig;
    const handle = await this.spawnAgent(agentConfig, sessionId);
    handle.parentAgentId = parentId;
    return handle;
  }

  async destroySubAgent(_parentId: string, childId: string): Promise<void> {
    for (const [key] of this.handles) {
      if (key.endsWith(`:${childId}`)) {
        this.handles.delete(key);
        return;
      }
    }
  }
}
