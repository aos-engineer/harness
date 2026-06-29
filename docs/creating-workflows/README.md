# Creating Workflows

Workflows are step-based execution plans that drive deliberation through a defined sequence of agent work, with optional review gates between steps. Where standard profiles let the orchestrator freely direct agents across open rounds of deliberation, workflows impose a concrete structure: each step delegates specific work to specific agents, produces a named artifact, and optionally waits for approval before proceeding.

Workflows are attached to profiles via the `workflow` field. When a profile declares a workflow, the harness switches from free-form orchestration to workflow execution mode, running through the defined steps in order.

## Workflow Structure

Workflow files live under `core/workflows/` and follow the naming convention `<id>.workflow.yaml`:

```
core/workflows/
  my-workflow.workflow.yaml
```

Here is the full schema with inline comments:

```yaml
schema: aos/workflow/v1          # Required. Always this value.
id: my-workflow                  # Required. Kebab-case identifier. Must be unique.
name: My Workflow                # Required. Human-readable display name.
description: >                   # Optional. Describes the workflow's purpose.
  What this workflow does and what it produces.

steps:                           # Required. At least one step.
  - id: step-one                 # Required. Kebab-case. Referenced by gates and input arrays.
    name: Step One               # Optional. Human-readable step name shown in the UI.
    action: targeted-delegation  # Required. The action type. See Step Actions below.
    agents: [agent-id]           # Which agents execute this step (see action types).
    prompt: |                    # The delegation message sent to the agent(s).
      Instructions for what to produce in this step.
    input: []                    # Optional. Artifact IDs from prior steps to pass as context.
    output: artifact_name        # The artifact ID written when this step completes.
    review_gate: true            # Whether this step has a gate (defined in `gates`).
    structural_advantage: null   # Optional. "speaks-last" or null. Overrides profile setting.

gates:                           # Optional. Gate definitions (one per step with review_gate: true).
  - after: step-one              # The step ID this gate follows.
    type: user-approval          # "user-approval" or "automated-review".
    prompt: "Prompt shown to the user or reviewer."
    on_rejection: retry_with_feedback   # "retry_with_feedback" or "re-run-step".
    max_iterations: 3            # Optional. Maximum retry attempts before halting.
```

All field names are lower-case with underscores. The `schema`, `id`, `name`, and `steps` fields are required. Everything else is optional.

## Step Actions

The `action` field on each step determines how the harness dispatches work. There are four action types:

### `targeted-delegation`

Delegates the step's prompt to a specific list of agents. Each listed agent works independently and produces its portion of the output. The harness collects all responses into the named output artifact.

Use this when you know exactly which agent (or small group of agents) should own a particular step. It is the most common action type.

```yaml
action: targeted-delegation
agents: [architect]
```

```yaml
action: targeted-delegation
agents: [strategist, operator]   # Both agents receive the same prompt; both contribute to the output.
```

### `broadcast`

Sends the prompt to all agents in the profile's assembly simultaneously. Every agent responds, and all responses are collected into the output artifact.

Use this when you want broad coverage -- multiple perspectives on the same question before narrowing. Analogous to an opening round of deliberation but within a workflow step.

```yaml
action: broadcast
# No `agents` field needed -- all assembly agents receive the prompt.
```

### `tension-pair`

Assigns the prompt to exactly two agents as a structured adversarial exchange. One agent produces and defends; the other critiques and challenges. The harness facilitates the back-and-forth and captures the result.

Use this when a design or plan needs active challenge before proceeding. The tension is the review -- it serves as an internal quality gate without requiring user approval.

```yaml
action: tension-pair
agents: [architect, operator]    # First agent defends, second agent challenges.
review_gate: false               # The tension itself is the review.
```

### `orchestrator-synthesis`

Instructs the orchestrator (not a perspective agent) to synthesize a final output from all named input artifacts. No `agents` field is needed -- the orchestrator runs synthesis directly.

Use this as the final step of a workflow when you want the orchestrator to integrate the outputs of all prior steps into a coherent deliverable.

```yaml
action: orchestrator-synthesis
input: [artifact-one, artifact-two, artifact-three]
output: final_deliverable
# No `agents` field -- orchestrator handles this directly.
```

## Artifact Flow

Each step declares an `output` field -- a string identifier for the artifact it produces. Subsequent steps can declare that artifact in their `input` array to receive it as context.

```yaml
steps:
  - id: analyze
    action: targeted-delegation
    agents: [strategist]
    prompt: "Analyze the requirements."
    output: requirements_analysis   # <-- produced here

  - id: design
    action: targeted-delegation
    agents: [architect]
    input: [requirements_analysis]  # <-- consumed here
    prompt: "Design a solution based on the requirements analysis."
    output: architecture_decision_record
```

At runtime, the harness resolves each input artifact ID to the file produced by the matching step. Artifacts are stored in the session's artifacts directory alongside the transcript and final output. A step can declare multiple inputs to receive context from several prior steps at once:

```yaml
input: [requirements_analysis, revised_architecture, phase_plan]
```

Artifacts are passed to agents verbatim -- the full content of the prior step's output is included in the delegation prompt. There is no summarization or truncation unless the model's context limit is reached.

## Review Gates

A review gate pauses execution after a step completes and waits for approval before the workflow proceeds. Gates are defined in the top-level `gates` array and linked to steps via the `after` field.

A step must have `review_gate: true` for a gate to apply. If a step has `review_gate: false` (or omits the field), the workflow proceeds immediately to the next step without pausing.

### Gate Types

**`user-approval`** -- Surfaces the completed artifact to the user and asks the gate's prompt. The user either approves (workflow continues) or rejects with feedback.

```yaml
- after: design
  type: user-approval
  prompt: "Does this architecture direction look right? Any constraints I missed?"
  on_rejection: retry_with_feedback
```

**`automated-review`** -- Triggers an automated check (e.g., a validation agent or a schema check) instead of waiting for human input. The automated reviewer either passes the artifact or returns a rejection.

```yaml
- after: validate
  type: automated-review
  prompt: "Validate the output against the quality checklist."
  on_rejection: re-run-step
```

### Rejection Behavior

The `on_rejection` field controls what happens when a gate is not approved:

**`retry_with_feedback`** -- The user's or reviewer's feedback is appended to the step's original prompt, and the step re-runs with that context. The same agents re-execute with access to both the original instructions and the rejection notes. This is the right choice when the agent needs to revise its output based on specific feedback.

**`re-run-step`** -- The step re-runs from scratch with the original prompt, without appending feedback. Use this for automated gates where the rejection is binary (pass/fail) and there is no meaningful feedback to pass back.

You can also set `max_iterations` on a gate to limit how many times the step can retry before the harness halts and asks for manual intervention.

## Example: The CTO Execution Workflow

The `cto-execution-workflow` (`core/workflows/cto-execution.workflow.yaml`) implements a full product development lifecycle from feature request to engineering handoff. Here is how each step is structured and why.

### Step 1: `understand` -- Requirements Analysis

```yaml
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
```

Two agents with complementary perspectives tackle the same feature request. The Advocate translates user needs into acceptance criteria; the Strategist frames the business and product context. The combined output becomes `requirements_analysis`. A `user-approval` gate follows so the requester can confirm the interpretation before design begins.

### Step 2: `design` -- Architecture & Design

```yaml
- id: design
  action: targeted-delegation
  agents: [architect]
  input: [requirements_analysis]
  prompt: |
    Based on the requirements analysis, produce an architecture decision record...
  output: architecture_decision_record
  review_gate: true
```

The Architect receives the requirements analysis as input and produces an ADR including a Mermaid diagram. Another `user-approval` gate lets the requester validate the technical direction before anyone builds a task plan against it.

### Step 3: `challenge` -- Architecture Review

```yaml
- id: challenge
  action: tension-pair
  agents: [architect, operator]
  input: [architecture_decision_record]
  prompt: |
    Operator: review this architecture for buildability...
    Architect: defend or revise based on Operator's concerns.
  output: revised_architecture
  review_gate: false             # Auto-proceeds. Tension is the review.
```

A `tension-pair` between the Architect (design purity) and the Operator (buildability) surfaces hidden complexity and missed dependencies. The adversarial structure is the quality gate -- no user approval is needed because the tension has already stress-tested the design. The result is `revised_architecture`, a more grounded version of the ADR.

### Steps 4-7: Planning, Tasks, Security, Stress Test

The remaining steps follow the same pattern: targeted delegation with explicit inputs from prior steps, building up a chain of artifacts:

- `plan` delegates to Strategist + Operator (receives `revised_architecture`, `requirements_analysis`), produces `phase_plan`, user-gated.
- `tasks` delegates to Operator (receives `phase_plan`, `revised_architecture`), produces `task_breakdown`, no gate.
- `security-review` delegates to Sentinel (receives `revised_architecture`, `task_breakdown`), produces `risk_assessment`, no gate.
- `stress-test` delegates to Provocateur (receives all prior artifacts), uses `structural_advantage: speaks-last` to ensure the Provocateur has the last word, produces `stress_test_findings`, no gate.

### Step 8: `synthesize` -- Execution Package Assembly

```yaml
- id: synthesize
  action: orchestrator-synthesis
  input: [requirements_analysis, revised_architecture, phase_plan, task_breakdown, risk_assessment, stress_test_findings]
  prompt: |
    Assemble the final execution package. Incorporate stress test findings.
    Adjust the plan if the Provocateur found real gaps.
  output: execution_package
```

The orchestrator receives all six prior artifacts and assembles the final deliverable. No agents are named -- this is the orchestrator's own synthesis step. There is no gate because by the time synthesis runs, all user-facing decisions have already been approved.

## Linking to a Profile

To activate a workflow for a profile, add the `workflow` field to the profile's `profile.yaml` pointing to the workflow's `id`:

```yaml
# core/profiles/my-profile/profile.yaml

workflow: my-workflow-id    # Must match the `id` field in the workflow file.
```

When the harness loads this profile, it reads the corresponding workflow file from `core/workflows/<id>.workflow.yaml` and switches to step-based execution mode. The profile's `assembly` still determines which agents are available -- the workflow determines the order and structure in which they are used.

A profile without a `workflow` field runs in standard orchestrated deliberation mode.

See [Creating Profiles](../creating-profiles/README.md) for the full profile schema.
