# Hierarchical Delegation

Agents can spawn and manage sub-agents, creating multi-level delegation chains. An orchestrator delegates to a lead, who spawns specialized workers. All communication flows through the parent -- no direct agent-to-agent messaging.

## Hierarchy Model

```
Profile (assembly)
  └── Orchestrator (depth 0)
        ├── Lead Agent (depth 1) — can spawn workers
        │     ├── Worker (depth 2)
        │     └── Worker (depth 2)
        └── Perspective Agent (depth 1) — standard, no spawning
```

Depth is measured from the orchestrator. Workers at depth 2 are grandchildren of the orchestrator and cannot spawn further unless the profile's `max_delegation_depth` is raised.

## Enabling Delegation on an Agent

Add a `delegation` block to `agent.yaml` to turn an agent into a lead that can spawn children:

```yaml
delegation:
  can_spawn: true
  max_children: 3               # Max concurrent sub-agents
  child_model_tier: economy     # Default model for spawned workers
  child_timeout_seconds: 120    # Per-child timeout
  delegation_style: delegate-only
  # delegate-only: only spawnSubAgent/messageChild tools available.
  #   Agent routes work but never executes directly.
  # delegate-and-execute: retains normal tools AND can spawn children.
  #   For agents that do light work but offload heavy tasks.
```

An agent without a `delegation` block is a standard agent. It receives tasks from its parent and produces output -- it cannot spawn sub-agents.

## Delegation Tools

The harness injects delegation tools into agents that have `can_spawn: true`. These tools are not available to standard agents.

### spawnSubAgent(config)

Spawns a new child agent scoped to the calling agent's session. The `config` object accepts:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Display name for the child agent |
| `role` | Yes | One-sentence description of the child's task |
| `systemPrompt` | No | Override system prompt; falls back to the harness default |
| `modelTier` | No | `economy` \| `standard` \| `premium`; defaults to `child_model_tier` |
| `domainRules` | No | Additional domain constraints; ANDed with parent's rules |
| `timeout` | No | Per-spawn timeout in seconds; defaults to `child_timeout_seconds` |

On success, returns:

```json
{ "success": true, "childAgentId": "agent-abc123" }
```

On failure, returns a structured error:

```json
{
  "success": false,
  "error": "depth_limit_exceeded",
  "currentDepth": 2,
  "maxDepth": 2,
  "suggestion": "execute_directly"
}
```

```json
{
  "success": false,
  "error": "max_children_exceeded",
  "activeChildren": 3,
  "maxChildren": 3
}
```

When `depth_limit_exceeded` is returned, the agent should fall back to executing the task directly rather than spawning.

### messageChild(childAgentId, message)

Sends a message to a child agent and blocks until the child responds. From the parent's perspective, this is synchronous.

Returns:

```json
{ "response": "...", "cost": { "tokens": 1240, "usd": 0.0018 } }
```

On failure:

```json
{ "success": false, "error": "child_not_found" }
```

```json
{ "success": false, "error": "child_timeout", "childAgentId": "agent-abc123" }
```

A child can only be messaged by its direct parent. Sibling agents and grandparent agents cannot address a child directly.

## Depth Limits

Delegation depth is configurable per profile via `delegation.max_delegation_depth` (default: `2`).

| Depth | Agent type |
|---|---|
| 0 | Orchestrator |
| 1 | Lead agents (children of orchestrator) |
| 2 | Workers (grandchildren of orchestrator) |

When an agent at the maximum depth calls `spawnSubAgent`, the harness returns `depth_limit_exceeded` immediately without spawning. The agent must handle this error and fall back to direct execution.

## Domain Inheritance

Children inherit their parent's domain rules as a ceiling. Permissions are ANDed -- a child can only have equal or narrower access than its parent.

Example: a parent agent has write access to `src/**`. A child is spawned with a `domainRules` config that requests `src/** delete`. The `delete` permission is denied because the parent's ceiling only allows `write`.

```
Parent domain: src/** → write
Child requests: src/** → delete
Effective child domain: src/** → write  (delete denied)
```

This prevents privilege escalation through spawning. A compromised or misbehaving child cannot exceed the permissions its parent was granted.

## Profile Configuration

Enable hierarchical delegation and set the depth ceiling in `profile.yaml`:

```yaml
delegation:
  default: targeted
  max_delegation_depth: 2        # Controls how deep spawning can go
  # ... other delegation fields
```

The `max_delegation_depth` field is new in harness v1. Omitting it defaults to `2`.

## Example: Engineering Team

A CTO orchestrator delegates broad engineering tasks to an Engineering Lead, which breaks work into parallel streams handled by specialized workers.

**Hierarchy:**

```
CTO Orchestrator (depth 0, delegate-and-execute)
  └── Engineering Lead (depth 1, delegate-only, max_children: 3)
        ├── Backend Dev (depth 2, economy)
        ├── Frontend Dev (depth 2, economy)
        └── QA (depth 2, economy)
```

**Engineering Lead `agent.yaml` delegation block:**

```yaml
delegation:
  can_spawn: true
  max_children: 3
  child_model_tier: economy
  child_timeout_seconds: 120
  delegation_style: delegate-only
```

The CTO Orchestrator uses `delegate-and-execute` because it does light synthesis work (writing the final summary) in addition to routing tasks. The Engineering Lead uses `delegate-only` because its only job is decomposing and distributing work -- it never produces output directly.

## Lifecycle

- Children are destroyed automatically when their parent's session ends.
- A parent can explicitly destroy a child at any time via `destroyChildAgent(childAgentId)`.
- A child can only be messaged by its direct parent -- not by siblings, grandparents, or the orchestrator directly.
- If a parent is destroyed before its children finish, all descendants are destroyed in depth-first order.
