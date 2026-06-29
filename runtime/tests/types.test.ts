import { describe, it, expect } from "bun:test";
import {
  type AgentConfig,
  type ProfileConfig,
  type DomainConfig,
  type ConstraintState,
  type AgentResponse,
  type AuthMode,
  type ModelCost,
  type DelegationTarget,
  type AgentCapabilities,
  type ArtifactManifest,
  type LoadedArtifact,
  type ExecuteCodeOpts,
  type ExecutionResult,
  type SkillInput,
  type SkillResult,
  type ReviewResult,
  type ReviewIssue,
  type AssemblyMember,
  type TranscriptEventType,
  type ExpertiseConfig,
  type ExpertiseFile,
  type ExpertiseDiff,
  type PersistenceAdapter,
  isConstraintConflict,
  isMetered,
  createDefaultConstraintState,
  UnsupportedError,
} from "../src/types";
import { MockAdapter } from "./mock-adapter";

describe("ConstraintState", () => {
  it("createDefaultConstraintState returns zeroed state", () => {
    const state = createDefaultConstraintState();
    expect(state.elapsed_minutes).toBe(0);
    expect(state.budget_spent).toBe(0);
    expect(state.rounds_completed).toBe(0);
    expect(state.past_all_minimums).toBe(false);
    expect(state.hit_maximum).toBe(false);
    expect(state.can_end).toBe(false);
    expect(state.bias_ratio).toBe(0);
    expect(state.bias_blocked).toBe(false);
    expect(state.metered).toBe(true);
  });

  it("isConstraintConflict detects budget max before time min", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "constraint_conflict";
    state.conflict_detail = "budget_max hit before time_min met";
    expect(isConstraintConflict(state)).toBe(true);
  });

  it("isConstraintConflict returns false for normal hit", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "time";
    expect(isConstraintConflict(state)).toBe(false);
  });
});

describe("AuthMode", () => {
  it("isMetered returns true for api_key auth", () => {
    const auth: AuthMode = { type: "api_key", metered: true };
    expect(isMetered(auth)).toBe(true);
  });

  it("isMetered returns false for subscription auth", () => {
    const auth: AuthMode = { type: "subscription", metered: false, subscription_tier: "max" };
    expect(isMetered(auth)).toBe(false);
  });
});

describe("AgentCapabilities", () => {
  it("can create a capabilities object with all fields", () => {
    const caps: AgentCapabilities = {
      can_execute_code: true,
      can_produce_files: true,
      can_review_artifacts: true,
      can_serve_artifacts: true,
      available_skills: ["run-tests", "security-scan"],
      output_types: ["text", "markdown", "code", "html"],
    };
    expect(caps.can_execute_code).toBe(true);
    expect(caps.available_skills).toHaveLength(2);
    expect(caps.output_types).toContain("code");
    expect(caps.output_types).toContain("html");
  });

  it("capabilities is optional on AgentConfig", () => {
    const config = {
      schema: "aos/agent/v1",
      id: "test",
      name: "Test",
      role: "tester",
      cognition: {
        objective_function: "test",
        time_horizon: { primary: "short", secondary: "medium", peripheral: "long" },
        core_bias: "none",
        risk_tolerance: "moderate" as const,
        default_stance: "neutral",
      },
      persona: {
        temperament: [],
        thinking_patterns: [],
        heuristics: [],
        evidence_standard: { convinced_by: [], not_convinced_by: [] },
        red_lines: [],
      },
      tensions: [],
      report: { structure: "freeform" },
      tools: null,
      skills: [],
      expertise: [],
      model: { tier: "standard" as const, thinking: "on" as const },
    } satisfies AgentConfig;
    expect((config as any).capabilities).toBeUndefined();
  });
});

describe("AssemblyMember", () => {
  it("supports role_override field", () => {
    const member: AssemblyMember = {
      agent: "architect",
      required: true,
      structural_advantage: "speaks-last",
      role_override: "Produce architecture decision records",
    };
    expect(member.role_override).toBe("Produce architecture decision records");
  });

  it("role_override defaults to undefined when not set", () => {
    const member: AssemblyMember = {
      agent: "catalyst",
      required: false,
    };
    expect(member.role_override).toBeUndefined();
  });

  it("role_override can be null", () => {
    const member: AssemblyMember = {
      agent: "sentinel",
      required: true,
      role_override: null,
    };
    expect(member.role_override).toBeNull();
  });
});

describe("ProfileConfig workflow field", () => {
  it("workflow is optional on ProfileConfig", () => {
    // Type check: workflow field is optional
    const partial: Pick<ProfileConfig, "workflow"> = {};
    expect(partial.workflow).toBeUndefined();
  });

  it("workflow can be a string or null", () => {
    const withWorkflow: Pick<ProfileConfig, "workflow"> = { workflow: "cto-execution-workflow" };
    expect(withWorkflow.workflow).toBe("cto-execution-workflow");

    const withNull: Pick<ProfileConfig, "workflow"> = { workflow: null };
    expect(withNull.workflow).toBeNull();
  });
});

describe("ArtifactManifest", () => {
  it("can create a valid artifact manifest", () => {
    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id: "requirements_analysis",
      produced_by: ["advocate", "strategist"],
      step_id: "understand",
      format: "html-static",
      content_path: "artifacts/requirements_analysis.md",
      platform: "generic",
      variation_index: 1,
      metadata: {
        produced_at: "2026-03-24T14:30:00Z",
        review_status: "approved",
        review_gate: "understand",
        word_count: 1250,
        revision: 1,
      },
    };
    expect(manifest.schema).toBe("aos/artifact/v1");
    expect(manifest.produced_by).toHaveLength(2);
    expect(manifest.metadata.review_status).toBe("approved");
    expect(manifest.platform).toBe("generic");
  });

  it("metadata supports additional properties", () => {
    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id: "test",
      produced_by: ["agent1"],
      step_id: "step1",
      format: "code",
      content_path: "artifacts/test.ts",
      metadata: {
        produced_at: "2026-03-24T14:30:00Z",
        review_status: "pending",
        review_gate: null,
        word_count: 100,
        revision: 1,
        custom_field: "custom_value",
      },
    };
    expect(manifest.metadata.custom_field).toBe("custom_value");
  });
});

describe("LoadedArtifact", () => {
  it("combines manifest and content", () => {
    const loaded: LoadedArtifact = {
      manifest: {
        schema: "aos/artifact/v1",
        id: "test",
        produced_by: ["agent1"],
        step_id: "step1",
        format: "markdown",
        content_path: "artifacts/test.md",
        metadata: {
          produced_at: "2026-03-24T14:30:00Z",
          review_status: "pending",
          review_gate: null,
          word_count: 5,
          revision: 1,
        },
      },
      content: "Hello world",
    };
    expect(loaded.content).toBe("Hello world");
    expect(loaded.manifest.id).toBe("test");
  });
});

describe("Execution adapter types", () => {
  it("ExecuteCodeOpts has all optional fields", () => {
    const opts: ExecuteCodeOpts = {};
    expect(opts.language).toBeUndefined();
    expect(opts.timeout_ms).toBeUndefined();

    const full: ExecuteCodeOpts = {
      language: "typescript",
      timeout_ms: 30000,
      cwd: "/tmp",
      env: { NODE_ENV: "test" },
      sandbox: "strict",
    };
    expect(full.language).toBe("typescript");
    expect(full.sandbox).toBe("strict");
  });

  it("ExecutionResult has required fields", () => {
    const result: ExecutionResult = {
      success: true,
      exit_code: 0,
      stdout: "ok",
      stderr: "",
      duration_ms: 123,
    };
    expect(result.success).toBe(true);
    expect(result.files_created).toBeUndefined();
  });

  it("SkillInput has all optional fields", () => {
    const input: SkillInput = {};
    expect(input.args).toBeUndefined();

    const full: SkillInput = {
      args: "--verbose",
      context: { key: "value" },
      artifacts: ["artifact1"],
    };
    expect(full.artifacts).toHaveLength(1);
  });

  it("SkillResult has required and optional fields", () => {
    const result: SkillResult = {
      success: true,
      output: "done",
    };
    expect(result.error).toBeUndefined();
  });

  it("ReviewResult has required and optional fields", () => {
    const approved: ReviewResult = {
      status: "approved",
      reviewer: "sentinel",
    };
    expect(approved.feedback).toBeUndefined();

    const rejected: ReviewResult = {
      status: "rejected",
      feedback: "Needs more detail",
      reviewer: "sentinel",
      issues: [
        { severity: "major", description: "Missing error handling", location: "src/main.ts" },
        { severity: "suggestion", description: "Consider adding types" },
      ],
    };
    expect(rejected.issues).toHaveLength(2);
    expect(rejected.issues![0].severity).toBe("major");
  });
});

describe("UnsupportedError", () => {
  it("creates error with method name", () => {
    const err = new UnsupportedError("executeCode");
    expect(err.name).toBe("UnsupportedError");
    expect(err.message).toContain("executeCode");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates error with custom message", () => {
    const err = new UnsupportedError("invokeSkill", "Skills not available on this platform");
    expect(err.message).toBe("Skills not available on this platform");
  });
});

describe("TranscriptEventType", () => {
  it("includes workflow event types", () => {
    const workflowEvents: TranscriptEventType[] = [
      "workflow_start",
      "step_start",
      "step_end",
      "gate_prompt",
      "gate_result",
      "artifact_write",
      "workflow_end",
    ];
    // Type check passes if this compiles
    expect(workflowEvents).toHaveLength(7);
  });

  it("includes execution event types", () => {
    const executionEvents: TranscriptEventType[] = [
      "code_execution",
      "skill_invocation",
      "review_submission",
    ];
    expect(executionEvents).toHaveLength(3);
  });

  it("includes memory event types", () => {
    const memoryEvents: TranscriptEventType[] = [
      "memory_wake", "memory_wake_truncated", "memory_recall_requested",
      "memory_recall", "memory_recall_denied", "memory_committed",
      "memory_commit_failed", "memory_provider_restart", "memory_fallback_written",
    ];
    expect(memoryEvents).toHaveLength(9);
  });

  it("includes all original event types", () => {
    const originalEvents: TranscriptEventType[] = [
      "session_start",
      "agent_spawn",
      "delegation",
      "response",
      "constraint_check",
      "constraint_warning",
      "budget_estimate",
      "budget_abort",
      "steer",
      "error",
      "expertise_write",
      "end_session",
      "final_statement",
      "agent_destroy",
      "session_end",
    ];
    expect(originalEvents).toHaveLength(15);
  });
});

describe("Domain & Delegation types", () => {
  it("DomainRules compiles with valid structure", () => {
    const rules: import("../src/types").DomainRules = {
      rules: [
        { path: "apps/web/**", read: true, write: true, delete: false },
        { path: "**/*.env*", read: false, write: false, delete: false },
      ],
      tool_allowlist: ["read", "write", "edit"],
      tool_denylist: ["bash"],
      bash_restrictions: {
        blocked_tokens: [
          { tokens: ["rm", "recursive"], aliases: { recursive: ["-r", "-R", "--recursive"] } },
        ],
        blocked_patterns: ["curl.*-X DELETE"],
      },
    };
    expect(rules.rules).toHaveLength(2);
    expect(rules.tool_denylist).toContain("bash");
  });

  it("DelegationConfig compiles with valid structure", () => {
    const config: import("../src/types").DelegationConfig = {
      can_spawn: true,
      max_children: 3,
      child_model_tier: "economy",
      child_timeout_seconds: 120,
      delegation_style: "delegate-only",
    };
    expect(config.can_spawn).toBe(true);
  });

  it("EnforcementResult compiles with allowed and denied", () => {
    const allowed: import("../src/types").EnforcementResult = { allowed: true };
    const denied: import("../src/types").EnforcementResult = { allowed: false, reason: "blocked" };
    expect(allowed.allowed).toBe(true);
    expect(denied.reason).toBe("blocked");
  });
});

describe("Hierarchical delegation types", () => {
  it("ChildAgentConfig compiles", () => {
    const config: import("../src/types").ChildAgentConfig = {
      name: "backend-dev", role: "test", modelTier: "economy",
      systemPrompt: "You are a dev.", timeout: 120,
    };
    expect(config.name).toBe("backend-dev");
  });
  it("SpawnResult compiles with success and errors", () => {
    const ok: import("../src/types").SpawnResult = { success: true, childAgentId: "c1" };
    const err: import("../src/types").SpawnResult = { success: false, error: "depth_limit_exceeded", currentDepth: 2, maxDepth: 2, suggestion: "execute_directly" };
    expect(ok.success).toBe(true);
    expect(err.success).toBe(false);
  });
  it("AgentHandle accepts parentAgentId and depth", () => {
    const h: import("../src/types").AgentHandle = { id: "h1", agentId: "c1", sessionId: "s1", parentAgentId: "p1", depth: 1 };
    expect(h.depth).toBe(1);
  });
});

describe("ExpertiseConfig, ExpertiseFile, ExpertiseDiff types", () => {
  it("ExpertiseConfig compiles with all required fields", () => {
    const config: ExpertiseConfig = {
      enabled: true,
      max_lines: 200,
      structure: ["decisions", "patterns", "gotchas"],
      read_on: "session_start",
      update_on: "session_end",
      scope: "per-project",
      mode: "read-write",
      auto_commit: "review",
    };
    expect(config.enabled).toBe(true);
    expect(config.max_lines).toBe(200);
    expect(config.scope).toBe("per-project");
    expect(config.mode).toBe("read-write");
    expect(config.auto_commit).toBe("review");
  });

  it("ExpertiseConfig supports global scope and read-only mode", () => {
    const config: ExpertiseConfig = {
      enabled: false,
      max_lines: 100,
      structure: ["summary"],
      read_on: "session_start",
      update_on: "session_end",
      scope: "global",
      mode: "read-only",
      auto_commit: "true",
    };
    expect(config.scope).toBe("global");
    expect(config.mode).toBe("read-only");
    expect(config.auto_commit).toBe("true");
  });

  it("ExpertiseFile compiles with correct shape", () => {
    const file: ExpertiseFile = {
      last_updated: "2026-04-10T00:00:00.000Z",
      session_count: 5,
      knowledge: {
        decisions: ["Use YAML for expertise files", "Prune oldest entries first"],
        patterns: ["Always validate before writing"],
      },
    };
    expect(file.session_count).toBe(5);
    expect(file.knowledge["decisions"]).toHaveLength(2);
    expect(file.knowledge["patterns"]).toHaveLength(1);
  });

  it("ExpertiseFile can have empty knowledge", () => {
    const file: ExpertiseFile = {
      last_updated: "",
      session_count: 0,
      knowledge: {},
    };
    expect(file.session_count).toBe(0);
    expect(Object.keys(file.knowledge)).toHaveLength(0);
  });

  it("ExpertiseDiff compiles with additions and removals", () => {
    const diff: ExpertiseDiff = {
      agentId: "architect",
      projectId: "aos-harness",
      additions: {
        decisions: ["New decision added this session"],
        gotchas: ["Watch out for YAML multiline strings"],
      },
      removals: {
        patterns: ["Old stale pattern"],
      },
    };
    expect(diff.agentId).toBe("architect");
    expect(diff.projectId).toBe("aos-harness");
    expect(diff.additions["decisions"]).toHaveLength(1);
    expect(diff.removals["patterns"]).toHaveLength(1);
  });

  it("ExpertiseDiff can have empty additions and removals", () => {
    const diff: ExpertiseDiff = {
      agentId: "sentinel",
      projectId: "test-project",
      additions: {},
      removals: {},
    };
    expect(Object.keys(diff.additions)).toHaveLength(0);
    expect(Object.keys(diff.removals)).toHaveLength(0);
  });

  it("AgentConfig accepts optional expertiseConfig", () => {
    const config: AgentConfig = {
      schema: "aos/agent/v1",
      id: "test",
      name: "Test",
      role: "tester",
      cognition: {
        objective_function: "test",
        time_horizon: { primary: "short", secondary: "medium", peripheral: "long" },
        core_bias: "none",
        risk_tolerance: "moderate" as const,
        default_stance: "neutral",
      },
      persona: {
        temperament: [],
        thinking_patterns: [],
        heuristics: [],
        evidence_standard: { convinced_by: [], not_convinced_by: [] },
        red_lines: [],
      },
      tensions: [],
      report: { structure: "freeform" },
      tools: null,
      skills: [],
      expertise: [],
      model: { tier: "standard" as const, thinking: "on" as const },
      expertiseConfig: {
        enabled: true,
        max_lines: 150,
        structure: ["decisions"],
        read_on: "session_start",
        update_on: "session_end",
        scope: "per-project",
        mode: "read-write",
        auto_commit: "review",
      },
    };
    expect(config.expertiseConfig?.enabled).toBe(true);
    expect(config.expertiseConfig?.max_lines).toBe(150);
  });

  it("PersistenceAdapter type is structurally correct", () => {
    // Type check: verify PersistenceAdapter shape by implementing it inline
    const adapter: PersistenceAdapter = {
      async persistExpertise(agentId: string, projectId: string, content: string): Promise<void> {},
      async loadExpertise(agentId: string, projectId: string): Promise<string | null> {
        return null;
      },
    };
    expect(typeof adapter.persistExpertise).toBe("function");
    expect(typeof adapter.loadExpertise).toBe("function");
  });
});

describe("Session checkpoint types", () => {
  it("AgentCheckpoint compiles", () => {
    const cp: import("../src/types").AgentCheckpoint = {
      agentId: "architect", depth: 0,
      conversationTail: [{ type: "response", timestamp: "t1", agentId: "architect", content: "test" }],
    };
    expect(cp.conversationTail).toHaveLength(1);
  });
  it("SessionCheckpoint compiles", () => {
    const cp: import("../src/types").SessionCheckpoint = {
      sessionId: "s1",
      constraintState: {
        elapsed_minutes: 5, budget_spent: 0.5, rounds_completed: 3,
        past_min_time: true, past_min_budget: true, past_min_rounds: true, past_all_minimums: true,
        approaching_max_time: false, approaching_max_budget: false, approaching_max_rounds: false,
        approaching_any_maximum: false, hit_maximum: false, hit_reason: "none",
        can_end: true, bias_ratio: 1.2, most_addressed: [], least_addressed: [],
        bias_blocked: false, metered: true,
      },
      activeAgents: [{ agentId: "a1", depth: 0, conversationTail: [] }],
      roundsCompleted: 3, pendingDelegations: [],
      transcriptReplayDepth: 50, createdAt: "2026-04-10",
    };
    expect(cp.activeAgents).toHaveLength(1);
  });
});

describe("MockAdapter execution methods", () => {
  it("executeCode records call and returns default result", async () => {
    const adapter = new MockAdapter();
    const handle = await adapter.spawnAgent(
      {
        schema: "aos/agent/v1",
        id: "dev",
        name: "Developer",
        role: "developer",
        cognition: {
          objective_function: "test",
          time_horizon: { primary: "s", secondary: "m", peripheral: "l" },
          core_bias: "none",
          risk_tolerance: "moderate",
          default_stance: "neutral",
        },
        persona: {
          temperament: [],
          thinking_patterns: [],
          heuristics: [],
          evidence_standard: { convinced_by: [], not_convinced_by: [] },
          red_lines: [],
        },
        tensions: [],
        report: { structure: "freeform" },
        tools: null,
        skills: [],
        expertise: [],
        model: { tier: "standard", thinking: "on" },
      },
      "session-1",
    );

    const result = await adapter.executeCode(handle, "console.log('hello')");
    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(adapter.calls.some((c) => c.method === "executeCode")).toBe(true);
  });

  it("invokeSkill records call and returns default result", async () => {
    const adapter = new MockAdapter();
    const handle = { id: "h1", agentId: "dev", sessionId: "s1" };
    const result = await adapter.invokeSkill(handle, "run-tests", { args: "--all" });
    expect(result.success).toBe(true);
    expect(adapter.calls.some((c) => c.method === "invokeSkill")).toBe(true);
  });

  it("createArtifact records call", async () => {
    const adapter = new MockAdapter();
    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id: "test-artifact",
      produced_by: ["dev"],
      step_id: "step1",
      format: "markdown",
      content_path: "artifacts/test.md",
      metadata: {
        produced_at: new Date().toISOString(),
        review_status: "pending",
        review_gate: null,
        word_count: 100,
        revision: 1,
      },
    };
    await adapter.createArtifact(manifest, "# Test Content");
    expect(adapter.calls.some((c) => c.method === "createArtifact")).toBe(true);
  });

  it("loadArtifact records call and returns default artifact", async () => {
    const adapter = new MockAdapter();
    const loaded = await adapter.loadArtifact("test-artifact", "/tmp/session");
    expect(loaded.manifest.id).toBe("test-artifact");
    expect(loaded.manifest.schema).toBe("aos/artifact/v1");
    expect(adapter.calls.some((c) => c.method === "loadArtifact")).toBe(true);
  });

  it("submitForReview records call and returns approved", async () => {
    const adapter = new MockAdapter();
    const reviewer = { id: "h1", agentId: "sentinel", sessionId: "s1" };
    const loaded = await adapter.loadArtifact("test", "/tmp");
    const result = await adapter.submitForReview(loaded, reviewer, "Review this artifact");
    expect(result.status).toBe("approved");
    expect(result.reviewer).toBe("sentinel");
    expect(adapter.calls.some((c) => c.method === "submitForReview")).toBe(true);
  });
});
