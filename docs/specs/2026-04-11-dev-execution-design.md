# Dev-Execution: Planning-to-Code Workflow Design

**Date:** 2026-04-11
**Status:** Draft
**Scope:** New profile, workflow, and agent that takes a feature brief through planning, implementation, review, and testing in a single session.

## Overview

The `dev-execution` profile combines the planning deliberation of `cto-execution` with actual code implementation. Agents read the user's real codebase, deliberate on architecture and task breakdown, then implement the changes using the adapter's native tools (read, write, edit, bash). An Engineering Lead agent distributes tasks to scoped workers via hierarchical delegation.

**User experience:**
```bash
aos run dev-execution --brief feature.md --domain saas
```

One command. Brief to working code.

## Architecture

The design adds zero new runtime modules. It wires existing infrastructure into a new workflow:

- **Workflow Runner** `execute-with-tools` action — spawns agents that use adapter tools directly
- **Hierarchical Delegation** (Phase 2) — Engineering Lead spawns scoped workers
- **Domain Enforcement** (Phase 1) — workers restricted to their task's file paths
- **Review Gates** — user approves plan before implementation begins, approves code before it's finalized

```
AOS Harness (orchestration)
  │
  │  "who does what, in what order, with what constraints"
  │
  ├── Planning agents reason about requirements, architecture, tasks
  │     └── they READ the codebase for context (via adapter tools)
  │
  ├── Engineering Lead distributes tasks to workers
  │     └── spawns workers with domain-scoped permissions
  │
  └── Worker agents implement using adapter tools
        └── Pi / Claude Code provides read, write, edit, bash, grep
```

**Key principle:** The adapter IS the execution engine. AOS orchestrates. Pi/Claude Code executes.

## Workflow: 9 Steps

### Planning Phase (Steps 1-5)

Same deliberation pattern as cto-execution. The critical difference: agents can **read the actual codebase** to ground their analysis in reality.

**Step 1: Requirements Analysis** (`targeted-delegation`)
- Agents: advocate, strategist
- Advocate writes user stories with acceptance criteria
- Strategist identifies core problem and roadmap fit
- Agents read relevant codebase files to understand current state
- Gate: user approval

**Step 2: Architecture Design** (`targeted-delegation`)
- Agent: architect
- Reads existing code structure (file tree, key modules, data models)
- Produces architecture decision record with Mermaid diagram
- Proposes changes grounded in actual codebase, not abstract design
- Gate: user approval

**Step 3: Architecture Review** (`tension-pair`)
- Agents: architect vs operator
- Operator challenges buildability, hidden dependencies
- Architect defends or revises
- No gate — tension is the review

**Step 4: Phase Planning** (`targeted-delegation`)
- Agents: strategist, operator
- Break work into 2-4 phases with milestones and dependencies
- Operator validates against codebase complexity and team capacity
- Gate: user approval

**Step 5: Task Breakdown** (`targeted-delegation`)
- Agent: operator
- Structured task list: name, description, effort, dependencies, domain scope (which files/directories)
- Each task includes a `domain_scope` field: the file paths this task touches
- This is the input to the Engineering Lead in the next phase

### Implementation Phase (Steps 6-9)

**Step 6: Implementation** (`execute-with-tools`)
- Agent: engineering-lead
- Input: task_breakdown, revised_architecture
- The Engineering Lead:
  1. Reads the task breakdown
  2. For each task (or group of independent tasks):
     a. Spawns a worker agent via `spawnSubAgent`
     b. Worker config includes `domainRules` scoped to the task's file paths
     c. Worker system prompt includes: task description, acceptance criteria, architecture context
  3. Workers use adapter tools to:
     - Read existing code in their scope
     - Write new files or modify existing ones
     - Run tests (`bash` tool)
     - Iterate if tests fail
  4. Lead collects results from each worker
  5. Produces implementation report: what was changed, what was added, test status
- No gate here — proceeds to code review first

**Step 7: Code Review** (`targeted-delegation`)
- Agent: sentinel
- Input: implementation_report, revised_architecture
- Sentinel reviews all code changes for:
  - Security vulnerabilities
  - Consistency with architecture
  - Code quality and test coverage
  - Missing edge cases
- Sentinel can read the actual changed files via adapter tools
- Gate: user approval — **user sees both the implementation report AND sentinel's findings together**, making an informed decision. This is the single approval point for all code changes.

**Step 8: Test Verification** (`execute-with-tools`)
- Spawns a test runner agent
- Runs the project's test suite via `bash` (e.g., `bun test`, `npm test`, `pytest`)
- **Retry mechanics:** If tests fail, the workflow re-invokes Step 6 (Implementation) with the test failure output appended to the input. The Engineering Lead reads the failures and spawns workers to fix the issues. Maximum **2 retry loops**. If tests still fail after 2 retries, the workflow proceeds to Step 9 (Synthesis) with failing tests flagged — the synthesis report documents what failed and why so the user can address it manually.
- If tests pass: proceed to synthesis

**Step 9: Synthesis** (`orchestrator-synthesis`)
- Agent: cto-orchestrator
- Input: all previous artifacts
- Produces final report:
  - What was built
  - Files changed (with summary)
  - Architecture decisions made
  - Test results
  - Any remaining concerns from sentinel or provocateur
  - Suggested follow-up tasks

## New Agent: Engineering Lead

```yaml
schema: aos/agent/v1
id: engineering-lead
name: Engineering Lead
role: >
  Implementation orchestrator. Reads task breakdowns, distributes work
  to coding workers, coordinates parallel implementation, and ensures
  all tasks are completed with tests passing.

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

tools: [read, grep, glob]    # read-only tools for codebase inspection
skills: []
expertise:
  - path: expertise/engineering-lead-notes.md
    mode: read-write
    use_when: "Track implementation patterns, test commands, common failure modes for this project"

model:
  tier: premium
  thinking: "on"

capabilities:
  can_execute_code: false     # delegates execution to workers
  can_produce_files: false    # workers produce files
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
      write: true       # Must be true so children can inherit write access.
      delete: false      # The Lead itself can't write — its tool_allowlist
                         # is [read, grep, glob]. But domain rules define the
                         # CEILING for child agents. If this were write: false,
                         # no worker could ever get write access via inheritance.
  tool_allowlist: [read, grep, glob]  # Lead's OWN tools — read-only
```

Workers are not pre-defined agents. The Engineering Lead spawns them dynamically based on the task breakdown, with each worker's system prompt and domain rules tailored to its specific task.

## New Profile: dev-execution

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
    max_minutes: 240     # planning + implementation + user review time
  budget: null           # subscription mode
  rounds:
    min: 6               # planning rounds + implementation rounds
    max: 30
# Note: gate wait time (while user reviews and approves) DOES count
# against max_minutes. With 4 user approval gates and nontrivial
# implementation, 240 minutes (4 hours) provides comfortable headroom.
# For very large features, increase max_minutes in a custom profile.

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
  agent_timeout_seconds: 300    # longer for code implementation
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

controls:
  halt: true
  wrap: true
  interject: true              # allow user to interject during implementation
```

## Runtime Change: executeWithTools Agent Resolution

**Current behavior** (`workflow-runner.ts:526-554`): `executeWithTools()` creates a generic inline agent config with stub cognition/persona. This works but doesn't carry delegation config or domain rules.

**New behavior:** When the step's `agents` field specifies an agent ID, resolve the actual agent config from the engine's loaded agents. Fall back to the inline stub only when no agent is specified.

```typescript
// In executeWithTools(), replace the inline agent config block:

let agentConfig: AgentConfig;
const specifiedAgent = step.agents?.[0];

if (specifiedAgent && this.agents?.has(specifiedAgent)) {
  // Use the real agent config (carries delegation, domain, expertise)
  agentConfig = this.agents.get(specifiedAgent)!;
} else {
  // Fallback: generic executor (existing behavior)
  agentConfig = {
    schema: "aos/agent/v1",
    id: `${step.id}-executor`,
    // ... existing inline stub
  };
}
```

**Delegate-only agent handling:** When `executeWithTools()` spawns an agent with `delegation_style: "delegate-only"`, the adapter must inject delegation tools (`spawnSubAgent`, `messageChild`) instead of execution tools (`write`, `edit`, `bash`). The tool injection path:

1. `executeWithTools()` resolves the agent config
2. If `agentConfig.delegation?.delegation_style === "delegate-only"`:
   - The adapter's `spawnAgent()` receives the full config including delegation settings
   - The adapter registers `spawnSubAgent` and `messageChild` as available tools for this agent (via `registerTool()` on the UIAdapter)
   - The adapter does NOT register `write`, `edit`, `bash` — the agent's `tool_allowlist` (`[read, grep, glob]`) enforces this
3. If `delegation_style` is absent or `"delegate-and-execute"`:
   - Normal tool injection — agent gets its full allowlist plus delegation tools if `can_spawn` is true

This means the runtime change also includes a check in `executeWithTools()` after spawning the agent:

```typescript
// After spawning, register delegation tools if agent can delegate
if (agentConfig.delegation?.can_spawn) {
  // The adapter handles tool registration during spawnAgent —
  // it reads agentConfig.delegation and registers spawnSubAgent/messageChild
  // This is already the contract from Phase 2 (L1 adapter methods)
}
```

The Pi adapter's `spawnAgent()` already receives the full `AgentConfig`. The change is ensuring it reads `delegation` from the config and registers the appropriate tools. This is ~10 lines in the Pi adapter's agent spawn path.

This is the **only runtime code change** beyond the agent config resolution. Everything else is YAML configuration.

**The agents map** needs to be passed to the WorkflowRunner. Currently the runner receives a `DelegationDelegate` and an `AOSAdapter` via its constructor. Add `agents: Map<string, AgentConfig>` as a new constructor parameter. The engine already has this map and passes it when creating the runner. This is a constructor signature change (~3 lines in engine.ts where WorkflowRunner is instantiated).

## Workflow YAML: dev-execution-workflow

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
    prompt: |
      Run the project's full test suite. Use bash to execute the test command
      (e.g., "bun test", "npm test", "pytest").

      If tests fail:
      - Identify which tests failed and why
      - Spawn workers to fix the failures (same scoping as implementation)
      - Re-run tests after fixes

      Report: test command used, pass/fail count, any remaining failures.
    output: test_results
    max_retries: 2
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

## What Uses What (Infrastructure Mapping)

| Feature | Existing Infrastructure | Used By |
|---|---|---|
| Codebase reading during planning | Adapter tools (read, grep, glob) | Steps 1-5: agents read actual code |
| Hierarchical delegation | ChildAgentManager (Phase 2) | Step 6: lead spawns workers |
| Domain enforcement | DomainEnforcer (Phase 1) | Step 6: workers scoped to task paths |
| Code execution | Adapter executeCode / bash tool | Step 6: workers write/test; Step 8: test suite |
| Review gates | WorkflowRunner gate handling | After planning (Step 5), after implementation (Step 6), after review (Step 7) |
| File tracking | file_changed events (Phase 2) | Step 6: track what workers change |
| Expertise | ExpertiseManager (Phase 3a) | Engineering Lead accumulates project patterns |
| Cost tracking | Constraint engine | Per-agent cost attribution including workers |
| Platform streaming | onTranscriptEvent | All steps visible in AOS Platform dashboard |

## Non-Goals

- **Automated git commits/PRs** — the workflow produces code changes in the working directory. The user decides when to commit and how to organize commits. Future enhancement, not this spec.
- **CI/CD integration** — running external CI pipelines is out of scope. Step 8 runs the local test suite only.
- **Multi-repo support** — assumes a single project directory. Workers can't span repositories.
- **Agent model selection** — workers use the `child_model_tier` from the Engineering Lead's delegation config. No per-task model override in this version.

## Implementation Scope

**New files (4 — all YAML/Markdown config):**
1. `core/agents/operational/engineering-lead/agent.yaml`
2. `core/agents/operational/engineering-lead/prompt.md`
3. `core/profiles/dev-execution/profile.yaml`
4. `core/workflows/dev-execution.workflow.yaml`

**Modified files (2 — small runtime changes):**
1. `runtime/src/workflow-runner.ts` — `executeWithTools()` resolves real agent config from `agents` field instead of creating stub. Adds `agents` map to constructor. Adds `max_retries` support for test-verify step retry loop.
2. `runtime/src/engine.ts` — Passes `this.agents` to WorkflowRunner constructor (~3 lines)

**Tests:**
1. Unit test for agent config resolution in `executeWithTools()`
2. Integration test verifying the dev-execution workflow loads and validates

**Documentation:**
1. `docs/dev-execution/README.md` — user guide
2. Astro site page: `/docs/dev-execution`
3. Update README.md feature list
