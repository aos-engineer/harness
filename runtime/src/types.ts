// ── AOS Harness Runtime Types ─────────────────────────────────

// ── Auth & Cost ─────────────────────────────────────────────────

export interface AuthMode {
  type: "api_key" | "subscription" | "unknown";
  subscription_tier?: string;
  metered: boolean;
}

export interface ModelCost {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  currency: string;
}

export type ModelTier = "economy" | "standard" | "premium";
export type ThinkingMode = "off" | "on" | "extended";
export type RiskTolerance = "very-low" | "low" | "moderate" | "high" | "very-high";
export type FailureAction = "skip" | "abort_round" | "abort_session";
export type BudgetExceededAction = "drop_optional" | "warn_arbiter" | "block_round";

// ── Agent Config ────────────────────────────────────────────────

export interface AgentCognition {
  objective_function: string;
  time_horizon: {
    primary: string;
    secondary: string;
    peripheral: string;
  };
  core_bias: string;
  risk_tolerance: RiskTolerance;
  default_stance: string;
}

export interface Heuristic {
  name: string;
  rule: string;
}

export interface AgentPersona {
  temperament: string[];
  thinking_patterns: string[];
  heuristics: Heuristic[];
  evidence_standard: {
    convinced_by: string[];
    not_convinced_by: string[];
  };
  red_lines: string[];
}

export interface TensionPair {
  agent: string;
  dynamic: string;
}

export interface ExpertiseEntry {
  path: string;
  mode: "read-only" | "read-write";
  use_when: string;
}

export interface AgentCapabilities {
  can_execute_code: boolean;
  can_produce_files: boolean;
  can_review_artifacts: boolean;
  can_serve_artifacts?: boolean;
  available_skills: string[];
  output_types: ("text" | "markdown" | "code" | "diagram" | "structured-data" | "html")[];
}

// ── Domain Enforcement ─────────────────────────────────────────

export interface DomainRule {
  path: string;
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface BlockedTokenSet {
  tokens: string[];
  aliases?: Record<string, string[]>;
}

export interface BashRestrictions {
  blocked_tokens: BlockedTokenSet[];
  blocked_patterns: string[];
}

export interface DomainRules {
  rules: DomainRule[];
  tool_allowlist?: string[];
  tool_denylist?: string[];
  bash_restrictions?: BashRestrictions;
}

export interface EnforcementResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Structured command descriptor passed to `enforceToolAccess` for tools that
 * need richer context than a raw command string (e.g. `execute_code`).
 * Callers may still pass `command: string` for legacy shell-style tools.
 */
export interface ToolCommand {
  language?: string;
  timeout_ms?: number;
}

// ── Delegation Config ──────────────────────────────────────────

export type DelegationStyle = "delegate-only" | "delegate-and-execute";

export interface DelegationConfig {
  can_spawn: boolean;
  max_children: number;
  child_model_tier: ModelTier;
  child_timeout_seconds: number;
  delegation_style: DelegationStyle;
}

// ── Child Agent Types ──────────────────────────────────────────

export interface ChildAgentConfig {
  name: string;
  role: string;
  modelTier?: ModelTier;
  systemPrompt?: string;
  domainRules?: DomainRules;
  timeout?: number;
}

export type SpawnResult =
  | { success: true; childAgentId: string }
  | { success: false; error: "depth_limit_exceeded"; currentDepth: number; maxDepth: number; suggestion: "execute_directly" }
  | { success: false; error: "max_children_exceeded"; active: number; max: number }
  | { success: false; error: "child_not_found"; childAgentId: string }
  | { success: false; error: "child_timeout"; childAgentId: string; elapsed_seconds: number; partial_response?: string };

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  model: string;
}

export interface FileChangeEvent {
  agentId: string;
  path: string;
  operation: "created" | "modified" | "deleted";
  diffSnippet?: string;
}

// ── Expertise Types ────────────────────────────────────────────

export interface ExpertiseConfig {
  enabled: boolean;
  max_lines: number;
  structure: string[];
  read_on: "session_start";
  update_on: "session_end";
  scope: "per-project" | "global";
  mode: "read-write" | "read-only";
  auto_commit: "true" | "review";
}

export interface ExpertiseFile {
  last_updated: string;
  session_count: number;
  knowledge: Record<string, string[]>;
}

export interface ExpertiseDiff {
  agentId: string;
  projectId: string;
  additions: Record<string, string[]>;
  removals: Record<string, string[]>;
}

// ── Persistence Adapter (Optional Mixin) ───────────────────────

export interface PersistenceAdapter {
  persistExpertise(agentId: string, projectId: string, content: string): Promise<void>;
  loadExpertise(agentId: string, projectId: string): Promise<string | null>;
}

// ── Session Checkpoint Types ───────────────────────────────────

export interface AgentCheckpoint {
  agentId: string;
  parentAgentId?: string;
  depth: number;
  conversationTail: TranscriptEntry[];
  expertiseSnapshot?: string;
}

export interface PendingDelegation {
  target: string | string[];
  message: string;
  round: number;
}

export interface SessionCheckpoint {
  sessionId: string;
  constraintState: ConstraintState;
  activeAgents: AgentCheckpoint[];
  roundsCompleted: number;
  pendingDelegations: PendingDelegation[];
  transcriptReplayDepth: number;
  createdAt: string;
}

export interface AgentConfig {
  schema: string;
  id: string;
  name: string;
  role: string;
  cognition: AgentCognition;
  persona: AgentPersona;
  tensions: TensionPair[];
  report: { structure: string };
  tools: string[] | null;
  skills: string[];
  expertise: ExpertiseEntry[];
  model: { tier: ModelTier; thinking: ThinkingMode };
  systemPrompt?: string;
  capabilities?: AgentCapabilities;
  domain?: DomainRules;
  delegation?: DelegationConfig;
  expertiseConfig?: ExpertiseConfig;
  /**
   * Phase 1 (MCP-inside): ids of MCP servers (from aos/mcp/v1 registries) this
   * agent is intended to use. NOTE: currently DECLARATIVE — not yet an enforced
   * isolation boundary. A skill's mcp_binding resolves against the session's
   * started servers regardless of this list; per-agent enforcement arrives with
   * the CLI-vendor tool wiring. Do not rely on it as a security boundary yet.
   */
  mcp_servers?: string[];
  /**
   * Phase 3 (A2A egress): when set, this assembly member is served REMOTELY over
   * A2A. The value references an aos/remote-agent/v1 record (its agent card URL).
   * The local agent.yaml supplies the AOS-side identity (name/role) for the
   * roster; the remote agent supplies the behavior. CompositeRuntime routes such
   * a member to the A2aConnector instead of a local CLI runtime.
   */
  remote_ref?: string;
}

// ── Remote Agent Config (aos/remote-agent/v1) — Phase 3 ──────────

export type A2aTransport = "jsonrpc" | "grpc" | "rest";

export interface RemoteAgentConfig {
  schema: string;
  id: string;
  description?: string;
  /** Only "a2a" today; a discriminator so future remote kinds can be added. */
  kind: "a2a";
  /** Base or full URL of the peer's Agent Card (/.well-known/agent-card.json). */
  agent_card_url: string;
  transport?: A2aTransport;
  /** Env var NAME holding a bearer credential — never the secret itself. */
  auth_ref?: string;
  /**
   * Whether remote spend is trusted for budget gating. Default "unmetered":
   * remote cost is reported as 0 and flagged, so ConstraintEngine's local
   * ModelCost table is not silently corrupted by an untrusted remote signal.
   */
  cost?: "metered" | "unmetered";
  capabilities?: string[];
}

// ── Profile Config ──────────────────────────────────────────────

export interface AssemblyMember {
  agent: string;
  required: boolean;
  structural_advantage?: "speaks-last";
  role_override?: string | null;
}

export interface ProfileConstraints {
  time: { min_minutes: number; max_minutes: number };
  budget: { min: number; max: number; currency: string } | null;
  rounds: { min: number; max: number };
}

export interface ErrorHandling {
  agent_timeout_seconds: number;
  retry_policy: { max_retries: number; backoff: "exponential" | "linear" };
  on_agent_failure: FailureAction;
  on_orchestrator_failure: "save_transcript_and_exit";
  partial_results: "include_with_status_flag";
}

export interface BudgetEstimation {
  strategy: "rolling_average" | "fixed_estimate";
  fixed_estimate_tokens: number;
  safety_margin: number;
  on_estimate_exceeded: BudgetExceededAction;
}

export interface InputSection {
  heading: string;
  guidance: string;
}

export interface ProfileConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  version: string;
  assembly: {
    orchestrator: string;
    perspectives: AssemblyMember[];
  };
  delegation: {
    default: "broadcast" | "round-robin" | "targeted";
    opening_rounds: number;
    tension_pairs: [string, string][];
    bias_limit: number;
    max_delegation_depth?: number;
  };
  constraints: ProfileConstraints;
  error_handling: ErrorHandling;
  budget_estimation?: BudgetEstimation | null;
  input: {
    format: "brief" | "question" | "document" | "freeform";
    required_sections: InputSection[];
    context_files: boolean;
  };
  output: {
    format: string;
    path_template: string;
    sections: string[];
    artifacts: { type: string }[];
    frontmatter: string[];
  };
  runtime_requirements?: {
    serve?: boolean;
    channels?: boolean;
    mempalace?: boolean;
    /** Phase 4: expose this assembly as an A2A agent (ingress). Default false. */
    a2a_serve?: boolean;
  };
  expertise: {
    enabled: boolean;
    path_template: string;
    mode: "per-agent" | "shared" | "none";
  };
  controls: {
    halt: boolean;
    wrap: boolean;
    interject: boolean;
  };
  workflow?: string | null;
  tools: import("./profile-schema").ToolsBlock;
}

// ── Domain Config ───────────────────────────────────────────────

export interface DomainOverlay {
  thinking_patterns?: string[];
  heuristics?: Heuristic[];
  red_lines?: string[];
  evidence_standard?: {
    convinced_by?: string[];
    not_convinced_by?: string[];
  };
  temperament?: string[];
}

export interface DomainConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  lexicon: {
    metrics: string[];
    frameworks: string[];
    stages: string[];
  };
  overlays: Record<string, DomainOverlay>;
  additional_input_sections: InputSection[];
  additional_output_sections: { section: string; description: string }[];
  guardrails: string[];
}

// ── Skill Config ────────────────────────────────────────────────

export interface SkillInputField {
  id: string;
  type: "artifact" | "text" | "structured-data" | "file-path";
  description: string;
}

export interface SkillOutputArtifact {
  id: string;
  format: "markdown" | "code" | "structured-data" | "diagram" | "html-static" | "html-interactive" | "html-live";
  description: string;
}

export interface SkillPlatformRequirements {
  requires_code_execution?: boolean;
  requires_file_access?: boolean;
  requires_network?: boolean;
  requires_tools?: string[];
  min_context_tokens?: number;
}

export interface SkillConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  version: string;
  input: {
    required?: SkillInputField[];
    optional?: SkillInputField[];
  };
  output: {
    artifacts?: SkillOutputArtifact[];
    structured_result?: boolean;
  };
  compatible_agents?: string[];
  platform_bindings?: Record<string, string | null>;
  platform_requirements?: SkillPlatformRequirements;
  /**
   * Phase 1 (MCP-inside): when present, invokeSkill resolves to a native MCP
   * tool call against the named server instead of sending prompt.md as an LLM
   * prompt. Opt-in per skill — absence preserves the existing behavior.
   */
  mcp_binding?: McpToolBinding;
}

// ── MCP Config (aos/mcp/v1) ─────────────────────────────────────

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string;
  description?: string;
  transport: McpTransport;
  /** stdio transport: executable to spawn (like mempalace's `python`). */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http/sse transport: endpoint URL. Validated by MeshEgressPolicy before connect. */
  url?: string;
  /** Name of an env var holding the bearer credential — never the secret itself. */
  auth_ref?: string;
  /** If set, only these tool names are exposed from this server (narrowing). */
  tool_allowlist?: string[];
}

export interface McpRegistryConfig {
  schema: string;
  id: string;
  description?: string;
  servers: McpServerConfig[];
}

/** A skill's binding to a native MCP tool call (replaces the LLM-prompt path). */
export interface McpToolBinding {
  /** References an McpServerConfig.id from a loaded aos/mcp/v1 registry. */
  server: string;
  /** Tool name(s) on that server. The first is the primary tool invoked. */
  tools: string[];
}

/**
 * A fully-resolved server spec for handing to a vendor CLI's MCP config
 * (Phase 1 "Tier 2"). env/headers are resolved (${VAR}/auth_ref expanded);
 * http urls have passed the egress gate. `tools` lists discovered tool names
 * when the in-process manager started the server.
 */
export interface VendorMcpServerSpec {
  id: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
}

// ── Constraint State ────────────────────────────────────────────

export interface ConstraintState {
  elapsed_minutes: number;
  budget_spent: number;
  rounds_completed: number;
  past_min_time: boolean;
  past_min_budget: boolean;
  past_min_rounds: boolean;
  past_all_minimums: boolean;
  approaching_max_time: boolean;
  approaching_max_budget: boolean;
  approaching_max_rounds: boolean;
  approaching_any_maximum: boolean;
  hit_maximum: boolean;
  hit_reason: "none" | "time" | "budget" | "rounds" | "constraint_conflict";
  conflict_detail?: string;
  can_end: boolean;
  bias_ratio: number;
  most_addressed: string[];
  least_addressed: string[];
  bias_blocked: boolean;
  metered: boolean;
}

// ── Agent Runtime Types ─────────────────────────────────────────

export interface AgentHandle {
  id: string;
  agentId: string;
  sessionId: string;
  parentAgentId?: string;
  depth?: number;
  /**
   * Phase 2: which Connector owns this handle (set by CompositeRuntime at spawn
   * time). Absent → treated as "local". Lets dispatch route per handle without
   * any change to DelegationRouter / ChildAgentManager / the engine round loop.
   */
  connectorKind?: string;
}

export interface MessageOpts {
  contextFiles?: string[];
  signal?: AbortSignal;
  onStream?: (partial: string) => void;
  extraArgs?: string[];
  timeoutMs?: number;
}

export interface AgentResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  contextTokens: number;
  model: string;
  status: "success" | "failed" | "aborted";
  error?: string;
}

export interface ContextUsage {
  tokens: number;
  percent: number;
}

// ── Delegation ──────────────────────────────────────────────────

export type DelegationTarget =
  | { type: "broadcast" }
  | { type: "targeted"; agents: string[] }
  | { type: "tension"; pair: [string, string] };

/**
 * Interface for delegating work to agents. The engine implements this
 * and passes it to the WorkflowRunner, allowing the runner to delegate
 * without managing agent lifecycle directly.
 */
export interface DelegationDelegate {
  /** Send a message to specific agents and collect responses. */
  delegateToAgents(agentIds: string[], message: string): Promise<AgentResponse[]>;

  /** Run a tension pair: agent1 responds, agent2 challenges, agent1 rebuts. */
  delegateTensionPair(agent1: string, agent2: string, message: string): Promise<AgentResponse[]>;

  /** Send a message to the orchestrator for synthesis. */
  delegateToOrchestrator(message: string): Promise<AgentResponse>;

  /**
   * Execution-mode dispatch: send a message directly to ONE agent (local or
   * remote A2A), bypassing the deliberation router and its bias accounting.
   *
   * Unlike {@link delegateToAgents}, the target need NOT be an assembly
   * perspective — this is the path for an *execution-mode* workflow step
   * (`a2a-delegate` / `adk-graph`) that hands its input to a remote ADK/A2A
   * graph as an opaque unit and ingests the single response as the step
   * output. Optional so existing DelegationDelegate implementers (mocks,
   * older callers) stay source-compatible.
   */
  delegateDirect?(agentId: string, message: string): Promise<AgentResponse>;
}

// ── Artifact Types ──────────────────────────────────────────────

export interface ArtifactManifest {
  schema: "aos/artifact/v1";
  id: string;
  produced_by: string[];
  step_id: string;
  format: "markdown" | "code" | "structured-data" | "diagram" | "html-static" | "html-interactive" | "html-live";
  content_path: string;
  platform?: "linkedin" | "twitter" | "tiktok" | "instagram" | "generic";
  variation_index?: number;
  channel_id?: string;
  metadata: {
    produced_at: string;
    review_status: "pending" | "approved" | "rejected" | "revised";
    review_gate: string | null;
    word_count: number;
    revision: number;
    [key: string]: unknown;
  };
}

export interface LoadedArtifact {
  manifest: ArtifactManifest;
  content: string;
}

// ── Execution Adapter Types ─────────────────────────────────────

export interface ExecuteCodeOpts {
  language?: string;
  timeout_ms?: number;
  cwd?: string;
  env?: Record<string, string>;
  sandbox?: "strict" | "relaxed";
}

export interface ExecutionResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  files_created?: string[];
  files_modified?: string[];
}

export interface SkillInput {
  args?: string;
  context?: Record<string, string>;
  artifacts?: string[];
}

export interface SkillResult {
  success: boolean;
  output: string;
  artifacts_produced?: string[];
  files_created?: string[];
  files_modified?: string[];
  error?: string;
}

export interface ReviewResult {
  status: "approved" | "rejected" | "needs-revision";
  feedback?: string;
  reviewer: string;
  issues?: ReviewIssue[];
}

export interface ReviewIssue {
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string;
  location?: string;
}

export class UnsupportedError extends Error {
  constructor(method: string, message?: string) {
    super(message ?? `Method "${method}" is not supported by this adapter`);
    this.name = "UnsupportedError";
  }
}

// ── Transcript Events ───────────────────────────────────────────

export type TranscriptEventType =
  | "session_start"
  | "agent_spawn"
  | "delegation"
  | "response"
  | "constraint_check"
  | "constraint_warning"
  | "budget_estimate"
  | "budget_abort"
  | "steer"
  | "error"
  | "expertise_write"
  | "end_session"
  | "final_statement"
  | "agent_destroy"
  | "session_end"
  // Workflow events
  | "workflow_start"
  | "step_start"
  | "step_end"
  | "gate_prompt"
  | "gate_result"
  | "artifact_write"
  | "workflow_end"
  // Execution events
  | "code_execution"
  | "skill_invocation"
  | "review_submission"
  // Domain enforcement events
  | "domain_violation"
  | "domain_access"
  // Hierarchical delegation events (Phase 2)
  | "agent_spawned"
  | "agent_destroyed"
  | "child_delegation"
  | "child_response"
  // Expertise events (Phase 3a)
  | "expertise_loaded"
  | "expertise_updated"
  // File tracking (Phase 2)
  | "file_changed"
  // Cost granularity
  | "token_usage"
  // Session lifecycle (Phase 3b)
  | "session_paused"
  | "session_resumed"
  // Memory events
  | "memory_wake"
  | "memory_wake_truncated"
  | "memory_recall_requested"
  | "memory_recall"
  | "memory_recall_denied"
  | "memory_committed"
  | "memory_commit_failed"
  | "memory_provider_restart"
  | "memory_fallback_written"
  // MCP plane (Phase 1 — external toolsets). Emitted by McpToolsetManager.
  | "mcp_server_started"
  | "mcp_server_unavailable"
  | "mcp_tool_call"
  | "mcp_tool_result"
  | "mcp_tool_error"
  // A2A egress (Phase 3 — remote agents). Emitted by A2aConnector / task-mapper.
  | "a2a_task_created"
  | "a2a_task_status"
  | "a2a_artifact_received"
  | "a2a_task_failed";

export interface TranscriptEntry {
  type: TranscriptEventType;
  timestamp: string;
  [key: string]: unknown;
}

// ── Adapter Interface ───────────────────────────────────────────

export interface AgentRuntimeAdapter {
  spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle>;
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
  destroyAgent(handle: AgentHandle): Promise<void>;
  setOrchestratorPrompt(prompt: string): void;
  injectContext(handle: AgentHandle, files: string[]): Promise<void>;
  getContextUsage(handle: AgentHandle): ContextUsage;
  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void;
  getAuthMode(): AuthMode;
  getModelCost(tier: ModelTier): ModelCost;
  abort(): void;
  spawnSubAgent(parentId: string, config: ChildAgentConfig, sessionId: string): Promise<AgentHandle>;
  destroySubAgent(parentId: string, childId: string): Promise<void>;
}

/**
 * Phase 2: the minimal cross-boundary member contract — a deliberate NARROWING
 * of AgentRuntimeAdapter to the methods the engine calls on a member. A local
 * CLI runtime is a full AgentRuntimeAdapter and therefore satisfies this plus
 * all the optional extended methods. A remote/A2A connector (Phase 3) implements
 * only the required methods; CompositeRuntime throws UnsupportedError when an
 * unsupported extended method is invoked on such a handle.
 */
export interface Connector {
  spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle>;
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
  destroyAgent(handle: AgentHandle): Promise<void>;
  getAuthMode(): AuthMode;
  getModelCost(tier: ModelTier): ModelCost;
  // Optional extended capabilities (present on local CLI connectors):
  spawnSubAgent?(parentId: string, config: ChildAgentConfig, sessionId: string): Promise<AgentHandle>;
  destroySubAgent?(parentId: string, childId: string): Promise<void>;
  injectContext?(handle: AgentHandle, files: string[]): Promise<void>;
  getContextUsage?(handle: AgentHandle): ContextUsage;
  setModel?(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void;
  setOrchestratorPrompt?(prompt: string): void;
  abort?(): void;
}

export interface EventBusAdapter {
  onSessionStart(handler: () => Promise<void>): void;
  onSessionShutdown(handler: () => Promise<void>): void;
  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void;
  onAgentEnd(handler: () => Promise<void>): void;
  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void;
  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void;
  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void;
  onCompaction(handler: () => Promise<void>): void;
}

export interface UIAdapter {
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
  registerTool(name: string, schema: Record<string, unknown>, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  renderAgentResponse(agent: string, response: string, color: string): void;
  renderCustomMessage(type: string, content: string, details: Record<string, unknown>): void;
  setWidget(id: string, renderer: (() => string[]) | undefined): void;
  setFooter(renderer: (width: number) => string[]): void;
  setStatus(key: string, text: string): void;
  setTheme(name: string): void;
  promptSelect(label: string, options: string[]): Promise<number>;
  promptConfirm(title: string, message: string): Promise<boolean>;
  promptInput(label: string): Promise<string>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  blockInput(allowedCommands: string[]): void;
  unblockInput(): void;
  steerMessage(message: string): void;
}

export interface WorkflowAdapter {
  dispatchParallel(
    agents: AgentHandle[],
    message: string,
    opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void; timeoutMs?: number },
  ): Promise<AgentResponse[]>;
  isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  openInEditor(path: string, editor: string): Promise<void>;
  persistState(key: string, value: unknown): Promise<void>;
  loadState(key: string): Promise<unknown>;
  executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult>;
  invokeSkill(
    handle: AgentHandle,
    skillId: string,
    input: SkillInput,
    opts?: { signal?: AbortSignal },
  ): Promise<SkillResult>;
  createArtifact(artifact: ArtifactManifest, content: string): Promise<void>;
  loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact>;
  submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult>;
  enforceToolAccess(agentId: string, toolCall: { tool: string; path?: string; command?: string | ToolCommand }): Promise<EnforcementResult>;
}

export type AOSAdapter = AgentRuntimeAdapter & EventBusAdapter & UIAdapter & WorkflowAdapter;

// ── Helper Functions ────────────────────────────────────────────

export function createDefaultConstraintState(): ConstraintState {
  return {
    elapsed_minutes: 0,
    budget_spent: 0,
    rounds_completed: 0,
    past_min_time: false,
    past_min_budget: false,
    past_min_rounds: false,
    past_all_minimums: false,
    approaching_max_time: false,
    approaching_max_budget: false,
    approaching_max_rounds: false,
    approaching_any_maximum: false,
    hit_maximum: false,
    hit_reason: "none",
    can_end: false,
    bias_ratio: 0,
    most_addressed: [],
    least_addressed: [],
    bias_blocked: false,
    metered: true,
  };
}

export function isConstraintConflict(state: ConstraintState): boolean {
  return state.hit_reason === "constraint_conflict";
}

export function isMetered(auth: AuthMode): boolean {
  return auth.metered;
}
