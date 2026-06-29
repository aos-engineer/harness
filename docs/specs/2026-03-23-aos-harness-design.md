# AOS Harness — Design Specification

**Date:** 2026-03-23
**Status:** Approved (pending spec review)
**Project:** aos-harness
**Location:** 

---

## 1. Vision

AOS Harness is a language-agnostic agentic orchestration system that assembles specialized AI agents into deliberation teams, drives structured multi-perspective debate under time and budget constraints, and synthesizes the results into actionable recommendations.

The framework serves three tiers of users:
- **Tier 1 (Install & Run)** — New agentic engineers install a pre-built orchestration profile, submit a brief, and get a structured output. They learn by using.
- **Tier 2 (Customize & Build)** — Intermediate engineers create custom agents, build orchestration profiles, and develop domain knowledge packs for their industry.
- **Tier 3 (Full Platform)** — Advanced/enterprise engineers get a web dashboard with session management, replay, observability, cost analytics, and team management.

The framework is the core IP behind AOS.engineer — a platform for training the top 1% of agentic orchestration engineers.

---

## 2. Architecture

### 2.1 Hybrid Config + Minimal Runtime

The framework follows a config-first design with a minimal shared runtime:

- **Config layer (YAML/Markdown)** — Agent personas, orchestration profiles, domain templates, workflow definitions, input/output specifications. This is what makes the harness language-agnostic.
- **Minimal runtime (~1200 lines TypeScript)** — Handles the things config can't express: constraint evaluation (time/budget/rounds with conflict resolution), delegation routing (broadcast/targeted/tension-pair with bias enforcement), template variable substitution, error handling and recovery, and budget estimation. TypeScript chosen for native Pi CLI compatibility; small enough to port to other languages as needed.
- **Platform adapters** — Thin implementations that wire the config + runtime to a specific execution environment (Pi CLI, Claude Code, Gemini CLI).

### 2.2 4-Layer Adapter Contract

Each platform adapter implements four layers:

**Layer 1: Agent Runtime** — Core agent lifecycle.
- `spawnAgent(config, sessionId)` — Create an agent subprocess/session
- `sendMessage(handle, message, opts)` — Send a message with optional context files, abort signal, and streaming callback
- `destroyAgent(handle)` — Tear down an agent
- `setOrchestratorPrompt(prompt)` — Inject/modify the orchestrator's system prompt
- `injectContext(handle, files)` — Load context files into agent
- `getContextUsage(handle)` — Token tracking
- `setModel(handle, modelConfig)` — Set model for agent
- `abort()` — Hard stop all agents

**Layer 2: Event Bus** — Lifecycle hooks and interception.
- `onSessionStart(handler)` — Initialization
- `onSessionShutdown(handler)` — Cleanup
- `onBeforeAgentStart(handler)` — Pre-agent hook (system prompt injection)
- `onAgentEnd(handler)` — Post-agent hook
- `onToolCall(handler)` — Intercept/block tool calls
- `onToolResult(handler)` — Post-tool hook (e.g., memo frontmatter injection)
- `onMessageEnd(handler)` — Track costs, tokens
- `onCompaction(handler)` — Custom compaction logic

**Layer 3: User Interface** — Rendering and interaction.
- `registerCommand(name, handler)` — Slash commands
- `registerTool(name, schema, handler)` — Custom tools callable by the orchestrator
- `renderAgentResponse(agent, response, color)` — Display agent output
- `renderCustomMessage(type, content, details)` — Custom message types
- `setWidget(id, renderer)` — Live-updating UI widgets (streaming, progress)
- `setFooter(renderer)` — Persistent footer (agent status cards)
- `setStatus(key, text)` — Status bar
- `setTheme(name)` — Visual theme
- `promptSelect(label, options)` — User selection
- `promptConfirm(title, message)` — Confirmation dialog
- `promptInput(label)` — Free-text input
- `notify(message, level)` — Notifications (info/warning/error)
- `blockInput(allowedCommands)` — Block user input during execution
- `unblockInput()` — Restore input
- `steerMessage(message)` — Inject a message that appears agent-initiated

**Layer 4: Workflow Engine** — Process orchestration.
- `dispatchParallel(agents, message, opts)` — Run N agents concurrently
- `executeWithCheckpoints(steps, reviewFn)` — Step-by-step execution with review gates
- `verifyBeforeComplete(evidence)` — Evidence-first completion
- `reviewLoop(dispatch, fixFn, maxIterations)` — Dispatch → fix → re-dispatch cycle
- `isolateWorkspace()` — Git worktree or equivalent
- `writeFile(path, content)` — File system write
- `readFile(path)` — File system read
- `openInEditor(path, editor)` — Launch external editor
- `persistState(key, value)` — State that survives restarts
- `loadState(key)` — Retrieve persisted state

### 2.3 Platform Coverage

| Capability | Pi CLI (Primary) | Claude Code | Gemini CLI |
|---|---|---|---|
| L1: Agent spawn | Native subprocess | Agent tool | API call |
| L1: System prompt injection | `before_agent_start` | CLAUDE.md + agents/ | GEMINI.md |
| L1: Abort | `ctx.abort()` | Agent cancellation | Signal abort |
| L2: Event hooks | Full (20+ events) | Partial (hooks) | Minimal |
| L2: Tool interception | `tool_call` event | Hooks only | Not supported |
| L3: TUI widgets | Full (widgets, footer) | Terminal text only | Terminal text only |
| L3: Commands | `registerCommand()` | Slash commands | Extensions |
| L3: Custom tools | `registerTool()` | MCP servers | Function calling |
| L3: Steer message | `deliverAs: "steer"` | Not supported | Not supported |
| L4: Parallel dispatch | `Promise.allSettled` | Multiple Agent calls | Concurrent API |
| L4: Git worktrees | Bash + git | `isolation: "worktree"` | Bash + git |
| L4: State persistence | `appendEntry()` | File system | File system |

---

## 3. Agent Definition Schema

Every agent is defined as a YAML metadata file + Markdown system prompt.

### 3.1 Schema: `aos/agent/v1`

```yaml
schema: aos/agent/v1
id: unique-identifier                    # kebab-case
name: Human-Readable Name
role: Brief role description (one line)

cognition:
  objective_function: "What this agent optimizes for"
  time_horizon:
    primary: "Primary time frame"
    secondary: "Secondary time frame"
    peripheral: "Background time frame"
  core_bias: keyword                     # e.g., speed-and-monetization
  risk_tolerance: moderate               # very-low | low | moderate | high | very-high
  default_stance: "Default position in one sentence"

persona:
  temperament: []                        # List of temperament traits
  thinking_patterns: []                  # "How This Role Thinks" questions
  heuristics:
    - name: Heuristic Name
      rule: "Decision rule description"
  evidence_standard:
    convinced_by: []
    not_convinced_by: []
  red_lines: []                          # Non-negotiable boundaries

tensions:
  - agent: other-agent-id
    dynamic: "Description of the tension"

report:
  structure: "Instructions for how to format responses"

tools: null                              # null = platform defaults, [] = no tools, ["read","write"] = whitelist
skills: []                               # Skill references
expertise:
  - path: relative/path/to/scratch-pad.md
    mode: read-write                     # read-only | read-write
    use_when: "When to use this file"

model:
  tier: standard                         # economy | standard | premium
  thinking: off                          # off | on | extended
```

The system prompt lives alongside as `prompt.md` with `{{VARIABLE}}` placeholders resolved at runtime.

### 3.2 Agent Roster (12 agents)

**Orchestrator:**
| Agent | Role |
|---|---|
| **Arbiter** | Decision integrator. Frames questions, drives debate, synthesizes recommendations. Neutral — weighs perspectives without ego. |

**Core Perspective Agents (essential tensions):**
| Agent | Role | Core Bias |
|---|---|---|
| **Catalyst** | Acceleration and monetization. Pushes for speed, shipping, momentum. | Speed |
| **Sentinel** | Protection and durability. Guards long-term value, trust, reputation. | Sustainability |
| **Architect** | Feasibility and systems thinking. Grounds decisions in buildability. | System durability |
| **Provocateur** | Assumption-breaking and stress-testing. Speaks last (code-enforced). | Truth-seeking |

**Extended Perspective Agents (domain depth):**
| Agent | Role | Core Bias |
|---|---|---|
| **Navigator** | Market positioning, competitive timing, distribution strategy. | Positioning |
| **Advocate** | User voice and behavior reality. What users actually do vs. what teams imagine. | User behavior |
| **Pathfinder** | Asymmetric opportunities and 10x thinking. Challenges incrementalism. | Asymmetric upside |
| **Strategist** | Problem selection and sequencing. What to build, in what order, why. | Impact per effort |

**Operational Agents (new — gaps from evaluation):**
| Agent | Role | Core Bias |
|---|---|---|
| **Operator** | Execution reality. Team capacity, dependencies, delivery risk. | Execution |
| **Steward** | Ethics, compliance, governance. Legal, regulatory, reputational exposure. | Compliance |
| **Auditor** | Retrospective analysis. Tracks what worked vs. didn't. Institutional memory. | Learning |

### 3.3 Tension Pairs

Designed tensions that create productive conflict:
- **Catalyst ↔ Sentinel** — "ship now" vs. "protect long-term value"
- **Architect ↔ Pathfinder** — "what's feasible" vs. "what's 10x"
- **Advocate ↔ Navigator** — "user needs now" vs. "market timing"
- **Catalyst ↔ Pathfinder** — "proven revenue" vs. "speculative bets"
- **Strategist ↔ Operator** — "ideal sequence" vs. "execution reality"
- **Provocateur ↔ all** — stress-tests every position

---

## 4. Orchestration Profile Schema

### 4.1 Schema: `aos/profile/v1`

```yaml
schema: aos/profile/v1
id: unique-identifier
name: Profile Name
description: "What this profile does"
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    - agent: agent-id
      required: true | false
      structural_advantage: speaks-last    # code-enforced ordering (optional)

delegation:
  default: broadcast                       # broadcast | round-robin | targeted
  opening_rounds: 1                        # full broadcasts before targeted allowed
  tension_pairs:
    - [agent-a, agent-b]
  bias_limit: 5                            # max call ratio between most/least addressed

constraints:
  time:
    min_minutes: 2
    max_minutes: 10
  budget:                                  # null = no budget constraints (subscription mode auto-detected)
    min: 1.00
    max: 10.00
    currency: USD
  rounds:
    min: 2
    max: 8

input:
  format: brief | question | document | freeform
  required_sections:
    - heading: "## Section Name"
      guidance: "What to write here"
  context_files: true                      # load additional files from input dir

output:
  format: memo | report | checklist | freeform
  path_template: "output/{{format}}s/{{date}}-{{brief_slug}}-{{session_id}}/{{format}}.md"
  sections: []                             # ranked_recommendations, agent_stances, etc.
  artifacts:
    - type: diagram | audio_summary
  frontmatter: [date, duration, budget_used, participants, brief_path, transcript_path]

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent | shared | none

error_handling:
  agent_timeout_seconds: 120               # per-agent response timeout
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip                   # skip | abort_round | abort_session
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:
  strategy: rolling_average                # rolling_average | fixed_estimate
  fixed_estimate_tokens: 2000              # fallback when no history
  safety_margin: 0.15                      # 15% buffer
  on_estimate_exceeded: drop_optional      # drop_optional | warn_arbiter | block_round

controls:
  halt: true                               # user can hard-stop (kills all agents, saves transcript)
  wrap: true                               # user can early-end (steers Arbiter to call end())
  interject: false                         # future: user injects context mid-session. When enabled,
                                           # temporarily unblocks input so user can send a message that
                                           # all agents receive in their next turn.
```

### 4.2 Included Profiles

**Phase 1:**
- **strategic-council** — Multi-perspective strategic deliberation (8-12 agents). Submit a brief, get a structured memo with ranked recommendations, documented dissent, and next actions.

**Phase 2:**
- **security-review** — Security assessment and remediation planning (Architect, Sentinel, Steward, Provocateur, Operator). Informed by /CIO command patterns.
- **delivery-ops** — Product delivery orchestration (Strategist, Operator, Architect, Catalyst). Informed by /CEO command patterns.
- **architecture-review** — Technical architecture evaluation and decision-making.
- **incident-response** — Incident analysis, root cause identification, remediation planning.

---

## 5. Domain Template Schema

### 5.1 Schema: `aos/domain/v1`

Domains are optional enhancers that contextualize agents for a specific industry.

```yaml
schema: aos/domain/v1
id: unique-identifier
name: Domain Name
description: "What this domain adds"

lexicon:
  metrics: []                              # Domain-specific metrics
  frameworks: []                           # Domain-specific frameworks
  stages: []                               # Domain lifecycle stages

overlays:                                  # Per-agent enhancements
  agent-id:
    thinking_patterns: []                  # Additional patterns merged into agent
    heuristics:
      - name: Domain-Specific Heuristic
        rule: "Rule description"
    red_lines: []                          # Additional red lines

additional_input_sections:
  - heading: "## Section"
    guidance: "What to include"
    required: false

additional_output_sections:
  - section: section_id
    description: "What this section covers"

guardrails: []                             # Domain-specific constraints
```

### 5.2 Included Domains

**Phase 1:** saas (SaaS business context)
**Phase 2:** healthcare, fintech, platform-engineering, personal-decisions

---

## 5B. Input Format (Brief)

A brief is a Markdown file with required sections defined by the profile. For the strategic-council profile:

```markdown
# Brief: Should We Acquire CompetitorX?

## Situation
CompetitorX has approached us with a $15M acquisition offer. We have 18 months
of runway, $2.3M ARR growing 15% QoQ, and a team of 12 engineers.

## Stakes
**Upside:** Immediate liquidity, team retention packages, access to their
distribution network (200K users).
**Downside:** Loss of independence, potential culture clash, founder lockup period.
**If we do nothing:** Continue current trajectory — $4M ARR in 12 months if
growth holds, but runway pressure increases.

## Constraints
- 30-day exclusivity window in the LOI
- No-shop clause prevents parallel conversations
- Team of 12 — 3 key engineers have competing offers
- Current cash: $800K, burn rate $65K/month

## Key Question
Should we accept the $15M acquisition offer, negotiate for better terms,
or decline and pursue independent growth?
```

Additional `.md` files in the same directory are loaded as context files (product overviews, financials, competitive analysis).

---

## 5C. Output Format (Memo)

The strategic-council profile produces a memo with auto-injected YAML frontmatter:

```markdown
---
schema: aos/output/v1
date: 2026-03-23
session_id: a1b2c3
duration_minutes: 8.4
budget_used: 6.72
currency: USD
profile: strategic-council
domain: saas
participants:
  - arbiter
  - catalyst
  - sentinel
  - architect
  - provocateur
  - navigator
  - advocate
  - pathfinder
  - strategist
brief_path: briefs/2026-03-23-acquisition/brief.md
transcript_path: sessions/2026-03-23-acquisition-a1b2c3/transcript.jsonl
---

# Strategic Council Memo: Should We Acquire CompetitorX?

## Recommendation (Ranked)

### 1. Negotiate — counter at $18-20M with structured earnout (RECOMMENDED)
...

### 2. Accept at $15M with modified terms
...

### 3. Decline and pursue independent growth (NOT RECOMMENDED)
...

## Agent Stances

| Agent | Position | Core Reasoning | Key Concern |
|---|---|---|---|
| **Catalyst** | Accept (modified) | ... | ... |
| **Sentinel** | Negotiate | ... | ... |
| ...

## Dissent & Unresolved Tensions
...

## Trade-offs & Risks
...

## Next Actions
...

## Deliberation Summary
...
```

---

## 5D. Transcript Format

Every session produces a `.jsonl` transcript (one JSON object per line):

```jsonl
{"type":"session_start","session_id":"a1b2c3","timestamp":"...","profile":"strategic-council","domain":"saas","participants":["arbiter","catalyst",...],"constraints":{"time":{"min":2,"max":10},"budget":{"min":1,"max":10},"rounds":{"min":2,"max":8}}}
{"type":"delegation","from":"arbiter","to":"all","message":"...","timestamp":"...","round":1}
{"type":"response","from":"catalyst","to":"all","message":"...","timestamp":"...","tokens_in":1200,"tokens_out":800,"cost":0.42}
{"type":"response","from":"sentinel","to":"all","message":"...","timestamp":"...","tokens_in":1400,"tokens_out":900,"cost":0.48}
{"type":"response","from":"provocateur","to":"all","message":"...","timestamp":"...","tokens_in":2100,"tokens_out":1100,"cost":0.62,"structural_advantage":"speaks-last"}
{"type":"constraint_check","timestamp":"...","state":{"elapsed_minutes":3.2,"budget_spent":4.10,"rounds_completed":1,"past_minimums":true,"approaching_maximums":false,"hit_maximum":false}}
{"type":"delegation","from":"arbiter","to":["catalyst","sentinel"],"message":"...","timestamp":"...","round":2}
{"type":"end_session","from":"arbiter","message":"...","timestamp":"..."}
{"type":"final_statement","from":"catalyst","message":"...","timestamp":"..."}
{"type":"final_statement","from":"provocateur","message":"...","timestamp":"...","structural_advantage":"speaks-last"}
{"type":"session_end","timestamp":"...","elapsed_minutes":8.4,"total_cost":6.72,"end_reason":"deliberation_complete"}
```

---

## 5E. Workflow Schema (Phase 2)

Workflows define multi-step processes. Defined here for architectural coherence; implementation is Phase 2.

```yaml
schema: aos/workflow/v1
id: brainstorm
name: Structured Brainstorming
description: "Collaborative ideation → design exploration → spec generation"

steps:
  - id: explore
    action: read-context                   # read project files, docs, git history
    output: context_summary

  - id: clarify
    action: ask-questions                  # one at a time, multiple choice preferred
    max_questions: 8
    output: requirements

  - id: propose
    action: generate-options               # 2-3 approaches with trade-offs
    input: [context_summary, requirements]
    output: approaches

  - id: design
    action: present-sections               # section by section, get approval
    input: [approaches]
    review_gate: true                      # user must approve. On rejection: re-run step with user feedback as input. Max 3 retries.
    output: approved_design

  - id: document
    action: write-spec
    input: [approved_design]
    output_path: "docs/specs/{{date}}-{{topic}}-design.md"

gates:
  - after: design
    type: user-approval
    prompt: "Does this design look right?"

  - after: document
    type: automated-review
    max_iterations: 3
```

---

## 5F. Model Tier Mapping

Agent configs use abstract tiers. Adapters map tiers to platform-specific models:

| Tier | Pi CLI (Anthropic) | Pi CLI (OpenRouter) | Claude Code | Gemini CLI |
|---|---|---|---|---|
| `economy` | claude-haiku-4-5 | varies by provider | haiku | gemini-flash |
| `standard` | claude-sonnet-4-6 | varies by provider | sonnet | gemini-pro |
| `premium` | claude-opus-4-6 | varies by provider | opus | gemini-ultra |

The adapter's config file maps tiers to specific model IDs. Users can override per-agent:

```yaml
# adapters/pi/config.yaml
model_map:
  economy: anthropic/claude-haiku-4-5
  standard: anthropic/claude-sonnet-4-6
  premium: anthropic/claude-opus-4-6
```

Budget estimation uses the adapter's model pricing table. The constraint engine calls `adapter.getModelCost(tier)` before `dispatchParallel` to estimate whether the round will exceed budget. If estimated cost > remaining budget, the engine reduces the agent set (drops optional agents first) or warns the orchestrator.

---

## 5G. SteerMessage Governance

`steerMessage` injects a message that appears agent-initiated. Governance rules:

1. **Only the engine can call steerMessage** — not individual agents. It is used exclusively for user-triggered actions (e.g., "wrap" command steers the orchestrator to end).
2. **All steer messages are logged** in the transcript with `"type": "steer"` and `"source": "user_command"`.
3. **Adapters that don't support steerMessage** fall back to a regular `sendMessage` with a `[SYSTEM]` prefix.

---

## 6. Minimal Runtime

~1200 lines TypeScript, 7 modules:

| Module | Purpose | Lines (est.) |
|---|---|---|
| `types.ts` | Shared interfaces: `AOSAdapter`, `AgentConfig`, `AgentResponse`, `ConstraintState`, `DelegationTarget`, `SessionState`. | ~100 |
| `engine.ts` | `AOSEngine` class — the main entry point. Composes all other modules. Wires the adapter to the runtime. Drives the session lifecycle. | ~120 |
| `constraint-engine.ts` | Evaluate time/budget/rounds against profile constraints. Return `ConstraintState`. Handle constraint conflict resolution (Section 6.6). Budget estimation (Section 6.7). Mid-round budget enforcement. | ~180 |
| `delegation-router.ts` | Resolve delegation targets: broadcast, targeted, tension-pair. Enforce bias_limit with counting rules (Section 6.8). Enforce structural_advantage ordering (Section 6.4). Track per-agent call counts. | ~250 |
| `template-resolver.ts` | Replace `{{VARIABLE}}` placeholders in agent prompts with runtime values (Section 6.13). Handle missing variables gracefully (leave placeholder). | ~70 |
| `config-loader.ts` | Load and validate YAML config (agents, profiles, domains) against JSON Schema. Error reporting with meaningful messages. | ~220 |
| `domain-merger.ts` | Deep-merge domain overlay onto agent config per merge rules (Section 6.12). | ~100 |

### 6.1 Adapter Interface

The adapter is defined as four separate interfaces (one per layer). A platform adapter implements all four. Methods that a platform cannot support should throw `UnsupportedError` — the engine degrades gracefully.

```typescript
// Authentication mode (subscription vs API key billing)
interface AuthMode {
  type: "api_key" | "subscription" | "unknown";
  subscription_tier?: string;        // e.g., "max", "pro", "plus"
  metered: boolean;                  // true = per-token billing, false = flat subscription
}

// Model cost (only meaningful when AuthMode.metered === true)
interface ModelCost {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  currency: string;
}

// Layer 1: Agent Runtime
interface AgentRuntimeAdapter {
  spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle>;
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
  destroyAgent(handle: AgentHandle): Promise<void>;
  setOrchestratorPrompt(prompt: string): void;
  injectContext(handle: AgentHandle, files: string[]): Promise<void>;
  getContextUsage(handle: AgentHandle): ContextUsage;
  setModel(handle: AgentHandle, modelConfig: ModelConfig): void;
  getAuthMode(): AuthMode;
  getModelCost(tier: "economy" | "standard" | "premium"): ModelCost;
  abort(): void;
}

// Layer 2: Event Bus
interface EventBusAdapter {
  onSessionStart(handler: SessionHandler): void;
  onSessionShutdown(handler: SessionHandler): void;
  onBeforeAgentStart(handler: AgentStartHandler): void;
  onAgentEnd(handler: AgentEndHandler): void;
  onToolCall(handler: ToolCallHandler): void;
  onToolResult(handler: ToolResultHandler): void;
  onMessageEnd(handler: MessageEndHandler): void;
  onCompaction(handler: CompactionHandler): void;
}

// Layer 3: User Interface
interface UIAdapter {
  registerCommand(name: string, handler: CommandHandler): void;
  registerTool(name: string, schema: ToolSchema, handler: ToolHandler): void;
  renderAgentResponse(agent: string, response: string, color: string): void;
  renderCustomMessage(type: string, content: string, details: Record<string, any>): void;
  setWidget(id: string, renderer: WidgetRenderer | undefined): void;
  setFooter(renderer: FooterRenderer): void;
  setStatus(key: string, text: string): void;
  setTheme(name: string): void;
  promptSelect(label: string, options: string[]): Promise<number>;
  promptConfirm(title: string, message: string): Promise<boolean>;
  promptInput(label: string): Promise<string>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  blockInput(allowedCommands: string[]): void;
  unblockInput(): void;
  steerMessage(message: string): void;
}

// Layer 4: Workflow Engine
interface WorkflowAdapter {
  dispatchParallel(agents: AgentHandle[], message: string, opts?: ParallelOpts): Promise<AgentResponse[]>;
  isolateWorkspace(): Promise<WorkspaceHandle>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  openInEditor(path: string, editor: string): Promise<void>;
  persistState(key: string, value: any): Promise<void>;
  loadState(key: string): Promise<any>;
}

// Combined adapter type
type AOSAdapter = AgentRuntimeAdapter & EventBusAdapter & UIAdapter & WorkflowAdapter;
```

Note: `executeWithCheckpoints`, `reviewLoop`, and `verifyBeforeComplete` are **runtime-level orchestration logic**, not adapter methods. They live in `engine.ts` and compose adapter primitives (e.g., `reviewLoop` calls `dispatchParallel` + `sendMessage` in a loop). The adapter only provides the platform primitives.

### 6.2 Engine Class

```typescript
class AOSEngine {
  constructor(adapter: AOSAdapter, profilePath: string, opts?: { domain?: string });

  // Session lifecycle
  async start(inputPath: string): Promise<void>;
  async end(closingMessage: string): Promise<AgentResponse[]>;

  // Delegation (uses delegation-router internally)
  async delegateMessage(to: string | string[] | "all", message: string): Promise<AgentResponse[]>;

  // Constraint inspection
  getConstraintState(): ConstraintState;

  // Workflow orchestration (composes adapter primitives)
  async executeWithCheckpoints(steps: Step[], reviewFn: ReviewFn): Promise<void>;
  async reviewLoop(dispatchFn: DispatchFn, fixFn: FixFn, maxIterations: number): Promise<void>;
  async verifyBeforeComplete(evidenceFn: EvidenceFn): Promise<boolean>;
}
```

### 6.3 Session Lifecycle

```
aos run <profile> [--domain <domain>]
  │
  ├─► Engine loads profile.yaml + agent configs + optional domain overlays
  ├─► Engine validates input (brief) against profile.input.required_sections
  ├─► Adapter.onSessionStart fires
  ├─► Adapter.setOrchestratorPrompt injects Arbiter's resolved system prompt
  ├─► Adapter.blockInput(["halt", "wrap"])
  ├─► Engine writes session_start to transcript
  │
  ├─► Arbiter receives brief + context files, calls delegateMessage("all", framing)
  │   │
  │   ├─► delegation-router resolves "all" → broadcast to all required agents
  │   │   (Provocateur excluded from broadcast — speaks last)
  │   ├─► Adapter.dispatchParallel spawns agents concurrently
  │   │   ├─► Per-agent: spawnAgent (if first call) → sendMessage → stream response
  │   │   ├─► constraint-engine checks budget after each agent completes
  │   │   └─► If budget exceeded mid-round: remaining agents aborted, partial results returned
  │   ├─► Provocateur called last (structural_advantage: speaks-last)
  │   ├─► constraint-engine evaluates full state (time + budget + rounds)
  │   ├─► Responses + ConstraintState returned to Arbiter
  │   └─► Transcript entries written
  │
  ├─► Arbiter reads constraint state, calls delegateMessage again (targeted or broadcast)
  │   (repeats until hit_maximum or Arbiter decides to end)
  │
  ├─► Arbiter calls engine.end(closing_message)
  │   ├─► All agents give final statements (parallel, Provocateur last)
  │   ├─► Transcript meeting_end written
  │   └─► Final statements returned to Arbiter
  │
  ├─► Arbiter writes output (memo) via Adapter.writeFile
  │   ├─► Adapter.onToolResult fires → inject frontmatter
  │   └─► Adapter.openInEditor
  │
  ├─► Adapter.unblockInput
  └─► Adapter.onSessionShutdown fires
```

### 6.4 Structural Advantage: Provocateur Speaks Last

When `structural_advantage: speaks-last` is set on an agent:

1. **Broadcast rounds:** The agent is excluded from `dispatchParallel`. After all other agents respond, the speaks-last agent is called separately with the full round's responses as context.
2. **End session:** Same — all other agents give final statements first, speaks-last agent goes last.
3. **Targeted calls:** If the orchestrator specifically addresses the speaks-last agent, it responds normally (no special ordering).

This ensures the stress-testing perspective always has the most complete picture before speaking.

### 6.5 Error Handling & Recovery

Failures in a multi-agent subprocess system are routine, not edge cases. The framework defines explicit error handling at every level.

**Per-agent timeout and retry:**

```yaml
# Addition to profile schema
error_handling:
  agent_timeout_seconds: 120           # per-agent response timeout
  retry_policy:
    max_retries: 2
    backoff: exponential               # 1s, 2s, 4s
  on_agent_failure: skip               # skip | abort_round | abort_session
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag
```

**Failure modes and responses:**

| Failure | Engine Response | Transcript Entry |
|---|---|---|
| Agent hangs (exceeds `agent_timeout_seconds`) | Kill subprocess. Retry per policy. If retries exhausted, apply `on_agent_failure`. | `{"type":"error","agent":"catalyst","error_type":"timeout","message":"Exceeded 120s","round":2}` |
| Agent crashes (non-zero exit) | Retry per policy. If retries exhausted, apply `on_agent_failure`. | `{"type":"error","agent":"catalyst","error_type":"crash","message":"Exit code 1: ..."}` |
| Network failure during API call | Retry with exponential backoff. After max retries, treat as agent crash. | `{"type":"error","error_type":"network","message":"Connection refused"}` |
| Arbiter fails mid-session | Save transcript immediately. Write partial `session_end` entry with `end_reason: "orchestrator_failure"`. Exit. | `{"type":"session_end","end_reason":"orchestrator_failure"}` |
| Budget exceeded mid-round | Abort remaining agents in `dispatchParallel`. Return partial results with status flags. | `{"type":"budget_abort","completed":["catalyst","sentinel"],"aborted":["architect","navigator"]}` |

**Partial result handling:** When `on_agent_failure: skip`, the engine marks the failed agent's response as `{"status": "failed", "error": "..."}` in the round results. The Arbiter receives all responses including failed ones and can see which agents did not respond. When `on_agent_failure: abort_round`, the engine discards the entire round and returns a constraint message to the Arbiter.

### 6.6 Constraint Conflict Resolution

When constraints conflict (e.g., min time not met but max budget hit), the engine follows an explicit priority order:

```
Constraint Priority (highest to lowest):
1. budget_max  — Hard ceiling. Always wins. Session ends.
2. time_max    — Hard ceiling. Always wins. Session ends.
3. rounds_max  — Hard ceiling. Always wins. Session ends.
4. rounds_min  — Soft floor. Overridden by any max ceiling.
5. time_min    — Soft floor. Overridden by any max ceiling.
6. budget_min  — Soft floor. Overridden by any max ceiling.
```

**Resolution rules:**

- **Hard maximums always win.** If any maximum is hit before a minimum is met, the session ends. The transcript records `end_reason: "constraint_conflict"` with details on which minimum was unsatisfied.
- **Approaching maximums (80%+)** trigger a `constraint_warning` event and a message to the Arbiter advising it to start wrapping up.
- **All minimums met + no maximums hit** = normal operation. The Arbiter decides whether to continue or end.
- **Arbiter attempts to end before minimums** = engine rejects the `end()` call with a message listing unmet minimums. Exception: if a maximum is also hit (conflict case above), the end is allowed.

**ConstraintState return format (returned to Arbiter after every round):**

```typescript
interface ConstraintState {
  elapsed_minutes: number;
  budget_spent: number;
  rounds_completed: number;
  // Minimum thresholds
  past_min_time: boolean;
  past_min_budget: boolean;
  past_min_rounds: boolean;
  past_all_minimums: boolean;        // convenience: all three above
  // Maximum thresholds
  approaching_max_time: boolean;     // >= 80% of max
  approaching_max_budget: boolean;
  approaching_max_rounds: boolean;
  approaching_any_maximum: boolean;  // convenience
  // Hard stop
  hit_maximum: boolean;
  hit_reason: "none" | "time" | "budget" | "rounds" | "constraint_conflict";
  conflict_detail?: string;          // e.g., "budget_max hit before time_min met"
  // Available actions
  can_end: boolean;                  // true if all minimums met OR a maximum is hit
  // Bias tracking (from delegation-router, Section 6.8)
  bias_ratio: number;                // current max/min call ratio
  most_addressed: string[];          // agents with highest call count
  least_addressed: string[];         // agents with lowest call count
  bias_blocked: boolean;             // true if targeted calls to most_addressed are blocked
  // Budget awareness (from auth mode, Section 1.3 fix)
  metered: boolean;                  // false if subscription mode — budget fields are zeroes
}
```

### 6.7 Budget Estimation & Authentication Awareness

The constraint engine adapts to the user's authentication mode:

```
Constraint engine behavior by auth mode (from adapter.getAuthMode()):

- metered: true (API key)
  Budget constraints fully active. getModelCost returns real pricing.
  Budget fields shown in Arbiter constraint messages.

- metered: false (subscription — e.g., Claude Max, ChatGPT Pro)
  Budget constraints DISABLED automatically. budget_spent always 0.
  Arbiter constraint message omits budget section entirely.
  Time and round constraints still enforced.
  Transcript records token counts (for analytics) but cost fields are 0.

- budget: null in profile schema
  Budget constraints explicitly disabled regardless of auth mode.
  Same behavior as metered: false.
```

When budget constraints ARE active, before each `dispatchParallel` call the constraint engine estimates cost:

```yaml
budget_estimation:
  strategy: rolling_average            # rolling_average | fixed_estimate
  fixed_estimate_tokens: 2000          # fallback when no history exists
  safety_margin: 0.15                  # 15% buffer
  on_estimate_exceeded: drop_optional  # drop_optional | warn_arbiter | block_round
```

**Algorithm:**
1. `getModelCost(tier)` returns per-million-token pricing from the adapter
2. For each agent in the round, estimate tokens: use rolling average of that agent's previous responses (or `fixed_estimate_tokens` if first round)
3. Total estimated cost = sum of all agents × (input estimate + output estimate) × model cost
4. Apply `safety_margin` (add 15%)
5. If estimated cost > remaining budget:
   - `drop_optional`: Remove `required: false` agents from the round, re-estimate. If still over budget, `warn_arbiter`.
   - `warn_arbiter`: Return a budget warning to the Arbiter with the estimate. Arbiter decides whether to proceed.
   - `block_round`: Reject the delegation call, force end.

`getModelCost(tier)` and `ModelCost` are defined in the `AgentRuntimeAdapter` interface (Section 6.1).

### 6.8 Bias Limit Enforcement

`bias_limit` prevents the Arbiter from ignoring perspectives. Counting rules:

```
Bias limit tracking:
- Broadcast rounds: increment ALL agents equally (included in count)
- Targeted rounds: increment ONLY addressed agents
- Ratio = max(call_counts) / min(call_counts) for REQUIRED agents only
  (optional agents excluded from ratio calculation)
- Speaks-last agents: their guaranteed final turn in broadcast rounds counts
  toward their total

Enforcement:
- When ratio >= bias_limit: engine BLOCKS targeted calls to the most-called
  agents. Returns a constraint message to the Arbiter listing neglected agents.
- The Arbiter must address neglected agents before it can target the
  over-addressed agents again.
- Bias state is included in ConstraintState:
  bias_ratio: number,
  most_addressed: string[],
  least_addressed: string[],
  bias_blocked: boolean
```

### 6.9 Expertise Scratch Pad Concurrency

With `dispatchParallel`, multiple agents run concurrently. Scratch pad access rules:

```
Expertise concurrency rules:
- mode: per-agent (DEFAULT) — Each agent writes only to its own scratch pad.
  No concurrency issues. This is the recommended mode.
- mode: shared — All agents read/write a single scratch pad.
  Writes use append-only semantics with timestamped entries.
  File locking: advisory flock. Last-write-wins on lock contention.
  Not recommended for parallel dispatch.
- mode: none — No scratch pads. Agents have no persistent expertise.

Scratch pad entry format (for both modes):
  ## [agent-id] — [ISO timestamp]
  <free-form markdown notes>
  ---

Config enforcement:
  If profile uses dispatchParallel AND any agent has mode: shared,
  config-loader.ts emits a WARNING during validation.
```

### 6.10 Complete Transcript Event Types

| Event Type | When Emitted | Required Fields |
|---|---|---|
| `session_start` | Session begins | session_id, profile, domain, participants, constraints, auth_mode |
| `agent_spawn` | Agent subprocess created | agent_id, model_tier, session_id |
| `delegation` | Arbiter delegates | from, to, message, round |
| `response` | Agent responds | from, message, tokens_in, tokens_out, cost |
| `constraint_check` | After each round | full ConstraintState object |
| `constraint_warning` | Approaching a maximum | constraint_type, current, max |
| `budget_estimate` | Pre-round cost estimate | estimated_cost, remaining_budget, agents_included |
| `budget_abort` | Budget exceeded mid-round | completed, aborted |
| `steer` | SteerMessage injected | source, target, message |
| `error` | Agent failure | agent_id, error_type, message, round |
| `expertise_write` | Scratch pad updated | agent_id, path, entry_length |
| `end_session` | Arbiter closes deliberation | from, message |
| `final_statement` | Agent final statement | from, message, structural_advantage? |
| `agent_destroy` | Agent subprocess torn down | agent_id |
| `session_end` | Session complete | elapsed_minutes, total_cost, end_reason |

### 6.11 Arbiter Constraint Message Format

After every round, the engine injects a structured constraint message into the Arbiter's context. This message is rendered by a dedicated function in `engine.ts`, not by `template-resolver.ts`. The `{{#if}}` blocks below represent conditional logic in code, not template syntax.

```markdown
---
## Deliberation Status — Round {{round}}

### Constraints
- **Time:** {{elapsed}} / {{max_time}} min ({{time_pct}}%)
{{#if metered}}
- **Budget:** ${{spent}} / ${{max_budget}} ({{budget_pct}}%)
{{/if}}
- **Rounds:** {{rounds}} / {{max_rounds}} (minimums {{met_or_not}})
- **Bias:** {{bias_ratio}}:1 (limit {{bias_limit}}) {{blocked_notice}}

### Available Actions
- `delegate("all", "message")` — broadcast to full board
- `delegate(["agent-a", "agent-b"], "message")` — targeted
- `delegate("tension", "catalyst", "sentinel", "message")` — tension pair
- `end("closing message")` — {{end_available_or_blocked}}

{{#if approaching_maximum}}
⚠️ APPROACHING LIMIT: {{approaching_detail}}. Consider wrapping up.
{{/if}}

{{#if hit_maximum}}
🛑 LIMIT REACHED: {{hit_detail}}. You MUST call end() now.
{{/if}}

{{#if bias_blocked}}
⚠️ BIAS LIMIT: You have addressed {{most_addressed}} {{bias_ratio}}x more than {{least_addressed}}. Target neglected agents before continuing.
{{/if}}
---
```

### 6.12 Domain Merge Rules

When a domain overlay is applied to an agent:

```
Merge rules (domain-merger.ts):
- thinking_patterns: domain patterns APPENDED after agent patterns
- heuristics: domain heuristics APPENDED (no dedup by name — both kept)
- red_lines: domain red_lines APPENDED (union, never removes)
- evidence_standard.convinced_by: domain values APPENDED
- evidence_standard.not_convinced_by: domain values APPENDED
- temperament: domain values APPENDED
- tensions: NOT merged (profile-level only)

Override rule: domain NEVER removes or replaces agent-level config.
It only adds. If domain provides a field that the agent also has,
both are kept (appended).

Multiple domains: Currently single-domain only (profile --domain flag).
Multi-domain is a future consideration. If implemented, domains would be
applied in order, each appending to the previous result.
```

### 6.13 Template Variable Reference

| Variable | Available In | Description |
|---|---|---|
| `{{date}}` | All templates | ISO date (YYYY-MM-DD) |
| `{{session_id}}` | All templates | Unique session identifier (6-char alphanumeric) |
| `{{brief_slug}}` | Output/expertise paths, prompts | Slugified brief directory name |
| `{{brief}}` | Orchestrator prompt | Full brief markdown content |
| `{{format}}` | Output path template | Output format from profile (memo, report, etc.) |
| `{{agent_id}}` | Agent prompts, expertise paths | Current agent's ID |
| `{{agent_name}}` | Agent prompts | Current agent's human-readable name |
| `{{profile_id}}` | Prompts | Current profile ID |
| `{{domain_id}}` | Prompts | Current domain ID (empty string if none) |
| `{{participants}}` | Orchestrator prompt | Comma-separated list of active agent names |
| `{{constraints}}` | Orchestrator prompt | Formatted constraint summary (min-max time, budget, rounds) |
| `{{expertise_block}}` | Agent prompts | Rendered list of expertise files with paths and use_when |
| `{{skills_block}}` | Agent prompts | Rendered list of skills with paths and use_when |
| `{{output_path}}` | Orchestrator prompt | Full path where output should be written |
| `{{deliberation_dir}}` | Agent prompts | Session directory for artifacts (SVGs, etc.) |
| `{{transcript_path}}` | Agent prompts | Path to the .jsonl transcript |

### 6.14 Tool Whitelist Semantics

The `tools` field in the agent schema:
- `tools: null` or field omitted → **platform defaults** (all tools the platform provides)
- `tools: []` (empty array) → **no tools** (agent can only respond with text, cannot call any tools)
- `tools: ["read", "write", "bash"]` → **explicit whitelist** (only these tools available)

The adapter enforces the whitelist when spawning the agent subprocess.

### 6.15 Arbiter System Prompt Structure (Skeleton)

The Arbiter's `prompt.md` is the most important prompt in the system. It must cover these sections in order:

1. **Identity & Role** — You are the Arbiter: a neutral decision synthesizer. You have no personal bias, no advocacy position. Your job is to frame questions, drive productive debate between perspective agents, and synthesize competing views into actionable recommendations. You are not a CEO, not a leader — you are an integrator.

2. **Deliberation Protocol** — On receiving a brief:
   - Read and internalize the situation, stakes, constraints, and key question
   - Open with a broadcast framing the core decision for all agents
   - After opening round: identify the strongest tensions and pursue them with targeted follow-ups
   - Use tension pairs when the room gets too comfortable or when two perspectives need direct confrontation
   - Do NOT loop through agents individually with the same question — use broadcast

3. **Constraint Awareness** — After every round you receive a Constraint Status block. Read it. Act on it:
   - If `can_end` is false: you MUST continue deliberating
   - If `approaching_any_maximum` is true: start wrapping — one more focused round
   - If `hit_maximum` is true: you MUST call `end()` immediately
   - If `bias_blocked` is true: address the neglected agents before continuing

4. **Delegation Syntax** — Your tools:
   - `delegate("all", "message")` — broadcast to full assembly
   - `delegate(["agent-a", "agent-b"], "message")` — targeted
   - `delegate("tension", "agent-a", "agent-b", "message")` — tension pair confrontation
   - `end("closing message")` — collect final statements and close

5. **Synthesis Instructions** — After `end()` returns final statements, write the output:
   - Ranked recommendations (top 3 with rationale for ordering)
   - Agent stance table (agent, position, core reasoning, key concern)
   - Dissent & unresolved tensions (name them, don't smooth them over)
   - Trade-offs & risks (structured table)
   - Next actions (concrete, assignable, time-bound)
   - Deliberation summary (3-5 paragraphs: how the conversation evolved, which tensions proved most productive, what shifted)

6. **Expertise** — You have a scratch pad. Use it to track: which agents are converging vs. diverging, which arguments have been stress-tested vs. assumed, your evolving thesis on the key question.

Template variables: `{{brief}}`, `{{participants}}`, `{{constraints}}`, `{{output_path}}`, `{{deliberation_dir}}`, `{{expertise_block}}`

---

## 6B. Testing Strategy

### Unit Tests (runtime/tests/)

| Module | Test Focus |
|---|---|
| `constraint-engine` | Property tests for all constraint combinations. Edge cases: all mins unmet + max hit (conflict). Budget at exact boundary. Zero-budget sessions. |
| `delegation-router` | Bias limit enforcement at boundary (ratio = exactly limit). Speaks-last ordering in broadcast + end. Broadcast with optional agents excluded. Targeted with unknown agent name. |
| `template-resolver` | Variable substitution with missing variables (should leave placeholder). Extra variables (should ignore). Nested `{{` escaping. |
| `config-loader` | Schema validation for valid and invalid configs. Missing required fields. Unknown schema version. Malformed YAML. |
| `domain-merger` | All merge rules. Domain with empty overlays. Agent with no matching overlay. Multiple heuristics with same name. |
| `engine` | Session lifecycle: start → delegate → constraint check → end. Arbiter attempts end before minimums. Budget abort mid-round. Timeout and retry. |

### Integration Tests

- **Mock adapter** implementing all 4 layers with in-memory state (no Pi, no subprocesses)
- Full session lifecycle: start → broadcast round → targeted round → end → output
- Transcript validation: all required events present in correct chronological order
- Constraint conflict: configure min_time=5, max_budget=$0.01 — verify session ends with `constraint_conflict`

### Agent Differentiation Tests

- Same brief submitted to each of the 12 agents individually (via mock adapter with real model calls)
- Validate that responses differ meaningfully in stance, time horizon, and evidence cited
- Manual review rubric: does each agent's response align with its `core_bias` and `objective_function`?

---

## 6C. Security Considerations

**Sandboxing:** Agents spawned via the adapter are restricted by the adapter's platform sandbox. The Pi adapter uses `--no-extensions --no-skills --no-prompt-templates --no-themes` to constrain agent subprocesses. Agents can read/write files within the session workspace and expertise paths. Access to paths outside these is platform-dependent.

**Tool whitelisting:** Enforced by the adapter at spawn time (see Section 6.14). An agent with `tools: []` cannot execute any tools — it can only respond with text.

**Context file safety:** The engine does not filter context file contents. Users are responsible for not including secrets in brief context files. A future enhancement could add a `.aosignore` pattern file.

**Authentication & API key management:** Model authentication is managed by the adapter, not the harness core. Adapters support multiple auth modes:

- **API key (metered):** Pi CLI with direct Anthropic/OpenRouter keys. Per-token billing. Keys referenced via environment variable names in adapter config, never stored directly.
- **Account subscription (unmetered):** Pi CLI authenticated with Claude Max/Pro. Codex CLI authenticated with ChatGPT Pro. No per-token cost. The adapter reports auth mode via `getAuthMode()` so the engine disables budget constraints automatically.
- **Platform-managed:** Claude Code uses its own authentication. Gemini CLI uses Google Cloud credentials.

The adapter's `getAuthMode()` method tells the engine whether billing is metered, which determines whether budget constraints are active (Section 6.7).

**SteerMessage:** Governed by Section 5G rules — only the engine can call it, all invocations are logged with `type: "steer"`.

---

## 6D. Observability (Phase 1)

Even without the Tier 3 web platform, Phase 1 users need debugging capabilities:

- **`--verbose` flag:** Streams engine decisions to stderr — delegation routing choices, constraint evaluations, bias limit status, budget estimates, template resolution.
- **`--dry-run` flag:** Validates all config (agents, profile, domain, brief) against schemas. Simulates delegation routing and constraint evaluation without calling any models. Reports estimated cost and session structure.
- **`aos replay <transcript.jsonl>`** command: Re-renders a transcript visually in the TUI (Pi adapter) or as formatted terminal output (other adapters). Shows agent responses in order with constraint states.

---

## 6E. Schema Versioning

```
Schema versioning policy:
- Schemas are versioned: aos/agent/v1, aos/profile/v1, etc.
- Minor additions (new optional fields): backwards-compatible, same version.
- Breaking changes (required field additions, semantic changes): bump to v2.
- config-loader.ts validates schema version and rejects unknown versions
  with a clear error message naming the expected version.
- Migration: `aos migrate <path> --from v1 --to v2` (future tooling).
- All config files must include `schema: aos/<type>/v1` as the first field.
```

---

## 7. Repo Structure

```
aos-harness/
│
├── core/                                  # Language-agnostic framework core
│   ├── schema/                            # JSON Schema for validation
│   │   ├── agent.schema.json
│   │   ├── profile.schema.json
│   │   ├── domain.schema.json
│   │   └── adapter.schema.json
│   ├── agents/                            # Agent persona library
│   │   ├── orchestrators/
│   │   │   └── arbiter/
│   │   │       ├── agent.yaml
│   │   │       └── prompt.md
│   │   ├── perspectives/
│   │   │   ├── catalyst/
│   │   │   ├── sentinel/
│   │   │   ├── architect/
│   │   │   ├── provocateur/
│   │   │   ├── navigator/
│   │   │   ├── advocate/
│   │   │   ├── pathfinder/
│   │   │   └── strategist/
│   │   └── operational/
│   │       ├── operator/
│   │       ├── steward/
│   │       └── auditor/
│   ├── profiles/                          # Orchestration profiles
│   │   ├── strategic-council/
│   │   │   ├── profile.yaml
│   │   │   └── README.md
│   │   ├── security-review/
│   │   ├── delivery-ops/
│   │   ├── architecture-review/
│   │   └── incident-response/
│   ├── domains/                           # Optional domain knowledge packs
│   │   ├── saas/
│   │   ├── healthcare/
│   │   ├── fintech/
│   │   ├── platform-engineering/
│   │   └── personal-decisions/
│   └── workflows/                         # Process templates
│       ├── brainstorm.workflow.yaml
│       ├── plan.workflow.yaml
│       ├── execute.workflow.yaml
│       ├── review.workflow.yaml
│       ├── debug.workflow.yaml
│       └── verify.workflow.yaml
│
├── runtime/                               # Minimal shared runtime (~1200 lines TS)
│   ├── src/
│   │   ├── constraint-engine.ts
│   │   ├── delegation-router.ts
│   │   ├── template-resolver.ts
│   │   ├── config-loader.ts
│   │   ├── domain-merger.ts
│   │   ├── engine.ts
│   │   └── types.ts
│   ├── tests/
│   └── package.json
│
├── adapters/                              # Platform-specific implementations
│   ├── pi/                                # Pi CLI extension (PRIMARY)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent-runtime.ts           # L1
│   │   │   ├── event-bus.ts               # L2
│   │   │   ├── ui.ts                      # L3
│   │   │   └── workflow.ts                # L4
│   │   ├── themes/
│   │   └── package.json
│   ├── claude-code/                       # Claude Code integration
│   │   ├── agents/
│   │   ├── commands/
│   │   ├── skills/
│   │   └── generate.ts
│   └── gemini/                            # Gemini CLI integration
│       ├── extensions/
│       └── generate.ts
│
├── platform/                              # Tier 3: Web platform (future)
│   ├── api/
│   ├── ui/
│   └── db/
│
├── docs/
│   ├── specs/
│   ├── getting-started/
│   ├── creating-agents/
│   ├── creating-profiles/
│   ├── creating-domains/
│   └── building-adapters/
│
├── README.md
├── LICENSE
├── package.json
└── justfile
```

---

## 8. User Experience by Tier

### Tier 1: Install & Run

```bash
bun add aos-harness
aos init --adapter pi
aos run strategic-council
# → Select a brief, watch deliberation, get a memo
```

The user writes a brief with required sections, selects it, and watches agents deliberate in real-time. Output is a structured memo with ranked recommendations, agent stances, dissent, and next actions.

### Tier 2: Customize & Build

```bash
aos create agent my-custom-agent
aos create profile my-team-profile
aos create domain my-industry
aos validate
```

The user creates custom agents (YAML + markdown), assembles them into profiles, and optionally creates domain packs. Schema validation ensures everything is well-formed before running.

### Tier 3: Full Platform

```bash
aos platform init
aos platform start
# → http://localhost:3000
```

Web dashboard with session management, deliberation replay, cost analytics across teams, and enterprise features (SSO, team management).

---

## 9. Build Phases

### Phase 1 — Core + Runtime + Pi Adapter

Deliverables:
- `core/schema/` — JSON Schema for agent, profile, domain
- `core/agents/` — All 12 agent personas (YAML + markdown prompts)
- `core/profiles/strategic-council/` — First working profile
- `core/domains/saas/` — First domain pack
- `runtime/` — Constraint engine, delegation router, template resolver, config loader, domain merger
- `runtime/tests/` — Unit tests for all runtime modules
- `adapters/pi/` — Full Pi CLI extension implementing all 4 adapter layers
- `docs/getting-started/` — Install and run guide

**Success criteria:** An engineer can install the harness, run `aos run strategic-council` in Pi CLI, submit a brief, watch a multi-agent deliberation with real-time streaming and constraint gauges, and receive a structured memo.

### Phase 2 — More Profiles + Domains + Claude Code

Deliverables:
- 4 additional profiles (security-review, delivery-ops, architecture-review, incident-response)
- 4 additional domains (healthcare, fintech, platform-engineering, personal-decisions)
- `core/workflows/` — Process templates (brainstorm, plan, execute, review, debug, verify)
- `adapters/claude-code/` — Generate .claude artifacts from core config
- `docs/creating-agents/`, `docs/creating-profiles/`, `docs/creating-domains/`

### Phase 3 — Gemini Adapter + Web Platform

Deliverables:
- `adapters/gemini/` — Gemini CLI integration
- `platform/` — Web dashboard (FastAPI + Next.js + PostgreSQL)
- Session replay, cost analytics, team management
- `docs/building-adapters/`

### Phase 4 — AOS.engineer Integration

Deliverables:
- Course curriculum mapped to framework tiers
- Community features (agent marketplace, profile sharing)
- Enterprise SSO and team management
- Content feed integration

---

## 10. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Config format | YAML + Markdown | Language-agnostic, human-readable, git-friendly. YAML for structured metadata, markdown for system prompts. |
| Runtime language | TypeScript | Runs natively in Pi (extensions) and Bun. ~1200 lines — small enough to port to Python for web platform. |
| Primary adapter | Pi CLI | Early adopter users can use Pi but not Claude Code in enterprise environments. Pi has the richest extension API (20+ lifecycle events, TUI widgets, custom tools). **Platform risk:** Pi is newer than Claude Code — the adapter contract itself mitigates this, since swapping the primary adapter requires no core/runtime changes. |
| Agent naming | Original single-word role names | No overlap with reference implementations. Names describe function, not corporate title. Domain-agnostic. |
| Structural advantages | Code-enforced | Provocateur speaks last is enforced by the delegation router, not just a prompt instruction. Addresses a gap found in the ceo-agents evaluation. |
| Domains | Optional enhancers | A profile runs perfectly without a domain. Domains sharpen agent reasoning for a specific industry context. |
| Deliberation model | Orchestrator-as-synthesizer | The Arbiter doesn't just route — it synthesizes. No algorithmic voting or weighting. The orchestrator's judgment is the synthesis mechanism. |
| Bias enforcement | Code-enforced via bias_limit | Maximum ratio of calls to any agent vs. least-called agent. Prevents the orchestrator from ignoring perspectives. |

---

## 11. Patterns Extracted From Evaluation

These patterns were identified in the ceo-agents deep evaluation (2026-03-23) and inform this framework:

1. **Controlled-bias cognitive framework** — Each agent has an explicit objective function, time horizon, core bias, and risk tolerance. This produces genuinely differentiated responses.
2. **Tension pair design** — Deliberately opposing agents create productive conflict. The value IS the tension.
3. **Constraint-driven deliberation** — Time/budget/round constraints with min/max thresholds force both depth (minimums) and discipline (maximums).
4. **Expertise accumulation** — Persistent scratch pads that agents read/write across sessions create compounding domain knowledge.
5. **Orchestrator-as-synthesizer** — The orchestrator doesn't just route; it synthesizes competing perspectives into ranked recommendations with documented dissent.
6. **Structural advantages** — Code-enforced ordering ensures certain perspectives (Provocateur) get the last word, preventing premature consensus.
7. **Session-scoped isolation** — Fresh agent state per session prevents cross-session contamination.

All patterns are reimplemented with original naming, enhanced architecture, and additional capabilities not present in the reference (code-enforced ordering, bias limits, domain overlays, workflow engine, multi-platform adapters).

---

## Appendix: Reference Projects

These projects were studied for patterns. No code was copied. All naming, architecture, and implementation is original.

- **ceo-agents** (IndyDevDan) — Pi-based CEO & Board deliberation system. Evaluated 2026-03-23. Key learnings: controlled-bias personas, constraint engine, expertise scratch pads, parallel subprocess execution.
- **multi-agent-orchestration** (IndyDevDan) — Python/PostgreSQL web-based orchestration with real-time streaming. Key learnings: web UI patterns, PostgreSQL persistence, WebSocket streaming.
- **Superpowers** (open-source community) — Claude Code skills plugin. Key learnings: process workflows (brainstorming, planning, TDD, debugging), verification patterns, parallel agent dispatch.

---

## Appendix B: Claude Code Adapter Strategy (Phase 2)

The Claude Code adapter is a **code generator**, not a runtime adapter. `adapters/claude-code/generate.ts` reads core config (agents, profiles, domains) and produces static `.claude/` artifacts:

**Generated artifacts:**
- `.claude/agents/` — One file per agent. YAML frontmatter (from agent.yaml) + flattened system prompt (from prompt.md with variables pre-resolved where possible)
- `.claude/commands/` — Slash commands mapped from profile controls and delegation syntax (e.g., `/strategic-council` that kicks off a deliberation)
- `CLAUDE.md` additions — Orchestrator instructions, constraint rules (as prompt instructions), agent roster, delegation syntax

**Limitations vs. Pi adapter:**
- **No runtime constraint engine** — constraints encoded as prompt instructions to the Arbiter ("you have approximately 10 minutes and should keep costs under $10")
- **No bias limit enforcement** — advisory only, via prompt instruction
- **No real-time budget tracking** — model cost awareness via prompt, not code
- **No TUI widgets or steerMessage** — terminal text output only
- **No tool interception** — hooks only (Claude Code limitation)
- **Parallel dispatch** — via Claude Code's native Agent tool (multiple concurrent agents)

**What IS preserved:**
- Same agent personas and cognitive frameworks
- Same deliberation structure (broadcast → targeted → end → synthesize)
- Same output format (memo with stances, dissent, next actions)
- Same expertise scratch pads (file-based, per-agent)
- Same domain overlays (baked into generated prompts)

The adapter contract means a Claude Code user gets the same strategic value from deliberation, but without the code-enforced runtime guarantees that Pi provides. This is an acceptable trade-off for Phase 2 — the core IP is in the agent personas and orchestration structure, not the enforcement mechanisms.

---

## Appendix C: `adapter.schema.json` Scope

The `core/schema/adapter.schema.json` file validates the **adapter's configuration file** (e.g., `adapters/pi/config.yaml`), not the TypeScript interface itself. It defines the schema for:

```yaml
# adapters/pi/config.yaml (validated by adapter.schema.json)
platform: pi
model_map:
  economy: anthropic/claude-haiku-4-5
  standard: anthropic/claude-sonnet-4-6
  premium: anthropic/claude-opus-4-6
theme: synthwave
editor: code
```

The TypeScript adapter interfaces (Section 6.1) are the code contract. The JSON Schema validates the adapter's static configuration.
