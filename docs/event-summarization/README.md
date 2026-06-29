# Event Summarization

The runtime includes an `EventSummarizer` that classifies transcript events into two groups: events that can be summarized with deterministic templates and events that need language understanding. Template summaries are implemented locally. Batched economy-tier LLM summarization is the intended platform behavior, but the platform worker/API that performs those LLM calls is not part of the current local harness package.

## Template-Summarized Events

Eleven event types carry enough information in their own fields to produce a useful summary without an LLM. The runtime can produce these summaries with string templates -- no network call, no latency, no cost.

| Event type | Template |
|---|---|
| `file_changed` | `{agentId} {operation} {path}` |
| `token_usage` | `{agentId} used {tokensIn}+{tokensOut} tokens (${cost})` |
| `agent_destroyed` | `{childAgentId} finished ({reason})` |
| `constraint_check` | `Round {round}: {elapsed}min, ${spent} spent` |
| `domain_access` | `{agentId} {operation} {path}` |
| `agent_spawn` | Template applied at write time |
| `agent_destroy` | Template applied at write time |
| `session_start` | Template applied at write time |
| `session_end` | Template applied at write time |
| `session_paused` | Template applied at write time |
| `session_resumed` | Template applied at write time |

These events are structural signals. A consumer reading the summary does not need the full payload to understand what happened.

## LLM-Classified Events

Ten event types carry free-form content -- agent reasoning, delegations, domain violations, gate decisions -- where a template would either truncate meaning or produce noise. The runtime marks these as needing an LLM. In the current repo, they are classified; they are not automatically summarized by a bundled LLM worker.

| Event type | Why LLM is needed |
|---|---|
| `delegation` | Contains a full task brief sent to a child agent |
| `response` | Contains an agent's reasoning and conclusion |
| `child_delegation` | Nested delegation with its own brief and context |
| `child_response` | Nested agent's reasoning, may reference prior context |
| `domain_violation` | Requires understanding of why the access was invalid |
| `expertise_updated` | Diff of scratch pad content; context determines meaning |
| `gate_reached` | Describes the state that triggered a workflow gate |
| `gate_result` | Records the evaluator's decision and rationale |
| `final_statement` | Each agent's closing position in the deliberation |
| `review_submission` | A structured review artifact submitted to the harness |

### Planned Batching

The intended platform implementation uses 10-second collection windows to minimize API calls:

1. Events arrive and are written to the transcript with `summary = null`.
2. The harness collects all unsummarized LLM-type events for up to 10 seconds.
3. At the end of the window, a single economy-tier LLM call is made with all events in the batch.
4. The LLM returns one summary per event.
5. Summaries are backfilled into the `summary` column for each event.

This means a burst of 20 `response` events during a high-activity round would cost one LLM call, not twenty. That batching behavior should be treated as platform design guidance until the worker is present in the deployed platform.

## Full Event Type Reference

### Core

| Type | Description |
|---|---|
| `delegation` | Orchestrator sends a task brief to a perspective agent |
| `response` | A perspective agent returns its analysis or conclusion |

### Domain Enforcement

| Type | Description |
|---|---|
| `domain_access` | An agent reads or writes a path within its allowed domain |
| `domain_violation` | An agent attempted to access a path outside its domain |

### Hierarchical Delegation

| Type | Description |
|---|---|
| `child_delegation` | An agent spawns a child and sends it a sub-task brief |
| `child_response` | A child agent returns its result to the parent |
| `agent_spawn` | A child agent handle is created and initialized |
| `agent_destroy` | A child agent handle is torn down after completing its task |
| `agent_destroyed` | Confirmation that a child agent has fully terminated |

### Expertise

| Type | Description |
|---|---|
| `expertise_updated` | An agent writes new content to its scratch pad |

### File Tracking

| Type | Description |
|---|---|
| `file_changed` | A file in the deliberation directory was created, modified, or deleted |

### Cost

| Type | Description |
|---|---|
| `token_usage` | Token counts and estimated cost for a single LLM call |
| `constraint_check` | Snapshot of round, elapsed time, and cumulative spend at a check interval |

### Session Lifecycle

| Type | Description |
|---|---|
| `session_start` | Session engine initialized, agents ready |
| `session_end` | Session completed and all agents torn down |
| `session_paused` | Session checkpointed and suspended |
| `session_resumed` | Session restored from checkpoint and agents re-spawned |

### Workflow

| Type | Description |
|---|---|
| `gate_reached` | The orchestrator reached a named gate in the workflow definition |
| `gate_result` | The gate evaluator returned a pass, fail, or escalate decision |
| `final_statement` | An agent submitted its closing position |
| `review_submission` | A structured review artifact was submitted to the harness |

## Platform Integration

Events flow through the following path:

```
Engine emits event
  → onTranscriptEvent callback
  → POST /api/sessions/:id/events
  → transcript_events table (summary column populated when available)
```

Template-summarized events can arrive with `summary` already filled. LLM-classified events should arrive with `summary: null` and remain pending until an external/platform summarizer backfills them.

The `transcript_events` table schema includes:

| Column | Description |
|---|---|
| `id` | Auto-incrementing row identifier |
| `session_id` | Foreign key to the parent session |
| `event_type` | One of the `TranscriptEventType` values listed above |
| `payload` | Full event payload as JSON |
| `summary` | Human-readable summary string, or null until backfilled |
| `created_at` | Wall-clock time the event was written |

Consumers that display a session feed should render `summary` when present and fall back to a compact raw-event preview or loading state while LLM summarization is pending.
