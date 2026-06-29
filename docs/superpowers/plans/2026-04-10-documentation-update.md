# Documentation Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document all new capabilities (domain enforcement, hierarchical delegation, persistent expertise, event summarization, session resumption) and previously undocumented features (skills, workflows), then update existing docs to reference the new capabilities.

**Architecture:** Follow the existing doc pattern (concept intro, file structure, full YAML schema with inline comments, mechanics, examples, troubleshooting). Each new guide is a standalone README.md in its own directory. Existing docs get appended sections — not rewritten. A final pass renames "framework" to "harness" across all docs.

**Tech Stack:** Markdown, YAML examples

---

## File Map

### New Files
| File | Topic |
|---|---|
| `docs/domain-enforcement/README.md` | Domain rules, path matching, tool access, bash restrictions |
| `docs/hierarchical-delegation/README.md` | Lead→Worker pattern, depth limits, domain inheritance |
| `docs/persistent-expertise/README.md` | Expertise files, diff updates, auto_commit, pruning |
| `docs/event-summarization/README.md` | Template vs LLM summaries, event types, batching |
| `docs/session-resumption/README.md` | Checkpoints, pause/resume, conversation tails |
| `docs/creating-workflows/README.md` | Workflow schema, steps, gates, artifact flow |
| `docs/creating-skills/README.md` | Skill manifest, platform bindings, compatible agents |

### Modified Files
| File | Change |
|---|---|
| `docs/creating-agents/README.md` | Add domain, delegation, expertiseConfig sections |
| `docs/creating-profiles/README.md` | Add max_delegation_depth |
| `README.md` | Add enhanced capabilities to feature list and architecture |
| All docs/*.md files | Replace "framework" with "harness" (97 occurrences across 21 files) |

---

## Task 1: Domain Enforcement Guide

**Files:**
- Create: `docs/domain-enforcement/README.md`

- [ ] **Step 1: Write the guide**

The guide must cover:

**Section: What Domain Enforcement Does** — Structural, code-enforced file/tool permission boundaries per agent. Not advisory prompts — real enforcement at the adapter layer.

**Section: Adding Domain Rules to an Agent** — Full `domain` schema in agent.yaml:
```yaml
domain:
  rules:
    - path: "src/api/**"
      read: true
      write: true
      delete: false
    - path: "**/*.env*"
      read: false
      write: false
      delete: false
  tool_allowlist: ["read", "write", "edit", "grep", "glob"]
  tool_denylist: ["bash"]
  bash_restrictions:
    blocked_tokens:
      - tokens: ["rm", "recursive"]
        aliases: { recursive: ["-r", "-R", "--recursive"] }
      - tokens: ["git", "push"]
    blocked_patterns: ["curl.*-X DELETE"]
```

**Section: Path Matching Algorithm** — Longest-prefix wins, deny breaks ties, deny-by-default for unmatched paths. Include the 3-level specificity example from the spec.

**Section: Tool Access Control** — Denylist takes precedence over allowlist. If no lists defined, all tools allowed.

**Section: Bash Restrictions** — Token-based co-occurrence detection (order-independent). Explain why `rm -rf`, `rm -r -f`, and `rm --recursive --force` all trigger the same rule. Regex fallback for complex patterns.

**Section: Profile-Level Overrides** — Show `domain_override` in profile assembly.

**Section: Domain Inheritance for Child Agents** — Children inherit parent's domain as ceiling. Permissions are ANDed — child can only narrow, never widen.

**Section: Troubleshooting** — Common errors: "no matching rule for path", "tool not in allowlist", "bash command matches blocked token set". What they mean and how to fix.

- [ ] **Step 2: Commit**

```bash
git add docs/domain-enforcement/README.md
git commit -m "docs: add domain enforcement guide"
```

---

## Task 2: Hierarchical Delegation Guide

**Files:**
- Create: `docs/hierarchical-delegation/README.md`

- [ ] **Step 1: Write the guide**

**Section: What Hierarchical Delegation Does** — Agents can spawn sub-agents, creating depth-2+ delegation chains. Orchestrator→Lead→Worker pattern.

**Section: Enabling Delegation on an Agent** — Full `delegation` schema:
```yaml
delegation:
  can_spawn: true
  max_children: 3
  child_model_tier: economy
  child_timeout_seconds: 120
  delegation_style: delegate-only  # or delegate-and-execute
```
Explain both styles: `delegate-only` (lead pattern — only spawnSubAgent/messageChild tools), `delegate-and-execute` (hybrid — retains normal tools AND can spawn).

**Section: Delegation Tools** — `spawnSubAgent(config)` and `messageChild(childAgentId, message)`. Show return types including error variants (depth_limit_exceeded, max_children_exceeded, child_not_found, child_timeout).

**Section: Depth Limits** — Configurable per profile via `max_delegation_depth` (default: 2). Explain depth counting (orchestrator=0, children=1, grandchildren=2).

**Section: Domain Inheritance** — Children inherit and narrow parent's domain. Permissions ANDed.

**Section: Profile Configuration** — Adding `max_delegation_depth` to profile delegation section.

**Section: Example: Engineering Team** — Show a CTO orchestrator spawning an Engineering Lead who spawns Backend Dev + Frontend Dev workers.

- [ ] **Step 2: Commit**

```bash
git add docs/hierarchical-delegation/README.md
git commit -m "docs: add hierarchical delegation guide"
```

---

## Task 3: Persistent Expertise Guide

**Files:**
- Create: `docs/persistent-expertise/README.md`

- [ ] **Step 1: Write the guide**

**Section: What Persistent Expertise Does** — Agents accumulate knowledge across sessions via structured YAML files. An Architect remembers your codebase patterns. A Sentinel retains threat models.

**Section: Enabling Expertise on an Agent** — Full `expertiseConfig` schema:
```yaml
expertiseConfig:
  enabled: true
  max_lines: 5000
  structure:
    - architecture_patterns
    - recurring_failure_modes
    - domain_heuristics
  read_on: session_start
  update_on: session_end
  scope: per-project    # or global
  mode: read-write      # or read-only
  auto_commit: review   # or "true"
```

**Section: Expertise File Structure** — Show the YAML format with `last_updated`, `session_count`, `knowledge` map.

**Section: How Updates Work** — Diff-based (additions + removals per category), not full rewrites. Economy-tier model distills session transcript. Explain why this limits blast radius.

**Section: Auto-Commit vs Review Mode** — `auto_commit: "true"` applies immediately. `auto_commit: review` writes to `.pending.yaml` requiring CLI approval.

**Section: Pruning** — Age-based FIFO within categories. Proportional distribution across categories. Oldest entries removed first.

**Section: Prompt Injection** — Expertise is injected as `## Prior Knowledge` section in agent's system prompt at session start.

**Section: Troubleshooting** — Empty expertise (first session), expertise growing too large, reviewing pending updates.

- [ ] **Step 2: Commit**

```bash
git add docs/persistent-expertise/README.md
git commit -m "docs: add persistent expertise guide"
```

---

## Task 4: Event Summarization Guide

**Files:**
- Create: `docs/event-summarization/README.md`

- [ ] **Step 1: Write the guide**

**Section: What Event Summarization Does** — Every transcript event gets a human-readable summary. Simple events use templates (zero LLM cost), complex events are batched for economy-tier summarization.

**Section: Template-Summarized Events** — List the 11 event types that get free template summaries: file_changed, token_usage, domain_access, agent_destroyed, constraint_check, agent_spawn, agent_destroy, session_start, session_end, session_paused, session_resumed. Show example summaries.

**Section: LLM-Summarized Events** — List the 10 complex types: delegation, response, child_delegation, child_response, domain_violation, expertise_updated, gate_reached, gate_result, final_statement, review_submission. Explain batching (10-second windows, single LLM call per batch).

**Section: Full Event Type Reference** — Table of all TranscriptEventType values with descriptions, grouped by category (core, domain enforcement, hierarchical, expertise, file tracking, cost, session lifecycle).

**Section: Platform Integration** — Events flow from harness via `onTranscriptEvent` → platform POST `/api/sessions/:id/events`. Summaries stored in `transcript_events.summary` column.

- [ ] **Step 2: Commit**

```bash
git add docs/event-summarization/README.md
git commit -m "docs: add event summarization guide"
```

---

## Task 5: Session Resumption Guide

**Files:**
- Create: `docs/session-resumption/README.md`

- [ ] **Step 1: Write the guide**

**Section: What Session Resumption Does** — Sessions can be paused and resumed with full context reconstruction. Agents wake up with memory of their recent conversation.

**Section: How Checkpoints Work** — Explain `SessionCheckpoint` contents: constraintState, activeAgents (with per-agent AgentCheckpoint), roundsCompleted, pendingDelegations, transcriptReplayDepth.

**Section: Per-Agent Conversation Tails** — Each agent's checkpoint includes the last N events where they were involved (default: 50). Events filtered by agentId, childAgentId, or delegation target. This gives agents context on resume.

**Section: Pause/Resume Flow** — Step by step: pause captures state → checkpoint serialized → session_paused event emitted → on resume, agents re-spawned → expertise loaded → conversation tails replayed as context → delegation resumes.

**Section: Constraint Behavior on Resume** — Time elapsed resets (fresh clock), budget and rounds continue from checkpoint values.

**Section: Limitations** — Agent internal context window is not preserved (only conversation tails replayed). Very long sessions may lose nuance. Replay depth is configurable.

- [ ] **Step 2: Commit**

```bash
git add docs/session-resumption/README.md
git commit -m "docs: add session resumption guide"
```

---

## Task 6: Creating Workflows Guide

**Files:**
- Create: `docs/creating-workflows/README.md`

- [ ] **Step 1: Write the guide**

Read `core/workflows/cto-execution.workflow.yaml` first to base the guide on a real example.

**Section: What Workflows Are** — Step-based execution plans with review gates. Linked from profiles via the `workflow` field.

**Section: Workflow Structure** — Full schema:
```yaml
schema: aos/workflow/v1
id: my-workflow
name: My Workflow
steps:
  - id: step-1
    name: Step Name
    action: targeted-delegation  # broadcast | targeted-delegation | tension-pair | orchestrator-synthesis
    agents: [agent-id-1, agent-id-2]
    prompt: "Message to send to agents"
    input: []                    # Artifact IDs from previous steps
    output: step-1-output        # Artifact key produced by this step
    review_gate: false
gates:
  - after: step-1
    type: user-approval          # or automated-review
    prompt: "Does this look right?"
    on_rejection: retry_with_feedback  # or re-run-step
```

**Section: Step Actions** — Explain each action type and when to use it.

**Section: Artifact Flow** — How output from one step becomes input to the next.

**Section: Review Gates** — User-approval vs automated-review. Rejection strategies.

**Section: Example** — Walk through the CTO execution workflow step by step.

- [ ] **Step 2: Commit**

```bash
git add docs/creating-workflows/README.md
git commit -m "docs: add creating workflows guide"
```

---

## Task 7: Creating Skills Guide

**Files:**
- Create: `docs/creating-skills/README.md`

- [ ] **Step 1: Write the guide**

Read `core/skills/code-review/skill.yaml` and `core/schema/skill.schema.json` first.

**Section: What Skills Are** — Reusable capability bundles that agents can invoke. Platform-agnostic definition with platform-specific bindings.

**Section: Skill Structure** — Full schema based on actual skill.schema.json.

**Section: Platform Bindings** — How skills map to platform capabilities (e.g., code-review → superpowers:requesting-code-review in Claude Code).

**Section: Compatible Agents** — How to restrict which agents can use a skill.

**Section: Example** — Walk through the code-review skill definition.

- [ ] **Step 2: Commit**

```bash
git add docs/creating-skills/README.md
git commit -m "docs: add creating skills guide"
```

---

## Task 8: Update Existing Agent and Profile Docs

**Files:**
- Modify: `docs/creating-agents/README.md`
- Modify: `docs/creating-profiles/README.md`

- [ ] **Step 1: Add new fields to creating-agents guide**

Append three new sections after the existing `capabilities` section:

**Domain Enforcement** — Brief explanation + link to full guide. Show the `domain` field in agent.yaml with a short example.

**Hierarchical Delegation** — Brief explanation + link. Show the `delegation` field.

**Persistent Expertise Configuration** — Brief explanation + link. Show the `expertiseConfig` field. Note this is different from the existing `expertise` field (which is the scratch pad paths).

- [ ] **Step 2: Add max_delegation_depth to creating-profiles guide**

In the delegation section, add `max_delegation_depth` as an optional field with explanation.

- [ ] **Step 3: Commit**

```bash
git add docs/creating-agents/README.md docs/creating-profiles/README.md
git commit -m "docs: update agent and profile guides with new capability fields"
```

---

## Task 9: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add enhanced capabilities section**

After the existing architecture section, add a "Enhanced Capabilities" section listing:
- Domain Enforcement — one-liner + link
- Hierarchical Delegation — one-liner + link
- Persistent Expertise — one-liner + link
- Event Summarization — one-liner + link
- Session Resumption — one-liner + link

Update the documentation pointers table to include the new guides.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with enhanced capabilities and doc links"
```

---

## Task 10: Framework → Harness Rename

**Files:**
- Modify: All 21 docs/*.md files with "framework" occurrences

- [ ] **Step 1: Run the rename**

Use grep to find all occurrences, then systematically replace:
- "AOS Harness" → "AOS Harness"
- "aos-harness" → "aos-harness" (in package names, imports)
- "framework" → "harness" (in general prose, case-sensitive check needed)

Be careful NOT to rename in contexts where "framework" is a generic English word (e.g., "analytical framework", "decision framework"). Only rename when it refers to the AOS project itself.

- [ ] **Step 2: Verify no broken references**

Scan for any remaining "aos-harness" or "AOS Harness" strings.

- [ ] **Step 3: Commit**

```bash
git add -A docs/
git commit -m "docs: rename framework to harness across all documentation"
```
