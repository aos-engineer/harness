/**
 * MockAdapter — in-memory adapter implementing all 4 adapter layers.
 * Records all calls for test assertions.
 */

import type {
  AOSAdapter,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  ArtifactManifest,
  AuthMode,
  ChildAgentConfig,
  ContextUsage,
  EnforcementResult,
  ExecuteCodeOpts,
  ExecutionResult,
  LoadedArtifact,
  MessageOpts,
  ModelCost,
  ModelTier,
  PersistenceAdapter,
  ReviewResult,
  SkillInput,
  SkillResult,
  ThinkingMode,
  ToolCommand,
} from "../src/types";
import { UnsupportedError } from "../src/types";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface MockCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

export class MockAdapter implements AOSAdapter, PersistenceAdapter {
  // ── Configurable state ──────────────────────────────────────────
  authMode: AuthMode = { type: "api_key", metered: true };
  agentResponses: Map<string, string> = new Map();
  responseCost = 0.012;
  responseTokensIn = 500;
  responseTokensOut = 300;
  domainEnforcerOverride?: (agentId: string, toolCall: { tool: string; path?: string; command?: string | ToolCommand }) => EnforcementResult;

  // ── Internal tracking ───────────────────────────────────────────
  calls: MockCall[] = [];
  private nextId = 1;
  private eventHandlers: Map<string, Function[]> = new Map();
  private expertiseStore: Map<string, string> = new Map();

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  // ── AgentRuntimeAdapter ─────────────────────────────────────────

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    this.record("spawnAgent", config.id, sessionId);
    const handle: AgentHandle = {
      id: `handle-${this.nextId++}`,
      agentId: config.id,
      sessionId,
    };
    return handle;
  }

  async sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse> {
    this.record("sendMessage", handle.agentId, message, opts);
    const text = this.agentResponses.get(handle.agentId) ?? `Response from ${handle.agentId}`;
    return {
      text,
      tokensIn: this.responseTokensIn,
      tokensOut: this.responseTokensOut,
      cost: this.responseCost,
      contextTokens: 0,
      model: "mock-model",
      status: "success",
    };
  }

  async destroyAgent(handle: AgentHandle): Promise<void> {
    this.record("destroyAgent", handle.agentId);
  }

  setOrchestratorPrompt(prompt: string): void {
    this.record("setOrchestratorPrompt", prompt);
  }

  async injectContext(handle: AgentHandle, files: string[]): Promise<void> {
    this.record("injectContext", handle.agentId, files);
  }

  getContextUsage(handle: AgentHandle): ContextUsage {
    this.record("getContextUsage", handle.agentId);
    return { tokens: 0, percent: 0 };
  }

  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void {
    this.record("setModel", handle.agentId, modelConfig);
  }

  getAuthMode(): AuthMode {
    this.record("getAuthMode");
    return this.authMode;
  }

  getModelCost(tier: ModelTier): ModelCost {
    this.record("getModelCost", tier);
    const costs: Record<ModelTier, ModelCost> = {
      economy: { inputPerMillionTokens: 0.25, outputPerMillionTokens: 1.0, currency: "USD" },
      standard: { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0, currency: "USD" },
      premium: { inputPerMillionTokens: 15.0, outputPerMillionTokens: 75.0, currency: "USD" },
    };
    return costs[tier];
  }

  abort(): void {
    this.record("abort");
  }

  async spawnSubAgent(parentId: string, config: ChildAgentConfig, sessionId: string): Promise<AgentHandle> {
    this.record("spawnSubAgent", parentId, config.name, sessionId);
    return {
      id: `handle-${this.nextId++}`,
      agentId: config.name,
      sessionId,
      parentAgentId: parentId,
      depth: 1,
    };
  }

  async destroySubAgent(parentId: string, childId: string): Promise<void> {
    this.record("destroySubAgent", parentId, childId);
  }

  // ── EventBusAdapter ─────────────────────────────────────────────

  private addHandler(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  onSessionStart(handler: () => Promise<void>): void {
    this.record("onSessionStart");
    this.addHandler("sessionStart", handler);
  }

  onSessionShutdown(handler: () => Promise<void>): void {
    this.record("onSessionShutdown");
    this.addHandler("sessionShutdown", handler);
  }

  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void {
    this.record("onBeforeAgentStart");
    this.addHandler("beforeAgentStart", handler);
  }

  onAgentEnd(handler: () => Promise<void>): void {
    this.record("onAgentEnd");
    this.addHandler("agentEnd", handler);
  }

  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void {
    this.record("onToolCall");
    this.addHandler("toolCall", handler);
  }

  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void {
    this.record("onToolResult");
    this.addHandler("toolResult", handler);
  }

  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void {
    this.record("onMessageEnd");
    this.addHandler("messageEnd", handler);
  }

  onCompaction(handler: () => Promise<void>): void {
    this.record("onCompaction");
    this.addHandler("compaction", handler);
  }

  // ── UIAdapter ───────────────────────────────────────────────────

  registerCommand(name: string, handler: (args: string) => Promise<void>): void {
    this.record("registerCommand", name);
  }

  registerTool(name: string, schema: Record<string, unknown>, handler: (params: Record<string, unknown>) => Promise<unknown>): void {
    this.record("registerTool", name);
  }

  renderAgentResponse(agent: string, response: string, color: string): void {
    this.record("renderAgentResponse", agent, response, color);
  }

  renderCustomMessage(type: string, content: string, details: Record<string, unknown>): void {
    this.record("renderCustomMessage", type, content, details);
  }

  setWidget(id: string, renderer: (() => string[]) | undefined): void {
    this.record("setWidget", id);
  }

  setFooter(renderer: (width: number) => string[]): void {
    this.record("setFooter");
  }

  setStatus(key: string, text: string): void {
    this.record("setStatus", key, text);
  }

  setTheme(name: string): void {
    this.record("setTheme", name);
  }

  async promptSelect(label: string, options: string[]): Promise<number> {
    this.record("promptSelect", label, options);
    return 0;
  }

  async promptConfirm(title: string, message: string): Promise<boolean> {
    this.record("promptConfirm", title, message);
    return true;
  }

  async promptInput(label: string): Promise<string> {
    this.record("promptInput", label);
    return "";
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    this.record("notify", message, level);
  }

  blockInput(allowedCommands: string[]): void {
    this.record("blockInput", allowedCommands);
  }

  unblockInput(): void {
    this.record("unblockInput");
  }

  steerMessage(message: string): void {
    this.record("steerMessage", message);
  }

  // ── WorkflowAdapter ─────────────────────────────────────────────

  async dispatchParallel(
    agents: AgentHandle[],
    message: string,
    opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void; timeoutMs?: number },
  ): Promise<AgentResponse[]> {
    this.record("dispatchParallel", agents.map((a) => a.agentId), message, opts);
    const responses: AgentResponse[] = [];
    for (const agent of agents) {
      const response = await this.sendMessage(agent, message, { timeoutMs: opts?.timeoutMs });
      responses.push(response);
    }
    return responses;
  }

  async isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    this.record("isolateWorkspace");
    return { path: "/tmp/mock-workspace", cleanup: async () => {} };
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.record("writeFile", path, content);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }

  async readFile(path: string): Promise<string> {
    this.record("readFile", path);
    return readFileSync(path, "utf-8");
  }

  async openInEditor(path: string, editor: string): Promise<void> {
    this.record("openInEditor", path, editor);
  }

  async persistState(key: string, value: unknown): Promise<void> {
    this.record("persistState", key, value);
  }

  async loadState(key: string): Promise<unknown> {
    this.record("loadState", key);
    return null;
  }

  // ── Execution Methods (new) ─────────────────────────────────────

  async executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
    this.record("executeCode", handle.agentId, code, opts);
    return {
      success: true,
      exit_code: 0,
      stdout: "",
      stderr: "",
      duration_ms: 0,
      files_created: [],
      files_modified: [],
    };
  }

  async invokeSkill(handle: AgentHandle, skillId: string, input: SkillInput): Promise<SkillResult> {
    this.record("invokeSkill", handle.agentId, skillId, input);
    return {
      success: true,
      output: "",
      artifacts_produced: [],
      files_created: [],
      files_modified: [],
    };
  }

  async createArtifact(artifact: ArtifactManifest, content: string): Promise<void> {
    this.record("createArtifact", artifact.id, content);
  }

  async loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact> {
    this.record("loadArtifact", artifactId, sessionDir);
    return {
      manifest: {
        schema: "aos/artifact/v1",
        id: artifactId,
        produced_by: [],
        step_id: "mock-step",
        format: "markdown",
        content_path: `${sessionDir}/artifacts/${artifactId}.md`,
        metadata: {
          produced_at: new Date().toISOString(),
          review_status: "pending",
          review_gate: null,
          word_count: 0,
          revision: 1,
        },
      },
      content: "",
    };
  }

  async submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult> {
    this.record("submitForReview", artifact.manifest.id, reviewer.agentId, reviewPrompt);
    return {
      status: "approved",
      reviewer: reviewer.agentId,
    };
  }

  async enforceToolAccess(
    agentId: string,
    toolCall: { tool: string; path?: string; command?: string | ToolCommand },
  ): Promise<EnforcementResult> {
    this.record("enforceToolAccess", agentId, toolCall);
    if (this.domainEnforcerOverride) {
      return this.domainEnforcerOverride(agentId, toolCall);
    }
    return { allowed: true };
  }

  // ── PersistenceAdapter ──────────────────────────────────────────

  async persistExpertise(agentId: string, projectId: string, content: string): Promise<void> {
    this.record("persistExpertise", agentId, projectId);
    this.expertiseStore.set(`${agentId}:${projectId}`, content);
  }

  async loadExpertise(agentId: string, projectId: string): Promise<string | null> {
    this.record("loadExpertise", agentId, projectId);
    return this.expertiseStore.get(`${agentId}:${projectId}`) ?? null;
  }
}
