# Layer 3: Skill & Agent AOS-Awareness

**Date:** 2026-03-24
**Status:** Draft
**Detail Level:** Architectural direction (target state contracts)
**Part of:** [AOS Execution Profiles Spec Suite](./00-overview.md)
**Depends on:**
- [Layer 1: Schema Additions](./01-schema-additions.md) (artifact schema, agent capabilities)
- [Layer 2: Adapter Execution Methods](./02-adapter-execution.md) (invokeSkill, executeCode interfaces)

---

## 1. Purpose

This document defines what it means for a skill or agent to be "AOS-aware" — able to receive delegated tasks from the orchestration framework, report structured results, and participate in multi-agent execution workflows.

This is **architectural direction**, not implementation-ready specification. It defines the target state and interface contracts that skill and agent authors should build toward. The migration path for existing skills and agents is out of scope — that is a separate implementation effort per platform.

---

## 2. The Problem

Today's skills and agents are designed for direct human interaction:

- A Claude Code skill receives a natural language prompt from a user and acts on it
- A Pi extension responds to user commands in a conversational flow
- A Codex tool executes based on user instructions

In an AOS execution workflow, the "user" is the orchestrator — another agent that delegates structured tasks and expects structured results. This creates three gaps:

| Gap | Description | Example |
|---|---|---|
| **Input contract** | Skills accept natural language. The orchestrator needs to send structured task descriptions with artifact references. | The CTO orchestrator delegates "run security scan on this architecture" — but the security scan skill expects a user to say "/scan" |
| **Output contract** | Skills produce natural language responses. The orchestrator needs structured results it can route to the next workflow step. | A test-runner skill says "3 tests passed, 1 failed" — but the orchestrator needs a structured `SkillResult` with `success: false` and an `issues` array |
| **Orchestration awareness** | Skills don't know they're part of a larger workflow. They can't signal "I need input from another agent" or "this artifact needs review before I continue." | A code-generation skill writes code but doesn't know it should produce an artifact that the sentinel agent will review next |

---

## 3. AOS Skill Contract

### 3.1 Schema: `aos/skill/v1`

This schema defines the metadata that makes a skill discoverable and invocable by the AOS harness. It does NOT replace the skill's implementation — it is a manifest that wraps the skill.

```yaml
schema: aos/skill/v1
id: architecture-design                  # Unique, kebab-case
name: Architecture Design
description: "Produces architecture decision records from requirements input"
version: 1.0.0

# What the skill needs to run
input:
  required:
    - id: requirements
      type: artifact                     # artifact | text | structured-data | file-path
      description: "Requirements analysis artifact"
    - id: constraints
      type: text
      description: "Technical and business constraints"
  optional:
    - id: existing_architecture
      type: artifact
      description: "Current system architecture (for migration planning)"
    - id: codebase_context
      type: file-path
      description: "Path to codebase or relevant source files"

# What the skill produces
output:
  artifacts:
    - id: architecture_decision_record
      format: markdown
      description: "Complete ADR with system design, tech choices, and migration strategy"
    - id: architecture_diagram
      format: diagram
      description: "Mermaid diagram of the system architecture"
  structured_result: true                # Returns structured SkillResult, not just text

# Which agents can invoke this skill
compatible_agents:
  - architect                            # Primary user
  - cto-orchestrator                     # Can invoke directly

# Platform-specific skill mappings (optional — see Section 3.3 and 7.2 for examples)
# platform_bindings:
#   claude-code: "some-claude-code-skill"
#   pi-cli: "some-pi-extension"

# What the platform must support
platform_requirements:
  requires_code_execution: false
  requires_file_access: true
  requires_network: false
  requires_tools: []                     # Platform-specific tool names
  min_context_tokens: 8000               # Minimum context window needed
```

### 3.2 Schema Definition

```jsonschema
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AOS Skill",
  "type": "object",
  "required": ["schema", "id", "name", "description", "version", "input", "output"],
  "properties": {
    "schema": {
      "const": "aos/skill/v1"
    },
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$"
    },
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "input": {
      "type": "object",
      "properties": {
        "required": {
          "type": "array",
          "items": { "$ref": "#/$defs/inputField" }
        },
        "optional": {
          "type": "array",
          "items": { "$ref": "#/$defs/inputField" }
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "artifacts": {
          "type": "array",
          "items": { "$ref": "#/$defs/outputArtifact" }
        },
        "structured_result": {
          "type": "boolean",
          "default": false
        }
      }
    },
    "compatible_agents": {
      "type": "array",
      "items": { "type": "string" }
    },
    "platform_bindings": {
      "type": "object",
      "description": "Maps platform names to platform-specific skill identifiers. The adapter reads this to resolve the AOS skill ID to a native invocation.",
      "additionalProperties": {
        "type": ["string", "null"]
      }
    },
    "platform_requirements": {
      "type": "object",
      "properties": {
        "requires_code_execution": { "type": "boolean", "default": false },
        "requires_file_access": { "type": "boolean", "default": false },
        "requires_network": { "type": "boolean", "default": false },
        "requires_tools": {
          "type": "array",
          "items": { "type": "string" },
          "default": []
        },
        "min_context_tokens": {
          "type": "integer",
          "default": 4000
        }
      }
    }
  },
  "$defs": {
    "inputField": {
      "type": "object",
      "required": ["id", "type", "description"],
      "properties": {
        "id": { "type": "string" },
        "type": {
          "type": "string",
          "enum": ["artifact", "text", "structured-data", "file-path"]
        },
        "description": { "type": "string" }
      }
    },
    "outputArtifact": {
      "type": "object",
      "required": ["id", "format", "description"],
      "properties": {
        "id": { "type": "string" },
        "format": {
          "type": "string",
          "enum": ["markdown", "code", "structured-data", "diagram"]
        },
        "description": { "type": "string" }
      }
    }
  }
}
```

### 3.3 Skill Directory Layout

```
core/skills/
├── architecture-design/
│   ├── skill.yaml                       # aos/skill/v1 manifest
│   ├── prompt.md                        # Skill's execution prompt (template)
│   └── README.md                        # Human documentation
├── security-scan/
│   ├── skill.yaml
│   ├── prompt.md
│   └── README.md
├── code-review/
│   ├── skill.yaml
│   ├── prompt.md
│   └── README.md
└── task-decomposition/
    ├── skill.yaml
    ├── prompt.md
    └── README.md
```

**Relationship to platform skills:** AOS skills are **wrappers**, not replacements. An AOS skill manifest can reference a platform-specific skill underneath:

```yaml
# In skill.yaml
platform_bindings:
  claude-code: "superpowers:requesting-code-review"    # Maps to Claude Code skill
  pi-cli: "code-review-extension"                       # Maps to Pi extension
  codex: "review-tool"                                  # Maps to Codex tool
```

The adapter's `invokeSkill()` method reads the `platform_bindings` to find the platform-specific implementation. If no binding exists for the current platform, the skill falls back to its `prompt.md` — executed as a natural language prompt to the assigned agent.

---

## 4. Structured Result Reporting

### 4.1 The Problem

In deliberation mode, agents return free-text responses. The Arbiter reads them as a human would — understanding arguments, weighing perspectives, synthesizing.

In execution mode, the orchestrator needs to route results programmatically. "The tests passed" is not actionable — the orchestrator needs `{ success: true, tests_run: 47, tests_passed: 47, coverage: 83.2 }`.

### 4.2 Result Schema

Agents in execution workflows should produce results that conform to a structured envelope:

```typescript
interface StructuredResult {
  // Required
  status: "success" | "partial" | "failed";
  summary: string;                       // Human-readable one-line summary

  // Optional — depends on the task type
  artifacts_produced?: string[];         // Artifact IDs created by this agent
  issues?: Issue[];                      // Problems found (for review tasks)
  metrics?: Record<string, number>;      // Quantitative results
  recommendations?: string[];            // Suggested next steps
  blocked_by?: string[];                 // What's preventing completion
}

interface Issue {
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string;
  location?: string;                     // File path, line number, or section reference
  suggested_fix?: string;
}
```

### 4.3 How Agents Produce Structured Results

Agents don't need to output raw JSON. The framework extracts structure from natural language responses using conventions:

1. **Status line:** The agent's response should start with a clear status indicator:
   - "**APPROVED** — [summary]"
   - "**COMPLETED** — [summary]"
   - "**FAILED** — [summary]"
   - "**NEEDS REVISION** — [summary]"

2. **Issue blocks:** For review tasks, issues are listed with severity markers:
   ```
   **[CRITICAL]** SQL injection in user input handler (src/api/users.ts:42)
   **[MAJOR]** Missing rate limiting on public endpoints
   **[MINOR]** Inconsistent error response format
   **[SUGGESTION]** Consider using connection pooling for database access
   ```

3. **Metrics:** Quantitative results use a key-value format:
   ```
   **Metrics:**
   - Tests run: 47
   - Tests passed: 47
   - Coverage: 83.2%
   - Build time: 12.4s
   ```

The engine's response parser extracts these structures. If parsing fails, the entire response is wrapped in a minimal `StructuredResult` with `status: "partial"` and the full text as `summary`.

### 4.4 Extraction vs. Enforcement

The framework does NOT enforce structured output. Agents can respond naturally, and the parser does its best. This is a deliberate design choice:

- **Enforcement** (forcing JSON output) reduces agent reasoning quality and makes prompts rigid
- **Extraction** (parsing conventions from natural language) preserves agent flexibility while giving the orchestrator enough structure to route

The conventions above are recommendations that improve extraction accuracy. Agents that follow them get better structured results. Agents that don't still work — their output is just treated as unstructured text.

---

## 5. Review Feedback Protocol

### 5.1 The Review Loop

Execution workflows frequently need review cycles: one agent produces work, another reviews it, feedback goes back, the producer revises. This is the review feedback protocol.

```
Producer Agent ──produces──► Artifact
                                │
                     submitForReview()
                                │
                                ▼
Reviewer Agent ──reviews──► ReviewResult
                                │
                    ┌───────────┴───────────┐
                    │                       │
              status: approved        status: rejected
                    │                       │
              Continue workflow        Route feedback
                                           │
                                           ▼
                              Producer Agent ──revises──► Revised Artifact
                                                              │
                                                    (loop until approved
                                                     or max iterations)
```

### 5.2 Feedback Routing

When a reviewer rejects an artifact, the engine:

1. Extracts the `ReviewResult.feedback` and `ReviewResult.issues[]`
2. Formats the feedback as a structured revision request:

```markdown
---
## Revision Request
Reviewer: {{reviewer_id}}
Status: {{status}}
Issues found: {{issues_count}}
---

### Issues

{{#each issues}}
**[{{severity}}]** {{description}}
{{#if location}}Location: {{location}}{{/if}}
{{#if suggested_fix}}Suggested fix: {{suggested_fix}}{{/if}}

{{/each}}

### Reviewer Feedback
{{feedback}}

---
Please revise the artifact to address the issues above. Focus on critical and major issues first.
```

3. Re-delegates to the producer agent with:
   - The original artifact content
   - The revision request above
   - The original step prompt (for context)

4. The producer's revised output overwrites the artifact content, and the artifact's `revision` counter increments.

### 5.3 Review Loop Limits

- **Default max iterations:** 3 (configurable per workflow step)
- **After max iterations with rejection:** The artifact is marked `review_status: "rejected"` and the workflow continues. The orchestrator decides whether to proceed or halt.
- **Transcript:** Each review iteration is logged as a `review_submission` event.

---

## 6. Agent AOS-Awareness Levels

Not all agents need full AOS-awareness. The framework supports a spectrum:

### Level 0: Unaware (Current State)

- Agent responds to natural language prompts
- Output is free-text
- No knowledge of workflows, artifacts, or other agents
- **All 12 existing agents start here.** They work in execution profiles through the orchestrator's mediation — the CTO orchestrator handles structured delegation and result extraction.

### Level 1: Convention-Following

- Agent follows structured result conventions (Section 4.3)
- Produces status lines, issue blocks, and metrics in its responses
- Still responds to natural language; just with predictable formatting
- **Target for existing agents in execution profiles.** Add formatting conventions to their `role_override` instructions.

### Level 2: Artifact-Aware

- Agent understands the artifact concept
- Can reference input artifacts by ID
- Produces output that maps cleanly to the artifact schema
- Can flag when an artifact needs review
- **Target for specialized execution agents** (e.g., a Developer agent, a QA agent)

### Level 3: Workflow-Aware

- Agent understands its position in the workflow
- Can signal "I'm blocked on artifact X" or "artifact Y needs revision before I can continue"
- Can request re-delegation to another agent
- **Target for orchestrator agents** (CTO orchestrator, future CEO/CIO orchestrators)

### Migration Path

```
Level 0 ──(add role_override with formatting instructions)──► Level 1
Level 1 ──(update prompt.md with artifact conventions)──► Level 2
Level 2 ──(add workflow signaling to prompt.md)──► Level 3
```

Each level is achieved through prompt engineering, not code changes. The framework's result parser handles all levels — it just gets more accurate at higher levels.

---

## 7. Existing Skill Landscape

### 7.1 Skills Available for Wrapping

The following skill families exist across platforms and are candidates for AOS skill wrappers:

**Process Skills (from Superpowers and similar):**

| Skill | What It Does | AOS Skill Wrapper |
|---|---|---|
| brainstorming | Explores ideas through structured dialogue | `ideation` |
| writing-plans | Creates implementation plans from specs | `plan-generation` |
| test-driven-development | Writes tests before implementation | `tdd-workflow` |
| systematic-debugging | Structured bug investigation | `debug-workflow` |
| requesting-code-review | Reviews code against standards | `code-review` |
| verification-before-completion | Verifies work before claiming done | `verification` |

**Implementation Skills:**

| Skill | What It Does | AOS Skill Wrapper |
|---|---|---|
| frontend-design | Produces UI components | `ui-implementation` |
| api-docs | Generates API documentation | `api-documentation` |
| scan | Security audits | `security-scan` |
| implement | Feature implementation | `feature-implementation` |

**Operational Skills:**

| Skill | What It Does | AOS Skill Wrapper |
|---|---|---|
| commit-code | Git commit with conventions | `version-control` |
| create-pr | Pull request creation | `pr-management` |
| worktree-merge | Git worktree management | `workspace-isolation` |

### 7.2 Wrapping Strategy

AOS skill wrappers do NOT rewrite the underlying skills. They add:

1. **A manifest** (`skill.yaml`) that declares inputs, outputs, and platform bindings
2. **An adapter prompt** that translates the orchestrator's structured delegation into the skill's expected input format
3. **A result parser** configuration that extracts structured results from the skill's output

Example wrapper for the `requesting-code-review` skill:

```yaml
schema: aos/skill/v1
id: code-review
name: Code Review
description: "Reviews code artifacts against quality standards and security best practices"
version: 1.0.0

input:
  required:
    - id: code_artifact
      type: artifact
      description: "The code or implementation artifact to review"
  optional:
    - id: standards
      type: text
      description: "Project-specific coding standards or review criteria"
    - id: architecture
      type: artifact
      description: "Architecture artifact for context on design intent"

output:
  artifacts:
    - id: review_report
      format: markdown
      description: "Structured review report with issues and recommendations"
  structured_result: true

compatible_agents: [sentinel, architect, operator]

platform_bindings:
  claude-code: "superpowers:requesting-code-review"
  pi-cli: null                           # No native binding; uses prompt.md fallback

platform_requirements:
  requires_code_execution: false
  requires_file_access: true
  requires_network: false
```

---

## 8. Integration with Agent Capabilities

The agent `capabilities` field (Layer 1, Section 3.1) and the skill `compatible_agents` field create a two-way binding:

```
Agent capabilities.available_skills: ["code-review", "security-scan"]
                    │
                    │ Agent declares what skills it can invoke
                    │
                    ▼
Skill compatible_agents: [sentinel, architect]
                    │
                    │ Skill declares which agents can invoke it
                    │
                    ▼
Engine validates both directions before invokeSkill()
```

**Validation rules:**
1. When the engine receives an `invokeSkill(handle, skillId)` call, it checks:
   - The agent's `capabilities.available_skills` includes `skillId`
   - The skill's `compatible_agents` includes the agent's ID (or is empty, meaning "any agent")
2. If either check fails, the engine logs a warning but does not block the invocation (advisory, not enforcement — same as capability declarations in general).

---

## 9. Open Questions

These questions are deferred to implementation time:

1. **Skill discovery:** How does the engine discover available skills? Scanning `core/skills/` is one option; a skill registry is another. The discovery mechanism may be platform-specific.

2. **Skill versioning:** When multiple versions of a skill exist, which one does the engine invoke? First-match, latest, or explicit version pinning in the workflow?

3. **Cross-platform skill portability:** A skill manifest with `platform_bindings` for Claude Code but not Pi CLI will fall back to `prompt.md` on Pi. Is this degradation acceptable, or should the engine warn?

4. **Skill composition:** Can one skill invoke another? If yes, how deep can the chain go? Initial recommendation: no skill-to-skill invocation. Skills are leaf nodes; orchestration is the engine's job.

5. **Skill testing:** How do you test an AOS skill wrapper in isolation? A mock adapter that simulates `invokeSkill()` would be the natural approach, but the testing contract needs definition.

6. **Agent marketplace:** The framework vision includes community-contributed agents and skills. The `aos/skill/v1` manifest is the starting point for a skill marketplace, but packaging, distribution, and trust verification are out of scope for this spec.
