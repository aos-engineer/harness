# AOS Harness Enhanced Capabilities Design

**Date:** 2026-04-10
**Status:** Draft
**Scope:** AOS Harness + AOS Platform (cross-repo)
**Approach:** Contract-First Enhancement (Approach 2)

## Overview

This spec defines four capability enhancements to the AOS Harness, drawing logic and patterns from two reference projects (lead-agents, multi-agent-orchestration) while adapting them to AOS's config-first, layered architecture. All enhancements are designed in conjunction with the AOS Platform to ensure both repositories stay in sync via shared type contracts.

**Reference projects (ideas extracted, no code copied):**
- `lead-agents` — Depth-2 hierarchical delegation, persistent mental models, domain locking, shared conversation context, skills composition
- `multi-agent-orchestration` — Real-time WebSocket streaming with hook-based event capture, subagent templates, session resumption, AI event summarization, per-agent cost tracking, file change tracking

**Capabilities being added:**
1. Hierarchical Delegation (Lead → Worker sub-agents)
2. Persistent Agent Intelligence (Mental Models & Expertise)
3. Domain Enforcement & Safety (Structural permission boundaries)
4. Enhanced Observability & Real-Time Control (Richer events, summarization, session resumption, file tracking)
5. Shared Type Contracts (Single source of truth across repos)

## Architectural Decision: Extend Existing Layers

New capabilities are added as extensions to the existing L1-L4 adapter contract, not as new layers or a restructured contract.

**Rationale:**
- L1-L4 is working, tested (194 tests), and the Pi adapter is fully implemented
- New capabilities map naturally to existing layers
- One new optional mixin (`PersistenceAdapter`) added for session state and expertise

| New Capability | Adapter Layer |
|---|---|
| Hierarchical delegation (spawn sub-agents) | L1 (Agent Runtime) |
| Persistent expertise (load/persist) | L1 (Agent Runtime) + PersistenceAdapter mixin |
| Domain enforcement (tool/file access) | L4 (Workflow Engine) |
| Real-time event streaming | L2 (Event Bus) — extends `onTranscriptEvent` |
| Session resumption | L1 + L2 (session lifecycle) |
| Cost tracking | L2 (Event Bus) — hook-based capture |
| File change tracking | L4 (Workflow Engine) — post-execution hook |

---

## 1. Hierarchical Delegation

### Concept

Agents can spawn and manage sub-agents, creating depth-2 (or deeper) delegation chains. An orchestrator delegates to a lead agent, who spawns workers to execute in parallel. All communication flows through the parent — no direct agent-to-agent messaging.

### Agent Hierarchy Model

```
Profile (assembly)
  └── Orchestrator (existing)
        ├── Perspective Agent (existing — can now be a "Lead")
        │     ├── Worker Agent (spawned on demand)
        │     └── Worker Agent (spawned on demand)
        └── Perspective Agent (existing)
```

### Schema Additions — `agent.yaml`

```yaml
# New fields on existing agent schema
delegation:
  can_spawn: true                          # This agent can create sub-agents
  max_children: 3                          # Cap on concurrent sub-agents
  child_model_tier: economy                # Default model tier for spawned workers
  child_timeout_seconds: 120               # Per-child timeout
  delegation_style: delegate-only | delegate-and-execute
  # "delegate-only" = lead pattern: agent's tool_allowlist is ignored, only
  #   delegation tools (spawnSubAgent, messageChild) are available. The agent
  #   routes work to children but never reads/writes/executes directly.
  # "delegate-and-execute" = hybrid: agent retains its normal tool_allowlist
  #   AND can spawn children. Use for agents that do light work themselves
  #   but offload heavy tasks to workers.
```

### Runtime Changes

- `AOSEngine` gets `spawnChildAgent(parentId, childConfig)` and `destroyChildAgent(parentId, childId)` methods
- L1 adapter contract adds: `spawnSubAgent(parentId, config): Promise<string>`, `destroySubAgent(parentId, childId): Promise<void>`
- Child agents inherit parent's domain constraints (can only narrow, never widen)
- Transcript records parent-child relationships: `{ parentAgentId, childAgentId, delegation_depth }`
- `DelegationRouter` updated to support parent→child routing alongside existing broadcast/targeted/tension patterns

### Platform Impact

- New event types: `agent_spawned`, `agent_destroyed`, `child_delegation`, `child_response`
- Agent roster becomes a collapsible tree (hierarchy view)
- Cost rolls up: child costs attributed to parent in sidebar

### Delegation Tools Contract

Agents with `can_spawn: true` receive two delegation tools injected into their available tools:

**`spawnSubAgent(config)`** — Creates a new child agent.
- `config`: `{ name, role, systemPrompt?, modelTier?, domainRules?, timeout? }`
- Returns: `{ childAgentId: string }` on success
- On depth limit exceeded: returns `{ error: 'depth_limit_exceeded', currentDepth: number, maxDepth: number, suggestion: 'execute_directly' }`. The parent receives a structured error it can reason about — it should fall back to executing the task directly or restructuring its delegation.
- On `max_children` exceeded: returns `{ error: 'max_children_exceeded', active: number, max: number }`. Parent must destroy a child before spawning another.

**`messageChild(childAgentId, message)`** — Sends a task or query to an existing child agent.
- `childAgentId`: string — must be a direct child of the calling agent
- `message`: string — the task description or query
- Returns: `Promise<{ response: string, cost: TokenUsage }>` — **synchronous from the parent's perspective** (parent blocks until child responds). This matches the existing delegation pattern where `delegateToAgents` returns `Promise<AgentResponse[]>`.
- On invalid childAgentId (not a child, or already destroyed): returns `{ error: 'child_not_found', childAgentId }`
- On child timeout: returns `{ error: 'child_timeout', childAgentId, elapsed_seconds, partial_response? }`

**`delegate-only` agents** have ONLY `spawnSubAgent` and `messageChild` in their tool set. All other tools from their `tool_allowlist` are removed. This is enforced at agent spawn time, not at runtime — the tools are never registered.

**`delegate-and-execute` agents** retain their full `tool_allowlist` AND receive `spawnSubAgent` and `messageChild` as additional tools.

### Depth Limit Enforcement

Maximum delegation depth is configurable per profile (default: 2). Depth is tracked as an integer on each agent instance:
- Orchestrator: depth 0
- Orchestrator's children: depth 1
- Children's children: depth 2

When an agent at depth N calls `spawnSubAgent` and N >= `max_delegation_depth`, the call returns a structured error (see above). The agent is expected to handle this by executing the task itself or returning it to its parent. The spawn is never silently dropped.

### Constraints

- No arbitrary agent-to-agent communication — all flows through parent
- Child agents destroyed when parent's session ends
- A child can only be messaged by its direct parent (no grandparent→grandchild messaging)

---

## 2. Persistent Agent Intelligence

### Concept

Agents accumulate domain-specific knowledge across sessions via structured expertise files. An agent reads its expertise at session start and updates it after meaningful work. Knowledge is project-scoped by default.

### Storage Location

```
core/agents/perspectives/architect/
  ├── agent.yaml
  ├── prompt.md
  └── expertise/                    # NEW
      └── {project-hash}.yaml
```

### Schema Additions — `agent.yaml`

```yaml
expertise:
  enabled: true
  max_lines: 5000                   # Cap file size
  structure:                        # Agent-type-specific knowledge categories
    - architecture_patterns
    - recurring_failure_modes
    - domain_heuristics
  read_on: session_start
  update_on: session_end
  scope: per-project | global
  mode: read-write | read-only      # Read-only for compliance knowledge
  auto_commit: true | review
  # "true" = expertise diff is applied immediately after session end
  # "review" = diff is written to {expertise-file}.pending.yaml and requires
  #   CLI confirmation (aos expertise approve <agent-id>) before merging into
  #   the active expertise file. Pending files are shown by aos expertise list.
```

### Expertise File Structure

```yaml
# .aos/expertise/architect-{project-hash}.yaml
last_updated: 2026-04-10T14:30:00Z
session_count: 4
knowledge:
  architecture_patterns:
    - "Service layer uses repository pattern with Drizzle ORM"
    - "Auth flows through middleware chain, not per-route"
  recurring_failure_modes:
    - "WebSocket reconnection drops events during API restart"
  domain_heuristics:
    - "Team prefers explicit error types over generic throws"
```

### Runtime Changes

New `ExpertiseManager` module (~200 LoC):
- `loadExpertise(agentId, projectId)` — reads YAML, injects into agent's system prompt as `## Prior Knowledge` section
- `updateExpertise(agentId, projectId, sessionTranscript)` — after session, asks an economy-tier model to produce a **diff** against the current expertise file: `{ additions: string[], removals: string[] }` per knowledge category. The model receives the current expertise file + session transcript and is prompted to output only net-new learnings and entries invalidated by the session. This is NOT a full rewrite — only the diff is applied.
  - If `auto_commit: true`: diff is applied immediately to the active expertise file
  - If `auto_commit: review`: diff is written to `{file}.pending.yaml` for CLI approval
- `pruneExpertise(agentId)` — enforces `max_lines` using **age-based pruning (FIFO)** within each knowledge category. When a category exceeds its proportional share of `max_lines`, the oldest entries are removed first. Value-based pruning (ranking by access frequency or relevance) is a future enhancement — not in scope for Phase 3.

L1 adapter contract adds:
- `persistExpertise(agentId, content): Promise<void>`
- `loadExpertise(agentId, projectId): Promise<string | null>`

Optional `PersistenceAdapter` mixin for adapters with durable storage.

### Platform Impact

- New event types: `expertise_loaded`, `expertise_updated`
- New API endpoint: `GET /api/agents/:id/expertise`
- New DB table: `agent_expertise` (agent_id, project_id, content jsonb, updated_at)
- UI: Expertise Panel showing per-agent knowledge and session-over-session growth

### Key Design Decisions

1. **Updates at session end, not mid-session.** The session transcript is the authoritative record. Distillation happens once when the picture is complete.
2. **Diff-based, not full rewrite.** The economy-tier model produces additions and removals, not a regenerated file. This limits the blast radius of a bad summarization — at worst a few incorrect entries are added, not the entire expertise file corrupted.
3. **Review gate for high-stakes agents.** Agents with `auto_commit: review` (recommended for Sentinel, Steward, and any compliance-focused agents) require human approval before expertise changes take effect. This mitigates the risk of an economy-tier model hallucinating patterns.

---

## 3. Domain Enforcement & Safety

### Concept

Structural, code-enforced permission boundaries per agent. Path-based file access rules, tool allowlists, and bash command heuristics enforced at the L4 adapter layer before tool execution.

### Schema Additions — `agent.yaml`

```yaml
domain:
  rules:
    - path: "apps/web/**"
      read: true
      write: true
      delete: false
    - path: "apps/api/**"
      read: true
      write: false
      delete: false
    - path: "**/*.env*"
      read: false
      write: false
      delete: false
  tool_allowlist:
    - read
    - write
    - edit
    - grep
    - glob
  tool_denylist:
    - bash
  bash_restrictions:
    blocked_tokens:
      # Token-based detection: command is split into tokens, checked for
      # co-occurrence of dangerous token sets (order-independent).
      # This catches "rm -rf", "rm -r -f", "rm --recursive --force", etc.
      - tokens: [rm, recursive]          # rm + any recursive flag (-r, -R, --recursive)
        aliases: { recursive: ["-r", "-R", "--recursive"] }
      - tokens: [git, push]
      - tokens: [git, reset]
      - tokens: [DROP, TABLE]
      - tokens: [find, delete]           # find . -delete
        aliases: { delete: ["-delete", "--delete", "-exec rm"] }
    blocked_patterns: ["curl.*-X DELETE", "wget.*--post"]   # Regex fallback for complex patterns
```

### Profile-Level Overrides

```yaml
# In profile.yaml
assembly:
  perspectives:
    - agent: architect
      domain_override:
        rules:
          - path: "**"
            read: true
            write: true
```

### Runtime Changes

New `DomainEnforcer` module (~300 LoC):
- `checkToolAccess(agentId, toolName)` → `{ allowed: boolean, reason?: string }`
- `checkFileAccess(agentId, filePath, operation)` → `{ allowed: boolean, reason?: string }` (operation: read | write | delete)
- `checkBashCommand(agentId, command)` → `{ allowed: boolean, reason?: string }` — token-based analysis (see Bash Restrictions below)

**Path matching algorithm — longest prefix wins, deny breaks ties:**

1. Normalize the requested file path to a project-relative path
2. Evaluate every rule's glob pattern against the path. Collect all matching rules.
3. Rank matches by **specificity** = number of path segments in the rule's pattern (e.g., `apps/web/components/**` = 3 segments, `apps/web/**` = 2 segments, `**` = 0 segments)
4. The rule with the highest specificity wins
5. **Tie-breaking:** If two rules have equal specificity and disagree (one allows, one denies), **deny wins**. This is the safer default.
6. If no rules match, **deny-by-default** applies

Example resolution:
```
Rules:
  apps/web/**              → write: true     (specificity: 2)
  apps/web/components/**   → write: false    (specificity: 3)
  apps/web/components/Button.tsx → write: true (specificity: 4, literal path)

Request: write apps/web/components/Button.tsx
  → Matches all 3 rules
  → Button.tsx rule wins (specificity 4)
  → Result: allowed

Request: write apps/web/components/Modal.tsx
  → Matches rules 1 and 2
  → components/** rule wins (specificity 3)
  → Result: denied
```

Arbitrary nesting depth is supported. Literal file paths have the highest specificity.

L4 adapter contract adds:
- `enforceToolAccess(agentId, toolCall): Promise<EnforcementResult>`

### Enforcement Flow

```
Agent requests tool call
  → L4.enforceToolAccess(agentId, toolCall)
    → DomainEnforcer.checkToolAccess()
    → DomainEnforcer.checkFileAccess() (for file-touching tools)
    → DomainEnforcer.checkBashCommand() (for bash tool)
  → If blocked: return structured error to agent, emit domain_violation event
  → If allowed: proceed with normal tool execution
```

### Domain Inheritance

Child agents inherit parent's domain rules as a ceiling. Children can only narrow permissions, never widen. If parent has `apps/web/** → write: true`, child can restrict to `apps/web/components/** → write: true` but cannot gain write access to `apps/api/`.

### Platform Impact

- New event type: `domain_violation` with payload `{ agentId, tool, path?, operation, reason }`
- New event type: `domain_access` (optional audit trail)
- UI: Violations as red-flagged entries in event stream
- Domain activity heatmap (agents × paths)
- Security audit view (violations across sessions, filterable)

### Key Design Decisions

1. **Enforcement at L4, not L1.** Agent runtime (L1) spawns agents. Workflow engine (L4) controls what they do.
2. **Deny-by-default.** Unlisted paths are blocked. Explicit allowlisting only.
3. **Bash uses token-based detection, not string matching.** Commands are tokenized and checked for co-occurrence of dangerous token sets (order-independent). `rm -rf`, `rm -r -f`, and `rm --recursive --force` all trigger the same rule. Regex patterns are a fallback for complex multi-token expressions. This is still heuristic (not a full shell parser), but significantly harder to bypass than naive substring matching. It is a safety net for audit, not a security boundary.

---

## 4. Enhanced Observability & Real-Time Control

### 4A: Enhanced Event Model

Expanding the event types flowing from harness to platform via `onTranscriptEvent` → `POST /api/sessions/:id/events`.

```typescript
// Full TranscriptEventType enum
type TranscriptEventType =
  // Existing
  | 'session_start' | 'session_end' | 'delegation' | 'response' | 'constraint_check'
  // Hierarchical Delegation
  | 'agent_spawned' | 'agent_destroyed' | 'child_delegation' | 'child_response'
  // Expertise
  | 'expertise_loaded' | 'expertise_updated'
  // Domain Enforcement
  | 'domain_violation' | 'domain_access'
  // File Tracking
  | 'file_changed'
  // Cost Granularity
  | 'token_usage'
  // Session Lifecycle
  | 'session_paused' | 'session_resumed'
  // Workflow Gates
  | 'gate_reached' | 'gate_result'
```

### 4B: AI Event Summarization

Events get human-readable summaries via a **hybrid approach** that minimizes LLM calls:

**Template-based summaries (no LLM call)** for predictable event types:
- `file_changed` → `"{agentName} {operation} {path}"`
- `token_usage` → `"{agentName} used {tokensIn}+{tokensOut} tokens (${cost})"`
- `domain_access` → `"{agentName} {operation} {path}"`
- `agent_destroyed` → `"{childName} finished ({reason})"`
- `constraint_check` → `"Round {round}: {elapsed}min, ${spent} spent"`

**LLM-summarized (economy-tier, batched)** for complex event types:
- `delegation`, `response`, `child_delegation`, `child_response`, `domain_violation`, `expertise_updated`, `gate_reached`, `gate_result`

**Batching strategy:**
- Events are collected in a **10-second window**
- At window close, all unsummarized complex events are sent in a single LLM call with the prompt: "Summarize each event in 10-15 words"
- Summaries are backfilled to the platform DB and broadcast via WebSocket as `summary_backfill` updates
- This reduces LLM calls by 10-20x compared to per-event summarization

**Cost bound:** In a session with 200 events, ~60% will be template-summarized (zero cost). The remaining ~80 complex events produce ~8 batch calls (10-second windows). At economy-tier pricing, this is negligible.

New `EventSummarizer` module:
- `templateSummary(event)` — returns string or null (null = needs LLM)
- `batchSummarize(events[])` — single LLM call, returns `Map<eventId, summary>`
- 10-second collection window managed by the engine's event loop

Platform schema change: add `summary text` column to `transcript_events`.

Example summaries:
- delegation → "Arbiter asked Sentinel and Catalyst to evaluate migration risk"
- domain_violation → "Backend Dev blocked from writing to apps/web/components"
- file_changed → "Frontend Worker created apps/web/components/Modal.tsx" (template)

### 4C: Session Resumption

**Harness:**
- `AOSEngine` gains `pauseSession()` and `resumeSession(sessionId)` methods
- On pause: serialize full checkpoint (see below) → persist to transcript + platform
- On resume: reload checkpoint, re-spawn agents with reconstructed context
- CLI: `aos resume <session-id>` command

**Checkpoint contents:**

```typescript
interface SessionCheckpoint {
  sessionId: string;
  constraintState: ConstraintState;
  activeAgents: AgentCheckpoint[];     // Per-agent state (not just IDs)
  roundsCompleted: number;
  pendingDelegations: PendingDelegation[];
  transcriptReplayDepth: number;       // How many recent events to replay (default: 50)
  createdAt: string;
}

interface AgentCheckpoint {
  agentId: string;
  parentAgentId?: string;
  depth: number;
  conversationTail: TranscriptEvent[]; // Last N events involving this agent
  expertiseSnapshot?: string;          // Expertise state at pause time
}
```

**Resumption process:**
1. Load checkpoint from platform DB or local `.aos/sessions/{id}/checkpoint.json`
2. Restore constraint state (time elapsed resets, budget/rounds continue from checkpoint values)
3. For each agent in `activeAgents`:
   a. Re-spawn agent via L1 adapter
   b. Inject expertise (from snapshot or current file, whichever is newer)
   c. Replay `conversationTail` events into the agent's context as a `## Session Context (Resumed)` prompt section — this gives the agent memory of what just happened
4. Resume delegation from where it left off (pending delegations re-queued)

**`transcriptReplayDepth`** defaults to 50 events per agent. This is configurable per profile. The events are filtered to only those relevant to each specific agent (events where `agentId` matches or the agent was a delegation target). This prevents agents from waking up disoriented — they see their recent conversation history, not the entire session.

**Platform:**
- `checkpoint` (jsonb, nullable) column on sessions table
- API: `POST /api/sessions/:id/pause`, `POST /api/sessions/:id/resume`
- UI: "Resume" button on paused sessions, linked prior session for audit trail
- Resumed sessions carry `priorSessionId` for full audit chain

### 4D: File Change Tracking

**Harness:**
- L4 adapter hook: after any file-writing tool completes, emit `file_changed` event
- Capture git diff snippet (first 50 lines) in payload
- Track cumulative file changes per agent across session

**Platform:**
- New `file_changes` table: `session_id, agent_id, path, operation, diff_snippet, created_at`
- UI: "Files" tab showing which agents touched which files, with inline diffs

### 4E: Platform UI Enhancements

| View | Purpose |
|---|---|
| Agent Tree | Collapsible hierarchy (orchestrator → leads → workers) with per-node cost |
| Domain Heatmap | Agents × paths grid showing access activity and violations |
| Expertise Panel | Per-agent knowledge summary, growth over sessions |
| File Activity | File changes by agent, with inline diffs |
| Cost Breakdown | Per-agent, per-round, per-model-tier cost waterfall |
| Security Audit | Domain violations across sessions, filterable |
| Session Timeline | Gantt-style agent activity (who was active when, including children) |
| Event Filters | Filter event stream by category (delegation, enforcement, expertise, cost) |

---

## 5. Shared Type Contracts

### Package Structure

New package in harness monorepo: `@aos-harness/shared-types`

```
packages/shared-types/
  ├── src/
  │   ├── events.ts      # TranscriptEventType + typed payloads (discriminated union)
  │   ├── agents.ts       # AgentConfig, DelegationConfig, DomainRules, ExpertiseConfig
  │   ├── sessions.ts     # SessionStatus, SessionConstraints, SessionCheckpoint
  │   ├── costs.ts        # CostRecord, TokenUsage
  │   └── index.ts        # Re-exports
  ├── package.json
  └── tsconfig.json
```

### Sharing Mechanism

Git submodule (to start). The platform repo references the shared-types package from the harness. Zero infrastructure required.

**Migration trigger:** If shared-types is updated more than twice in a single development sprint, migrate to a Bun workspace package (if repos are co-located) or a private npm registry via GitHub Packages. Don't wait for submodule merge conflicts to become painful — the trigger is update frequency, not pain level.

### Key Type Contracts

```typescript
// Discriminated union — every event type has a typed payload
export type TranscriptEvent =
  | { type: 'delegation'; agentId: string; targetAgents: string[]; message: string; pattern: DelegationPattern }
  | { type: 'response'; agentId: string; content: string; cost: TokenUsage }
  | { type: 'agent_spawned'; parentAgentId: string; childAgentId: string; childConfig: ChildAgentConfig }
  | { type: 'domain_violation'; agentId: string; tool: string; path?: string; operation: string; reason: string }
  | { type: 'expertise_updated'; agentId: string; projectId: string; additions: string[]; removals: string[] }
  | { type: 'file_changed'; agentId: string; path: string; operation: FileOp; diffSnippet?: string }
  // ... all event types

// Agent summary for platform display
export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  modelTier: ModelTier;
  parentAgentId?: string;
  delegationStyle?: DelegationStyle;
  domainRules?: DomainRuleSummary;
  expertiseEnabled: boolean;
}

// Session checkpoint for resumption
export interface SessionCheckpoint {
  sessionId: string;
  constraintState: ConstraintState;
  activeAgents: AgentCheckpoint[];   // Full per-agent state, not just IDs
  roundsCompleted: number;
  pendingDelegations: PendingDelegation[];
  transcriptReplayDepth: number;     // Events per agent to replay on resume (default: 50)
  createdAt: string;
}

export interface AgentCheckpoint {
  agentId: string;
  parentAgentId?: string;
  depth: number;
  conversationTail: TranscriptEvent[];
  expertiseSnapshot?: string;
}
```

### Versioning

Semver. Breaking changes (removing/renaming event types) bump major. New event types bump minor. Platform pins to compatible range.

---

## 6. Implementation Phasing

### Phase 1 — Contracts & Domain Enforcement (Foundation)

**Harness:**
- Create `@aos-harness/shared-types` package with all new type definitions
- Implement `DomainEnforcer` module in runtime
- Extend `agent.yaml` schema with `domain` rules and `delegation` fields
- Add `enforceToolAccess` to L4 adapter contract
- Update Pi adapter to enforce domain rules
- Emit `domain_violation` and `domain_access` events
- ~12 files, ~40 tests

**Platform:**
- Wire up shared types via git submodule
- Extend DB schema (summary column, file_changes table)
- Handle new event types in ingestion service
- Add domain violation rendering to EventCard
- ~8 files

**Deliverable:** Enforceable agent permissions, violations in platform, shared type contract established.

### Phase 2 — Hierarchical Delegation & File Tracking

**Harness:**
- Implement `spawnChildAgent` / `destroySubAgent` in `AOSEngine`
- Add sub-agent methods to L1 adapter contract
- Update `DelegationRouter` for parent→child routing
- Domain inheritance (children narrow parent's rules)
- File change tracking in L4 (post-tool-execution hook)
- Emit hierarchical + file events
- ~10 files, ~35 tests

**Platform:**
- Agent Tree component (replaces flat roster)
- Parent-child cost rollup
- File Activity tab
- EventCard renderers for hierarchical events
- Session Timeline (Gantt-style)
- ~10 files

**Deliverable:** Orchestrators spawn sub-teams, platform shows full hierarchy live with file changes and cost attribution.

### Phase 3a — Expertise & Event Summarization (tightly coupled)

These two capabilities share the economy-tier LLM dependency and the `PersistenceAdapter` mixin. Building them together avoids duplicate infrastructure.

**Harness:**
- Implement `ExpertiseManager` module (load, diff-update, prune, review gate)
- Add `PersistenceAdapter` optional mixin to adapter contract
- Add `persistExpertise` / `loadExpertise` to L1 contract
- Implement `EventSummarizer` module (template + batched LLM hybrid)
- Extend agent config schema with `expertise` fields
- Add `aos expertise list`, `aos expertise approve <agent-id>` CLI commands
- Emit expertise and summarization events
- ~8 files, ~20 tests

**Platform:**
- `agent_expertise` table
- Expertise Panel (per-agent knowledge, growth over sessions)
- API: `GET /api/agents/:id/expertise`
- AI summaries inline on EventCards (with backfill via WebSocket)
- Event category filters on event stream
- ~8 files

**Deliverable:** Agents accumulate knowledge across sessions with human review gates. Events get readable summaries via cost-efficient batching.

### Phase 3b — Session Resumption & Remaining UI (independent)

Session resumption is mechanically independent from expertise — it depends on the checkpoint contract (defined in Phase 1 shared types) and L1/L2 adapter methods.

**Harness:**
- Implement `pauseSession` / `resumeSession` in `AOSEngine`
- Add `aos resume <session-id>` CLI command
- Checkpoint serialization with per-agent conversation tails
- Transcript replay on agent re-spawn
- ~5 files, ~15 tests

**Platform:**
- `checkpoint` column on sessions table
- API: `POST /api/sessions/:id/pause`, `POST /api/sessions/:id/resume`
- Resume button on paused sessions with prior session linking
- Cost Breakdown waterfall view
- Security Audit view (domain violations across sessions)
- Session Timeline (Gantt-style, if not completed in Phase 2)
- ~6 files

**Deliverable:** Sessions survive interruption with full agent context reconstruction. Platform provides deep cross-session observability.

---

## Non-Goals

- **Agent-to-agent direct communication** — All communication flows through parent. Predictable, auditable.
- **Full bash sandboxing** — Heuristic guards, not a security boundary. Catch common mistakes, log everything.
- **Real-time collaborative editing** — Platform is read-only monitoring. Control flows through the CLI.
- **Multi-tenant platform** — Single-user/team for now. Multi-tenancy is a future concern.
- **Copying code from reference repos** — Ideas and logic patterns only. All implementation is original.

## Dependencies

- AOS Harness current branch (`rename/framework-to-harness`) must be merged to main before Phase 1 begins
- AOS Platform current state is sufficient — no blockers
- Bun runtime for both repos
- PostgreSQL for platform persistence
