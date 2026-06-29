# Dev-Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dev-execution` profile + workflow that takes a feature brief through planning, implementation via hierarchical delegation, code review, and testing in a single session.

**Architecture:** 4 new config files (agent YAML, prompt, profile, workflow) + 2 small runtime changes (WorkflowRunner accepts agents map, `executeWithTools` resolves real agent configs). No new modules.

**Tech Stack:** TypeScript, YAML, Bun test runner

**Spec:** `docs/specs/2026-04-11-dev-execution-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `core/agents/operational/engineering-lead/agent.yaml` | Engineering Lead agent definition with delegation config |
| `core/agents/operational/engineering-lead/prompt.md` | System prompt template for the lead |
| `core/profiles/dev-execution/profile.yaml` | Dev execution profile combining planning + implementation |
| `core/workflows/dev-execution.workflow.yaml` | 9-step workflow: plan → implement → review → test → synthesize |

### Modified Files
| File | Change |
|---|---|
| `runtime/src/workflow-runner.ts` | Add `agents` map to constructor, add `max_retries` to WorkflowStep, update `executeWithTools()` to resolve real agent configs |
| `runtime/src/engine.ts` | Pass `this.agents` to WorkflowRunner constructor |
| `runtime/tests/workflow-runner.test.ts` | Tests for agent resolution and max_retries |

---

## Task 1: Create Engineering Lead Agent

**Files:**
- Create: `core/agents/operational/engineering-lead/agent.yaml`
- Create: `core/agents/operational/engineering-lead/prompt.md`

- [ ] **Step 1: Create agent.yaml**

Create the directory and file at `core/agents/operational/engineering-lead/agent.yaml`:

```yaml
schema: aos/agent/v1
id: engineering-lead
name: Engineering Lead
role: >
  Implementation orchestrator. Reads task breakdowns, distributes work
  to coding workers via hierarchical delegation, coordinates parallel
  implementation, and ensures all tasks are completed with tests passing.

cognition:
  objective_function: "Ship every task with passing tests and clean code"
  time_horizon:
    primary: this session
    secondary: sprint
    peripheral: codebase health
  core_bias: execution-quality
  risk_tolerance: low
  default_stance: "Break it down, assign it, verify it."

persona:
  temperament:
    - "Methodical — works through tasks in dependency order"
    - "Pragmatic — prefers working code over perfect code"
    - "Vigilant — checks test results after every implementation"
  thinking_patterns:
    - "Which tasks can run in parallel vs which have dependencies?"
    - "Does this worker's output actually satisfy the acceptance criteria?"
    - "Are the tests passing? If not, what's the minimal fix?"
  heuristics:
    - name: Dependency-First
      rule: "Always implement dependencies before dependents. If task B depends on task A's output, A completes first."
    - name: Scope Guard
      rule: "Each worker gets only the file paths their task requires. Never give broad write access."
    - name: Test-After-Each
      rule: "After each task implementation, run relevant tests before moving to the next task."
  evidence_standard:
    convinced_by:
      - "Passing tests"
      - "Code that matches the acceptance criteria"
      - "Clean diff with no unrelated changes"
    not_convinced_by:
      - "Claims of completion without test evidence"
      - "Code that works but doesn't match the architecture"
  red_lines:
    - "Never merge work that breaks existing tests"
    - "Never give a worker write access outside their task scope"
    - "Never skip the test verification step"

tensions:
  - agent: sentinel
    dynamic: "Engineering Lead prioritizes shipping; Sentinel prioritizes safety"
  - agent: operator
    dynamic: "Engineering Lead executes the plan; Operator designed the plan and may challenge changes"

report:
  structure: "Implementation report: tasks completed, files changed, test results, issues encountered"

tools: [read, grep, glob]
skills: []
expertise:
  - path: expertise/engineering-lead-notes.md
    mode: read-write
    use_when: "Track implementation patterns, test commands, common failure modes for this project"

model:
  tier: premium
  thinking: "on"

capabilities:
  can_execute_code: false
  can_produce_files: false
  can_review_artifacts: true
  available_skills: []
  output_types: [text, markdown, structured-data]

delegation:
  can_spawn: true
  max_children: 5
  child_model_tier: standard
  child_timeout_seconds: 300
  delegation_style: delegate-only

domain:
  rules:
    - path: "**"
      read: true
      write: true
      delete: false
  tool_allowlist: [read, grep, glob]
```

- [ ] **Step 2: Create prompt.md**

Create `core/agents/operational/engineering-lead/prompt.md`:

```markdown
# {{agent_name}}

## Session: {{session_id}}
## Agent: {{agent_id}}
## Participants: {{participants}}
## Constraints: {{constraints}}

## Expertise
{{expertise_block}}

## Deliberation Directory: {{deliberation_dir}}
## Transcript: {{transcript_path}}

## Brief
{{brief}}

---

## 1. Identity & Role

You are the **Engineering Lead** — the bridge between planning and implementation. You receive a task breakdown from the planning phase and turn it into working code by distributing tasks to specialized coding workers.

**You do not write code directly.** You orchestrate: read the tasks, spawn workers scoped to specific file paths, give each worker clear instructions, and collect their results.

## 2. How You Work

### Reading the Task Breakdown
Each task has: name, description, effort estimate, dependencies, `domain_scope` (file paths), and acceptance criteria. Use these to plan your delegation.

### Spawning Workers
Use `spawnSubAgent` to create a worker for each task (or group of related tasks):
- Set `domainRules.rules` to match the task's `domain_scope` — the worker can only read/write those paths
- Include in the system prompt: the task description, acceptance criteria, and relevant architecture context
- Set a reasonable timeout based on effort estimate (S=120s, M=180s, L=300s, XL=300s)

### Coordinating Dependencies
If task B depends on task A:
1. Spawn and complete task A first
2. Then spawn task B with task A's output as additional context

Independent tasks can be spawned in parallel.

### Collecting Results
Use `messageChild` to check on worker progress and collect results. Each worker should report:
- Files created or modified
- Tests run and results
- Any issues encountered

### Producing the Implementation Report
After all workers complete, produce a structured report:
- List each task with status (completed/failed)
- Files changed (created, modified, deleted)
- Test results per task
- Any unresolved issues

## 3. Constraints

- **Never write code yourself** — delegate everything to workers
- **Respect domain scoping** — each worker gets only the paths their task requires
- **Test after each task** — instruct workers to run relevant tests
- **Dependencies first** — never start a task before its dependencies complete
- **Report honestly** — if a task failed, say so. Don't mask failures.

{{role_override}}
```

- [ ] **Step 3: Validate the agent loads**

Run: `cd aos-harness && bun run cli/src/index.ts validate 2>&1 | head -20`
Expected: Engineering Lead should appear in the validation output without errors

- [ ] **Step 4: Commit**

```bash
git add core/agents/operational/engineering-lead/
git commit -m "feat: add Engineering Lead agent for dev-execution workflow

Delegate-only agent that orchestrates code implementation via
hierarchical delegation. Spawns scoped workers per task, coordinates
dependencies, collects results. Read-only tools, write-enabled domain
ceiling for child inheritance."
```

---

## Task 2: Create Dev-Execution Workflow

**Files:**
- Create: `core/workflows/dev-execution.workflow.yaml`

- [ ] **Step 1: Create the workflow file**

Create `core/workflows/dev-execution.workflow.yaml`:

```yaml
schema: aos/workflow/v1
id: dev-execution-workflow
name: Dev Execution
description: >
  End-to-end development: planning deliberation followed by agent-driven
  code implementation with hierarchical delegation, code review, and testing.

steps:
  # ── Planning Phase ─────────────────────────────────────────────

  - id: understand
    name: Requirements Analysis
    action: targeted-delegation
    agents: [advocate, strategist]
    prompt: |
      Analyze this feature request. Read the existing codebase to understand
      the current state. Advocate: write user stories with acceptance criteria.
      Strategist: identify the core problem and how this fits the product roadmap.
    output: requirements_analysis
    review_gate: true

  - id: design
    name: Architecture & Design
    action: targeted-delegation
    agents: [architect]
    input: [requirements_analysis]
    prompt: |
      Based on the requirements, read the existing code structure and produce
      an architecture decision record:
      - System design (components, data flow, integration points)
      - Technology choices with rationale
      - Migration strategy if modifying existing systems
      - Mermaid diagram of the architecture
      Ground every decision in the actual codebase — read files, check imports,
      understand the current patterns before proposing changes.
    output: architecture_decision_record
    review_gate: true

  - id: challenge
    name: Architecture Review
    action: tension-pair
    agents: [architect, operator]
    input: [architecture_decision_record]
    prompt: |
      Operator: review this architecture for buildability. Read the actual code
      it references. What's missing? What's harder than it looks? What dependencies
      are hidden? Architect: defend or revise based on Operator's concerns.
    output: revised_architecture
    review_gate: false

  - id: plan
    name: Phase Planning
    action: targeted-delegation
    agents: [strategist, operator]
    input: [revised_architecture, requirements_analysis]
    prompt: |
      Break this into execution phases. Strategist: define 2-4 phases with
      clear milestones and dependencies. Operator: validate against codebase
      complexity, add effort estimates, flag risks.
    output: phase_plan
    review_gate: true

  - id: tasks
    name: Task Breakdown
    action: targeted-delegation
    agents: [operator]
    input: [phase_plan, revised_architecture]
    prompt: |
      For each phase, produce a concrete task breakdown:
      - Task name, description, effort estimate (S/M/L/XL)
      - Dependencies between tasks
      - domain_scope: the file paths this task reads and writes (e.g., "src/api/**")
      - Acceptance criteria per task

      The domain_scope is critical — it determines which files each coding
      worker will have access to. Be specific: "src/api/routes/**" not "src/".
    output: task_breakdown
    review_gate: false

  # ── Implementation Phase ───────────────────────────────────────

  - id: implement
    name: Implementation
    action: execute-with-tools
    agents: [engineering-lead]
    input: [task_breakdown, revised_architecture]
    prompt: |
      You are the Engineering Lead. You have the task breakdown and architecture.

      For each task in the breakdown:
      1. Read the domain_scope to determine which files the worker needs access to
      2. Spawn a worker agent scoped to those paths using spawnSubAgent
      3. Give the worker: task description, acceptance criteria, architecture context
      4. The worker will read existing code, implement changes, and run relevant tests
      5. If tests fail, have the worker fix the issues
      6. Collect the worker's result via messageChild

      Respect task dependencies — implement dependencies before dependents.
      Independent tasks can be spawned in parallel.

      When all tasks are complete, produce an implementation report listing:
      - Each task and its status (completed/failed)
      - Files created or modified
      - Test results per task
    output: implementation_report
    review_gate: false

  - id: code-review
    name: Code Review
    action: targeted-delegation
    agents: [sentinel]
    input: [implementation_report, revised_architecture]
    prompt: |
      Review all code changes made during implementation. Read the actual
      modified files. Check for:
      - Security vulnerabilities and attack surface changes
      - Consistency with the architecture decision record
      - Code quality, naming, and test coverage
      - Missing edge cases or error handling
      - Any changes outside the expected scope

      Produce a review report with findings categorized as:
      critical (must fix), important (should fix), minor (nice to fix).
    output: code_review_findings
    review_gate: true

  - id: test-verify
    name: Test Verification
    action: execute-with-tools
    agents: [engineering-lead]
    input: [implementation_report, code_review_findings]
    max_retries: 2
    prompt: |
      Run the project's full test suite. Use bash to execute the test command
      (e.g., "bun test", "npm test", "pytest").

      If tests fail:
      - Identify which tests failed and why
      - Spawn workers to fix the failures (same scoping as implementation)
      - Re-run tests after fixes

      Report: test command used, pass/fail count, any remaining failures.
    output: test_results
    review_gate: false

  - id: synthesize
    name: Synthesis
    action: orchestrator-synthesis
    input: [requirements_analysis, revised_architecture, phase_plan, task_breakdown, implementation_report, code_review_findings, test_results]
    prompt: |
      Assemble the final report. Summarize:
      - What was built (features implemented)
      - Files changed (with summary of each change)
      - Architecture decisions made and why
      - Test results (passing/failing)
      - Code review findings and whether they were addressed
      - Any remaining concerns or suggested follow-up tasks

      If tests are failing, document what failed and provide guidance
      for manual resolution.
    output: dev_execution_report

gates:
  - after: understand
    type: user-approval
    prompt: "Do these requirements capture what you're building? Any corrections?"
    on_rejection: retry_with_feedback

  - after: design
    type: user-approval
    prompt: "Does this architecture direction look right? Any constraints I missed?"
    on_rejection: retry_with_feedback

  - after: plan
    type: user-approval
    prompt: "Does this phasing make sense? Ready to proceed to implementation?"
    on_rejection: retry_with_feedback

  - after: code-review
    type: user-approval
    prompt: "Review the code changes and Sentinel's findings. Approve to proceed to testing, or request changes."
    on_rejection: retry_with_feedback
```

- [ ] **Step 2: Validate the workflow loads**

Run: `cd aos-harness && bun run cli/src/index.ts validate 2>&1 | grep -i workflow`
Expected: dev-execution-workflow should validate without errors

- [ ] **Step 3: Commit**

```bash
git add core/workflows/dev-execution.workflow.yaml
git commit -m "feat: add dev-execution 9-step workflow

Planning (5 steps): requirements → architecture → review → phases → tasks
Implementation (4 steps): code via hierarchical delegation → sentinel review
→ test verification with max 2 retries → synthesis report"
```

---

## Task 3: Create Dev-Execution Profile

**Files:**
- Create: `core/profiles/dev-execution/profile.yaml`

- [ ] **Step 1: Create the profile**

Create directory and file at `core/profiles/dev-execution/profile.yaml`:

```yaml
schema: aos/profile/v1
id: dev-execution
name: Dev Execution
description: >
  End-to-end development workflow: from feature brief to implemented,
  tested, reviewed code. Combines CTO-level planning deliberation with
  agent-driven code implementation via hierarchical delegation.
version: 1.0.0

assembly:
  orchestrator: cto-orchestrator
  perspectives:
    - agent: architect
      required: true
      role_override: "Analyze the codebase and produce architecture decisions grounded in existing code"
    - agent: strategist
      required: true
      role_override: "Sequence the work into phases considering the existing codebase"
    - agent: operator
      required: true
      role_override: "Break phases into concrete tasks with file-level scope and effort estimates"
    - agent: advocate
      required: true
      role_override: "Write user stories and acceptance criteria from the user perspective"
    - agent: sentinel
      required: true
      role_override: "Review all code changes for security, reliability, and quality"
    - agent: engineering-lead
      required: true
      role_override: "Orchestrate implementation by distributing tasks to scoped coding workers"
    - agent: provocateur
      required: false
      structural_advantage: speaks-last
      role_override: "Stress-test the plan before implementation begins"

delegation:
  default: targeted
  opening_rounds: 0
  max_delegation_depth: 2
  tension_pairs:
    - [architect, operator]
    - [strategist, advocate]
  bias_limit: 3

constraints:
  time:
    min_minutes: 10
    max_minutes: 240
  budget: null
  rounds:
    min: 6
    max: 30

input:
  format: brief
  required_sections:
    - heading: "## Feature / Change"
      guidance: "What are we building or changing? Describe the feature, bug fix, or refactor."
    - heading: "## Context"
      guidance: "Current codebase state, relevant files/modules, existing infrastructure."
    - heading: "## Constraints"
      guidance: "Timeline, tech debt, dependencies, test requirements."
    - heading: "## Success Criteria"
      guidance: "How do we know this is done? What does good look like? What tests should pass?"
  context_files: true

output:
  format: execution-package
  path_template: "output/dev-executions/{{date}}-{{brief_slug}}-{{session_id}}/"
  sections:
    - requirements_analysis
    - architecture_decision_record
    - phase_plan
    - task_breakdown
    - implementation_report
    - code_review_findings
    - test_results
    - synthesis
  artifacts:
    - type: mermaid_diagram
    - type: task_list
    - type: implementation_diff
  frontmatter: [date, duration, participants, brief_path, transcript_path]

workflow: dev-execution-workflow

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent

error_handling:
  agent_timeout_seconds: 300
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

controls:
  halt: true
  wrap: true
  interject: true
```

- [ ] **Step 2: Validate**

Run: `cd aos-harness && bun run cli/src/index.ts validate 2>&1 | grep -i "dev-execution"`
Expected: Profile validates without errors

- [ ] **Step 3: Commit**

```bash
git add core/profiles/dev-execution/
git commit -m "feat: add dev-execution profile

Combines planning deliberation (architect, strategist, operator, advocate,
provocateur) with code implementation (engineering-lead with hierarchical
delegation). 240-minute max, 30 max rounds, interject enabled."
```

---

## Task 4: Runtime Change — WorkflowRunner Agent Resolution

**Files:**
- Modify: `runtime/src/workflow-runner.ts`
- Modify: `runtime/src/engine.ts`
- Test: `runtime/tests/workflow-runner.test.ts`

- [ ] **Step 1: Write failing test for agent resolution**

Append to `runtime/tests/workflow-runner.test.ts` (read it first to understand the test pattern):

```typescript
describe("WorkflowRunner — executeWithTools agent resolution", () => {
  it("uses real agent config when agents field specifies a known agent", async () => {
    // This test verifies the WorkflowRunner can accept an agents map
    // and that executeWithTools resolves agent configs from it.
    const { WorkflowRunner } = await import("../src/workflow-runner");
    const adapter = new MockAdapter();

    const agents = new Map();
    agents.set("engineering-lead", {
      schema: "aos/agent/v1",
      id: "engineering-lead",
      name: "Engineering Lead",
      role: "test",
      cognition: { objective_function: "test", time_horizon: { primary: "", secondary: "", peripheral: "" }, core_bias: "", risk_tolerance: "moderate", default_stance: "" },
      persona: { temperament: [], thinking_patterns: [], heuristics: [], evidence_standard: { convinced_by: [], not_convinced_by: [] }, red_lines: [] },
      tensions: [],
      report: { structure: "" },
      tools: ["read"],
      skills: [],
      expertise: [],
      model: { tier: "standard", thinking: "off" },
      delegation: { can_spawn: true, max_children: 3, child_model_tier: "economy", child_timeout_seconds: 120, delegation_style: "delegate-only" },
    });

    const config = {
      schema: "aos/workflow/v1",
      id: "test-workflow",
      name: "Test",
      description: "test",
      steps: [{
        id: "test-step",
        action: "execute-with-tools",
        agents: ["engineering-lead"],
        prompt: "test prompt",
        output: "test_output",
      }],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, { agents });
    // The runner should accept the agents map without error
    expect(runner).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/workflow-runner.test.ts`
Expected: FAIL — WorkflowRunner constructor doesn't accept `agents` option

- [ ] **Step 3: Add max_retries to WorkflowStep and agents to constructor**

In `runtime/src/workflow-runner.ts`:

Add `max_retries` to the `WorkflowStep` interface:

```typescript
export interface WorkflowStep {
  id: string;
  name?: string;
  action: string;
  description?: string;
  agents?: string[];
  prompt?: string;
  code?: string;
  structural_advantage?: "speaks-last" | null;
  input?: string[];
  output?: string;
  review_gate?: boolean;
  max_retries?: number;    // NEW — max retry loops for execute-with-tools steps
}
```

Add `AgentConfig` to the imports at the top:

```typescript
import type { AOSAdapter, AgentConfig, ExecuteCodeOpts, TranscriptEntry, ProfileConfig, DelegationDelegate } from "./types";
```

Add `agents` field and constructor support:

```typescript
private agents?: Map<string, AgentConfig>;
```

Update the constructor to accept `agents`:

```typescript
constructor(config: WorkflowConfig, adapter: AOSAdapter, opts?: {
  sessionDir?: string;
  onTranscriptEvent?: (event: TranscriptEntry) => void;
  profileConfig?: ProfileConfig;
  delegationDelegate?: DelegationDelegate;
  agents?: Map<string, AgentConfig>;    // NEW
}) {
```

Add to constructor body:

```typescript
if (opts?.agents) {
  this.agents = opts.agents;
}
```

- [ ] **Step 4: Update executeWithTools to resolve real agent configs**

In the `executeWithTools` method, replace the inline agent config creation (~lines 526-554). Find the block that starts with `const handle = await this.adapter.spawnAgent({` and replace the entire inline config object:

```typescript
private async executeWithTools(
  step: WorkflowStep,
  inputs: Record<string, unknown>,
): Promise<unknown> {
  const prompt = this.resolveStepPrompt(step);

  this.adapter.notify(
    `[${this.config.id}] Execute with tools: ${prompt}`,
    "info",
  );

  let executionResult: unknown = null;

  try {
    // Resolve agent config: use real agent if specified, else generic stub
    const specifiedAgent = step.agents?.[0];
    let agentConfig: AgentConfig;

    if (specifiedAgent && this.agents?.has(specifiedAgent)) {
      agentConfig = this.agents.get(specifiedAgent)!;
    } else {
      agentConfig = {
        schema: "aos/agent/v1",
        id: `${step.id}-executor`,
        name: step.name ?? step.id,
        role: "executor",
        cognition: {
          objective_function: "execute",
          time_horizon: { primary: "immediate", secondary: "", peripheral: "" },
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
        report: { structure: "flat" },
        tools: null,
        skills: [],
        expertise: [],
        model: { tier: "standard", thinking: "off" },
      };
    }

    const handle = await this.adapter.spawnAgent(agentConfig, this.config.id);

    try {
      if (step.code) {
        const opts: ExecuteCodeOpts = {
          timeout_ms: 30000,
          sandbox: "strict",
        };
        executionResult = await this.adapter.executeCode(handle, step.code, opts);
      } else {
        const response = await this.adapter.sendMessage(handle, prompt);
        executionResult = response.text;
      }
    } catch (err) {
      if (err instanceof UnsupportedError) {
        this.adapter.notify(
          `[${this.config.id}] execution not supported by adapter, skipping`,
          "info",
        );
      } else {
        throw err;
      }
    }

    await this.adapter.destroyAgent(handle);
  } catch (err) {
    if (err instanceof UnsupportedError) {
      this.adapter.notify(
        `[${this.config.id}] Execution adapter not available, skipping`,
        "info",
      );
    } else {
      throw err;
    }
  }

  return {
    stepId: step.id,
    action: step.action,
    prompt,
    executionResult,
    inputs,
  };
}
```

- [ ] **Step 5: Update engine.ts to pass agents map**

In `runtime/src/engine.ts`, find the `new WorkflowRunner(...)` call (~line 175). Add `agents: this.agents` to the options:

```typescript
const runner = new WorkflowRunner(this.workflowConfig, this.adapter, {
  sessionDir: deliberationDir,
  onTranscriptEvent: (e) => this.pushTranscript(e),
  delegationDelegate: this.createDelegationDelegate(),
  profileConfig: this.profile,
  agents: this.agents,    // NEW — pass agent configs for executeWithTools resolution
});
```

- [ ] **Step 6: Run tests**

Run: `cd aos-harness && bun test`
Expected: All tests PASS (347+ existing + new test)

- [ ] **Step 7: Commit**

```bash
git add runtime/src/workflow-runner.ts runtime/src/engine.ts runtime/tests/workflow-runner.test.ts
git commit -m "feat(runtime): resolve real agent configs in executeWithTools

WorkflowRunner accepts agents map via constructor. executeWithTools
checks step.agents field and resolves actual AgentConfig (with
delegation, domain, expertise) instead of creating a generic stub.
Adds max_retries field to WorkflowStep for retry loops."
```

---

## Task 5: Update Integration Test — Validate Dev-Execution Config

**Files:**
- Modify: `tests/integration/validate-config.ts`

- [ ] **Step 1: Update expected agent count**

Read `tests/integration/validate-config.ts`. Find the agent count check. Update from 13 to 14 (we added engineering-lead):

```typescript
check(`Expected 14 agents, found ${agents.length}`, () => {
  if (agents.length !== 14) throw new Error(`Expected 14, got ${agents.length}`);
});
```

- [ ] **Step 2: Run integration validation**

Run: `cd aos-harness && bun run tests/integration/validate-config.ts`
Expected: All checks pass

- [ ] **Step 3: Commit**

```bash
git add tests/integration/validate-config.ts
git commit -m "test: update integration test for 14 agents (added engineering-lead)"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/dev-execution/README.md`

- [ ] **Step 1: Write the guide**

Read `docs/creating-workflows/README.md` for style reference. Create `docs/dev-execution/README.md`:

Content should cover:
- What dev-execution does (brief to working code in one session)
- Prerequisites (Bun, adapter like Pi installed, project with `aos init`)
- Usage: `aos run dev-execution --brief feature.md`
- The 9-step flow explained simply (planning phase → user approval → implementation → code review → testing → synthesis)
- How the Engineering Lead works (spawns workers, domain-scoped, dependency-ordered)
- Writing a good brief for dev-execution (the 4 required sections: Feature/Change, Context, Constraints, Success Criteria)
- What you get at the end (implementation report, code changes in your project, test results)
- Limitations (gate wait time counts against max_minutes, max 2 test retries, no git commits)

- [ ] **Step 2: Update README.md**

Add `dev-execution` to the Enhanced Capabilities table in the root README.md:

```markdown
| [Dev Execution](docs/dev-execution/README.md) | Brief to working code in one session | Planning + hierarchical implementation |
```

- [ ] **Step 3: Commit**

```bash
git add docs/dev-execution/README.md README.md
git commit -m "docs: add dev-execution guide and update README"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 2: Run integration validation**

Run: `bun run tests/integration/validate-config.ts`
Expected: All checks pass (14 agents, profiles load, etc.)

- [ ] **Step 3: List all configs**

Run: `bun run cli/src/index.ts list`
Expected: Shows 14 agents (including engineering-lead), 7 profiles (including dev-execution), dev-execution-workflow in workflows

- [ ] **Step 4: Verify git status is clean**

Run: `git status`
Expected: Clean working tree

- [ ] **Step 5: Push**

```bash
git push origin main
```
