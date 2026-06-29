# Creating Agents

Stitch UI prompt for the Creating Agents documentation page at /docs/creating-agents.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Creating Agents ===
Documentation page for defining custom AI agent personas. Covers the full agent.yaml schema, prompt.md template variables, cognition model, persona definition, tensions, capabilities, and validation. Developers should leave this page able to create a production-quality agent from scratch.

=== DESKTOP LAYOUT (1200px) ===
- Max content width: 1200px centered
- Left sidebar: 220px wide, sticky (top: 80px), contains section navigation links
- Main content: single column, max-width 720px, left-aligned next to sidebar with 48px gap
- Breadcrumb at top of main content area
- Sections flow vertically with 48px gap between them
- Code blocks are full-width within the 720px column

Sidebar navigation:
- Title: "On this page" in Label style (12px, 500 weight, uppercase, #86868b)
- Links: Agent Structure, Schema Reference, Cognition, Persona, Tensions, Capabilities, Template Variables, Prompt Writing Tips, Validate
- Active link: #1d1d1f, font-weight 600, 2px left border in Signal Blue (#0071e3)

=== MOBILE LAYOUT (375px) ===
- Sidebar collapses into a horizontal scrollable pill bar at top of content (below breadcrumb)
- Pills: 13px Inter 500, #86868b, padding 6px 12px, border-radius 12px, border 1px solid #e8e8ed
- Active pill: background #1d1d1f, color white
- Main content: full width, 16px horizontal padding
- Code blocks: horizontal scroll if overflow
- Section gap reduces to 32px

=== KEY COMPONENTS ===

Breadcrumb:
- Body Small (13px, #86868b)
- "Docs > Creating Agents"
- "Docs" is a text link (#0071e3)

Page header:
- H1: "Creating Agents" — 48px desktop / 32px mobile, Inter 800, #1d1d1f
- Subtitle: "Define AI personas with structured cognition, heuristics, and productive tensions" — Body (15px, #424245), 8px below

Section headers:
- H2: 28px desktop / 22px mobile, Inter 700, #1d1d1f
- Thin border-top divider 48px above each H2

Code blocks:
- Background: #f5f5f7, border: 1px solid #e8e8ed, border-radius: 8px, padding: 16px
- JetBrains Mono 13px, #1d1d1f
- Copy button top-right, language label top-left
- YAML blocks use syntax highlighting: keys in #1d1d1f bold, string values in #424245, comments in #86868b

File tree component:
- Background: #f5f5f7, border: 1px solid #e8e8ed, border-radius: 8px, padding: 16px
- JetBrains Mono 13px
- Folder icons: simple unicode folder character
- File icons: simple unicode document character
- Indentation: 20px per level

Annotated code block:
- Code block on top, annotation callouts below or inline
- Annotations: numbered markers (circled numbers in Signal Blue) in the code, with corresponding explanation text below the block
- Each annotation: number badge (20px circle, #0071e3 background, white text, 12px Inter 700) + explanation text (15px, #424245)

Table:
- Full width within 720px column
- Header row: background #f5f5f7, Inter 600 13px #1d1d1f, uppercase
- Body rows: Inter 400 14px #424245
- Borders: 1px solid #e8e8ed between rows
- Padding: 12px 16px per cell

Callout box:
- Background: #f5f5f7, border-left: 4px solid #0071e3, border-radius: 0 8px 8px 0, padding: 16px 20px
- Label: "TIP" or "NOTE" in 12px 600 weight #0071e3 uppercase

=== CONTENT ===

--- Breadcrumb ---
Docs > Creating Agents

--- Page Header ---
# Creating Agents
Define AI personas with structured cognition, heuristics, and productive tensions

--- Section: Agent Structure ---
## Agent Structure

Every agent is a directory containing two files:

File tree:
```
core/agents/perspectives/
  catalyst/
    agent.yaml      # Schema, cognition, persona, tensions, capabilities
    prompt.md        # Full prompt template with {{variables}}
```

Body text:
**agent.yaml** defines the agent's structured identity — how it thinks, what it values, who it clashes with, and what it can produce. The runtime reads this file to configure the agent before each session.

**prompt.md** is the full prompt sent to the LLM. It uses template variables (like `{{brief}}`, `{{role_override}}`, `{{participants}}`) that the runtime injects at execution time.

--- Section: Schema Reference ---
## Schema Reference

A complete agent.yaml with every field annotated:

```yaml
schema: aos/agent/v1                    # [1] Required. Schema identifier.
id: catalyst                            # [2] Unique agent ID. Lowercase, hyphenated.
name: Catalyst                          # [3] Display name.
role: >                                 # [4] One-line role description. Used in
  Acceleration and monetization           #     assembly summaries and UI displays.
  strategist. Pushes for commercial
  velocity and shipping speed.

cognition:                              # [5] How the agent thinks.
  objective_function: >                 #     The agent's north star — what it
    Maximize momentum and commercial      #     optimizes for above all else.
    velocity. Ship, sell, collect.
  time_horizon:                         # [6] Planning horizons.
    primary: 30-90 days                 #     Main focus window.
    secondary: this quarter             #     Awareness range.
    peripheral: next quarter            #     Peripheral vision.
  core_bias: speed-and-monetization     # [7] Named cognitive bias.
  risk_tolerance: moderate              # [8] low | moderate | high
  default_stance: >                     # [9] Opening position in any debate.
    I want a version customers will
    pay for in 90 days.

persona:                                # [10] Behavioral personality.
  temperament:                          # [11] List of character traits.
    - "Impatient — treats delays as costs"
    - "Revenue-obsessed"
    - "Action-biased"
    - "Direct"
  thinking_patterns:                    # [12] Internal monologue patterns.
    - "Who will pay for this, and how much?"
    - "What is the fastest path to revenue?"
    - "If we ship in half the time with half the scope, do we capture 80% of the value?"
  heuristics:                           # [13] Named decision rules.
    - name: Ship-It Rule
      rule: >
        If a version can ship in half the time,
        default to shipping it — unless
        irreversibility risk is proven.
    - name: Payback Period
      rule: >
        Every initiative must have a payback
        period under 6 months.
  evidence_standard:                    # [14] What convinces or fails to convince.
    convinced_by:
      - "Revenue data and conversion metrics"
      - "Concrete timelines with ship dates"
    not_convinced_by:
      - "Abstract quality arguments without revenue impact"
      - "Timelines that keep extending"
  red_lines:                            # [15] Hard boundaries the agent will not cross.
    - "Never accept an indefinite timeline"
    - "Never ignore unit economics"

tensions:                               # [16] Productive conflict definitions.
  - agent: sentinel                     #      ID of the opposing agent.
    dynamic: >                          #      Description of the tension.
      Ship now vs. protect long-term.
      Catalyst pushes speed; Sentinel
      demands sustainability.

report:                                 # [17] How the agent structures its output.
  structure: >
    Lead with revenue opportunity.
    State the recommended path with a
    concrete ship date. Name trade-offs
    in commercial terms.

model:                                  # [18] LLM configuration.
  tier: standard                        #      standard | advanced | reasoning
  thinking: "off"                       #      off | on (extended thinking)

capabilities:                           # [19] What this agent can produce.
  can_execute_code: false               #      Can it run code during sessions?
  can_produce_files: false              #      Can it write files to disk?
  can_review_artifacts: true            #      Can it review other agents' output?
  available_skills: []                  #      Skill IDs this agent can invoke.
  output_types: [text, markdown]        #      Output format types.

tools: null                             # [20] External tool integrations (future).
skills: []                              # [21] Linked skill definitions.
expertise:                              # [22] Scratch pad for persistent notes.
  - path: expertise/catalyst-notes.md
    mode: read-write
    use_when: >
      Track revenue projections and
      cost-of-delay calculations.
```

--- Section: Cognition ---
## Cognition

The `cognition` block defines *how* the agent thinks — its optimization target, time horizon, biases, and risk appetite.

Body text:
**objective_function** is the agent's north star. Every argument, recommendation, and challenge the agent makes should trace back to this function. Make it specific and measurable.

Body text:
**core_bias** names the agent's intentional cognitive lean. This is not a flaw — it is a design choice. Agents are biased *on purpose* so that the council produces genuine tension. Examples: `speed-and-monetization`, `risk-aversion`, `systems-thinking`, `user-empathy`, `contrarian`.

Body text:
**risk_tolerance** (low / moderate / high) controls how the agent weighs uncertain outcomes. A `low` agent demands proof before acting. A `high` agent acts on signal and adjusts.

Body text:
**time_horizon** defines three nested windows. The `primary` horizon is where the agent does most of its thinking. The `secondary` is awareness. The `peripheral` is what it notices but does not prioritize.

Callout box (TIP):
Good councils have agents with *different* time horizons. A Catalyst focused on 30-90 days clashes productively with a Sentinel focused on 1-3 years. This asymmetry is intentional.

--- Section: Persona ---
## Persona

The `persona` block defines *who* the agent is — its character, patterns of reasoning, decision rules, evidence standards, and hard limits.

Body text:
**temperament** is a list of character traits written as short descriptions. These set the tone for how the agent communicates. Write them as "Trait — explanation" pairs.

Body text:
**thinking_patterns** are the internal questions the agent asks itself when evaluating any input. These appear in the prompt as the agent's cognitive voice. Write them as questions the agent would ask.

Body text:
**heuristics** are named decision rules. Each has a `name` (short, memorable) and a `rule` (one or two sentences). These are the shortcuts the agent uses to make fast decisions. Good heuristics are opinionated and actionable.

Body text:
**evidence_standard** has two lists: `convinced_by` (what counts as good evidence) and `not_convinced_by` (what the agent rejects). This controls how the agent responds to other agents' arguments.

Body text:
**red_lines** are absolute limits. The agent will never cross these regardless of the discussion. Keep the list short (2-4 items) and specific.

--- Section: Tensions ---
## Tensions

Tensions define the productive conflicts between agents. They are the engine of deliberation.

```yaml
tensions:
  - agent: sentinel
    dynamic: >
      Ship now vs. protect long-term. The Catalyst
      pushes for speed; the Sentinel demands
      sustainability. The tension is whether velocity
      creates value or destroys trust.
  - agent: pathfinder
    dynamic: >
      Proven revenue vs. speculative bets. The Catalyst
      wants to monetize the known; the Pathfinder wants
      to bet on the unknown.
```

Body text:
Each tension entry names the opposing `agent` by ID and describes the `dynamic` — the specific disagreement that makes this pairing valuable.

Callout box (NOTE):
Tensions are bidirectional. If Catalyst defines a tension with Sentinel, Sentinel should also define a tension with Catalyst. The descriptions can differ — each agent describes the tension from its own perspective.

--- Section: Capabilities ---
## Capabilities

The `capabilities` block declares what an agent can produce during sessions.

```yaml
capabilities:
  can_execute_code: false       # Run code in a sandboxed environment
  can_produce_files: false      # Write files to the output directory
  can_review_artifacts: true    # Read and critique other agents' outputs
  available_skills: []          # Skill IDs the agent can invoke
  output_types:                 # What formats this agent produces
    - text
    - markdown
```

Body text:
For execution profiles, agents with `can_produce_files: true` generate artifacts (architecture docs, task breakdowns) that become part of the execution package. Agents with `can_review_artifacts: true` can read and critique those artifacts in later workflow steps.

Body text:
**output_types** declares the formats this agent can produce: `text`, `markdown`, `json`, `yaml`, `mermaid`, `code`.

--- Section: Template Variables ---
## Template Variables

The prompt.md file uses `{{variable}}` placeholders that the runtime injects at execution time.

Table:
| Variable | Type | Description |
|----------|------|-------------|
| `{{agent_name}}` | string | Display name of the agent (e.g., "Catalyst") |
| `{{agent_id}}` | string | Agent identifier (e.g., "catalyst") |
| `{{session_id}}` | string | Unique session identifier |
| `{{participants}}` | string | Comma-separated list of all agents in the session |
| `{{constraints}}` | string | Time, budget, and round constraints from the profile |
| `{{brief}}` | string | Full text of the user's brief |
| `{{role_override}}` | string | Profile-specific role override (empty if not set). Inserted into the prompt to specialize the agent for a particular profile. |
| `{{expertise_block}}` | string | Contents of the agent's expertise scratch pad (previous session notes) |
| `{{deliberation_dir}}` | string | Path to the output directory for this session |
| `{{transcript_path}}` | string | Path to the live transcript file |

Callout box (TIP):
`{{role_override}}` is especially powerful in execution profiles. The same Architect agent can serve as "system designer" in a deliberation council and "produce architecture decision records" in an execution profile — same persona, different mission.

--- Section: Prompt Writing Tips ---
## Prompt Writing Tips

Bulleted list:
- **Start with identity.** The first section of prompt.md should establish who the agent is, what it cares about, and why it exists. This anchors the LLM's behavior.
- **Use second person.** Write "You are the Catalyst" not "The Catalyst is." Direct address produces stronger role adherence.
- **Include example reasoning.** Show the agent's internal monologue with quoted examples: "If we shipped this tomorrow, who would pay for it?"
- **Define engagement rules.** Tell the agent how to interact with specific other agents. "With the Sentinel, quantify the risk before dismissing it."
- **Keep red lines few and firm.** 2-4 hard limits. If you list 10, the LLM treats them all as soft.
- **Use `{{role_override}}` as an insertion point.** Place it after the identity section so profile-specific instructions layer on top of the base persona.
- **End with report structure.** Tell the agent exactly how to format its output. Numbered steps work better than vague instructions.

--- Section: Validate ---
## Validate

Validate your agent definition against the schema:

```bash
aos validate agent core/agents/perspectives/my-agent/agent.yaml
```

Body text:
The validator checks:

Bulleted list:
- Schema version is `aos/agent/v1`
- All required fields are present (id, name, role, cognition, persona)
- Tension references point to agents that exist
- Capability fields use valid values
- prompt.md exists in the same directory

Body text:
To validate all agents at once:

```bash
aos validate agents
```
```
