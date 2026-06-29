# Layer 1: Schema Additions

**Date:** 2026-03-24
**Status:** Draft
**Detail Level:** Implementation-ready
**Part of:** [AOS Execution Profiles Spec Suite](./00-overview.md)

---

## 1. Summary of Changes

This document specifies all schema and runtime changes required to support execution profiles. Every change is backwards-compatible — existing deliberation profiles continue to work without modification.

| Change | Schema | Type | Breaking? |
|---|---|---|---|
| `role_override` field | `aos/profile/v1` | New optional field in `assembly.perspectives[]` | No |
| `capabilities` field | `aos/agent/v1` | New optional field at agent root | No |
| `workflow` field | `aos/profile/v1` | New optional field at profile root | No |
| `aos/artifact/v1` | New schema | New schema for inter-step artifacts | No |
| Workflow action types | `aos/workflow/v1` | New enum values for `action` field | No |
| Step-level `agents` | `aos/workflow/v1` | New optional field on workflow steps | No |
| Step-level `structural_advantage` | `aos/workflow/v1` | New optional field on workflow steps | No |
| Step-level `prompt` | `aos/workflow/v1` | New optional field on workflow steps | No |
| Gate `on_rejection` behavior | `aos/workflow/v1` | New enum value `retry_with_feedback` | No |
| `execution-package` output format | `aos/profile/v1` | New enum value for `output.format` | No |
| `{{role_override}}` template variable | Template resolver | New variable | No |

All changes follow the schema versioning policy (Section 6E of the harness spec): new optional fields are backwards-compatible additions within the same version.

---

## 2. Profile Schema Additions

### 2.1 `role_override` in `assembly.perspectives[]`

**Location:** `aos/profile/v1` → `assembly.perspectives[]`

```yaml
assembly:
  perspectives:
    - agent: architect
      required: true
      structural_advantage: null         # Existing field
      role_override: "Custom instruction" # NEW — optional, default null
```

**Schema definition:**

```jsonschema
{
  "role_override": {
    "type": ["string", "null"],
    "default": null,
    "description": "Profile-level instruction that overrides the agent's default output mode. Injected into the agent's system prompt via the {{role_override}} template variable. When set, the agent retains its cognitive framework (bias, heuristics, evidence standards, tensions) but changes what it produces."
  }
}
```

**Behavior:**
- When `null` or omitted: The agent operates in its default advisory mode. The `{{role_override}}` template variable resolves to an empty string.
- When set: The string is injected into the agent's system prompt after the base persona. The `{{role_override}}` variable resolves to the override string.
- The override does NOT replace the agent's `report.structure`. It augments the agent's instructions. If both are present, `role_override` takes precedence for output format, while `report.structure` provides fallback guidance.

**Template resolution example:**

Agent prompt.md contains:
```markdown
# {{agent_name}} — System Prompt

You are the {{agent_name}}...

{{role_override}}
```

With `role_override: "Produce architecture decision records and system design docs"`, this resolves to:
```markdown
# Architect — System Prompt

You are the Architect...

Produce architecture decision records and system design docs
```

Without `role_override`, the `{{role_override}}` line resolves to an empty string (no blank line injected — template resolver strips the line if the variable resolves to empty).

**Runtime change:** `template-resolver.ts` must handle empty-string variables by stripping the containing line if the line contains only the variable placeholder and whitespace. This prevents blank lines in prompts when `role_override` is not set.

### 2.2 `workflow` Field

**Location:** `aos/profile/v1` root

```yaml
schema: aos/profile/v1
id: cto-execution
# ...
workflow: cto-execution-workflow          # NEW — optional, default null
```

**Schema definition:**

```jsonschema
{
  "workflow": {
    "type": ["string", "null"],
    "default": null,
    "description": "Reference to a workflow ID (aos/workflow/v1). When set, the engine drives the session through the workflow's steps instead of free-form orchestrator delegation. When null, the session operates in deliberation mode (orchestrator has full control over delegation)."
  }
}
```

**Behavior:**
- When `null` or omitted: Session operates in deliberation mode. The orchestrator (Arbiter) has full control over when and how to delegate. This is the existing behavior.
- When set: The engine's `WorkflowRunner` drives the session through the referenced workflow's steps. The orchestrator still controls delegation within each step, but the step sequence and review gates are enforced by the engine.

**Validation:** `config-loader.ts` validates that the referenced workflow ID exists and can be loaded. If the workflow file is missing, validation fails with: `Profile "cto-execution" references workflow "cto-execution-workflow" but no workflow with that ID was found.`

### 2.3 `execution-package` Output Format

**Location:** `aos/profile/v1` → `output.format`

```yaml
output:
  format: memo | report | checklist | execution-package | freeform
```

**Schema update:** Add `execution-package` to the enum.

**Default sections for `execution-package`:**

When a profile declares `format: execution-package` without specifying `sections`, the following default section list is used:

```yaml
sections:
  - executive_summary
  - requirements_analysis
  - architecture_decision_record
  - phase_plan
  - task_breakdown
  - risk_assessment
  - stress_test_findings
  - implementation_checklist
```

Profiles may override this by specifying their own `sections` list. The default exists so that simple execution profiles don't need to enumerate every section.

**Frontmatter extensions:** The `execution-package` format adds optional frontmatter fields:

| Field | Type | Description |
|---|---|---|
| `workflow` | string | ID of the workflow that produced this output |
| `phases_completed` | string[] | Workflow step IDs that completed successfully |
| `gates_passed` | string[] | Review gate IDs that received user approval |

These are populated by the engine when writing the output. They are informational — the harness does not read them back.

---

## 3. Agent Schema Additions

### 3.1 `capabilities` Field

**Location:** `aos/agent/v1` root

```yaml
schema: aos/agent/v1
id: architect
# ...existing fields...

capabilities:                            # NEW — optional
  can_execute_code: false
  can_produce_files: false
  can_review_artifacts: true
  available_skills: []
  output_types: [text, markdown]
```

**Schema definition:**

```jsonschema
{
  "capabilities": {
    "type": "object",
    "description": "Declares what this agent can do beyond responding with text. Used by the engine and orchestrator to validate delegation targets and match agents to workflow steps.",
    "properties": {
      "can_execute_code": {
        "type": "boolean",
        "default": false,
        "description": "Can this agent run code via platform tools (executeCode adapter method)?"
      },
      "can_produce_files": {
        "type": "boolean",
        "default": false,
        "description": "Can this agent create or modify files via platform tools (createArtifact adapter method)?"
      },
      "can_review_artifacts": {
        "type": "boolean",
        "default": true,
        "description": "Can this agent review another agent's output and provide structured feedback?"
      },
      "available_skills": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Skill IDs this agent can invoke via the invokeSkill adapter method. Empty array means no skills available."
      },
      "output_types": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["text", "markdown", "code", "diagram", "structured-data"]
        },
        "default": ["text", "markdown"],
        "description": "What artifact formats this agent can produce."
      }
    },
    "additionalProperties": false
  }
}
```

**Default behavior:** When `capabilities` is omitted, the agent is assumed to have the default capabilities:

```yaml
capabilities:
  can_execute_code: false
  can_produce_files: false
  can_review_artifacts: true
  available_skills: []
  output_types: [text, markdown]
```

This matches the behavior of all existing agents (advisory mode, text/markdown output only).

**Usage by the engine:**
1. **Delegation validation:** When the orchestrator delegates a task that requires code execution to an agent without `can_execute_code: true`, the engine logs a warning but does not block the delegation. The agent may still attempt the task via its platform tools — the capability declaration is advisory, not enforcement.
2. **Workflow step matching:** When a workflow step declares `action: execute-with-tools`, the engine can validate that the delegated agents have the required capabilities. If no agent in the step's `agents` list has `can_execute_code: true`, the engine emits a warning.
3. **Orchestrator context:** The CTO orchestrator (or any orchestrator) can use capability declarations to make delegation decisions. The `{{participants}}` template variable can optionally include capability summaries.

**Why advisory, not enforcement:** Capabilities are a planning tool, not a sandbox. An agent with `can_execute_code: false` might still receive code in its context and reason about it — it just won't invoke `executeCode()`. The adapter's tool whitelist (Section 6.14 of the harness spec) remains the enforcement mechanism.

### 3.2 Capability Profiles for Existing Agents

Recommended `capabilities` for the existing 12 agents when used in execution profiles. These are suggestions for the agent YAML files, not enforced defaults:

| Agent | can_execute_code | can_produce_files | can_review_artifacts | output_types |
|---|---|---|---|---|
| Arbiter | false | true | true | text, markdown |
| CTO Orchestrator | false | true | true | text, markdown, structured-data |
| Catalyst | false | false | true | text, markdown |
| Sentinel | false | false | true | text, markdown |
| Architect | false | true | true | text, markdown, diagram |
| Provocateur | false | false | true | text, markdown |
| Navigator | false | false | true | text, markdown |
| Advocate | false | false | true | text, markdown |
| Pathfinder | false | false | true | text, markdown |
| Strategist | false | true | true | text, markdown, structured-data |
| Operator | false | true | true | text, markdown, structured-data |
| Steward | false | false | true | text, markdown |
| Auditor | false | false | true | text, markdown |

Future execution-oriented agents (e.g., a "Developer" agent or "Reviewer" agent) would have `can_execute_code: true` and `available_skills` populated.

---

## 4. Artifact Schema

### 4.1 Schema: `aos/artifact/v1`

Artifacts are the work products that agents produce during workflow execution. They are the mechanism by which one workflow step's output becomes the next step's input.

```yaml
schema: aos/artifact/v1
id: requirements_analysis                # Matches the workflow step's output field
produced_by: [advocate, strategist]      # Which agents contributed to this artifact
step_id: understand                      # Which workflow step produced it
format: markdown                         # markdown | code | structured-data | diagram
content_path: "{{deliberation_dir}}/artifacts/requirements_analysis.md"
metadata:
  produced_at: "2026-03-24T14:30:00Z"   # ISO 8601 timestamp
  review_status: approved                # pending | approved | rejected | revised
  review_gate: understand                # Which gate reviewed this (null if no gate)
  word_count: 1250
  revision: 1                            # Incremented on retry_with_feedback
```

**Schema definition:**

```jsonschema
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AOS Artifact",
  "type": "object",
  "required": ["schema", "id", "produced_by", "step_id", "format", "content_path"],
  "properties": {
    "schema": {
      "type": "string",
      "const": "aos/artifact/v1"
    },
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]*$",
      "description": "Artifact identifier. Must match the workflow step's output field value."
    },
    "produced_by": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "Agent IDs that contributed to this artifact."
    },
    "step_id": {
      "type": "string",
      "description": "The workflow step ID that produced this artifact."
    },
    "format": {
      "type": "string",
      "enum": ["markdown", "code", "structured-data", "diagram"],
      "description": "The artifact's content format."
    },
    "content_path": {
      "type": "string",
      "description": "Path to the artifact's content file, relative to the session directory. Supports {{deliberation_dir}} template variable."
    },
    "metadata": {
      "type": "object",
      "properties": {
        "produced_at": {
          "type": "string",
          "format": "date-time"
        },
        "review_status": {
          "type": "string",
          "enum": ["pending", "approved", "rejected", "revised"],
          "default": "pending"
        },
        "review_gate": {
          "type": ["string", "null"],
          "default": null,
          "description": "The gate ID that reviewed this artifact. Null if no review gate."
        },
        "word_count": {
          "type": "integer",
          "minimum": 0
        },
        "revision": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Revision number. Incremented each time the step is re-run via retry_with_feedback."
        }
      },
      "additionalProperties": true
    }
  }
}
```

### 4.2 Artifact Lifecycle

```
Step executes
  │
  ├─► Agent(s) produce output
  ├─► Engine captures response as artifact content
  ├─► Engine writes content to content_path
  ├─► Engine writes artifact manifest (YAML) to {{deliberation_dir}}/artifacts/{{id}}.artifact.yaml
  ├─► Artifact metadata: review_status = "pending", revision = 1
  │
  ├─► If step has review_gate: true
  │   ├─► Gate prompt presented to user
  │   ├─► User approves → review_status = "approved"
  │   └─► User rejects → review_status = "rejected"
  │       ├─► Step re-runs with user feedback
  │       ├─► New content written to content_path (overwrites)
  │       ├─► revision incremented
  │       └─► review_status = "revised" (then "pending" for re-review)
  │
  └─► Next step references artifact via input field
      └─► Engine loads content_path and injects into agent context
```

### 4.3 Review Status State Machine

The `review_status` field transitions through these states:

```
pending ──(gate: approved)──► approved
pending ──(gate: rejected)──► rejected ──(step re-runs)──► revised ──(re-review)──► pending
```

**Mapping from `ReviewResult.status` (Layer 2, see `02-adapter-execution.md` Section 2.2 for the type definition) to `artifact.review_status`:**

| `ReviewResult.status` | Artifact `review_status` | Next Action |
|---|---|---|
| `approved` | `approved` | Continue to next step |
| `rejected` | `rejected` | Trigger revision loop |
| `needs-revision` | `rejected` | Trigger revision loop (same as rejected) |

After a revision loop produces new content, the artifact transitions: `rejected` → `revised` (content updated) → `pending` (awaiting re-review). The `revision` counter increments on each cycle.

### 4.4 Artifact Storage Layout

```
{{deliberation_dir}}/
├── artifacts/
│   ├── requirements_analysis.md                    # Content file
│   ├── requirements_analysis.artifact.yaml         # Manifest
│   ├── architecture_decision_record.md
│   ├── architecture_decision_record.artifact.yaml
│   ├── revised_architecture.md
│   ├── revised_architecture.artifact.yaml
│   ├── phase_plan.md
│   ├── phase_plan.artifact.yaml
│   ├── task_breakdown.md
│   ├── task_breakdown.artifact.yaml
│   ├── risk_assessment.md
│   ├── risk_assessment.artifact.yaml
│   ├── stress_test_findings.md
│   ├── stress_test_findings.artifact.yaml
│   └── execution_package.md                        # Final assembled output
├── transcript.jsonl
└── expertise/
    └── {{agent_id}}-notes.md
```

### 4.5 Artifact Injection into Agent Context

When a workflow step declares `input: [requirements_analysis, revised_architecture]`, the engine:

1. Loads each referenced artifact's manifest from `artifacts/{{id}}.artifact.yaml`
2. Reads the content file at `content_path`
3. Injects the content into the agent's context via `adapter.injectContext()`, wrapped with metadata headers:

```markdown
---
## Artifact: requirements_analysis
Produced by: advocate, strategist
Step: understand
Review status: approved
Revision: 1
---

[artifact content here]
```

This ensures agents receiving prior artifacts know their provenance and review status.

---

## 5. Workflow Schema Additions

### 5.1 New Action Types

**Location:** `aos/workflow/v1` → `steps[].action`

Add to the action enum:

| Action | Description | Required Step Fields |
|---|---|---|
| `targeted-delegation` | Orchestrator delegates to specific named agents. | `agents`, `prompt` |
| `tension-pair` | Invoke a tension pair. Two agents challenge each other. | `agents` (exactly 2), `prompt` |
| `orchestrator-synthesis` | Orchestrator assembles output from prior artifacts. No agent delegation. | `input`, `prompt` |
| `execute-with-tools` | Agent invokes platform tools to produce artifacts. Requires adapter execution methods (Layer 2). | `agents`, `prompt`, requires agent `capabilities.can_execute_code` or `capabilities.can_produce_files` |

**Relationship to existing actions:** The existing actions (`read-context`, `ask-questions`, `generate-options`, `present-sections`, `write-spec`, `write-code`, `run-tests`, `self-review`, `commit-changes`, `advance`) remain valid. The new actions operate at the orchestration level — they describe how the orchestrator delegates, not what the agent does internally.

An execution profile workflow can mix both types:
```yaml
steps:
  - id: understand
    action: targeted-delegation          # Orchestration-level
    agents: [advocate, strategist]
    # ...
  - id: implement
    action: execute-with-tools           # Orchestration-level, triggers tool use
    agents: [developer]
    # ...
  - id: test
    action: run-tests                    # Agent-level (existing)
    # ...
```

### 5.2 Step-Level `agents` Field

**Location:** `aos/workflow/v1` → `steps[]`

```yaml
steps:
  - id: understand
    action: targeted-delegation
    agents: [advocate, strategist]       # NEW — required for delegation actions
    prompt: "..."
    output: requirements_analysis
```

**Schema definition:**

```jsonschema
{
  "agents": {
    "type": "array",
    "items": { "type": "string" },
    "description": "Agent IDs to delegate this step to. Required for targeted-delegation, tension-pair, and execute-with-tools actions. For tension-pair, must contain exactly 2 agents."
  }
}
```

**Validation rules:**
- Required when `action` is `targeted-delegation`, `tension-pair`, or `execute-with-tools`
- Must not be present when `action` is `orchestrator-synthesis`
- For `tension-pair`: must contain exactly 2 agent IDs
- All referenced agent IDs must be present in the profile's `assembly.perspectives[]`
- `config-loader.ts` validates these constraints during profile+workflow loading

### 5.3 Step-Level `structural_advantage`

**Location:** `aos/workflow/v1` → `steps[]`

```yaml
steps:
  - id: stress-test
    action: targeted-delegation
    agents: [provocateur]
    structural_advantage: speaks-last    # NEW — optional, per-step override
    prompt: "..."
```

**Schema definition:**

```jsonschema
{
  "structural_advantage": {
    "type": ["string", "null"],
    "enum": ["speaks-last", null],
    "default": null,
    "description": "Structural advantage for this step. Overrides the agent's profile-level structural_advantage for this step only. When set to speaks-last, the engine ensures this step's agents receive all prior step outputs before executing."
  }
}
```

**Behavior:** When set on a step, the structural advantage applies to the execution of that specific step, independent of the agent's profile-level `structural_advantage`. This allows the Provocateur to speak last in the stress-test step even if it doesn't have `speaks-last` at the profile level (or vice versa).

### 5.4 Step-Level `prompt`

**Location:** `aos/workflow/v1` → `steps[]`

```yaml
steps:
  - id: design
    action: targeted-delegation
    agents: [architect]
    prompt: |                            # NEW — the delegation message
      Based on the requirements analysis, produce an architecture
      decision record...
    output: architecture_decision_record
```

**Schema definition:**

```jsonschema
{
  "prompt": {
    "type": "string",
    "description": "The delegation message sent to the agent(s) for this step. Supports template variables. For orchestrator-synthesis, this is the instruction to the orchestrator."
  }
}
```

**Template resolution:** The `prompt` field supports all standard template variables (Section 6.13 of the harness spec) plus `{{role_override}}`. Artifact content from `input` references is injected separately via `adapter.injectContext()`, not inlined into the prompt.

### 5.5 Gate `on_rejection` Behavior

**Location:** `aos/workflow/v1` → `gates[]`

Add `retry_with_feedback` to the `on_rejection` enum:

```yaml
gates:
  - after: understand
    type: user-approval
    prompt: "Do these requirements capture what you're building?"
    on_rejection: retry_with_feedback    # NEW value
```

**Complete enum (this spec defines the full enum, as the main framework spec does not formally define it):**
- `re-run-step` — Re-runs the step from scratch. Used in existing workflows (e.g., `execute.workflow.yaml`).
- `retry_with_feedback` — Re-runs the step with the user's rejection feedback injected as additional context. New in this spec.

**`retry_with_feedback` behavior:** The engine:
  1. Prompts the user for feedback text via `adapter.promptInput("What needs to change?")`
  2. Appends the feedback to the step's `prompt` as a clearly delimited section:
     ```
     ---
     ## User Feedback (Revision {{revision}})
     {{user_feedback}}
     ---
     ```
  3. Re-runs the step with the augmented prompt
  4. Increments the artifact's `revision` counter
  5. Maximum 3 retries per gate. After 3 rejections, the engine proceeds with the current artifact marked `review_status: "rejected"` and logs a `constraint_warning` event.

**Schema update:**

```jsonschema
{
  "on_rejection": {
    "type": "string",
    "enum": ["re-run-step", "retry_with_feedback"],
    "default": "re-run-step",
    "description": "What to do when the user rejects at this gate."
  }
}
```

---

## 6. Template Variable Addition

### 6.1 `{{role_override}}`

**Location:** Template variable reference (Section 6.13 of the harness spec)

| Variable | Available In | Description |
|---|---|---|
| `{{role_override}}` | Agent prompts | Profile-level instruction override from `assembly.perspectives[].role_override`. Empty string if not set. |

**Resolution behavior in `template-resolver.ts`:**

```typescript
// Current behavior: unknown variables left as-is
// New behavior for {{role_override}} specifically:
// - If role_override is null/undefined → resolve to empty string
// - If the line contains ONLY {{role_override}} (plus whitespace) and it resolves
//   to empty string → strip the entire line from output
// - If the line contains other content alongside {{role_override}} → replace
//   {{role_override}} with empty string, keep the line
```

This prevents blank lines in agent prompts when `role_override` is not set, which is the common case for deliberation profiles.

**Implementation note:** This is a targeted change to `template-resolver.ts`. The general behavior (unknown variables left as-is) does not change. Only `role_override` (and potentially future optional variables) gets the empty-string-strips-line treatment. Consider generalizing this to all variables that resolve to empty string, but that is a separate concern and should be evaluated for backwards compatibility.

---

## 7. Transcript Event Additions

### 7.1 New Event Types

Execution profiles introduce these new transcript events:

| Event Type | When Emitted | Required Fields |
|---|---|---|
| `workflow_start` | Workflow execution begins | workflow_id, steps (list of step IDs) |
| `step_start` | A workflow step begins | step_id, action, agents (optional — absent for `orchestrator-synthesis`) |
| `step_end` | A workflow step completes | step_id, artifact_id, duration_seconds |
| `gate_prompt` | Review gate presented to user | gate_id, after_step, prompt |
| `gate_result` | User responds to review gate | gate_id, result (approved/rejected), feedback? |
| `artifact_write` | Artifact written to disk | artifact_id, content_path, format, revision |
| `workflow_end` | Workflow execution completes | workflow_id, steps_completed, gates_passed |

These supplement the existing 15 transcript event types (Section 6.10 of the harness spec). Existing events (`delegation`, `response`, `constraint_check`, etc.) continue to be emitted within workflow steps.

### 7.2 Transcript Event Sequence for a Workflow Step

```jsonl
{"type":"workflow_start","workflow_id":"cto-execution-workflow","steps":["understand","design","challenge","plan","tasks","security-review","stress-test","synthesize"],"timestamp":"..."}
{"type":"step_start","step_id":"understand","action":"targeted-delegation","agents":["advocate","strategist"],"timestamp":"..."}
{"type":"delegation","from":"cto-orchestrator","to":["advocate","strategist"],"message":"...","round":1,"timestamp":"..."}
{"type":"response","from":"advocate","message":"...","tokens_in":1200,"tokens_out":2400,"cost":0.00,"timestamp":"..."}
{"type":"response","from":"strategist","message":"...","tokens_in":1400,"tokens_out":1800,"cost":0.00,"timestamp":"..."}
{"type":"artifact_write","artifact_id":"requirements_analysis","content_path":"artifacts/requirements_analysis.md","format":"markdown","revision":1,"timestamp":"..."}
{"type":"step_end","step_id":"understand","artifact_id":"requirements_analysis","duration_seconds":45,"timestamp":"..."}
{"type":"gate_prompt","gate_id":"understand","after_step":"understand","prompt":"Do these requirements capture what you're building?","timestamp":"..."}
{"type":"gate_result","gate_id":"understand","result":"approved","timestamp":"..."}
{"type":"step_start","step_id":"design","action":"targeted-delegation","agents":["architect"],"timestamp":"..."}
...
```

---

## 8. Runtime Changes

### 8.1 `config-loader.ts`

**New validations:**

1. **Profile → workflow reference:** If `profile.workflow` is set, validate the workflow file exists and loads successfully.
2. **Workflow → agent cross-reference:** For each workflow step with an `agents` field, validate all listed agent IDs appear in the profile's `assembly.perspectives[]`.
3. **Tension-pair step validation:** Steps with `action: tension-pair` must have exactly 2 agents in the `agents` field.
4. **Orchestrator-synthesis step validation:** Steps with `action: orchestrator-synthesis` must not have an `agents` field.
5. **Artifact ID uniqueness:** All `output` values across workflow steps must be unique within the workflow.
6. **Artifact reference validation:** All IDs in step `input` arrays must reference an `output` value from a prior step (no forward references, no missing references). Note: `input` references artifact IDs (the `output` field values), not step IDs. Existing workflows that reference step IDs (e.g., `input: [read-plan]` in `execute.workflow.yaml`) should be updated to reference output values instead (e.g., `input: [current-task]`). Both forms are accepted during a transition period: the engine first tries to resolve as an output ID, then falls back to looking up the step's output by step ID.
7. **Gate reference validation:** All `after` values in `gates[]` must reference a step ID with `review_gate: true`.
8. **Capability warnings:** If a step uses `action: execute-with-tools` and no agent in its `agents` list has `capabilities.can_execute_code: true`, emit a warning (not an error).

### 8.2 `template-resolver.ts`

**Changes:**

1. Add `role_override` to the variable resolution map.
2. Implement empty-string line stripping for `role_override` (see Section 6.1).

### 8.3 `workflow-runner.ts`

**Changes:**

1. **Artifact management:** After each step completes, write the artifact manifest and content file.
2. **Artifact injection:** Before each step executes, load all referenced input artifacts and inject via `adapter.injectContext()`.
3. **New action handlers:**
   - `targeted-delegation`: Resolve agents from the step's `agents` field, delegate via `engine.delegateMessage()`.
   - `tension-pair`: Resolve the 2 agents, delegate via `engine.delegateMessage("tension", agent1, agent2, prompt)`.
   - `orchestrator-synthesis`: No delegation — the orchestrator assembles the output directly from input artifacts.
   - `execute-with-tools`: Delegate to agents with execution capability. Requires adapter execution methods (Layer 2).
4. **`retry_with_feedback` gate handler:** Implement the feedback collection and prompt augmentation loop described in Section 5.5.
5. **Transcript events:** Emit `workflow_start`, `step_start`, `step_end`, `gate_prompt`, `gate_result`, `artifact_write`, `workflow_end` events.

### 8.4 `engine.ts`

**Changes:**

1. **Workflow detection:** In `start()`, check if the loaded profile has a `workflow` field. If yes, instantiate `WorkflowRunner` and drive the session through the workflow. If no, use the existing deliberation flow.
2. **Artifact directory creation:** Create `{{deliberation_dir}}/artifacts/` at session start if the profile has a workflow.

### 8.5 `types.ts`

**New types:**

```typescript
// Artifact manifest
interface ArtifactManifest {
  schema: "aos/artifact/v1";
  id: string;
  produced_by: string[];
  step_id: string;
  format: "markdown" | "code" | "structured-data" | "diagram";
  content_path: string;
  metadata: {
    produced_at: string;              // ISO 8601
    review_status: "pending" | "approved" | "rejected" | "revised";
    review_gate: string | null;
    word_count: number;
    revision: number;
    [key: string]: unknown;           // Allow additional metadata
  };
}

// Agent capabilities
interface AgentCapabilities {
  can_execute_code: boolean;
  can_produce_files: boolean;
  can_review_artifacts: boolean;
  available_skills: string[];
  output_types: ("text" | "markdown" | "code" | "diagram" | "structured-data")[];
}

// Extended workflow step (adds new fields to existing WorkflowStep)
interface WorkflowStep {
  id: string;
  name?: string;
  action: string;                     // Expanded enum
  description?: string;
  agents?: string[];                  // NEW
  prompt?: string;                    // NEW
  structural_advantage?: "speaks-last" | null;  // NEW
  input?: string[];
  output?: string;
  review_gate?: boolean;
}

// Extended workflow gate
interface WorkflowGate {
  after: string;
  type: "user-approval" | "automated-review";
  prompt: string;
  on_rejection?: "re-run-step" | "retry_with_feedback";  // Extended enum
  max_iterations?: number;
}

// Workflow transcript events
type WorkflowTranscriptEvent =
  | { type: "workflow_start"; workflow_id: string; steps: string[] }
  | { type: "step_start"; step_id: string; action: string; agents?: string[] }
  | { type: "step_end"; step_id: string; artifact_id?: string; duration_seconds: number }
  | { type: "gate_prompt"; gate_id: string; after_step: string; prompt: string }
  | { type: "gate_result"; gate_id: string; result: "approved" | "rejected"; feedback?: string }
  | { type: "artifact_write"; artifact_id: string; content_path: string; format: string; revision: number }
  | { type: "workflow_end"; workflow_id: string; steps_completed: string[]; gates_passed: string[] };
```

**Update to existing types:**

```typescript
// Add to AgentConfig
interface AgentConfig {
  // ...existing fields...
  capabilities?: AgentCapabilities;    // NEW — optional
}

// Add to ProfileConfig
interface ProfileConfig {
  // ...existing fields...
  workflow?: string | null;            // NEW — optional
}

// Add to perspective entry in ProfileConfig
interface PerspectiveEntry {
  agent: string;
  required: boolean;
  structural_advantage?: "speaks-last" | null;
  role_override?: string | null;       // NEW — optional
}

// Add to TranscriptEventType enum
type TranscriptEventType =
  | /* ...existing 15 types... */
  // Layer 1: Workflow events
  | "workflow_start"
  | "step_start"
  | "step_end"
  | "gate_prompt"
  | "gate_result"
  | "artifact_write"
  | "workflow_end"
  // Layer 2: Execution events (defined in 02-adapter-execution.md)
  | "code_execution"
  | "skill_invocation"
  | "review_submission";
```

---

## 9. JSON Schema File Updates

The following JSON Schema files in `core/schema/` need updates:

### 9.1 `agent.schema.json`

Add the `capabilities` property as defined in Section 3.1.

### 9.2 `profile.schema.json`

1. Add `workflow` property at root level (Section 2.2).
2. Add `role_override` to `assembly.perspectives[]` items (Section 2.1).
3. Add `execution-package` to `output.format` enum (Section 2.3).

### 9.3 New: `artifact.schema.json`

Create `core/schema/artifact.schema.json` with the full schema from Section 4.1.

### 9.4 `workflow.schema.json`

If this file exists, update it. If not, create it with:
1. New action type values in the `action` enum (Section 5.1).
2. New step-level fields: `agents`, `prompt`, `structural_advantage` (Sections 5.2-5.4).
3. New gate `on_rejection` value: `retry_with_feedback` (Section 5.5).

---

## 10. Migration Guide

### For Existing Profiles

No changes required. All additions are optional fields with sensible defaults. Existing profiles (strategic-council, security-review, delivery-ops, architecture-review, incident-response) continue to work unchanged.

### For Existing Agents

No changes required. The `capabilities` field defaults to advisory mode when omitted. Existing agents retain their current behavior.

### For Existing Workflows

No changes required. Existing workflow action types remain valid. New action types are additive.

### For Existing Agent Prompts

Agent `prompt.md` files should be updated to include the `{{role_override}}` placeholder at an appropriate location — typically after the base persona block. Example:

```markdown
# {{agent_name}} — System Prompt

You are the {{agent_name}}. [base persona description]

{{role_override}}

## Your Approach
...
```

This is a non-breaking change: in deliberation profiles (where no `role_override` is set), the variable resolves to an empty string and the line is stripped by the template resolver. Existing behavior is unchanged. The placeholder only activates when an execution profile sets `role_override` in its assembly.

### For Adapter Implementers

Layer 1 changes require no adapter changes. The engine handles artifact management, template resolution, and workflow orchestration internally using existing adapter primitives (`sendMessage`, `dispatchParallel`, `writeFile`, `readFile`, `injectContext`).

Layer 2 adapter execution methods (defined in `02-adapter-execution.md`) are required only for `execute-with-tools` workflow steps. Adapters that don't implement these methods throw `UnsupportedError`, and the engine degrades gracefully — the step fails and is handled by the profile's `error_handling` policy.
