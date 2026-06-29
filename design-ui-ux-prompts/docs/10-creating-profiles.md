# Creating Profiles

Stitch UI prompt for the Creating Profiles documentation page at /docs/creating-profiles.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Creating Profiles ===
Documentation page for assembling agents into deliberation councils and execution teams. Covers profile.yaml schema, assembly, delegation, constraints, workflows, output formats, and execution-specific features like review gates and retry_with_feedback. Developers should leave this page able to create both deliberation and execution profiles.

=== DESKTOP LAYOUT (1200px) ===
- Max content width: 1200px centered
- Left sidebar: 220px wide, sticky (top: 80px), contains section navigation links
- Main content: single column, max-width 720px, left-aligned next to sidebar with 48px gap
- Breadcrumb at top of main content area
- Sections flow vertically with 48px gap between them

Sidebar navigation:
- Title: "On this page" in Label style (12px, 500 weight, uppercase, #86868b)
- Links: Deliberation vs Execution, Profile Schema, Assembly, Delegation, Constraints, Workflow, Output Format, Execution Profiles
- Active link: #1d1d1f, font-weight 600, 2px left border in Signal Blue (#0071e3)

=== MOBILE LAYOUT (375px) ===
- Sidebar collapses into a horizontal scrollable pill bar at top (below breadcrumb)
- Pills: 13px Inter 500, #86868b, padding 6px 12px, border-radius 12px, border 1px solid #e8e8ed
- Active pill: background #1d1d1f, color white
- Main content: full width, 16px horizontal padding
- Tables: horizontal scroll wrapper
- Section gap reduces to 32px

=== KEY COMPONENTS ===

Breadcrumb:
- Body Small (13px, #86868b)
- "Docs > Creating Profiles"
- "Docs" is a text link (#0071e3)

Page header:
- H1: "Creating Profiles" — 48px desktop / 32px mobile, Inter 800, #1d1d1f
- Subtitle: "Assemble agents into deliberation councils or execution teams" — Body (15px, #424245), 8px below

Section headers:
- H2: 28px desktop / 22px mobile, Inter 700, #1d1d1f
- Thin border-top divider 48px above each H2

Comparison table:
- Two-column table with header row
- Header: background #f5f5f7, Inter 600 13px uppercase
- Cells: Inter 400 14px #424245, padding 12px 16px
- Borders: 1px solid #e8e8ed

Code blocks:
- Background: #f5f5f7, border: 1px solid #e8e8ed, border-radius: 8px, padding: 16px
- JetBrains Mono 13px, #1d1d1f
- YAML syntax highlighting: keys bold, values #424245, comments #86868b

Callout box:
- Background: #f5f5f7, border-left: 4px solid #0071e3, border-radius: 0 8px 8px 0, padding: 16px 20px

Workflow diagram:
- Horizontal flow diagram (desktop), vertical on mobile
- Steps: rounded rectangles (#ffffff, border 1px solid #e8e8ed, border-radius: 8px, padding: 12px 16px)
- Arrows: 1px solid #86868b between steps
- Review gates: diamond shape or distinct styling (border: 2px solid #f59e0b, background: rgba(245,158,11,0.05))
- Step labels: Inter 600 13px #1d1d1f
- Step descriptions: Inter 400 12px #86868b

=== CONTENT ===

--- Breadcrumb ---
Docs > Creating Profiles

--- Page Header ---
# Creating Profiles
Assemble agents into deliberation councils or execution teams

--- Section: Deliberation vs Execution ---
## Deliberation vs Execution

Body text:
AOS supports two profile patterns. Choose based on whether you need a *decision* or a *deliverable*.

Comparison table:
| | Deliberation | Execution |
|---|---|---|
| **Purpose** | Multi-perspective debate to reach a strategic decision | Structured workflow to produce implementation-ready artifacts |
| **Orchestrator** | Arbiter (neutral facilitator) | Domain-specific (e.g., CTO Orchestrator) |
| **Delegation** | Broadcast — all agents hear everything | Targeted — orchestrator assigns to specific agents |
| **Agents** | Debate and challenge each other | Produce artifacts and review each other's work |
| **Output** | Structured memo with recommendations and dissent | Execution package with docs, tasks, and checklists |
| **Workflow** | Implicit (rounds of debate) | Explicit (ordered steps with review gates) |
| **Example** | strategic-council, security-review | cto-execution |
| **Brief sections** | Situation, Stakes, Constraints, Key Question | Feature/Vision, Context, Constraints, Success Criteria |

--- Section: Profile Schema ---
## Profile Schema

A complete profile.yaml with all fields:

```yaml
schema: aos/profile/v1                  # Required. Schema identifier.
id: strategic-council                   # Unique profile ID.
name: Strategic Council                 # Display name.
description: >                          # What this profile does.
  Multi-perspective strategic
  deliberation. Agents debate and
  the Arbiter synthesizes a memo.
version: 1.0.0

assembly:                               # Who participates.
  orchestrator: arbiter                 # Agent ID of the orchestrator.
  perspectives:                         # List of participating agents.
    - agent: catalyst
      required: true                    # Must be included in every session.
    - agent: sentinel
      required: true
    - agent: architect
      required: true
    - agent: provocateur
      required: true
      structural_advantage: speaks-last # Special positioning.
    - agent: navigator
      required: false                   # Can be deactivated.
    - agent: operator
      required: false

delegation:                             # How work is distributed.
  default: broadcast                    # broadcast | targeted
  opening_rounds: 1                     # Broadcast rounds before targeting.
  tension_pairs:                        # Agents paired for productive conflict.
    - [catalyst, sentinel]
    - [architect, pathfinder]
    - [advocate, navigator]
  bias_limit: 5                         # Max consecutive turns by one agent.

constraints:                            # Session boundaries.
  time:
    min_minutes: 2
    max_minutes: 10
  budget:
    min: 1.00
    max: 10.00
    currency: USD
  rounds:
    min: 2
    max: 8

error_handling:                         # Failure modes.
  agent_timeout_seconds: 120
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip                # skip | halt | replace
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:                      # Token budget management.
  strategy: rolling_average
  fixed_estimate_tokens: 2000
  safety_margin: 0.15
  on_estimate_exceeded: drop_optional   # drop_optional | warn | halt

input:                                  # Brief format requirements.
  format: brief
  required_sections:
    - heading: "## Situation"
      guidance: "What is happening right now?"
    - heading: "## Stakes"
      guidance: "What's at risk?"
    - heading: "## Constraints"
      guidance: "Boundaries and limits."
    - heading: "## Key Question"
      guidance: "The single question to answer."
  context_files: true                   # Allow attached files.

output:                                 # What the profile produces.
  format: memo                          # memo | execution-package | report | checklist
  path_template: "output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md"
  sections:
    - ranked_recommendations
    - agent_stances
    - dissent_and_tensions
    - tradeoffs_and_risks
    - next_actions
    - deliberation_summary
  artifacts:
    - type: diagram
  frontmatter:
    - date
    - duration
    - budget_used
    - participants
    - brief_path
    - transcript_path

expertise:                              # Persistent agent memory.
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent

controls:                               # Runtime controls.
  halt: true                            # Allow user to halt mid-session.
  wrap: true                            # Allow user to force early wrap-up.
  interject: false                      # Allow user interjection.
```

--- Section: Assembly ---
## Assembly

The `assembly` block defines who participates in the session.

Body text:
**orchestrator** is the agent ID of the session leader. For deliberation, use `arbiter` (neutral facilitator). For execution, use a domain-specific orchestrator like `cto-orchestrator`.

Body text:
**perspectives** lists participating agents. Each entry has:

Bulleted list:
- **agent** — Agent ID (must exist in core/agents/)
- **required** — If `true`, the agent is always included. If `false`, the agent can be deactivated by the user or dropped by budget estimation.
- **structural_advantage** — Optional. Currently supports `speaks-last`, which guarantees the agent gives its position after hearing all others. Useful for contrarian or stress-test roles.
- **role_override** — Optional. A string injected into the agent's `{{role_override}}` template variable. Lets you specialize a general-purpose agent for this specific profile without modifying its base definition.

```yaml
perspectives:
  - agent: architect
    required: true
    role_override: "Produce architecture decision records and system design docs"
  - agent: provocateur
    required: false
    structural_advantage: speaks-last
    role_override: "Stress-test the plan. Find the gaps."
```

--- Section: Delegation ---
## Delegation

The `delegation` block controls how the orchestrator distributes work.

Body text:
**default** sets the mode:
- `broadcast` — Every agent sees every message. Used in deliberation where all perspectives should react to everything.
- `targeted` — The orchestrator sends specific tasks to specific agents. Used in execution where each agent has a defined role.

Body text:
**opening_rounds** sets how many broadcast rounds happen before the orchestrator can begin targeting. Set to `1` for deliberation (everyone hears the brief) and `0` for execution (orchestrator delegates immediately).

Body text:
**tension_pairs** lists pairs of agents that should be brought into direct dialogue. The orchestrator uses these to engineer productive conflict:

```yaml
tension_pairs:
  - [catalyst, sentinel]       # Speed vs. sustainability
  - [architect, pathfinder]    # Proven patterns vs. novel approaches
  - [advocate, navigator]      # User needs vs. market positioning
  - [strategist, operator]     # Long-term sequence vs. what ships now
```

Body text:
**bias_limit** is the maximum number of consecutive turns any single agent can take before the orchestrator must rotate to another voice. Prevents any agent from dominating the conversation.

--- Section: Constraints ---
## Constraints

```yaml
constraints:
  time:
    min_minutes: 2              # Minimum session duration
    max_minutes: 10             # Hard timeout
  budget:
    min: 1.00                   # Minimum spend before wrap-up allowed
    max: 10.00                  # Hard budget cap (triggers wrap-up)
    currency: USD
  rounds:
    min: 2                      # Minimum deliberation rounds
    max: 8                      # Maximum rounds before forced synthesis
```

Body text:
All three constraint types work together. The session ends when any `max` value is reached. The orchestrator cannot wrap up until all `min` values are met.

Callout box (TIP):
For execution profiles, set `budget: null` if you are using subscription-based LLM access. The time and round constraints still apply.

--- Section: Workflow ---
## Workflow

Execution profiles can link to a workflow definition that specifies ordered steps, review gates, and artifact flow.

```yaml
# In profile.yaml:
workflow: cto-execution-workflow    # Links to workflow YAML by ID
```

Body text:
The workflow YAML defines the execution pipeline:

```yaml
schema: aos/workflow/v1
id: cto-execution-workflow
name: CTO Execution Workflow
description: "Full product development lifecycle"

steps:
  - id: requirements
    name: Requirements Analysis
    action: targeted-delegation
    agents: [advocate, strategist]
    prompt: "Analyze the brief and extract structured requirements"
    input: []
    output: requirements_analysis
    review_gate: true

  - id: design
    name: Architecture Design
    action: targeted-delegation
    agents: [architect]
    prompt: "Design the architecture based on requirements"
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

  - id: tasks
    name: Task Breakdown
    action: targeted-delegation
    agents: [operator]
    prompt: "Break the plan into engineering tasks with estimates"
    input: [revised_architecture]
    output: task_breakdown
    review_gate: false

  - id: risk
    name: Risk Assessment
    action: targeted-delegation
    agents: [sentinel]
    prompt: "Review for security, reliability, maintainability risks"
    input: [revised_architecture, task_breakdown]
    output: risk_assessment
    review_gate: false

  - id: stress-test
    name: Stress Test
    action: targeted-delegation
    agents: [provocateur]
    prompt: "Challenge the timeline, find gaps, stress-test assumptions"
    input: [revised_architecture, task_breakdown, risk_assessment]
    output: stress_test_findings
    review_gate: false

  - id: synthesize
    name: Final Assembly
    action: orchestrator-synthesis
    prompt: "Assemble the complete execution package"
    input: [requirements_analysis, revised_architecture, task_breakdown, risk_assessment, stress_test_findings]
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

Body text:
Each step defines:

Bulleted list:
- **action** — `targeted-delegation` (send to specific agents), `tension-pair` (two agents debate), or `orchestrator-synthesis` (orchestrator assembles final output)
- **input** — Output IDs from previous steps that feed into this step
- **output** — Named output artifact produced by this step
- **review_gate** — If `true`, the user can approve or reject before proceeding

Body text:
**role_override** in the profile's `assembly.perspectives` entries specializes agents for the workflow. The same Architect agent writes design docs in one profile and reviews code in another.

--- Section: Output Format ---
## Output Format

The `output.format` field determines the structure of the profile's deliverable.

Table:
| Format | Description | Typical Use |
|--------|-------------|-------------|
| `memo` | Structured decision memo with recommendations, dissent, and next actions | Deliberation profiles |
| `execution-package` | Multi-file deliverable with docs, tasks, diagrams, and checklists | Execution profiles |
| `report` | Single-document analysis report | Review profiles |
| `checklist` | Actionable checklist with status tracking | Audit profiles |

Body text:
**path_template** uses variables to generate the output path:

```yaml
path_template: "output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md"
```

Body text:
Available template variables: `{{date}}`, `{{brief_slug}}`, `{{session_id}}`, `{{profile_id}}`.

Body text:
**sections** lists the named sections included in the output. For `memo` format:

```yaml
sections:
  - ranked_recommendations
  - agent_stances
  - dissent_and_tensions
  - tradeoffs_and_risks
  - next_actions
  - deliberation_summary
```

Body text:
**artifacts** lists additional outputs (diagrams, structured data):

```yaml
artifacts:
  - type: diagram              # Mermaid architecture diagram
  - type: task_list            # Structured task breakdown
```

--- Section: Execution Profiles ---
## Execution Profiles

Execution profiles differ from deliberation in several key ways.

Body text:
**Targeted delegation.** The orchestrator sends specific tasks to specific agents rather than broadcasting. The CTO Orchestrator knows that Architect produces design docs and Operator produces task breakdowns — it delegates accordingly.

Body text:
**Ordered workflow.** Steps execute in sequence. Each step's `input` references outputs from previous steps, creating a dependency chain. The orchestrator manages this flow automatically.

Body text:
**Review gates.** The `gates` section defines user-approval checkpoints. When the workflow reaches a gate, it pauses and presents the output to the user:

```yaml
gates:
  - after: requirements
    type: user-approval
    prompt: "Do these requirements look right?"
    on_rejection: retry_with_feedback
```

Body text:
**retry_with_feedback** means the user can type feedback when rejecting, and the step re-runs with that feedback injected into the agent's prompt. This creates a human-in-the-loop refinement cycle.

Body text:
**role_override specialization.** Execution profiles use `role_override` to repurpose general agents for specific tasks:

```yaml
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
```

Callout box (NOTE):
The agent's base persona, cognition, and heuristics remain intact. The role_override layers a specific mission on top. Sentinel still thinks like Sentinel — it just knows its job in this profile is to review artifacts for risks, not to debate strategy.
```
