# Execution Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the AOS Execution Profiles spec suite — enabling the harness to support execution-oriented profiles with workflow-driven delegation, artifact passing, agent capabilities, and adapter execution methods.

**Architecture:** Three implementation layers that can be worked in parallel after the shared types (Task 1) are complete. Layer 1 modifies core schemas and runtime. Layer 2 extends the adapter contract. Layer 3 adds skill awareness manifests. A reference implementation (CTO execution profile) validates all layers.

**Tech Stack:** TypeScript (Bun runtime), YAML configs, JSON Schema validation, js-yaml

**Spec:** `docs/specs/2026-03-24-aos-execution-profiles/`

---

## File Map

### New Files
- `runtime/src/artifact-manager.ts` — Artifact lifecycle (create, load, inject)
- `core/schema/artifact.schema.json` — JSON Schema for `aos/artifact/v1`
- `core/agents/orchestrators/cto-orchestrator/agent.yaml` — CTO orchestrator agent config
- `core/agents/orchestrators/cto-orchestrator/prompt.md` — CTO orchestrator system prompt
- `core/profiles/cto-execution/profile.yaml` — CTO execution profile
- `core/workflows/cto-execution.workflow.yaml` — CTO 7-phase workflow
- `runtime/tests/artifact-manager.test.ts` — Tests for artifact manager
- `runtime/fixtures/workflows/execution-workflow/workflow.yaml` — Test fixture for execution workflows

### Modified Files
- `runtime/src/types.ts:64-86,114-155,250-265,275-327` — New types: AgentCapabilities, ArtifactManifest, PerspectiveEntry.role_override, ProfileConfig.workflow, WorkflowTranscriptEvent, extended WorkflowStep/Gate
- `runtime/src/template-resolver.ts:1-17` — Add empty-string line stripping for role_override
- `runtime/src/config-loader.ts:69-107,148-213` — Profile workflow validation, workflow agent cross-references, artifact ID validation
- `runtime/src/workflow-runner.ts:1-162` — Artifact management, new action handlers (targeted-delegation, tension-pair, orchestrator-synthesis, execute-with-tools), retry_with_feedback gates, transcript events
- `runtime/src/engine.ts:100-120` — Workflow detection in start(), artifact directory creation
- `core/schema/profile.schema.json` — Add workflow, role_override, execution-package
- `core/schema/agent.schema.json` — Add capabilities field
- `core/schema/workflow.schema.json` — New action types, step-level agents/prompt/structural_advantage, on_rejection enum
- `runtime/tests/workflow-runner.test.ts` — Tests for new action types, retry_with_feedback, artifact flow
- `runtime/tests/template-resolver.test.ts` — Tests for empty-string line stripping
- `runtime/tests/config-loader.test.ts` — Tests for new validations

---

## Parallelization Strategy

```
Task 1 (types.ts) ─── blocks everything
       │
       ├──► Parallel batch 1 (no interdependencies):
       │      Task 2 (JSON schemas)
       │      Task 3 (template-resolver)
       │      Task 5 (artifact-manager)
       │      Task 11 (agent prompts — needs Task 3 for {{role_override}})
       │
       ├──► Parallel batch 2 (depends on batch 1):
       │      Task 4 (config-loader — needs Tasks 2, 5)
       │      Task 6 (workflow-runner actions — needs Task 5)
       │      Task 12 (package exports — needs Task 5)
       │
       ├──► Sequential (depends on batch 2):
       │      Task 7 (workflow gates & transcript — needs Task 6)
       │      Task 8 (engine integration — needs Task 7)
       │      Task 13 (execution-package output renderer — needs Task 8)
       │
       └──► Final (depends on all above):
              Task 9 (CTO reference implementation — needs Tasks 2, 4)
              Task 10 (integration test — needs all)
```

**Key dependency:** Task 6 (workflow action handlers) depends on Task 5 (ArtifactManager), so they cannot run in true parallel. Within batch 1, Tasks 2, 3, and 5 are fully independent.

**MockAdapter note:** Any task that tests new adapter methods must first update `runtime/tests/mock-adapter.ts` to add the new methods. Task 1 Step 11 makes adapter methods non-optional with `UnsupportedError` defaults, and the MockAdapter must match.

---

## Task 1: Extend Core Types

**Files:**
- Modify: `runtime/src/types.ts`
- Test: `runtime/tests/types.test.ts`

This task adds all new type definitions. Everything else depends on this.

- [ ] **Step 1: Write failing test for AgentCapabilities type**

```typescript
// Add to runtime/tests/types.test.ts
import type { AgentCapabilities, ArtifactManifest, PerspectiveEntry, WorkflowStep, WorkflowGate, WorkflowTranscriptEvent } from "../src/types";

describe("AgentCapabilities", () => {
  it("accepts a valid capabilities object", () => {
    const caps: AgentCapabilities = {
      can_execute_code: false,
      can_produce_files: false,
      can_review_artifacts: true,
      available_skills: [],
      output_types: ["text", "markdown"],
    };
    expect(caps.can_review_artifacts).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/types.test.ts`
Expected: FAIL — `AgentCapabilities` not exported from types.ts

- [ ] **Step 3: Add AgentCapabilities type to types.ts**

Add after the `ExpertiseEntry` interface (around line 62):

```typescript
export interface AgentCapabilities {
  can_execute_code: boolean;
  can_produce_files: boolean;
  can_review_artifacts: boolean;
  available_skills: string[];
  output_types: ("text" | "markdown" | "code" | "diagram" | "structured-data")[];
}
```

- [ ] **Step 4: Add capabilities to AgentConfig**

Add optional field to `AgentConfig` (around line 78):

```typescript
  capabilities?: AgentCapabilities;
```

- [ ] **Step 5: Add role_override to AssemblyMember**

Rename `AssemblyMember` to `PerspectiveEntry` (or add alias) and add `role_override`:

```typescript
export interface PerspectiveEntry {
  agent: string;
  required: boolean;
  structural_advantage?: "speaks-last" | null;
  role_override?: string | null;
}
```

Update `ProfileConfig.assembly.perspectives` to use `PerspectiveEntry`.

- [ ] **Step 6: Add workflow field to ProfileConfig**

Add after existing fields in `ProfileConfig` (around line 155):

```typescript
  workflow?: string | null;
```

- [ ] **Step 7: Add ArtifactManifest type**

```typescript
export interface ArtifactManifest {
  schema: "aos/artifact/v1";
  id: string;
  produced_by: string[];
  step_id: string;
  format: "markdown" | "code" | "structured-data" | "diagram";
  content_path: string;
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
```

- [ ] **Step 8: Extend existing WorkflowStep and WorkflowGate types in workflow-runner.ts**

Do NOT create separate types. Add optional fields to the existing interfaces in `runtime/src/workflow-runner.ts` (lines 11-29). This preserves backward compatibility — existing workflows that don't use the new fields continue to work:

```typescript
// In workflow-runner.ts — modify existing interfaces
export interface WorkflowStep {
  id: string;
  action: string;
  description?: string;                           // Make optional (was required)
  input?: string[];                                // Make optional (was required, default [])
  output?: string;                                 // Make optional (was required)
  review_gate?: boolean;                           // Make optional (was required, default false)
  // New execution profile fields:
  name?: string;
  agents?: string[];
  prompt?: string;
  structural_advantage?: "speaks-last" | null;
}

export interface WorkflowGate {
  after: string;
  type: "user-approval" | "automated-review";
  prompt: string;
  max_iterations?: number;
  on_rejection?: "re-run-step" | "retry_with_feedback";  // Extend enum
}
```

Also update the `WorkflowRunner` constructor to accept an optional `sessionDir` for artifact management:

```typescript
export class WorkflowRunner {
  private config: WorkflowConfig;
  private adapter: AOSAdapter;
  private sessionDir?: string;
  private artifactManager?: ArtifactManager;
  // ... existing fields ...

  constructor(config: WorkflowConfig, adapter: AOSAdapter, opts?: { sessionDir?: string }) {
    this.config = config;
    this.adapter = adapter;
    if (opts?.sessionDir) {
      this.sessionDir = opts.sessionDir;
      this.artifactManager = new ArtifactManager(adapter, opts.sessionDir);
    }
  }
}
```

This preserves backward compatibility — all existing tests use `new WorkflowRunner(config, adapter)` without opts, and that continues to work.

- [ ] **Step 9: Add workflow transcript event types**

Add to the `TranscriptEventType` union (around line 265):

```typescript
  | "workflow_start"
  | "step_start"
  | "step_end"
  | "gate_prompt"
  | "gate_result"
  | "artifact_write"
  | "workflow_end"
  | "code_execution"
  | "skill_invocation"
  | "review_submission"
```

- [ ] **Step 10: Add execution adapter method types**

```typescript
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
  suggested_fix?: string;
}
```

- [ ] **Step 11: Add execution methods to WorkflowAdapter**

Extend the `WorkflowAdapter` interface (around line 320). Methods are **non-optional** — adapters that don't support them throw `UnsupportedError`, matching the existing pattern for `steerMessage()` and `openInEditor()`:

```typescript
  executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult>;
  invokeSkill(handle: AgentHandle, skillId: string, input: SkillInput): Promise<SkillResult>;
  createArtifact(artifact: ArtifactManifest, content: string): Promise<void>;
  loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact>;
  submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult>;
```

Also add the `UnsupportedError` class if not already present:

```typescript
export class UnsupportedError extends Error {
  constructor(method: string, message?: string) {
    super(message || `Method "${method}" is not supported by this adapter.`);
    this.name = "UnsupportedError";
  }
}
```

- [ ] **Step 11b: Update MockAdapter with new methods**

In `runtime/tests/mock-adapter.ts`, add implementations for all 5 new methods. Default implementations should record the call and return sensible defaults:

```typescript
  async executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
    this.calls.push({ method: "executeCode", args: [handle, code, opts], timestamp: Date.now() });
    return { success: true, exit_code: 0, stdout: "", stderr: "", duration_ms: 0 };
  }
  async invokeSkill(handle: AgentHandle, skillId: string, input: SkillInput): Promise<SkillResult> {
    this.calls.push({ method: "invokeSkill", args: [handle, skillId, input], timestamp: Date.now() });
    return { success: true, output: "" };
  }
  async createArtifact(artifact: ArtifactManifest, content: string): Promise<void> {
    this.calls.push({ method: "createArtifact", args: [artifact, content], timestamp: Date.now() });
  }
  async loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact> {
    this.calls.push({ method: "loadArtifact", args: [artifactId, sessionDir], timestamp: Date.now() });
    throw new UnsupportedError("loadArtifact", "MockAdapter: override loadArtifact in your test");
  }
  async submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult> {
    this.calls.push({ method: "submitForReview", args: [artifact, reviewer, reviewPrompt], timestamp: Date.now() });
    return { status: "approved", reviewer: reviewer.agentId };
  }
```

- [ ] **Step 12: Run all tests to verify nothing breaks**

Run: `cd runtime && bun test`
Expected: All existing tests PASS. New type test PASSES.

- [ ] **Step 13: Commit**

```bash
git add runtime/src/types.ts runtime/tests/types.test.ts
git commit -m "feat: add execution profile types — capabilities, artifacts, workflow extensions, adapter methods"
```

---

## Task 2: Update JSON Schemas

**Files:**
- Modify: `core/schema/agent.schema.json`
- Modify: `core/schema/profile.schema.json`
- Modify: `core/schema/workflow.schema.json`
- Create: `core/schema/artifact.schema.json`
- Test: `runtime/tests/config-loader.test.ts`

- [ ] **Step 1: Write failing test for capabilities in agent schema**

```typescript
// Add to config-loader.test.ts
it("loads agent with capabilities field", () => {
  // Create a fixture agent with capabilities
  const config = loadAgent(join(fixturesDir, "agents", "capable-agent"));
  expect(config.capabilities).toBeDefined();
  expect(config.capabilities?.can_execute_code).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/config-loader.test.ts`
Expected: FAIL — fixture doesn't exist yet

- [ ] **Step 3: Create capable-agent fixture**

Create `runtime/fixtures/agents/capable-agent/agent.yaml`:

```yaml
schema: aos/agent/v1
id: capable-agent
name: Capable Agent
role: "Test agent with execution capabilities"
cognition:
  objective_function: "Test execution"
  time_horizon:
    primary: "Immediate"
    secondary: "Short-term"
    peripheral: "N/A"
  core_bias: execution-reality
  risk_tolerance: moderate
  default_stance: "Execute tasks efficiently"
persona:
  temperament: [focused]
  thinking_patterns: ["Can I execute this?"]
  heuristics:
    - name: Simplicity
      rule: "Do the simplest thing that works"
  evidence_standard:
    convinced_by: [working code]
    not_convinced_by: [vague plans]
  red_lines: []
tensions: []
report:
  structure: "Structured result with status"
tools: null
skills: []
expertise: []
model:
  tier: standard
  thinking: off
capabilities:
  can_execute_code: true
  can_produce_files: true
  can_review_artifacts: true
  available_skills: [run-tests, code-review]
  output_types: [text, markdown, code]
```

- [ ] **Step 4: Add capabilities to agent.schema.json**

Add `capabilities` property to the agent schema's `properties` object. Keep `additionalProperties` handling permissive (the current schema may not have it set to false — check and match existing pattern).

```json
"capabilities": {
  "type": "object",
  "properties": {
    "can_execute_code": { "type": "boolean", "default": false },
    "can_produce_files": { "type": "boolean", "default": false },
    "can_review_artifacts": { "type": "boolean", "default": true },
    "available_skills": {
      "type": "array",
      "items": { "type": "string" },
      "default": []
    },
    "output_types": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["text", "markdown", "code", "diagram", "structured-data"]
      },
      "default": ["text", "markdown"]
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 5: Update profile.schema.json**

Add three changes:
1. `workflow` property at root: `{ "type": ["string", "null"], "default": null }`
2. `role_override` in `assembly.perspectives` items: `{ "type": ["string", "null"], "default": null }`
3. `execution-package` added to `output.format` enum

Remove `additionalProperties: false` from perspective items or add `role_override` to allowed properties.

- [ ] **Step 6: Update workflow.schema.json**

1. Add optional fields to step items: `agents`, `prompt`, `structural_advantage`, `name`
2. Change step `additionalProperties` from `false` to allow new fields
3. Change `on_rejection` from `{ "const": "re-run-step" }` to `{ "enum": ["re-run-step", "retry_with_feedback"] }`
4. Change step required fields — `description`, `input`, `output`, `review_gate` should become optional for new action types (or remove from required and handle in config-loader validation)

- [ ] **Step 7: Create artifact.schema.json**

Create `core/schema/artifact.schema.json` with the full schema from spec 01-schema-additions.md Section 4.1.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd runtime && bun test tests/config-loader.test.ts`
Expected: PASS — capable-agent loads with capabilities

- [ ] **Step 9: Commit**

```bash
git add core/schema/ runtime/fixtures/agents/capable-agent/ runtime/tests/config-loader.test.ts
git commit -m "feat: update JSON schemas for execution profiles — capabilities, artifacts, workflow extensions"
```

---

## Task 3: Extend Template Resolver

**Files:**
- Modify: `runtime/src/template-resolver.ts`
- Test: `runtime/tests/template-resolver.test.ts`

- [ ] **Step 1: Write failing tests for role_override resolution**

```typescript
// Add to template-resolver.test.ts
describe("role_override resolution", () => {
  it("resolves role_override to the provided value", () => {
    const result = resolveTemplate(
      "Base persona.\n\n{{role_override}}\n\nMore content.",
      { role_override: "Produce architecture decision records" }
    );
    expect(result).toContain("Produce architecture decision records");
    expect(result).toContain("Base persona.");
    expect(result).toContain("More content.");
  });

  it("strips line when role_override resolves to empty string", () => {
    const result = resolveTemplate(
      "Base persona.\n\n{{role_override}}\n\nMore content.",
      { role_override: "" }
    );
    expect(result).toBe("Base persona.\n\nMore content.");
  });

  it("strips line when role_override is not in variables", () => {
    const result = resolveTemplate(
      "Base persona.\n\n{{role_override}}\n\nMore content.",
      {}
    );
    // role_override is a known optional variable — should strip, not leave as-is
    expect(result).toBe("Base persona.\n\nMore content.");
  });

  it("keeps line when role_override is alongside other content", () => {
    const result = resolveTemplate(
      "Override: {{role_override}} here",
      { role_override: "" }
    );
    expect(result).toBe("Override:  here");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/template-resolver.test.ts`
Expected: FAIL — empty role_override not stripped

- [ ] **Step 3: Implement empty-string line stripping**

Replace `runtime/src/template-resolver.ts`:

```typescript
/**
 * Template Resolver — replaces {{VARIABLE}} placeholders with runtime values.
 * Unknown variables are left as-is (not removed, not errored).
 * Supports hyphenated variable names (e.g., {{profile-name}}).
 *
 * Special handling for optional variables (role_override):
 * - If the variable resolves to empty string AND the line contains only
 *   the variable placeholder (plus whitespace), the entire line is stripped.
 * - This prevents blank lines in prompts when optional variables are not set.
 *
 * See spec Section 6.13 for the full variable reference.
 */

const OPTIONAL_VARIABLES = new Set(["role_override"]);
const OPTIONAL_LINE_PATTERN = /^\s*\{\{([\w-]+)\}\}\s*$/;

export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  if (!template) return template;

  // Process line-by-line to handle optional variable line stripping
  const lines = template.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(OPTIONAL_LINE_PATTERN);
    if (match) {
      const key = match[1];
      if (OPTIONAL_VARIABLES.has(key)) {
        const value = key in variables ? variables[key] : "";
        if (value === "") {
          // Strip the entire line — optional variable resolved to empty
          continue;
        }
        // Non-empty value — replace and keep the line
        result.push(value);
        continue;
      }
    }

    // Standard variable replacement for all other lines
    const resolved = line.replace(/\{\{([\w-]+)\}\}/g, (m, key: string) => {
      if (OPTIONAL_VARIABLES.has(key)) {
        return key in variables ? variables[key] : "";
      }
      return key in variables ? variables[key] : m;
    });
    result.push(resolved);
  }

  return result.join("\n");
}
```

The key insight: detect lines that contain ONLY an optional variable placeholder BEFORE resolution, and strip those lines entirely when the value is empty. Lines where the optional variable appears alongside other content get inline replacement (empty string) but the line is kept.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/template-resolver.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd runtime && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add runtime/src/template-resolver.ts runtime/tests/template-resolver.test.ts
git commit -m "feat: add role_override template variable with empty-string line stripping"
```

---

## Task 4: Extend Config Loader Validations

**Files:**
- Modify: `runtime/src/config-loader.ts`
- Test: `runtime/tests/config-loader.test.ts`

- [ ] **Step 1: Write failing tests for new validations**

```typescript
// Add to config-loader.test.ts

describe("execution profile validations", () => {
  it("validates profile workflow reference exists", () => {
    // Test with a profile that references a nonexistent workflow
    expect(() => {
      // loadProfile should warn/validate when workflow field is set
    }).not.toThrow(); // Profile loading itself shouldn't throw; workflow validation is separate
  });

  it("validates workflow step agents against profile assembly", () => {
    // When loading a workflow + profile pair, agents in steps must be in assembly
  });

  it("validates tension-pair steps have exactly 2 agents", () => {
    // tension-pair action with 1 or 3 agents should fail
  });

  it("validates artifact ID uniqueness across workflow steps", () => {
    // Two steps with the same output ID should fail
  });

  it("validates input references exist as prior step outputs", () => {
    // input referencing an output that doesn't exist should fail
  });

  it("accepts retry_with_feedback on_rejection value", () => {
    const config = loadWorkflow(join(fixturesDir, "workflows", "execution-workflow"));
    const gate = config.gates.find(g => g.on_rejection === "retry_with_feedback");
    expect(gate).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/config-loader.test.ts`
Expected: FAIL — fixture missing, validations not implemented

- [ ] **Step 3: Create execution-workflow fixture**

Create `runtime/fixtures/workflows/execution-workflow/workflow.yaml`:

```yaml
schema: aos/workflow/v1
id: execution-workflow
name: Test Execution Workflow
description: "Fixture for testing execution profile workflow features"

steps:
  - id: requirements
    name: Requirements Analysis
    action: targeted-delegation
    agents: [advocate, strategist]
    prompt: "Analyze requirements"
    input: []
    output: requirements_analysis
    review_gate: true

  - id: design
    name: Architecture Design
    action: targeted-delegation
    agents: [architect]
    prompt: "Design the architecture"
    input: [requirements_analysis]
    output: architecture_decision
    review_gate: true

  - id: review
    name: Architecture Review
    action: tension-pair
    agents: [architect, operator]
    prompt: "Review architecture for buildability"
    input: [architecture_decision]
    output: revised_architecture
    review_gate: false

  - id: synthesize
    name: Final Assembly
    action: orchestrator-synthesis
    prompt: "Assemble the execution package"
    input: [requirements_analysis, revised_architecture]
    output: execution_package
    review_gate: false

gates:
  - after: requirements
    type: user-approval
    prompt: "Do these requirements look right?"
    on_rejection: retry_with_feedback

  - after: design
    type: user-approval
    prompt: "Does this architecture look right?"
    on_rejection: retry_with_feedback
```

- [ ] **Step 4: Update loadWorkflow to handle new optional fields**

In `config-loader.ts`, update `loadWorkflow()` to:
1. Accept optional `agents`, `prompt`, `name`, `structural_advantage` on steps
2. Accept `retry_with_feedback` as `on_rejection` value
3. Make `description`, `input`, `output` optional on steps (for orchestrator-synthesis which may omit agents)
4. Validate tension-pair has exactly 2 agents
5. Validate artifact ID uniqueness (output values)
6. **Dual input resolution:** Update the input validation (currently at lines 198-207 which validates against `stepIds`). The new logic: build an `outputIds` set from step `output` values. For each `input` reference, first check `outputIds`; if not found, fall back to checking if a step with that ID exists and use its `output` value. Log a deprecation warning when the fallback is used. This preserves backward compatibility with existing workflows (like `test-workflow`) that reference step IDs.
7. Validate that gate `after` references a step with `review_gate: true`

- [ ] **Step 5: Update loadProfile to handle workflow field**

In `config-loader.ts`, update `loadProfile()` to:
1. Parse the `workflow` field (optional string)
2. Parse `role_override` on perspective entries

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd runtime && bun test tests/config-loader.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add runtime/src/config-loader.ts runtime/tests/config-loader.test.ts runtime/fixtures/workflows/execution-workflow/
git commit -m "feat: extend config loader for execution profiles — workflow validation, artifact references, new action types"
```

---

## Task 5: Implement Artifact Manager

**Files:**
- Create: `runtime/src/artifact-manager.ts`
- Create: `runtime/tests/artifact-manager.test.ts`

- [ ] **Step 1: Write failing tests for artifact lifecycle**

```typescript
// runtime/tests/artifact-manager.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { ArtifactManager } from "../src/artifact-manager";
import { MockAdapter } from "./mock-adapter";
import type { ArtifactManifest } from "../src/types";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("ArtifactManager", () => {
  let sessionDir: string;
  let adapter: MockAdapter;
  let manager: ArtifactManager;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "aos-test-"));
    adapter = new MockAdapter();
    manager = new ArtifactManager(adapter, sessionDir);
  });

  it("creates an artifact with manifest and content", async () => {
    await manager.createArtifact(
      "requirements_analysis",
      "# Requirements\n\nUser stories here.",
      {
        produced_by: ["advocate", "strategist"],
        step_id: "understand",
        format: "markdown",
      }
    );

    const loaded = await manager.loadArtifact("requirements_analysis");
    expect(loaded.manifest.id).toBe("requirements_analysis");
    expect(loaded.manifest.produced_by).toEqual(["advocate", "strategist"]);
    expect(loaded.manifest.metadata.review_status).toBe("pending");
    expect(loaded.manifest.metadata.revision).toBe(1);
    expect(loaded.content).toContain("User stories here.");
  });

  it("loads artifact content for injection", async () => {
    await manager.createArtifact(
      "architecture",
      "# Architecture\n\nMicroservices.",
      {
        produced_by: ["architect"],
        step_id: "design",
        format: "markdown",
      }
    );

    const injectionBlock = await manager.formatForInjection("architecture");
    expect(injectionBlock).toContain("## Artifact: architecture");
    expect(injectionBlock).toContain("Produced by: architect");
    expect(injectionBlock).toContain("Microservices.");
  });

  it("updates review status", async () => {
    await manager.createArtifact("test_artifact", "content", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });

    await manager.updateReviewStatus("test_artifact", "approved", "step");

    const loaded = await manager.loadArtifact("test_artifact");
    expect(loaded.manifest.metadata.review_status).toBe("approved");
    expect(loaded.manifest.metadata.review_gate).toBe("step");
  });

  it("increments revision on re-creation", async () => {
    await manager.createArtifact("test_artifact", "v1", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });

    await manager.reviseArtifact("test_artifact", "v2");

    const loaded = await manager.loadArtifact("test_artifact");
    expect(loaded.content).toBe("v2");
    expect(loaded.manifest.metadata.revision).toBe(2);
    expect(loaded.manifest.metadata.review_status).toBe("pending");
  });

  it("throws on loading nonexistent artifact", async () => {
    expect(manager.loadArtifact("nonexistent")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/artifact-manager.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement ArtifactManager**

Create `runtime/src/artifact-manager.ts`. **Important:** Use `adapter.writeFile()`/`adapter.readFile()` instead of raw `fs` calls. This preserves the adapter abstraction so platform-specific adapters can hook into artifact I/O for indexing, UI notification, etc. The `mkdirSync` for the artifacts directory is acceptable since it's one-time setup.

```typescript
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import * as yaml from "js-yaml";
import type { ArtifactManifest, LoadedArtifact, AOSAdapter } from "./types";

export class ArtifactManager {
  private adapter: AOSAdapter;
  private sessionDir: string;
  private artifactsDir: string;
  private manifests: Map<string, ArtifactManifest> = new Map();

  constructor(adapter: AOSAdapter, sessionDir: string) {
    this.adapter = adapter;
    this.sessionDir = sessionDir;
    this.artifactsDir = join(sessionDir, "artifacts");
    if (!existsSync(this.artifactsDir)) {
      mkdirSync(this.artifactsDir, { recursive: true });
    }
  }

  async createArtifact(
    id: string,
    content: string,
    opts: {
      produced_by: string[];
      step_id: string;
      format: ArtifactManifest["format"];
    },
  ): Promise<ArtifactManifest> {
    const contentPath = join(this.artifactsDir, `${id}.md`);
    const manifestPath = join(this.artifactsDir, `${id}.artifact.yaml`);

    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id,
      produced_by: opts.produced_by,
      step_id: opts.step_id,
      format: opts.format,
      content_path: contentPath,
      metadata: {
        produced_at: new Date().toISOString(),
        review_status: "pending",
        review_gate: null,
        word_count: content.split(/\s+/).filter(Boolean).length,
        revision: 1,
      },
    };

    await this.adapter.writeFile(contentPath, content);
    await this.adapter.writeFile(manifestPath, yaml.dump(manifest));
    this.manifests.set(id, manifest);

    return manifest;
  }

  async loadArtifact(id: string): Promise<LoadedArtifact> {
    let manifest = this.manifests.get(id);
    if (!manifest) {
      const manifestPath = join(this.artifactsDir, `${id}.artifact.yaml`);
      const manifestYaml = await this.adapter.readFile(manifestPath);
      manifest = yaml.load(manifestYaml) as ArtifactManifest;
      this.manifests.set(id, manifest);
    }

    const content = await this.adapter.readFile(manifest.content_path);
    return { manifest, content };
  }

  async formatForInjection(id: string): Promise<string> {
    const { manifest, content } = await this.loadArtifact(id);
    return [
      "---",
      `## Artifact: ${manifest.id}`,
      `Produced by: ${manifest.produced_by.join(", ")}`,
      `Step: ${manifest.step_id}`,
      `Review status: ${manifest.metadata.review_status}`,
      `Revision: ${manifest.metadata.revision}`,
      "---",
      "",
      content,
    ].join("\n");
  }

  async updateReviewStatus(
    id: string,
    status: ArtifactManifest["metadata"]["review_status"],
    gateId?: string,
  ): Promise<void> {
    const manifest = this.manifests.get(id);
    if (!manifest) throw new Error(`Artifact "${id}" not loaded.`);

    manifest.metadata.review_status = status;
    if (gateId) manifest.metadata.review_gate = gateId;

    const manifestPath = join(this.artifactsDir, `${id}.artifact.yaml`);
    await this.adapter.writeFile(manifestPath, yaml.dump(manifest));
  }

  async reviseArtifact(id: string, newContent: string): Promise<void> {
    const manifest = this.manifests.get(id);
    if (!manifest) throw new Error(`Artifact "${id}" not loaded.`);

    manifest.metadata.revision += 1;
    manifest.metadata.review_status = "pending";
    manifest.metadata.word_count = newContent.split(/\s+/).filter(Boolean).length;

    await this.adapter.writeFile(manifest.content_path, newContent);
    const manifestPath = join(this.artifactsDir, `${id}.artifact.yaml`);
    await this.adapter.writeFile(manifestPath, yaml.dump(manifest));
  }

  getManifest(id: string): ArtifactManifest | undefined {
    return this.manifests.get(id);
  }

  getAllManifests(): Map<string, ArtifactManifest> {
    return new Map(this.manifests);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/artifact-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/artifact-manager.ts runtime/tests/artifact-manager.test.ts
git commit -m "feat: implement ArtifactManager — create, load, revise, inject artifacts"
```

---

## Task 6: Extend Workflow Runner — Action Handlers

**Files:**
- Modify: `runtime/src/workflow-runner.ts`
- Test: `runtime/tests/workflow-runner.test.ts`

**Depends on:** Tasks 1, 5

- [ ] **Step 1: Write failing tests for new action types**

```typescript
// Add to workflow-runner.test.ts
describe("execution workflow actions", () => {
  it("handles targeted-delegation action", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design the system",
        input: [],
        output: "architecture",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");
  });

  it("handles tension-pair action with exactly 2 agents", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "tension-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "tension-pair",
        agents: ["architect", "operator"],
        prompt: "Challenge the design",
        input: [],
        output: "reviewed",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");
  });

  it("handles orchestrator-synthesis action (no agents)", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "synth-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data-a", review_gate: false },
        {
          id: "step-b",
          action: "orchestrator-synthesis",
          prompt: "Assemble everything",
          input: ["data-a"],
          output: "final",
          review_gate: false,
        },
      ],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toEqual(["step-a", "step-b"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/workflow-runner.test.ts`
Expected: FAIL — new action types not handled

- [ ] **Step 3: Implement action handlers in workflow-runner.ts**

Refactor `executeStep()` to dispatch based on action type. Add handler methods for `targeted-delegation`, `tension-pair`, `orchestrator-synthesis`, and `execute-with-tools`. The handlers interact with the adapter and artifact manager.

Key implementation points:
- Import `ArtifactManager` and create it in the constructor
- `targeted-delegation`: resolve agents from step, call adapter.sendMessage for each (or dispatchParallel)
- `tension-pair`: same as targeted but with exactly 2 agents
- `orchestrator-synthesis`: no delegation, collect all input artifacts and format as orchestrator output
- `execute-with-tools`: call adapter.executeCode or adapter.invokeSkill (with UnsupportedError handling)
- After each step: create artifact from output

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/workflow-runner.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/workflow-runner.ts runtime/tests/workflow-runner.test.ts
git commit -m "feat: add execution workflow action handlers — targeted-delegation, tension-pair, orchestrator-synthesis"
```

---

## Task 7: Extend Workflow Runner — Gates & Transcript Events

**Files:**
- Modify: `runtime/src/workflow-runner.ts`
- Test: `runtime/tests/workflow-runner.test.ts`

**Depends on:** Task 6

- [ ] **Step 1: Write failing tests for retry_with_feedback**

```typescript
describe("retry_with_feedback gate", () => {
  it("re-runs step with user feedback on rejection", async () => {
    const adapter = new MockAdapter();
    let confirmCount = 0;
    adapter.promptConfirm = async () => {
      confirmCount++;
      return confirmCount > 1; // Reject first, approve second
    };
    adapter.promptInput = async () => "Please add error handling";

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "feedback-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design it",
        input: [],
        output: "design",
        review_gate: true,
      }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "retry_with_feedback",
      }],
    };

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    expect(confirmCount).toBe(2); // Called twice: reject then approve
  });

  it("stops retrying after max iterations", async () => {
    const adapter = new MockAdapter();
    adapter.promptConfirm = async () => false; // Always reject
    adapter.promptInput = async () => "feedback";

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "max-retry-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "gather",
        input: [],
        output: "data",
        review_gate: true,
      }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "retry_with_feedback",
        max_iterations: 3,
      }],
    };

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    // Should complete without infinite loop — max 3 retries then proceed
    expect(runner.getCompletedSteps()).toContain("step-a");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/workflow-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement retry_with_feedback gate handler**

In the gate execution logic:
1. On rejection, call `adapter.promptInput("What needs to change?")`
2. Augment the step prompt with the feedback
3. Re-execute the step
4. Track iteration count, max 3 (or `gate.max_iterations`)
5. After max retries, proceed with current output

- [ ] **Step 4: Add transcript event emission**

Add transcript event emission throughout the workflow runner:
- `workflow_start` at the beginning of `execute()`
- `step_start` / `step_end` around each step
- `gate_prompt` / `gate_result` around each gate
- `artifact_write` after each artifact creation
- `workflow_end` at the end of `execute()`

Store events via a callback or transcript array passed to the constructor.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd runtime && bun test tests/workflow-runner.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd runtime && bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add runtime/src/workflow-runner.ts runtime/tests/workflow-runner.test.ts
git commit -m "feat: add retry_with_feedback gates and workflow transcript events"
```

---

## Task 8: Integrate Workflow Mode into Engine

**Files:**
- Modify: `runtime/src/engine.ts`
- Test: `runtime/tests/engine.test.ts`

**Depends on:** Tasks 6, 7

- [ ] **Step 1: Write failing test for workflow detection**

```typescript
// Add to engine.test.ts
describe("workflow integration", () => {
  it("detects workflow field on profile and enters workflow mode", () => {
    // Create a profile with workflow: "test-workflow"
    // Verify engine creates WorkflowRunner
  });

  it("creates artifacts directory when workflow is present", () => {
    // Verify {{deliberation_dir}}/artifacts/ exists after start()
  });

  it("uses deliberation mode when workflow is null", () => {
    // Standard strategic-council profile — verify existing behavior unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement workflow detection in engine.ts**

In `start()` method (around line 100):
1. After loading the profile, check `this.profile.workflow`
2. If set: load the workflow config, instantiate `WorkflowRunner`, create `artifacts/` directory
3. If null: continue with existing deliberation flow
4. The workflow runner drives the session instead of the orchestrator's free-form delegation

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd runtime && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add runtime/src/engine.ts runtime/tests/engine.test.ts
git commit -m "feat: integrate workflow mode into engine — workflow detection, artifact directory creation"
```

---

## Task 9: Create CTO Execution Reference Implementation

**Files:**
- Create: `core/agents/orchestrators/cto-orchestrator/agent.yaml`
- Create: `core/agents/orchestrators/cto-orchestrator/prompt.md`
- Create: `core/profiles/cto-execution/profile.yaml`
- Create: `core/workflows/cto-execution.workflow.yaml`

**Depends on:** Tasks 2, 4 (schemas and config-loader must accept new fields)

- [ ] **Step 1: Create CTO orchestrator agent.yaml**

Copy the agent config from spec `00-overview.md` Section 6.1 into `core/agents/orchestrators/cto-orchestrator/agent.yaml`.

- [ ] **Step 2: Create CTO orchestrator prompt.md**

Copy the system prompt from spec `00-overview.md` Section 6.2 into `core/agents/orchestrators/cto-orchestrator/prompt.md`.

Add `{{role_override}}` placeholder after the team description section.

- [ ] **Step 3: Create CTO execution workflow**

Copy the workflow from spec `00-overview.md` Section 5.1 into `core/workflows/cto-execution.workflow.yaml`.

- [ ] **Step 4: Create CTO execution profile**

Copy the profile from spec `00-overview.md` Section 4.1 into `core/profiles/cto-execution/profile.yaml`.

- [ ] **Step 5: Validate all configs**

Run: `cd cli && bun run dev validate`
Expected: All configs valid (or use direct config-loader calls if CLI validate isn't wired yet)

Alternatively:
```bash
cd runtime && bun -e "
import { loadAgent, loadProfile, loadWorkflow } from './src/config-loader';
loadAgent('../core/agents/orchestrators/cto-orchestrator');
loadProfile('../core/profiles/cto-execution');
console.log('All configs valid');
"
```

- [ ] **Step 6: Commit**

```bash
git add core/agents/orchestrators/cto-orchestrator/ core/profiles/cto-execution/ core/workflows/cto-execution.workflow.yaml
git commit -m "feat: add CTO execution profile — orchestrator, 7-phase workflow, profile config"
```

---

## Task 10: Integration Test

**Files:**
- Create: `runtime/tests/execution-profile.integration.test.ts`

**Depends on:** All previous tasks

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { loadProfile, loadWorkflow, loadAgent } from "../src/config-loader";

const coreDir = join(import.meta.dir, "..", "..", "core");

describe("CTO Execution Profile Integration", () => {
  it("loads the CTO execution profile", () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    expect(profile.id).toBe("cto-execution");
    expect(profile.workflow).toBe("cto-execution-workflow");
    expect(profile.output.format).toBe("execution-package");
  });

  it("loads the CTO orchestrator agent", () => {
    const agent = loadAgent(join(coreDir, "agents", "orchestrators", "cto-orchestrator"));
    expect(agent.id).toBe("cto-orchestrator");
    expect(agent.cognition.core_bias).toBe("execution-quality");
  });

  it("loads the CTO execution workflow", () => {
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml").replace(".workflow.yaml", ""));
    // Adjust path resolution based on how loadWorkflow works
    expect(workflow.id).toBe("cto-execution-workflow");
    expect(workflow.steps.length).toBe(8);
  });

  it("all workflow step agents exist in profile assembly", () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const workflow = loadWorkflow(/* cto-execution-workflow path */);

    const assemblyAgents = profile.assembly.perspectives.map(p => p.agent);

    for (const step of workflow.steps) {
      if (step.agents) {
        for (const agentId of step.agents) {
          expect(assemblyAgents).toContain(agentId);
        }
      }
    }
  });

  it("all workflow input references are valid output IDs", () => {
    const workflow = loadWorkflow(/* cto-execution-workflow path */);
    const outputs = new Set<string>();

    for (const step of workflow.steps) {
      if (step.input) {
        for (const ref of step.input) {
          expect(outputs.has(ref)).toBe(true);
        }
      }
      if (step.output) outputs.add(step.output);
    }
  });

  it("existing strategic-council profile still loads correctly", () => {
    const profile = loadProfile(join(coreDir, "profiles", "strategic-council"));
    expect(profile.id).toBe("strategic-council");
    expect(profile.workflow).toBeUndefined(); // or null — deliberation mode
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd runtime && bun test tests/execution-profile.integration.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite one final time**

Run: `cd runtime && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add runtime/tests/execution-profile.integration.test.ts
git commit -m "test: add CTO execution profile integration tests"
```

---

## Task 11: Update Agent Prompt Files with `{{role_override}}`

**Files:**
- Modify: All 12 agent `prompt.md` files in `core/agents/`

- [ ] **Step 1: Add `{{role_override}}` to each agent's prompt.md**

For each agent prompt file, add the `{{role_override}}` placeholder after the base persona block. The placement should be:

```markdown
# {{agent_name}} — System Prompt

[existing base persona description]

{{role_override}}

[rest of existing prompt]
```

Files to modify:
- `core/agents/orchestrators/arbiter/prompt.md`
- `core/agents/perspectives/catalyst/prompt.md`
- `core/agents/perspectives/sentinel/prompt.md`
- `core/agents/perspectives/architect/prompt.md`
- `core/agents/perspectives/provocateur/prompt.md`
- `core/agents/perspectives/navigator/prompt.md`
- `core/agents/perspectives/advocate/prompt.md`
- `core/agents/perspectives/pathfinder/prompt.md`
- `core/agents/perspectives/strategist/prompt.md`
- `core/agents/operational/operator/prompt.md`
- `core/agents/operational/steward/prompt.md`
- `core/agents/operational/auditor/prompt.md`

- [ ] **Step 2: Verify template resolution works**

Run a quick check that the template resolver handles these files correctly with and without role_override set.

- [ ] **Step 3: Commit**

```bash
git add core/agents/
git commit -m "feat: add role_override template variable to all agent prompts"
```

---

## Task 12: Export New Modules from Runtime Package

**Files:**
- Modify: `runtime/package.json`

- [ ] **Step 1: Add artifact-manager to package exports**

Add `"./artifact-manager": "./src/artifact-manager.ts"` to the `exports` field in `runtime/package.json`.

- [ ] **Step 2: Verify import works**

```bash
cd runtime && bun -e "import { ArtifactManager } from './src/artifact-manager'; console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add runtime/package.json
git commit -m "feat: export artifact-manager from runtime package"
```

---

## Task 13: Execution Package Output Renderer

**Files:**
- Create: `runtime/src/output-renderer.ts`
- Create: `runtime/tests/output-renderer.test.ts`

**Depends on:** Tasks 5, 8

This task wires up the `execution-package` output format — assembling the final document from collected artifacts with the correct frontmatter. Without this, execution profiles produce artifacts but never assemble them into the final output document.

- [ ] **Step 1: Write failing test for output rendering**

```typescript
// runtime/tests/output-renderer.test.ts
import { describe, it, expect } from "bun:test";
import { renderExecutionPackage } from "../src/output-renderer";
import type { ArtifactManifest } from "../src/types";

describe("renderExecutionPackage", () => {
  it("assembles artifacts into execution package with frontmatter", () => {
    const artifacts = new Map<string, { manifest: ArtifactManifest; content: string }>([
      ["requirements_analysis", {
        manifest: {
          schema: "aos/artifact/v1",
          id: "requirements_analysis",
          produced_by: ["advocate"],
          step_id: "understand",
          format: "markdown",
          content_path: "/tmp/artifacts/requirements_analysis.md",
          metadata: { produced_at: "2026-03-24T00:00:00Z", review_status: "approved", review_gate: "understand", word_count: 100, revision: 1 },
        },
        content: "# Requirements\n\nUser stories here.",
      }],
    ]);

    const result = renderExecutionPackage({
      profile: "cto-execution",
      workflow: "cto-execution-workflow",
      sessionId: "abc123",
      domain: null,
      participants: ["architect", "advocate"],
      briefPath: "briefs/test/brief.md",
      transcriptPath: "sessions/test/transcript.jsonl",
      durationMinutes: 12.5,
      stepsCompleted: ["understand"],
      gatesPassed: ["understand"],
      artifacts,
      executiveSummary: "We are building X.",
    });

    expect(result).toContain("schema: aos/output/v1");
    expect(result).toContain("profile: cto-execution");
    expect(result).toContain("workflow: cto-execution-workflow");
    expect(result).toContain("phases_completed:");
    expect(result).toContain("gates_passed:");
    expect(result).toContain("# Execution Package");
    expect(result).toContain("User stories here.");
  });

  it("uses default sections when none specified", () => {
    // Verify the 8 default sections are present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/output-renderer.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement output renderer**

Create `runtime/src/output-renderer.ts`:
- Takes a map of loaded artifacts + session metadata
- Produces a Markdown document with YAML frontmatter
- Frontmatter includes `workflow`, `phases_completed`, `gates_passed` fields
- Sections are rendered from artifacts in the order defined by the profile's `output.sections` list (or the default 8 sections for `execution-package`)
- Each section includes the artifact content under the appropriate heading

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/output-renderer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Wire into engine.ts**

In `engine.ts`, after the workflow completes, call the output renderer to assemble and write the final execution package. Use `adapter.writeFile()` to write to the profile's `output.path_template`.

- [ ] **Step 6: Commit**

```bash
git add runtime/src/output-renderer.ts runtime/tests/output-renderer.test.ts runtime/src/engine.ts
git commit -m "feat: implement execution-package output renderer with frontmatter assembly"
```
