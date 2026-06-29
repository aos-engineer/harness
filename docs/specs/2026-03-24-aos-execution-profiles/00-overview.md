# AOS Execution Profiles — Overview & Reference Implementation

**Date:** 2026-03-24
**Status:** Draft
**Extends:** [AOS Harness Design Specification (2026-03-23)](../2026-03-23-aos-harness-design.md)
**Spec Suite:**
- `00-overview.md` — This document. Vision, reference implementation, architectural direction.
- `01-schema-additions.md` — Layer 1: All schema and runtime changes (implementation-ready).
- `02-adapter-execution.md` — Layer 2: Execution methods on the existing adapter contract (interface contracts).
- `03-skill-awareness.md` — Layer 3: Target state for AOS-aware skills and agents (architectural direction).

---

## 1. Executive Summary

The AOS Harness currently supports **deliberation profiles** — agents debate, the Arbiter synthesizes, and the output is a recommendation memo. This answers the question "what should we do?"

This spec suite extends the harness to support **execution profiles** — the orchestrator receives a feature request or product vision, breaks it into workstreams, delegates actual production work to agents (including code creation, security review, and artifact generation), reviews their output, and delivers a complete execution package. This answers the question "how do we do it, and start doing it now?"

The framework already has the architectural foundations for this. Profiles define agent assemblies and delegation strategies. Workflows define multi-step processes with review gates. The Arbiter role generalizes to any orchestrator. Agent outputs shift from opinions to artifacts. The key additions are:

- **Schema additions** — `role_override` field, agent `capabilities` declaration, `aos/artifact/v1` schema, new workflow action types, `execution-package` output format
- **Adapter execution methods** — New methods on the existing `WorkflowAdapter` interface for code execution, skill invocation, and artifact management
- **Skill/agent AOS-awareness** — A standard contract for skills and agents to receive delegated tasks, report structured results, and participate in orchestration chains

The CTO Execution profile is the reference implementation that validates all three layers.

---

## 2. Layer Dependency Map

The spec suite is organized into three layers that can be **implemented in parallel** once interface contracts are defined. Understanding the dependency graph is essential for reading the remaining sections — Sections 3-7 are the reference implementation that all three layers must support.

### Layer Overview

| Layer | Document | Detail Level | Scope |
|---|---|---|---|
| 1. Schema Additions | `01-schema-additions.md` | Implementation-ready YAML/TS | Core schema and runtime changes |
| 2. Adapter Execution Methods | `02-adapter-execution.md` | Interface contracts | New methods on existing `WorkflowAdapter` |
| 3. Skill/Agent AOS-Awareness | `03-skill-awareness.md` | Target state contracts | What AOS-compatible skills/agents look like |

### Dependency Graph

```
Layer 1: Schema Additions
  ├── role_override (profile schema)
  ├── capabilities (agent schema)           ──► Layer 2 uses capabilities to validate
  ├── aos/artifact/v1 (new schema)          ──► Layer 2 implements artifact I/O
  ├── Workflow action types                 ──► Layer 2 implements execute-with-tools
  ├── execution-package output format
  └── {{role_override}} template variable

Layer 2: Adapter Execution Methods
  ├── executeCode()                         ──► Layer 3 skills may invoke
  ├── invokeSkill()                         ──► Layer 3 defines skill contract
  ├── createArtifact() / loadArtifact()     ──► Layer 1 defines artifact schema
  └── submitForReview()

Layer 3: Skill/Agent AOS-Awareness
  ├── aos/skill/v1 (target schema)          ◄── Depends on Layer 1 artifact schema
  ├── Structured result reporting           ◄── Depends on Layer 2 interfaces
  └── Review feedback protocol              ◄── Depends on Layer 2 submitForReview
```

### Parallelization Strategy

- **Layer 1** blocks nothing — it is pure schema and config work. Start immediately.
- **Layer 2** depends on Layer 1's artifact schema and capability declarations for its interface types. The interfaces can be drafted in parallel with Layer 1 using the contracts defined in this overview, then finalized once Layer 1 is approved.
- **Layer 3** depends on Layer 2's interfaces to define what skills implement. Can be drafted in parallel using the target state contracts in this overview.
- **Adapter implementations** (Pi, Claude Code, Codex) are independent of each other and can be built in parallel once Layer 2 interfaces are finalized.

---

## 3. The Delegation Pattern

### Deliberation vs. Delegation

The strategic-council profile follows a **deliberation pattern**: agents debate, the Arbiter synthesizes, and the output is a recommendation memo.

The CTO execution profile follows a **delegation pattern**: the orchestrator receives a feature request, breaks it into workstreams, delegates actual production work to agents, reviews their output, and delivers a complete execution package.

This is the same pattern behind a CIO delegating security remediation or a CEO delegating quarterly planning. The orchestrator role changes, the agents shift from advisory to productive, and the output shifts from a memo to a set of artifacts.

### How This Fits the Existing Framework

No new architectural primitives are needed. The key pieces already exist:

- **Profiles** define which agents are assembled and how delegation works. An execution profile uses a different assembly and delegation strategy than strategic-council.
- **Workflows** define multi-step processes with review gates. Execution profiles are the first profiles that genuinely need workflows, because execution has sequential dependencies (you can't write implementation tasks before the architecture is decided).
- **The Arbiter role** generalizes to any orchestrator. Same engine, same adapter contract, different system prompt and delegation behavior. The `assembly.orchestrator` field already accepts any agent ID.
- **Agent outputs** shift from opinions to artifacts. Instead of "I think we should use microservices because..." the Architect produces an actual architecture decision record. The agent schema supports this through the `report.structure` field, extended by the new `role_override` field.

### Executive Delegation Profile Family

The CTO profile is the reference implementation for a broader family of execution-oriented profiles. Each follows the same structural pattern with different agent assemblies and workflows.

| Profile | Executive Role | Input | Orchestration Pattern | Output |
|---|---|---|---|---|
| `cto-execution` | CTO | Feature request / product vision | Delegation (plan, assign, review, deliver) | Execution package (spec, architecture, tasks, implementation plan) |
| `cio-operations` | CIO | Operational issue / security incident | Triage, assess, remediate | Remediation plan + runbooks |
| `ciso-security` | CISO | Security review / compliance requirement | Assess, classify, plan, verify | Security assessment + remediation tickets |
| `ceo-delivery` | CEO | Strategic initiative / quarterly goals | Prioritize, resource, delegate, track | OKR breakdown + project charters |

> **Scope note:** Only `cto-execution` is fully specified in this document. The other profiles are listed to illustrate the pattern's extensibility. They will be designed and specced individually when implementation is planned.

---

## 4. CTO Execution Profile

This is the reference implementation for the delegation pattern. The profile YAML demonstrates all schema additions defined in `01-schema-additions.md`.

### 4.1 Profile Schema

```yaml
schema: aos/profile/v1
id: cto-execution
name: CTO Execution Orchestration
description: >
  Receives a feature request or product vision, orchestrates the full
  product development lifecycle: requirements analysis, architecture
  design, task breakdown, implementation planning, and quality gates.
  Produces a complete execution package ready for engineering handoff.
version: 1.0.0

assembly:
  orchestrator: cto-orchestrator         # Custom orchestrator (not generic Arbiter)
  perspectives:
    - agent: architect
      required: true
      role_override: "Produce architecture decision records and system design docs"
    - agent: strategist
      required: true
      role_override: "Sequence the work into phases with dependency mapping"
    - agent: operator
      required: true
      role_override: "Break phases into concrete engineering tasks with effort estimates"
    - agent: advocate
      required: true
      role_override: "Write user stories and acceptance criteria from the user perspective"
    - agent: sentinel
      required: true
      role_override: "Review all outputs for security, reliability, and maintainability risks"
    - agent: provocateur
      required: false
      structural_advantage: speaks-last
      role_override: "Stress-test the plan. Find the gaps. Challenge the timeline."

delegation:
  default: targeted                      # CTO delegates to specific agents, not broadcast
  opening_rounds: 0                      # No broadcast needed. CTO knows who to ask.
  tension_pairs:
    - [architect, operator]              # "ideal design" vs "what we can actually build"
    - [strategist, advocate]             # "optimal sequence" vs "what users need first"
  bias_limit: 3                          # Tighter than strategic-council. Every agent must contribute.

constraints:
  time:
    min_minutes: 5
    max_minutes: 30                      # Execution planning takes longer than deliberation
  budget: null                           # Typically subscription mode for this kind of work
  rounds:
    min: 4                               # Minimum: requirements, architecture, tasks, review
    max: 12

input:
  format: brief
  required_sections:
    - heading: "## Feature / Vision"
      guidance: "What are we building? Describe the feature, product change, or initiative."
    - heading: "## Context"
      guidance: "Current system state, relevant codebase areas, existing infrastructure."
    - heading: "## Constraints"
      guidance: "Timeline, team capacity, tech debt, dependencies, budget."
    - heading: "## Success Criteria"
      guidance: "How do we know this is done? What does good look like?"
  context_files: true                    # Load PRDs, existing specs, codebase docs

output:
  format: execution-package              # New output format (see Section 7)
  path_template: "output/executions/{{date}}-{{brief_slug}}-{{session_id}}/"
  sections:
    - executive_summary
    - requirements_analysis
    - architecture_decision_record
    - phase_plan
    - task_breakdown
    - risk_assessment
    - stress_test_findings
    - implementation_checklist
  artifacts:
    - type: mermaid_diagram              # Architecture diagram
    - type: task_list                    # Structured task breakdown (markdown or JSON)
  frontmatter: [date, duration, participants, brief_path, transcript_path]

workflow: cto-execution-workflow          # Links to workflow definition (Section 5)

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent

error_handling:
  agent_timeout_seconds: 180             # Longer timeout for production work
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation: null                  # Irrelevant when budget: null

controls:
  halt: true
  wrap: true
  interject: false
```

### 4.2 Key Differences from Deliberation Profiles

| Aspect | strategic-council | cto-execution |
|---|---|---|
| Orchestrator | `arbiter` (neutral synthesizer) | `cto-orchestrator` (execution leader) |
| Delegation default | `broadcast` | `targeted` |
| Opening rounds | 1 (full broadcast before targeting) | 0 (CTO knows who to ask) |
| Bias limit | 5 (loose — some agents dominate) | 3 (tight — every agent must contribute) |
| Output format | `memo` (recommendations) | `execution-package` (artifacts) |
| Workflow | None (pure deliberation) | `cto-execution-workflow` (sequential phases) |
| Agent behavior | Advisory (opinions with reasoning) | Productive (work products with artifacts) |
| `role_override` | Not used | Per-agent production instructions |
| Time constraints | 2-10 min | 5-30 min |

### 4.3 The `role_override` Field

The `role_override` is a new optional field in `assembly.perspectives[]` that tells an agent to shift from advisory mode to production mode. The agent keeps its cognitive framework (bias, heuristics, evidence standards, tensions) but changes what it produces.

- **Without `role_override`:** The Architect says "I think we should use event-driven architecture because..."
- **With `role_override`:** The Architect produces an architecture decision record with diagrams, trade-off analysis, and integration points.

The `role_override` is injected into the agent's system prompt via the template variable `{{role_override}}`, appended after the base persona. See `01-schema-additions.md` for the full schema definition.

---

## 5. CTO Execution Workflow

This is the sequential process the CTO orchestrator drives. It maps to the `aos/workflow/v1` schema with new action types defined in `01-schema-additions.md`.

### 5.1 Workflow Definition

```yaml
schema: aos/workflow/v1
id: cto-execution-workflow
name: CTO Feature Execution
description: >
  Full product development lifecycle from feature request to engineering handoff.
  Each phase produces artifacts that feed the next phase.

steps:
  - id: understand
    name: Requirements Analysis
    action: targeted-delegation
    agents: [advocate, strategist]
    prompt: |
      Analyze this feature request. Advocate: write user stories with acceptance
      criteria. Strategist: identify the core problem being solved and how this
      fits into the product roadmap.
    output: requirements_analysis
    review_gate: true

  - id: design
    name: Architecture & Design
    action: targeted-delegation
    agents: [architect]
    input: [requirements_analysis]
    prompt: |
      Based on the requirements analysis, produce an architecture decision record:
      - System design (components, data flow, integration points)
      - Technology choices with rationale
      - Migration strategy if modifying existing systems
      - Mermaid diagram of the architecture
    output: architecture_decision_record
    review_gate: true

  - id: challenge
    name: Architecture Review
    action: tension-pair
    agents: [architect, operator]
    input: [architecture_decision_record]
    prompt: |
      Operator: review this architecture for buildability. What's missing?
      What's going to be harder than it looks? What dependencies are hidden?
      Architect: defend or revise based on Operator's concerns.
    output: revised_architecture
    review_gate: false                   # Auto-proceeds. Tension is the review.

  - id: plan
    name: Phase Planning
    action: targeted-delegation
    agents: [strategist, operator]
    input: [revised_architecture, requirements_analysis]
    prompt: |
      Break this into execution phases. Strategist: define 2-4 phases with
      clear milestones and dependencies. Operator: validate against team
      capacity, add effort estimates, flag risks.
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
      - Suggested assignee role (frontend, backend, infra, etc.)
      - Acceptance criteria per task
    output: task_breakdown
    review_gate: false

  - id: security-review
    name: Security & Risk Review
    action: targeted-delegation
    agents: [sentinel]
    input: [revised_architecture, task_breakdown]
    prompt: |
      Review the architecture and task plan for:
      - Security vulnerabilities and attack surface changes
      - Data privacy implications
      - Reliability and failure mode risks
      - Compliance or governance concerns
      Flag anything that needs a task added to the breakdown.
    output: risk_assessment
    review_gate: false

  - id: stress-test
    name: Final Stress Test
    action: targeted-delegation
    agents: [provocateur]
    input: [requirements_analysis, revised_architecture, phase_plan, task_breakdown, risk_assessment]
    structural_advantage: speaks-last
    prompt: |
      You have the full execution plan. Stress-test it:
      - What's the weakest assumption?
      - Where will this plan fail first?
      - What did everyone agree on too easily?
      - Is the timeline realistic or optimistic?
    output: stress_test_findings
    review_gate: false

  - id: synthesize
    name: Execution Package Assembly
    action: orchestrator-synthesis
    input: [requirements_analysis, revised_architecture, phase_plan, task_breakdown, risk_assessment, stress_test_findings]
    prompt: |
      Assemble the final execution package. Incorporate stress test findings.
      Adjust the plan if the Provocateur found real gaps. Produce the final
      deliverable with all sections.
    output: execution_package

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
    prompt: "Does this phasing make sense for your team and timeline?"
    on_rejection: retry_with_feedback
```

### 5.2 Workflow Action Types

The existing workflow schema (Section 5E of the harness spec) defines actions like `read-context`, `ask-questions`, `generate-options`, `write-code`, `run-tests`. The CTO execution workflow introduces action types that operate at the orchestration level:

| Action Type | Behavior | Used In |
|---|---|---|
| `targeted-delegation` | Orchestrator delegates to specific named agents. Agents listed in `agents` field. | Requirements, Architecture, Planning, Tasks, Security, Stress Test |
| `tension-pair` | Invoke a tension pair directly. Two agents in `agents` field challenge each other. | Architecture Review |
| `orchestrator-synthesis` | Orchestrator assembles final output from all prior step outputs. No agent delegation. | Final Assembly |
| `execute-with-tools` | Agent invokes platform tools (code execution, skill invocation, file creation) to produce artifacts. | Future: implementation steps |

The first three are orchestration-level delegation patterns. `execute-with-tools` is the bridge to actual code creation — it requires the adapter execution methods defined in `02-adapter-execution.md`.

### 5.3 Review Gates

Three user-approval gates at critical decision points:

1. **After requirements** (Phase 1) — "Do these requirements capture what you're building?"
2. **After architecture** (Phase 2) — "Does this architecture direction look right?"
3. **After phase planning** (Phase 4) — "Does this phasing make sense for your team?"

Gate behavior: `on_rejection: retry_with_feedback` re-runs the step with the user's feedback injected as additional context. Maximum 3 retries per gate before proceeding with best effort. This is a new gate behavior defined in `01-schema-additions.md`.

### 5.4 Artifact Flow Between Steps

Each step's `output` field names an artifact. Each step's `input` field references prior artifacts by name. The engine loads referenced artifacts and injects them into the agent's context when executing a step.

```
understand ──► requirements_analysis
                    │
design ◄────────────┘──► architecture_decision_record
                              │
challenge ◄───────────────────┘──► revised_architecture
                                        │
plan ◄─────────────────────────────────┘──► phase_plan
                                                │
tasks ◄────────────────────────────────────────┘──► task_breakdown
                                                         │
security-review ◄───────────────────────────────────────┘──► risk_assessment
                                                                  │
stress-test ◄── (all prior artifacts) ───────────────────────────┘──► stress_test_findings
                                                                           │
synthesize ◄── (all artifacts) ────────────────────────────────────────────┘──► execution_package
```

The artifact schema (`aos/artifact/v1`) that defines what these artifacts look like — their metadata, format, storage path, and review status — is specified in `01-schema-additions.md`.

---

## 6. CTO Orchestrator System Prompt

This is the orchestrator persona for the CTO execution profile. It replaces the Arbiter for this profile. Same engine, different orchestrator. The agent definition lives at `core/agents/orchestrators/cto-orchestrator/`.

### 6.1 Agent Config

```yaml
schema: aos/agent/v1
id: cto-orchestrator
name: CTO Orchestrator
role: "Execution leader. Drives the product development lifecycle from feature request to engineering handoff."

cognition:
  objective_function: "Deliver a complete, buildable execution package with minimal ambiguity"
  time_horizon:
    primary: "Current quarter (execution timeline)"
    secondary: "Next 2 quarters (technical debt and migration)"
    peripheral: "1-2 years (architecture durability)"
  core_bias: execution-quality
  risk_tolerance: moderate
  default_stance: "Ship the right thing, correctly scoped, with clear ownership"

persona:
  temperament:
    - technically deep
    - strategically aware
    - execution-focused
    - decisive under ambiguity
  thinking_patterns:
    - "Is this buildable with the team we have?"
    - "What's the smallest scope that delivers the core value?"
    - "Where will this plan fail first?"
    - "What decisions can be deferred vs. must be made now?"
  heuristics:
    - name: Scope Hammer
      rule: "Every feature request is too large until proven otherwise. Break it down."
    - name: Dependency Detector
      rule: "Hidden dependencies are the #1 cause of missed deadlines. Surface them early."
    - name: Build vs. Buy
      rule: "Default to using existing tools and libraries. Build only what's truly custom."
    - name: Reversibility Test
      rule: "Prefer reversible decisions. Irreversible ones need more review."
  evidence_standard:
    convinced_by:
      - Working prototypes or proof-of-concept code
      - Concrete task breakdowns with effort estimates
      - Architecture diagrams with data flow
      - Prior art or reference implementations
    not_convinced_by:
      - Vague scope ("we'll figure it out as we go")
      - Effort estimates without task decomposition
      - Architecture without migration strategy
  red_lines:
    - Never ship without a security review
    - Never commit to a timeline without a task breakdown
    - Never skip the stress test phase

tensions:
  - agent: provocateur
    dynamic: "CTO wants to ship; Provocateur wants to find why the plan will fail"
  - agent: architect
    dynamic: "CTO wants pragmatic; Architect wants durable"

report:
  structure: "Execution package with all sections. See workflow output template."

tools: null
skills: []
expertise:
  - path: expertise/cto-orchestrator-notes.md
    mode: read-write
    use_when: "Track decisions made at each phase, open questions, cross-cutting concerns, evolving risk assessment"

model:
  tier: premium
  thinking: on
```

### 6.2 System Prompt

```markdown
# CTO Orchestrator — System Prompt

You are the CTO Orchestrator for this execution session. Your job is to take a
feature request or product vision and drive it through a complete product
development lifecycle, producing a ready-for-engineering execution package.

## Your Role

You are NOT a deliberation facilitator. You are an execution leader. You:
- Analyze the input to understand what needs to be built
- Delegate specific production work to specialized agents
- Review their output for quality and completeness
- Drive the process forward through sequential phases
- Assemble the final deliverable

You think like a CTO: technically deep, strategically aware, execution-focused.
You care about buildability, team capacity, technical debt, and shipping on time.

## Your Team

You have these agents available. Each produces actual work products, not opinions:

{{participants}}

Each agent has a cognitive bias that shapes HOW they work:
- **Advocate** produces user stories and acceptance criteria. Biased toward user needs.
- **Strategist** produces phase plans and sequencing. Biased toward impact per effort.
- **Architect** produces architecture decision records and system designs. Biased toward system durability.
- **Operator** produces task breakdowns and effort estimates. Biased toward execution reality.
- **Sentinel** produces security and risk assessments. Biased toward compliance and safety.
- **Provocateur** stress-tests the full plan. Biased toward finding what everyone missed. Always speaks last.

## Execution Protocol

You follow a defined workflow. Each phase feeds the next:

### Phase 1: Requirements Analysis
Delegate to Advocate + Strategist. Get user stories and problem framing.
Present to the user for approval before proceeding.

### Phase 2: Architecture & Design
Delegate to Architect. Get an architecture decision record with diagrams.
Present to the user for approval before proceeding.

### Phase 3: Architecture Review (Tension Pair)
Delegate to Architect + Operator together. Let them challenge each other.
The Operator grounds the architecture in buildability.

### Phase 4: Phase Planning
Delegate to Strategist + Operator. Get a phased execution plan.
Present to the user for approval before proceeding.

### Phase 5: Task Breakdown
Delegate to Operator. Get concrete tasks with estimates and dependencies.

### Phase 6: Security & Risk Review
Delegate to Sentinel. Get a risk assessment with remediation recommendations.

### Phase 7: Stress Test
Delegate to Provocateur (speaks last, sees everything). Get a challenge report.

### Phase 8: Final Assembly
You synthesize all outputs into the execution package. Incorporate stress test
findings. Adjust the plan where gaps were found.

## Constraint Awareness

{{constraints}}

After every delegation round you receive a Constraint Status block. Act on it:
- If `can_end` is false: you MUST continue through the workflow
- If `approaching_any_maximum` is true: compress remaining phases
- If `hit_maximum` is true: produce the best execution package you can with
  what you have. Call `end()` immediately.
- If `bias_blocked` is true: you have been leaning too heavily on certain agents.
  Bring in the neglected ones.

## Delegation Syntax

- `delegate(["advocate", "strategist"], "message")` — targeted multi-agent
- `delegate(["architect"], "message")` — targeted single agent
- `delegate("tension", "architect", "operator", "message")` — tension pair
- `end("closing message")` — collect final statements and close

## Review Gates

At three points in the workflow, you MUST present work to the user for approval:
1. After requirements analysis (Phase 1)
2. After architecture design (Phase 2)
3. After phase planning (Phase 4)

When presenting for review, summarize what was produced and ask:
"Does this direction look right? Any corrections or constraints I'm missing?"

If the user rejects, incorporate their feedback and re-run the phase.
Maximum 3 retries per gate before proceeding with best effort.

## Output Format

Your final execution package goes to: {{output_path}}

Structure:
1. **Executive Summary** — One paragraph: what we're building, why, and the
   high-level approach.
2. **Requirements Analysis** — User stories, acceptance criteria, problem framing.
3. **Architecture Decision Record** — System design, technology choices, diagrams,
   migration strategy.
4. **Phase Plan** — Sequenced phases with milestones, dependencies, and timeline.
5. **Task Breakdown** — Per-phase tasks with effort estimates, assignee roles,
   acceptance criteria, and dependency graph.
6. **Risk Assessment** — Security, reliability, compliance risks with
   severity ratings and mitigation tasks.
7. **Stress Test Findings** — Provocateur's challenges and your response to each.
8. **Implementation Checklist** — Ordered list of everything needed before
   engineering starts (environment setup, access provisioning, design reviews,
   documentation).

## Expertise

{{expertise_block}}

Use your scratch pad to track:
- Decisions made at each phase (so you don't revisit settled questions)
- Open questions that need user input
- Cross-cutting concerns that affect multiple phases
- Your evolving assessment of project risk

## Brief

{{brief}}
```

---

## 7. Execution Package Output Template

The `execution-package` output format is a new entry in the output format registry (alongside `memo`, `report`, `checklist`, `freeform`). This section defines the default section structure and frontmatter for this format.

Individual artifacts produced during the workflow (requirements analysis, architecture decision record, etc.) are defined by the `aos/artifact/v1` schema in `01-schema-additions.md`. This output template references those artifacts as sections in the final assembled document.

### 7.1 Template

```markdown
---
schema: aos/output/v1
date: {{date}}
session_id: {{session_id}}
duration_minutes: ...
profile: cto-execution
domain: {{domain_id}}
participants: [...]
brief_path: ...
transcript_path: ...
workflow: cto-execution-workflow
phases_completed: [understand, design, challenge, plan, tasks, security-review, stress-test]
gates_passed: [understand, design, plan]
---

# Execution Package: {{brief_title}}

## Executive Summary
[CTO Orchestrator's synthesis: what, why, how, timeline]

## 1. Requirements Analysis

### User Stories
[From Advocate — artifact: requirements_analysis]

### Problem Framing & Roadmap Fit
[From Strategist — artifact: requirements_analysis]

## 2. Architecture Decision Record

### System Design
[From Architect — artifact: architecture_decision_record]

### Component Diagram
[Mermaid diagram — artifact: mermaid_diagram]

### Technology Choices
| Choice | Alternatives Considered | Rationale |
|---|---|---|

### Migration Strategy
[If modifying existing systems]

### Buildability Review
[From Operator — artifact: revised_architecture]

## 3. Phase Plan

### Phase Overview
| Phase | Milestone | Duration | Dependencies | Risk Level |
|---|---|---|---|---|

### Phase Details
[From Strategist + Operator — artifact: phase_plan]

## 4. Task Breakdown

### Phase 1 Tasks
| Task | Description | Effort | Role | Dependencies | Acceptance Criteria |
|---|---|---|---|---|---|

[Repeat per phase]

### Dependency Graph
[Mermaid diagram or structured list — artifact: task_list]

## 5. Risk Assessment
[From Sentinel — artifact: risk_assessment]

| Risk | Severity | Likelihood | Mitigation | Added Task? |
|---|---|---|---|---|

## 6. Stress Test Findings
[From Provocateur — artifact: stress_test_findings]

| Challenge | CTO Response | Plan Adjusted? |
|---|---|---|

## 7. Implementation Checklist
- [ ] Environment setup
- [ ] Access provisioning
- [ ] Design review scheduled
- [ ] Documentation updated
- [ ] Security review sign-off
- [ ] ...
```

### 7.2 Frontmatter Extensions

The `execution-package` format adds these frontmatter fields beyond the standard `aos/output/v1`:

| Field | Type | Description |
|---|---|---|
| `workflow` | string | ID of the workflow that produced this output |
| `phases_completed` | string[] | Workflow step IDs that completed successfully |
| `gates_passed` | string[] | Review gate IDs that received user approval |

---

## 8. The Delegation Chain Vision

> **Status: Architectural direction only.** This section describes the target state for Phase 3+ of the harness. Nothing in this section should be built against or treated as a specification. It exists to ensure that nothing built in the current phase precludes this future direction.

### Nested Orchestration

The executive delegation pattern naturally extends to hierarchical delegation, where one profile invokes another as a sub-orchestration:

```
CEO Delivery Profile
  └── "Build feature X for Q3"
       ├── CTO Execution Profile
       │    ├── Requirements (Advocate, Strategist)
       │    ├── Architecture (Architect)
       │    ├── Task Breakdown (Operator)
       │    ├── Security Review (Sentinel)
       │    └── Execution Package output
       │
       └── CIO Operations Profile
            ├── Infrastructure Assessment
            ├── Compliance Check (Steward)
            └── Operational Readiness output
```

### Profile-as-Step Action Type

A workflow step could reference another profile as its action:

```yaml
# Illustrative only — not specced for implementation
steps:
  - id: technical-execution
    action: delegate-to-profile
    profile: cto-execution
    input: [strategic_brief]
    output: execution_package
    review_gate: true
```

This turns AOS from a single-layer orchestration system into a hierarchical delegation framework. Each level maintains its own constraint tracking, transcript, and output. The parent profile receives the child profile's output as an artifact.

### Design Constraints for Current Work

To avoid precluding nested orchestration:

1. **Artifacts must be self-contained.** An execution package should be understandable without access to the session that produced it. This enables a parent profile to consume a child profile's output without needing its transcript.
2. **Constraint tracking must be session-scoped.** Each orchestration session tracks its own time, budget, and rounds independently. A parent session's constraints do not leak into child sessions.
3. **The `workflow` field on profiles is optional.** Deliberation profiles that don't need workflows should continue to work without one. The workflow engine is invoked only when the profile references a workflow.

---

## Appendix A: Multiple Orchestrators

The current spec assumes a single orchestrator type (Arbiter). Execution profiles require custom orchestrators. The profile's `assembly.orchestrator` field already supports this — it accepts any agent ID, not just `arbiter`.

Custom orchestrators live alongside the Arbiter:

```
core/agents/orchestrators/
├── arbiter/
│   ├── agent.yaml
│   └── prompt.md
└── cto-orchestrator/
    ├── agent.yaml
    └── prompt.md
```

No schema change is needed. This is a documentation note: orchestrators are not limited to the Arbiter, and the directory structure supports multiple orchestrator personas.

---

## Appendix B: New Template Variables

This spec introduces one new template variable:

| Variable | Available In | Description |
|---|---|---|
| `{{role_override}}` | Agent prompts | Profile-level instruction override. Contains the `role_override` string from the agent's entry in the profile's `assembly.perspectives[]`. Empty string if not set. |

The full template variable reference remains in the harness spec (Section 6.13). This variable is added to that table.
