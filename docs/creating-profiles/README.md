# Creating Profiles

A profile defines a deliberation council -- which agents participate, how they interact, what constraints govern the session, and what output is produced. Profiles are the primary configuration unit for AOS sessions.

## Profile Structure

Each profile lives in its own directory under `core/profiles/`:

```
core/profiles/my-council/
  profile.yaml    # Full profile configuration
```

### profile.yaml

```yaml
schema: aos/profile/v1
id: my-council                    # Unique, kebab-case identifier
name: My Council                  # Human-readable display name
description: "What this council does and when to use it."
version: 1.0.0

assembly:
  orchestrator: arbiter           # Agent ID of the orchestrator
  perspectives:                   # List of participating agents
    - agent: catalyst
      required: true
    - agent: sentinel
      required: true
    - agent: navigator
      required: false
      structural_advantage: speaks-last

delegation:
  default: broadcast              # broadcast | round-robin | targeted
  opening_rounds: 1               # Rounds of broadcast before targeted delegation
  tension_pairs:                  # Agent pairs that create productive disagreement
    - [catalyst, sentinel]
    - [architect, pathfinder]
  bias_limit: 5                   # Max times one agent can be addressed before bias triggers
  max_delegation_depth: 2        # Maximum child agent depth (default: 2)

constraints:
  time:
    min_minutes: 2                # Minimum session duration
    max_minutes: 10               # Maximum session duration
  budget:
    min: 1.00                     # Minimum spend before session can end
    max: 10.00                    # Maximum spend (hard cap)
    currency: USD
  rounds:
    min: 2                        # Minimum deliberation rounds
    max: 8                        # Maximum deliberation rounds

error_handling:
  agent_timeout_seconds: 120
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip          # skip | abort_round | abort_session
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:
  strategy: fixed_estimate        # rolling_average | fixed_estimate
  fixed_estimate_tokens: 2000
  safety_margin: 0.15
  on_estimate_exceeded: drop_optional  # drop_optional | warn_arbiter | block_round

input:
  format: brief                   # brief | question | document | freeform
  required_sections:
    - heading: Situation
      guidance: "Describe the current state and context"
    - heading: Key Question
      guidance: "The central question to deliberate"
  context_files: true

output:
  format: markdown-memo
  path_template: "output/{{profile_id}}/{{session_id}}/memo.md"
  sections:
    - executive-summary
    - recommendations
    - risk-assessment
    - dissenting-views
    - next-actions
  artifacts:
    - type: transcript
  frontmatter:
    - session_id
    - profile
    - domain
    - timestamp
    - cost

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent                 # per-agent | shared | none

controls:
  halt: true                      # Allow user to halt mid-session
  wrap: true                      # Allow user to force wrap-up
  interject: true                 # Allow user to inject messages mid-session
```

## Assembly Design

### Orchestrator

The orchestrator is the Arbiter -- it reads the brief, delegates to perspective agents, synthesizes responses, and produces the final memo. The default `arbiter` agent is designed for this role. You can create custom orchestrators, but they must implement the delegation tool protocol.

### Perspectives

Perspectives are the debating agents. Design your assembly around productive tensions:

- **Required agents** (`required: true`) always participate. They should cover the essential analytical dimensions for your use case.
- **Optional agents** (`required: false`) can be dropped by the budget estimation system if costs are running high. Place specialized or supplementary perspectives here.
- **Structural advantage** (`structural_advantage: speaks-last`) gives one agent the final word in every round. Use this for the agent whose role is to challenge consensus (e.g., Provocateur, Devil's Advocate).

### Assembly sizing guidelines

| Council size | Use case | Notes |
|---|---|---|
| 3-4 agents | Quick focused review | Fast, low cost, narrow coverage |
| 5-7 agents | Standard deliberation | Good tension coverage, moderate cost |
| 8-11 agents | Deep strategic analysis | Full perspective coverage, higher cost |
| 12+ agents | Comprehensive audit | Maximum coverage, requires budget headroom |

## Delegation Configuration

### Tension Pairs

Tension pairs define agents that should be heard together when the Arbiter wants to explore a specific dimension. When the Arbiter delegates to a tension pair, both agents respond, naturally creating structured disagreement:

```yaml
tension_pairs:
  - [catalyst, sentinel]       # Speed vs. safety
  - [architect, pathfinder]    # Structure vs. exploration
  - [advocate, navigator]      # User needs vs. market position
```

Design tension pairs around complementary oppositions. Each pair should represent a genuine analytical trade-off, not arbitrary grouping.

### Bias Limit

The `bias_limit` prevents the Arbiter from over-consulting specific agents. When any agent has been addressed more than `bias_limit` times more than the least-addressed agent, further targeted delegation to that agent is blocked.

- Low values (3-4): Force even distribution, good for fairness
- Medium values (5-6): Allow some focusing while maintaining balance
- High values (7+): Allow deep dives on specific agents, risk perspective imbalance

### Max Delegation Depth

`max_delegation_depth` controls how deep hierarchical delegation can go. A depth of 2 means the profile's agents can spawn child agents, but those children cannot spawn further children. Setting this to 1 disables all sub-agent spawning regardless of individual agent `delegation` settings. Controls how deep hierarchical delegation can go. See [Hierarchical Delegation](../hierarchical-delegation/README.md).

### Opening Rounds

`opening_rounds` controls how many initial rounds use broadcast delegation (all agents respond) before the Arbiter can switch to targeted delegation. Set to 1 for a single opening broadcast, or higher to ensure all agents weigh in multiple times before the Arbiter narrows focus.

## Constraint Tuning

Constraints create the session governance envelope:

### Time Constraints

- `min_minutes`: The session cannot end until this time has elapsed (unless a maximum is hit).
- `max_minutes`: Hard cap on session duration. The session ends when this is reached.

### Budget Constraints

- Set `budget: null` to disable budget tracking entirely (useful for subscription/unmetered accounts).
- `min`: Ensures enough deliberation happens before the Arbiter can wrap up.
- `max`: Hard cap. The constraint engine will drop optional agents and eventually block rounds as the maximum approaches.
- `currency`: Currently only USD is supported.

### Rounds Constraints

- `min`: Minimum rounds of deliberation.
- `max`: Maximum rounds. Each delegation (broadcast or targeted) counts as one round.

### Constraint interaction

Constraints follow a priority order when they conflict:
1. Budget max (highest priority -- money is hard to recover)
2. Time max
3. Rounds max
4. Soft floors (minimums)

If a minimum has not been met but a maximum has been hit, the maximum wins and the session ends.

## Input/Output Format Configuration

### Input

The `input.required_sections` array defines what the brief must contain. The CLI validates these before launching:

```yaml
input:
  format: brief
  required_sections:
    - heading: Situation
      guidance: "Describe the current state"
    - heading: Key Question
      guidance: "What needs to be decided"
    - heading: Constraints
      guidance: "Time, budget, or other constraints"
```

### Output

Configure what goes into the memo and where it is saved:

```yaml
output:
  format: markdown-memo
  path_template: "output/{{profile_id}}/{{session_id}}/memo.md"
  sections:
    - executive-summary
    - recommendations
    - dissenting-views
```

## Example: Creating a "Code Review Council" Profile

### 1. Create the directory

```bash
bun run cli/src/index.ts create profile code-review-council
```

### 2. Write profile.yaml

```yaml
schema: aos/profile/v1
id: code-review-council
name: Code Review Council
description: "Multi-perspective code review. Submit a pull request brief describing the changes, architecture decisions, and trade-offs. A neutral Arbiter orchestrates specialist agents who evaluate correctness, security, performance, and maintainability."
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    - agent: architect
      required: true
    - agent: sentinel
      required: true
    - agent: operator
      required: true
    - agent: auditor
      required: false
    - agent: provocateur
      required: false
      structural_advantage: speaks-last

delegation:
  default: broadcast
  opening_rounds: 1
  tension_pairs:
    - [architect, operator]
    - [sentinel, provocateur]
  bias_limit: 4

constraints:
  time:
    min_minutes: 1
    max_minutes: 5
  budget:
    min: 0.50
    max: 3.00
    currency: USD
  rounds:
    min: 2
    max: 5

error_handling:
  agent_timeout_seconds: 60
  retry_policy:
    max_retries: 1
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:
  strategy: fixed_estimate
  fixed_estimate_tokens: 1500
  safety_margin: 0.20
  on_estimate_exceeded: warn_arbiter

input:
  format: brief
  required_sections:
    - heading: Changes
      guidance: "Describe what was changed and why"
    - heading: Architecture Decisions
      guidance: "Key design decisions and trade-offs"
  context_files: true

output:
  format: markdown-memo
  path_template: "output/code-review/{{session_id}}/review.md"
  sections:
    - summary
    - findings
    - risk-assessment
    - recommendations
  artifacts:
    - type: transcript
  frontmatter:
    - session_id
    - profile
    - timestamp
    - cost

expertise:
  enabled: false
  path_template: ""
  mode: none

controls:
  halt: true
  wrap: true
  interject: false
```

This profile uses a smaller agent set focused on code quality, with tighter constraints for faster turnaround. The Architect evaluates system design, the Sentinel checks for risks and security issues, the Operator ensures practical deployability, and the Provocateur challenges assumptions.

## Execution Profiles

Execution profiles extend the standard deliberation model with two additional concepts: **workflows** and **role overrides**. Instead of producing a recommendation memo, they orchestrate a multi-step production process and output a complete execution package.

### The `workflow` Field

The `workflow` field links a profile to a workflow definition that controls step sequencing, agent assignments, and review gates:

```yaml
workflow: cto-execution-workflow    # References a workflow definition
```

When a profile includes a `workflow` field, the runtime switches from the standard broadcast/targeted delegation model to a step-driven execution model. The orchestrator follows the workflow steps in order, delegating to specific agents at each step and pausing at review gates for user approval.

Profiles without a `workflow` field use the standard Arbiter-driven deliberation model.

### The `role_override` Field

In standard deliberation, agents operate in advisory mode -- they analyze and recommend. In execution profiles, `role_override` shifts agents into production mode by redefining what their output should be:

```yaml
assembly:
  perspectives:
    - agent: architect
      required: true
      role_override: "Produce architecture decision records and system design docs"
    - agent: operator
      required: true
      role_override: "Break phases into concrete engineering tasks with effort estimates"
```

The `role_override` string is injected into the agent's prompt via the `{{role_override}}` template variable. This means agents reuse their existing cognitive framework (biases, heuristics, evidence standards) but direct their analysis toward producing concrete artifacts instead of advisory opinions.

Without a `role_override`, the agent defaults to its standard advisory behavior.

### The `execution-package` Output Format

Execution profiles use the `execution-package` output format instead of the standard `markdown-memo`:

```yaml
output:
  format: execution-package
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
    - type: mermaid_diagram
    - type: task_list
```

The `execution-package` format differs from `markdown-memo` in several ways:

- Output is saved to a directory (not a single file), with each section as a separate document.
- Artifacts like Mermaid diagrams and structured task lists are saved alongside the sections.
- Frontmatter includes execution-specific metadata (date, duration, participants, brief path).

### Example: How the CTO Execution Profile is Configured

The built-in `cto-execution` profile demonstrates all of these concepts working together:

- **Workflow**: Links to `cto-execution-workflow`, an 8-step process from requirements through final assembly.
- **Role overrides**: Each agent gets a production-oriented role override (Architect produces ADRs, Operator produces task breakdowns, Sentinel reviews for security risks).
- **Targeted delegation**: Uses `default: targeted` with `opening_rounds: 0` because the CTO orchestrator knows exactly which agent to call at each workflow step.
- **Output**: Produces an `execution-package` with architecture diagrams, task lists, and a full implementation checklist.
- **Review gates**: The workflow pauses at 3 points for user approval (after requirements, architecture, and planning).

See the profile definition at `core/profiles/cto-execution/profile.yaml` and its README at `core/profiles/cto-execution/README.md` for the full configuration.
