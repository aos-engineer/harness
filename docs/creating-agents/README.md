# Creating Agents

Agents are the building blocks of AOS deliberation. Each agent has a distinct cognitive profile that determines how it analyzes problems, what evidence it finds compelling, and where it draws hard lines.

## Agent Definition Structure

Each agent lives in its own directory under `core/agents/` (organized into `orchestrators/`, `perspectives/`, and `operational/` subdirectories):

```
core/agents/perspectives/my-agent/
  agent.yaml    # Cognitive framework and configuration
  prompt.md     # System prompt template
```

### agent.yaml

The YAML file defines the agent's identity, cognition, persona, and runtime configuration:

```yaml
schema: aos/agent/v1
id: my-agent                  # Unique, kebab-case identifier
name: My Agent                # Human-readable display name
role: "One-sentence description of the agent's analytical focus."

cognition:
  objective_function: "What this agent optimizes for"
  time_horizon:
    primary: "30-90 days"     # Main planning window
    secondary: "this quarter" # Secondary consideration
    peripheral: "next year"   # Background awareness
  core_bias: speed-and-quality  # The agent's fundamental analytical lean
  risk_tolerance: moderate    # very-low | low | moderate | high | very-high
  default_stance: "The agent's instinctive opening position"

persona:
  temperament:
    - "Trait descriptions that define communication style"
  thinking_patterns:
    - "Questions the agent instinctively asks"
  heuristics:
    - name: Rule Name
      rule: "Decision shortcut the agent applies"
  evidence_standard:
    convinced_by:
      - "Types of evidence this agent finds compelling"
    not_convinced_by:
      - "Types of arguments this agent rejects"
  red_lines:
    - "Hard limits the agent will never cross"

tensions:
  - agent: other-agent-id
    dynamic: "Description of the productive tension between these agents"

report:
  structure: "How this agent structures its output"

tools: null                   # null = no tools; or ["read", "write"] for specific tools
skills: []
expertise:
  - path: expertise/my-agent-notes.md
    mode: read-write          # read-only | read-write
    use_when: "When to use the scratch pad"

model:
  tier: standard              # economy | standard | premium
  thinking: "off"             # off | on | extended
```

### prompt.md

The prompt template is the system prompt injected when the agent is spawned. It uses template variables that are resolved at runtime:

```markdown
You are {{agent_name}}, participating in session {{session_id}}.

[Your detailed system prompt instructions here...]
```

## Cognition Framework

The cognition section is the most important part of an agent definition. It determines the agent's analytical lens:

### Objective Function

A single sentence describing what the agent optimizes for. This is the agent's "north star" -- every analysis it produces should serve this function.

Good: "Minimize time-to-revenue while maintaining unit economics above break-even."
Bad: "Be helpful and provide good analysis." (too vague)

### Time Horizon

Three nested planning windows that determine how the agent weighs short-term vs long-term considerations:

- **primary**: The window where the agent focuses most of its analysis (e.g., "30-90 days")
- **secondary**: A secondary consideration (e.g., "this quarter")
- **peripheral**: Background awareness that influences but does not dominate (e.g., "3-5 years")

Agents with short time horizons (Catalyst: 30-90 days) naturally create tension with agents that have long time horizons (Sentinel: 2-5 years).

### Core Bias

The agent's fundamental analytical lean. This is intentional -- AOS agents are designed to be biased, and the harness creates balance through structured opposition. Examples:
- `speed-and-monetization` (Catalyst)
- `sustainability-and-protection` (Sentinel)
- `systemic-integrity` (Architect)

### Risk Tolerance

A five-level scale from `very-low` to `very-high` that influences how the agent evaluates uncertain outcomes. A `very-low` risk tolerance agent will flag risks that a `high` tolerance agent would dismiss.

### Default Stance

The agent's instinctive opening position -- what it would say before analyzing any specific brief. This anchors the agent's personality.

## Persona Design Guide

### Temperament

An array of trait descriptions that define communication style. Write each as an adjective followed by a behavioral description:

```yaml
temperament:
  - "Impatient -- treats delays as costs, not caution"
  - "Direct -- states the commercial reality others are dancing around"
```

### Thinking Patterns

Questions the agent instinctively asks when analyzing any problem. These should be specific and reflect the agent's cognitive bias:

```yaml
thinking_patterns:
  - "Who will pay for this, and how much, and when?"
  - "What is the fastest path to revenue from where we are right now?"
```

### Heuristics

Named decision shortcuts that the agent applies. Each has a `name` (for reference in deliberation) and a `rule` (the decision logic):

```yaml
heuristics:
  - name: Ship-It Rule
    rule: "If a version can ship in half the time, default to shipping it -- unless irreversibility risk is proven."
```

### Evidence Standard

What convinces and does not convince this agent. This is critical for creating productive disagreement:

```yaml
evidence_standard:
  convinced_by:
    - "Revenue data, conversion metrics, or willingness-to-pay signals"
    - "Competitive examples where speed created a durable advantage"
  not_convinced_by:
    - "Abstract quality arguments without revenue impact analysis"
    - "Risk concerns that lack probability estimates"
```

### Red Lines

Hard limits the agent will never cross, regardless of other arguments. These create non-negotiable boundaries:

```yaml
red_lines:
  - "Never accept an indefinite timeline"
  - "Never ignore unit economics"
```

## Template Variables in prompt.md

The following variables are available in agent prompt templates and are resolved at runtime:

| Variable | Description |
|---|---|
| `{{agent_name}}` | The agent's display name |
| `{{session_id}}` | Current session identifier |
| `{{brief}}` | The full brief content |
| `{{participants}}` | List of all agents in the session |
| `{{constraints}}` | Constraint configuration summary |
| `{{output_path}}` | Path where the memo will be written |
| `{{expertise_block}}` | Contents of the agent's expertise scratch pad |
| `{{deliberation_dir}}` | Directory for session artifacts |

## Example: Creating a "Compliance Officer" Agent

### 1. Create the directory

```bash
bun run cli/src/index.ts create agent compliance-officer
```

Or manually:

```bash
mkdir -p core/agents/perspectives/compliance-officer
```

### 2. Write agent.yaml

```yaml
schema: aos/agent/v1
id: compliance-officer
name: Compliance Officer
role: "Regulatory and legal compliance specialist. Evaluates every proposal against applicable regulations, industry standards, and legal obligations. Ensures the organization does not take on regulatory risk."

cognition:
  objective_function: "Minimize regulatory and legal risk exposure to zero tolerance for violations."
  time_horizon:
    primary: 6-12 months
    secondary: 1-3 years
    peripheral: regulatory cycle (3-5 years)
  core_bias: regulatory-compliance
  risk_tolerance: very-low
  default_stance: "Show me the regulatory analysis before I evaluate the opportunity."

persona:
  temperament:
    - "Methodical -- follows established frameworks and checklists"
    - "Cautious -- assumes regulatory scrutiny until proven otherwise"
    - "Precise -- uses exact regulatory citations, not generalizations"
    - "Firm -- does not bend on compliance requirements regardless of commercial pressure"
  thinking_patterns:
    - "Which regulations apply to this initiative in each jurisdiction we operate in?"
    - "What would a regulator say if they audited this decision in two years?"
    - "Is there a compliance-by-design approach that achieves the business goal?"
    - "What is the worst-case enforcement action and its financial impact?"
  heuristics:
    - name: Regulatory First
      rule: "Before evaluating any opportunity, identify all applicable regulations. If the regulatory landscape is unclear, mandate a compliance review before proceeding."
    - name: Documentation Rule
      rule: "If it is not documented, it did not happen. Every compliance-relevant decision needs a written rationale."
    - name: Jurisdiction Check
      rule: "Any initiative that touches user data, financial transactions, or healthcare must pass a per-jurisdiction compliance check."
  evidence_standard:
    convinced_by:
      - "Specific regulatory citations with section numbers"
      - "Precedent from enforcement actions in similar cases"
      - "Legal opinions from qualified counsel"
    not_convinced_by:
      - "Assertions that regulations do not apply without analysis"
      - "Claims that competitors are doing it so it must be legal"
      - "Arguments that the risk is small so compliance can wait"
  red_lines:
    - "Never approve an initiative that knowingly violates a regulation"
    - "Never defer a compliance review to post-launch"
    - "Never accept verbal assurances in place of documented compliance evidence"

tensions:
  - agent: catalyst
    dynamic: "Speed vs. compliance. The Catalyst wants to ship fast; the Compliance Officer requires regulatory clearance. The tension is whether compliance is a gate or a guardrail."

report:
  structure: "Lead with applicable regulations. State compliance status (compliant, conditionally compliant, non-compliant). List required actions for compliance. Flag timeline impacts. Close with risk exposure if compliance is bypassed."

tools: null
skills: []
expertise:
  - path: expertise/compliance-officer-notes.md
    mode: read-write
    use_when: "Track regulatory requirements, compliance status of discussed initiatives, and outstanding compliance actions."

model:
  tier: standard
  thinking: "on"
```

### 3. Write prompt.md

```markdown
You are {{agent_name}}, a regulatory and legal compliance specialist in session {{session_id}}.

Your role is to evaluate every proposal against applicable regulations, industry standards, and legal obligations. You ensure the organization does not take on avoidable regulatory risk.

When analyzing a brief, you must:
1. Identify all applicable regulations and standards
2. Assess compliance status of each proposed action
3. Flag any regulatory risks with specific citations
4. Propose compliance-by-design alternatives where possible
5. Document required compliance actions and timelines

You operate with very-low risk tolerance for regulatory violations. Commercial pressure does not override compliance requirements.
```

### 4. Add to a profile

Edit the relevant profile's `profile.yaml` to include the new agent in the `assembly.perspectives` array:

```yaml
assembly:
  perspectives:
    # ... existing agents ...
    - agent: compliance-officer
      required: false
```

## Agent Capabilities

The `capabilities` field declares what an agent can do beyond producing text responses. This is used by the runtime to determine which agents can be assigned to workflow steps that require specific output types:

```yaml
capabilities:
  - text-analysis
  - diagram-generation
  - task-decomposition
  - code-review
```

When a workflow step requires a specific capability (e.g., generating a Mermaid architecture diagram), the orchestrator can verify that the assigned agent declares that capability. If no capabilities are declared, the agent is assumed to produce text-only output.

Capabilities are informational -- they do not grant the agent access to tools. Tool access is controlled separately via the `tools` field. However, capabilities help execution profiles match agents to workflow steps correctly.

## The `{{role_override}}` Template Variable

In execution profiles, agents can receive a `role_override` that shifts them from advisory mode to production mode. This override is available in `prompt.md` via the `{{role_override}}` template variable:

```markdown
You are {{agent_name}}, participating in session {{session_id}}.

{{#role_override}}
**Production Mode:** {{role_override}}

Your output should be concrete artifacts, not advisory opinions. Apply your analytical
framework to produce the deliverables described above.
{{/role_override}}

[Rest of the agent's standard prompt...]
```

When a `role_override` is set in the profile's assembly configuration, the variable is populated with the override string. When no override is set (standard deliberation), the block is omitted.

This means the same agent definition can participate in both advisory deliberation (producing analysis and recommendations) and execution workflows (producing architecture docs, task breakdowns, or risk assessments) without needing separate agent configurations.

| Variable | Description |
|---|---|
| `{{role_override}}` | Production role from the profile's `role_override` field, or empty if not set |

See [Creating Profiles](../creating-profiles/README.md) for how `role_override` is configured at the profile level.

## Domain Enforcement

Domain enforcement gives each agent a structural boundary: which file paths it can read, write, or delete, and which tools it is permitted or forbidden to call. These rules are evaluated by the runtime before any tool call executes, not by the agent itself.

```yaml
domain:
  rules:
    - path: "src/**"
      read: true
      write: true
      delete: false
  tool_allowlist: ["read", "write", "edit"]
  tool_denylist: ["bash"]
```

See [Domain Enforcement](../domain-enforcement/README.md) for path matching rules, bash restrictions, and profile overrides.

## Hierarchical Delegation

Agents with delegation authority can spawn sub-agents to handle scoped sub-tasks, enabling Lead→Worker chains where a lead agent decomposes work and coordinates results. The `delegation` field on the agent definition controls what that agent is permitted to spawn.

```yaml
delegation:
  can_spawn: true
  max_children: 3
  child_model_tier: economy
  child_timeout_seconds: 120
  delegation_style: delegate-only
```

See [Hierarchical Delegation](../hierarchical-delegation/README.md) for depth limits, delegation tools, and domain inheritance.

## Persistent Expertise

An agent's expertise can accumulate across sessions rather than resetting each time. The runtime reads the expertise file at session start and writes a diff-based update at session end, so the agent's knowledge compounds over time without unbounded growth.

```yaml
expertiseConfig:
  enabled: true
  max_lines: 5000
  structure: [architecture_patterns, failure_modes]
  read_on: session_start
  update_on: session_end
  scope: per-project
  mode: read-write
  auto_commit: review
```

Note: This is separate from the `expertise` field above, which defines scratch-pad paths. `expertiseConfig` controls the persistent learning system.

See [Persistent Expertise](../persistent-expertise/README.md) for update mechanics, pruning, and review mode.
