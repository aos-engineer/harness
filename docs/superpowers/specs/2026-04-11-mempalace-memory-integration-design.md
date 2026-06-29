# MemPalace Memory Integration Design

**Date:** 2026-04-11
**Status:** Draft
**Author:** Segun Kolade + Claude

## Overview

Integrate [MemPalace](https://github.com/milla-jovovich/mempalace) as the first pluggable memory backend for the AOS framework. MemPalace is a local-first, verbatim memory system that uses a spatial metaphor (wings/halls/rooms/closets/drawers) backed by ChromaDB, achieving 96.6% recall on LongMemEval without LLM summarization.

The integration adds a `MemoryProvider` abstraction to the AOS runtime. MemPalace is the first provider; the existing `ExpertiseManager` becomes a lightweight fallback. Future memory systems can be added by implementing the same interface.

## Goals

1. Give AOS agents persistent, high-fidelity memory across sessions
2. The orchestrator acts as memory gatekeeper — curating writes at session end and approving recall requests mid-session
3. MemPalace is the first memory provider, but the architecture supports swapping in other backends
4. AOS works without MemPalace installed (graceful fallback to existing expertise system)
5. Operational agents can access MemPalace tools directly for hands-on memory management

## Non-Goals

- Porting MemPalace's internals into TypeScript (we talk to it via MCP, not embed it)
- Replacing MemPalace's ChromaDB with a different vector store
- Auto-mining codebases (users run `mempalace mine` separately)
- AAAK dialect integration (experimental in MemPalace, not stable enough to depend on)

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Palace structure mapping | Wing = Project, Room = Agent | Users work on multiple projects; clean separation per project, per-agent knowledge within each |
| Provisioning | Hybrid — AOS offers setup during `aos init`, detects existing installs, falls back to expertise | Smooth onboarding without hard dependency |
| What triggers memory writes | Orchestrator decides at session end | Curates quality over quantity; token-efficient; self-regulating size |
| Mid-session recall | Orchestrator-gated | Agents request recall; orchestrator approves/denies; prevents noisy searches and token runaway |
| Agent direct access | Operational agents only | Perspective agents go through orchestrator; operational agents (Operator, Steward, Auditor) get full MCP tools |
| Communication with MemPalace | MCP protocol (stdio JSON-RPC) | Aligns with MemPalace's design; keeps TypeScript runtime clean |

## Architecture

### MemoryProvider Interface

The core abstraction that all memory backends implement.

```typescript
interface MemoryProvider {
  readonly id: string;           // "mempalace" | "expertise" | future providers
  readonly name: string;         // Human-readable name

  // Lifecycle
  initialize(config: MemoryConfig): Promise<void>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<HealthStatus>;

  // Wake-up — called at session start, returns context to inject into agents
  wake(projectId: string, agentId?: string): Promise<WakeContext>;

  // Recall — orchestrator-gated semantic search
  recall(query: string, opts: RecallOpts): Promise<RecallResult>;

  // Remember — orchestrator commits content to long-term memory
  remember(content: string, opts: RememberOpts): Promise<RememberId>;

  // Status
  status(): Promise<MemoryStatus>;
}

interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

interface WakeContext {
  identity: string;       // L0 — who is this AI? (~100 tokens)
  essentials: string;     // L1 — critical facts, truncated to fit maxWakeTokens
  tokenEstimate: number;  // Total tokens for budget tracking
  truncated: boolean;     // True if L1 was truncated to fit token cap
}

interface RecallOpts {
  projectId: string;      // Wing
  agentId?: string;       // Room (optional — cross-agent search if omitted)
  hall?: string;          // Memory type filter (facts, events, discoveries, etc.)
  maxResults?: number;    // Default 5
}

interface RecallResult {
  entries: RecallEntry[];
  tokenEstimate: number;
}

interface RecallEntry {
  content: string;        // Verbatim drawer content
  wing: string;
  room: string;
  hall: string;
  similarity: number;     // 0-1 relevance score
  source?: string;        // Original source file if applicable
}

interface RememberOpts {
  projectId: string;      // Wing
  agentId: string;        // Room (which agent produced this)
  hall?: string;          // Auto-detected if omitted
  source?: string;        // Attribution metadata
  sessionId?: string;     // Tags drawer for dedup across concurrent sessions
}

type RememberId = string;

interface MemoryConfig {
  provider: "mempalace" | "expertise";
  mempalace?: {
    palacePath: string;
    projectWing: string;
    wakeLayers: ("L0" | "L1")[];
    autoHall: boolean;
    maxWakeTokens: number;    // Hard cap on wake context (default 1200)
    maxDrawerTokens: number;  // Per-drawer size limit (default 500)
  };
  expertise?: {
    maxLines: number;
    scope: "per-project" | "global";
  };
  orchestrator: {
    rememberPrompt: "session_end" | "per_round";
    recallGate: boolean;
    maxRecallPerSession: number;
  };
}

interface MemoryStatus {
  provider: string;
  available: boolean;
  drawerCount?: number;
  wings?: string[];
  rooms?: Record<string, string[]>;
}
```

### Memory Configuration

Project-level config at `.aos/memory.yaml`:

```yaml
api_version: aos/memory/v1

provider: mempalace           # "mempalace" | "expertise"

mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: my-project
  wake_layers: [L0, L1]
  auto_hall: true
  max_wake_tokens: 1200          # Hard cap on L0+L1 wake context (default 1200)
  max_drawer_tokens: 500         # Per-drawer size limit for aos_remember (default 500)

expertise:
  max_lines: 200
  scope: per-project

orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
```

**Fallback behavior:**
- `provider: mempalace` but not installed at runtime -> warn, fall back to `expertise`
- `provider: expertise` -> use existing `ExpertiseManager`
- No config file -> default to `expertise` (backwards compatible)

### `aos init` Flow

```
$ aos init my-project

  AOS Project Setup
  -----------------

  Memory Provider:
  > MemPalace (recommended - high-fidelity recall, local ChromaDB)
    Basic Expertise (built-in - lightweight YAML-based)
    None (no persistent memory)

  [If MemPalace selected but not installed:]
  MemPalace not found. Install it? (pip install mempalace) [Y/n]

  [If MemPalace installed:]
  Palace path: ~/.mempalace/palace (enter to accept, or type custom path)
  Wing name for this project: my-project

  > Memory configured - .aos/memory.yaml written
```

### Engine Integration

Three integration points in the session lifecycle:

**Session Start:**
1. Load memory config from `.aos/memory.yaml`
2. Initialize provider (MemPalace or expertise fallback)
3. Call `provider.wake(projectId)` to get L0+L1 context
4. Inject wake context into orchestrator's system prompt
5. Inject per-agent wake context into each agent on spawn

**Mid-Session (orchestrator-gated):**
1. Agent calls `aos_request_recall` tool (structured, not natural language) — emits a `recall_requested` transcript event
2. Engine intercepts the event and routes it to the orchestrator for approval/denial
3. Orchestrator decides: approve or deny
4. If approved: orchestrator calls `aos_recall` tool, result injected into requesting agent's context via `adapter.injectContext()`
5. If denied: `recall_request_denied` event logged, agent continues without the context
6. `recall_count++` checked against `max_recall_per_session`

**Session End:**
1. Orchestrator receives memory curation prompt
2. Reviews session transcript and artifacts
3. Calls `aos_remember` tool for each significant memory
4. Transcript events logged: `memory_committed`

### Orchestrator Tools

Three tools: two for the orchestrator, one for perspective agents.

```typescript
// aos_remember — commit content to long-term memory (orchestrator only)
{
  name: "aos_remember",
  description: "Commit important content to long-term memory",
  input: {
    content: string,       // Verbatim content to store (capped at maxDrawerTokens)
    agent: string,         // Which agent produced this (becomes the room)
    hall?: string,         // "facts" | "events" | "discoveries" | "preferences" | "advice"
  }
}

// aos_recall — search long-term memory (orchestrator only)
{
  name: "aos_recall",
  description: "Search long-term memory for relevant past knowledge",
  input: {
    query: string,
    agent?: string,        // Limit to specific agent's memories (room)
    hall?: string,         // Limit to memory type
    max_results?: number,  // Default 5
  }
}

// aos_request_recall — request a memory search (perspective agents)
// Emits a recall_requested event; orchestrator intercepts and decides.
{
  name: "aos_request_recall",
  description: "Request the orchestrator to search long-term memory on your behalf",
  input: {
    query: string,         // What to search for
    reason: string,        // Why this recall is needed (helps orchestrator decide)
  }
}
```

**Drawer size enforcement:** When `aos_remember` is called, the provider checks `content` against `maxDrawerTokens` (default 500). If it exceeds the cap, the tool returns an error prompting the orchestrator to be more concise. The content is still stored verbatim — the cap forces the orchestrator to select the most essential verbatim excerpt rather than dumping an entire discussion.

**Memory curation prompt (injected at session end):**

```
You are ending this deliberation session. Review the session outcomes and
decide what should be committed to long-term memory.

Guidelines:
- Store decisions, conclusions, and rationale - not the debate that led to them
- Store discoveries and insights that would be valuable in future sessions
- Store verbatim - do not summarize or paraphrase
- Tag each memory with the agent that produced it
- Skip procedural noise (constraint checks, routing, bias tracking)

Use the aos_remember tool for each item worth keeping.
```

### New Transcript Events

```typescript
| "memory_wake"              // L0+L1 loaded at session start
| "memory_wake_truncated"    // L1 was truncated to fit maxWakeTokens
| "recall_requested"         // Agent requested a recall via aos_request_recall
| "memory_recall"            // Mid-session search executed (orchestrator approved)
| "memory_recall_denied"     // Orchestrator denied a recall request
| "memory_committed"         // Content stored to long-term memory
| "memory_commit_failed"     // remember() failed — see crash recovery section
| "memory_provider_restart"  // MCP server crashed and was restarted
| "memory_fallback_written"  // Crash recovery: memories saved to local JSON fallback
```

### Provider Implementations

**MemPalaceProvider:**

Communicates with MemPalace's MCP server as an external process.

```
AOS Runtime (TypeScript/Bun)
    |
    +- MemPalaceProvider
    |      |
    |      +- wake()     -> mempalace wake-up --wing <projectId> --json
    |      +- recall()   -> MCP: mempalace_search (with wing/room/hall filters)
    |      +- remember() -> MCP: mempalace_add_drawer (tagged with metadata)
    |      +- status()   -> MCP: mempalace_status
    |
    MemPalace MCP Server (Python, separate process, stdio JSON-RPC)
        |
        +- ChromaDB (local, on-disk)
```

- Primary communication: MCP protocol via stdio transport
- Provider lazily starts the MCP server on first use, keeps it alive for session duration
- Fallback: CLI subprocess calls with `--json` flag (slower, process spawn per call)

**MCP Server Lifecycle & Crash Recovery:**

The MCP server is the biggest operational risk. If it dies mid-session, `remember()` calls at session end silently fail and the entire session's learnings are lost.

Mitigation strategy:

1. **Health check before critical operations:** Before session-end `remember()` calls, the provider calls `healthCheck()` which sends a lightweight `mempalace_status` ping. If it fails, trigger recovery before attempting writes.

2. **Auto-restart with one retry:** If any MCP call fails with a connection/process error:
   - Kill the dead MCP server process
   - Respawn `python -m mempalace.mcp_server`
   - Wait up to 5 seconds for ready signal
   - Retry the failed operation once
   - Log `memory_provider_restart` transcript event

3. **Local JSON fallback (last resort):** If the MCP server cannot be recovered after one restart attempt:
   - Write all pending memories to `.aos/sessions/{sessionId}/memory-fallback.jsonl`
   - Each line: `{ "content": "...", "wing": "...", "room": "...", "hall": "...", "timestamp": "..." }`
   - Log `memory_fallback_written` transcript event with the fallback file path
   - On next session start, the provider checks for fallback files and offers to import them via `mempalace mine` or a dedicated `mempalace import` command

4. **Known failure modes:**
   - Python process OOM on large palace: mitigated by ChromaDB's batched queries (already implemented in MemPalace)
   - ChromaDB lock contention: mitigated by single-writer-per-session model
   - Stale MCP server after laptop sleep/resume: caught by health check at session start

**Wake token cap enforcement:**

`wake()` enforces `maxWakeTokens` (default 1200) at runtime. If L0 + L1 combined exceeds the cap:
1. L0 (identity) is never truncated — it's typically ~100 tokens
2. L1 (essentials) is truncated: drawers are sorted by relevance score (from MemPalace's ChromaDB distance) and the lowest-relevance entries are dropped until the total fits
3. `WakeContext.truncated` is set to `true`
4. `memory_wake_truncated` transcript event logged with original vs. truncated token counts

**ExpertiseProvider:**

Wraps the existing `ExpertiseManager` with the `MemoryProvider` interface.

```
AOS Runtime (TypeScript/Bun)
    |
    +- ExpertiseProvider
           |
           +- wake()     -> ExpertiseManager.parseExpertise() + injectIntoPrompt()
           +- recall()   -> String matching against loaded expertise categories
           +- remember() -> ExpertiseManager.applyDiff() -> YAML write
           +- status()   -> session_count, category count, entry count
```

- Thin wrapper, no rewrite of existing code
- `recall()` uses fuzzy matching (Levenshtein distance + token overlap scoring) rather than exact string matching. Since expertise is the default for users who haven't installed MemPalace, recall quality matters. Fuzzy match is ~50 lines with no external dependencies and provides meaningful improvement over exact matching: it handles typos, partial matches, and word reordering. Not semantic search, but significantly better than `string.includes()`

### Agent-Facing Memory (Direct MCP Tools)

In addition to the runtime layer, operational agents can access MemPalace MCP tools directly — but with a scoped tool subset, not the full 19-tool suite.

**Tool subsets:**

MemPalace's 19 tools are split into three tiers:

| Tier | Tools | Purpose |
|---|---|---|
| **Read** | `mempalace_search`, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_get_taxonomy`, `mempalace_status`, `mempalace_check_duplicate` | Query and inspect the palace |
| **Write** | `mempalace_add_drawer`, `mempalace_delete_drawer` | Add or remove individual drawers |
| **Admin** | All remaining tools (wing management, hall creation, closet operations, graph traversal, repair, migration) | Structural palace operations |

**Two skill definitions:**

```yaml
# core/skills/mempalace-read-write/skill.yaml
api_version: aos/skill/v1
id: mempalace-read-write
name: MemPalace Read + Write
description: Search, inspect, and add drawers to MemPalace

platform_bindings:
  claude-code: null
  pi: mempalace-mcp

tool_subset:
  - mempalace_search
  - mempalace_list_wings
  - mempalace_list_rooms
  - mempalace_get_taxonomy
  - mempalace_status
  - mempalace_check_duplicate
  - mempalace_add_drawer
  - mempalace_delete_drawer

compatible_agents:
  - operator
  - steward
  - auditor
```

```yaml
# core/skills/mempalace-admin/skill.yaml
api_version: aos/skill/v1
id: mempalace-admin
name: MemPalace Admin
description: Full administrative access to all 19 MemPalace tools — explicit opt-in only

platform_bindings:
  claude-code: null
  pi: mempalace-mcp

tool_subset: all

compatible_agents:
  - auditor   # Only auditor by default — operator/steward must explicitly add this skill
```

**Access tiers:**

| Agent Type | Runtime Memory (aos_remember/recall) | Direct MemPalace MCP Tools |
|---|---|---|
| Orchestrator | Full access - gates all reads/writes | No (uses runtime tools) |
| Perspective agents | Request recall via `aos_request_recall` only | No |
| Operational agents | Can also use runtime tools | Read + Write (8 tools) by default |
| Auditor | Can also use runtime tools | Read + Write + Admin (all 19) by default |
| Developer (human) | N/A | Yes - CLI and MCP (all tools) |

Enforced via existing `DomainEnforcer` — the `tool_subset` field in the skill definition generates a `tool_allowlist` for MemPalace tools. Agents without either skill have all MemPalace MCP tools in their `tool_denylist`.

## Known Limitations

**Concurrent session writes:** AOS sessions can overlap (user starts a new session before the previous one's async `remember()` completes). ChromaDB doesn't have write locking at the wing/room level. Two sessions committing memories to the same agent's room simultaneously could produce duplicates or interleaved writes.

Mitigation: Every `remember()` call tags the drawer with a `sessionId` metadata field. Duplicates can be identified and cleaned up by querying drawers with the same `sessionId` and similar content hashes. For local-first single-user usage this is low risk, but the tagging ensures it's detectable and recoverable.

**ExpertiseProvider recall quality:** Even with fuzzy matching, the expertise fallback is a significant quality gap compared to MemPalace's semantic search. Users on the expertise provider should expect notably lower recall accuracy. This is an acceptable trade-off — expertise is the zero-dependency fallback, not the recommended experience.

## Files to Create or Modify

**New files:**
- `runtime/src/memory-provider.ts` — `MemoryProvider` interface and types
- `runtime/src/mempalace-provider.ts` — `MemPalaceProvider` implementation
- `runtime/src/expertise-provider.ts` — `ExpertiseProvider` wrapper
- `runtime/src/memory-config.ts` — Config loader for `.aos/memory.yaml`
- `core/skills/mempalace-read-write/skill.yaml` — Read + Write MCP access skill
- `core/skills/mempalace-admin/skill.yaml` — Full admin MCP access skill
- `core/schema/memory.schema.json` — JSON Schema for memory config validation
- `cli/src/commands/init-memory.ts` — Memory setup flow for `aos init`

**Modified files:**
- `runtime/src/engine.ts` — Add `memoryProvider` field, wire into session lifecycle (start/mid/end)
- `runtime/src/types.ts` — Add transcript event types, memory-related interfaces
- `cli/src/commands/init.ts` — Add memory provider selection step
- `core/agents/orchestrators/*/agent.yaml` — Add `aos_remember` and `aos_recall` to orchestrator tools

**Unchanged:**
- `runtime/src/expertise-manager.ts` — No modifications; `ExpertiseProvider` wraps it as-is

## Testing & Validation

**Unit tests:**
- `MemoryProvider` interface contract tests (any provider must pass)
- `ExpertiseProvider` correctly wraps `ExpertiseManager` behavior
- `ExpertiseProvider` fuzzy recall: typos, partial matches, word reordering
- `MemPalaceProvider` maps wake/recall/remember to MCP calls (mocked MCP server)
- Memory config loading and validation
- Fallback behavior when MemPalace not installed
- Wake token cap enforcement: verify L1 truncation when palace is large
- Drawer size cap enforcement: verify `aos_remember` rejects oversized content
- `aos_request_recall` emits correct transcript event

**Integration tests:**
- Full session lifecycle: wake -> mid-session recall -> session end remember -> verify drawers in ChromaDB
- Same flow with expertise fallback, verify YAML updates
- Provider switching on same project
- Orchestrator recall gating via `aos_request_recall` (approve/deny paths)
- `max_recall_per_session` cap enforcement
- MCP crash recovery: kill MCP server mid-session, verify auto-restart + retry
- MCP crash recovery: kill MCP server with restart failure, verify JSON fallback written
- JSON fallback import on next session start
- Concurrent sessions: two sessions writing to same wing, verify sessionId tagging and no data loss

**Token efficiency benchmarks:**
- Wake context token count across palace sizes (100, 1000, 10000 drawers)
- Verify `maxWakeTokens` cap holds across all palace sizes
- Recall result token count at varying `max_results`
- Total session token usage: with memory vs. without vs. expertise-only
- Targets: wake < 1200 tokens (enforced), individual recall < 2000 tokens

**Manual validation:**
- `aos init` with MemPalace selection (install prompt, config generation)
- Multi-session scenario: Session 1 commits memories -> Session 2 wakes with Session 1 context -> verify recall accuracy
- Run without MemPalace installed -> verify clean fallback with warning
- Laptop sleep/resume: verify health check catches stale MCP server
