# Creating Skills

Skills are reusable capability bundles that agents invoke to perform specific, well-defined tasks -- things like reviewing code, generating diagrams, or validating structured outputs. A skill defines what it does, what it needs as input, and what it produces, in a way that is entirely platform-agnostic. Platform-specific behavior is isolated in the `platform_bindings` field, which maps each platform to its native implementation.

This separation means the same skill definition works across multiple execution environments. The skill's identity, inputs, and outputs remain stable; only the binding changes per platform.

## Skill Structure

Each skill lives in its own directory under `core/skills/`:

```
core/skills/
  my-skill/
    skill.yaml    # Skill definition
```

Here is the full schema with inline comments:

```yaml
schema: aos/skill/v1             # Required. Always this value.
id: my-skill                     # Required. Kebab-case. Must match directory name.
name: My Skill                   # Required. Human-readable display name.
description: "What this skill does, in one sentence."   # Required.
version: 1.0.0                   # Required. Semantic version (major.minor.patch).

input:
  required:                      # Inputs the skill cannot run without.
    - id: input_name             # Identifier used when invoking the skill.
      type: artifact             # Input type. See Input and Output below.
      description: "What this input contains."
  optional:                      # Inputs that provide additional context if available.
    - id: optional_input
      type: text
      description: "Additional context the skill can use if provided."

output:
  artifacts:                     # Artifacts this skill produces.
    - id: result_name            # Identifier for the produced artifact.
      format: markdown           # Output format. See Input and Output below.
      description: "What this artifact contains."
  structured_result: false       # true if the skill also returns a machine-readable result.

compatible_agents:               # Optional. Restricts which agents can invoke this skill.
  - agent-id-one
  - agent-id-two

platform_bindings:               # Optional. Maps platform names to native skill identifiers.
  claude-code: "skill-name-or-path"
  other-platform: null           # null = not supported on this platform.

platform_requirements:           # Optional. Runtime capabilities this skill needs.
  requires_code_execution: false
  requires_file_access: false
  requires_network: false
  requires_tools: []             # Named tools the platform must provide (e.g., ["bash", "read"]).
  min_context_tokens: 4000       # Minimum context window size needed to run the skill.
```

The `schema`, `id`, `name`, `description`, `version`, `input`, and `output` fields are all required. Every other field is optional.

## Input and Output

### Input Types

The `type` field on each input entry declares the shape of the data the skill expects:

| Type | Description |
|---|---|
| `artifact` | A named artifact produced by a prior step. Passed by reference; the harness resolves the content at invocation time. |
| `text` | A plain text string -- instructions, criteria, or freeform context. |
| `structured-data` | A machine-readable object (JSON or YAML). Used when the skill needs to process data programmatically. |
| `file-path` | A path to a file on disk. Used when the skill needs to read a specific file rather than an artifact produced by the workflow. |

Required inputs must be provided for the skill to run. Optional inputs are passed when available and can improve the quality of the skill's output, but their absence does not block execution.

### Output Formats

The `format` field on each output artifact declares how the result is structured:

| Format | Description |
|---|---|
| `markdown` | Human-readable document, typically a report, analysis, or summary. |
| `code` | Source code in any language. |
| `structured-data` | Machine-readable output (JSON or YAML) for downstream consumption. |
| `diagram` | A diagram in a text-based format such as Mermaid. |

If `structured_result: true`, the skill also returns a machine-readable summary alongside the artifact. This is useful when the invoking agent or orchestrator needs to branch on the skill's outcome programmatically (e.g., pass/fail, severity level).

## Platform Bindings

The `platform_bindings` field maps platform identifiers to the native invocation string the adapter uses to execute the skill on that platform. The AOS harness reads this map at runtime to resolve the abstract skill ID to a concrete action.

```yaml
platform_bindings:
  claude-code: "superpowers:requesting-code-review"
  my-platform: "my-platform/run-review"
  unsupported-platform: null     # Explicitly marks this skill as unavailable on this platform.
```

Each key is a platform name recognized by the harness. Each value is either a string (the native skill path or command on that platform) or `null` (not supported).

If a platform has no entry in `platform_bindings`, behavior is platform-defined -- the harness may attempt a generic invocation or skip the skill with a warning. Explicitly setting `null` makes the unavailability clear and prevents ambiguity.

When adding a new platform binding, you do not need to modify the rest of the skill definition. The platform binding is the only field that changes across environments.

## Compatible Agents

The optional `compatible_agents` field restricts which agents can invoke this skill. When present, the harness enforces that only listed agents can trigger the skill during a session.

```yaml
compatible_agents: [sentinel, architect, operator]
```

When omitted, any agent in the assembly can invoke the skill.

Use `compatible_agents` when:

- The skill requires a specific cognitive profile to use correctly (e.g., a security scanning skill that only makes sense for the Sentinel).
- You want to prevent agents from invoking skills outside their domain, reducing noise in the output.
- The skill produces artifacts that are inputs to a specific agent's workflow step.

This field is informational at the agent level -- it does not grant tool access. Tool access is controlled separately via the agent's `tools` field.

## Platform Requirements

The `platform_requirements` block declares what the executing platform must provide for the skill to run. The harness reads this before invoking the skill and can skip or warn if a requirement is unmet.

```yaml
platform_requirements:
  requires_code_execution: false   # Needs a code execution sandbox (e.g., Python/bash runner).
  requires_file_access: true       # Needs read (and possibly write) access to the filesystem.
  requires_network: false          # Needs outbound network access.
  requires_tools: []               # Specific named tools the platform must expose.
  min_context_tokens: 4000         # Minimum context window the model must support.
```

All fields default to their most permissive value (`false` for booleans, `[]` for arrays, `4000` for `min_context_tokens`) when omitted. Only declare requirements that are genuinely hard constraints -- overly strict requirements reduce the platforms where the skill can run.

`requires_tools` accepts an array of named tool strings matching the tool identifiers used in agent and platform configurations. For example:

```yaml
requires_tools: ["bash", "read", "write"]
```

## Example: The Code Review Skill

The `code-review` skill (`core/skills/code-review/skill.yaml`) reviews code artifacts against quality standards and security best practices. Here is the complete definition and what each part does.

```yaml
schema: aos/skill/v1
id: code-review
name: Code Review
description: "Reviews code artifacts against quality standards and security best practices"
version: 1.0.0
```

Standard header. The `id` must match the directory name (`core/skills/code-review/`). The version starts at `1.0.0` and increments as the skill's interface changes.

```yaml
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
```

One required input: the code artifact to be reviewed. Two optional inputs improve review quality when available: project-specific standards narrow the review criteria, and an architecture artifact gives the reviewer context on what the code is supposed to do. The skill runs without the optional inputs, but a reviewer with architecture context will catch more design-level issues.

```yaml
output:
  artifacts:
    - id: review_report
      format: markdown
      description: "Structured review report with issues and recommendations"
  structured_result: true
```

The skill produces a `review_report` in Markdown format -- a human-readable document listing issues, severity, and recommendations. `structured_result: true` means the skill also returns a machine-readable summary, which allows the orchestrator or a downstream agent to act on the review outcome programmatically (e.g., determine whether issues are blocking or advisory).

```yaml
compatible_agents: [sentinel, architect, operator]
```

Only the Sentinel, Architect, and Operator can invoke this skill. These are the agents with the analytical profile to interpret a code review and act on it -- the Sentinel for security and reliability, the Architect for design alignment, and the Operator for buildability. Keeping the skill scoped to these three avoids noise from agents (like the Advocate or Provocateur) who lack the technical context to use the output effectively.

```yaml
platform_bindings:
  claude-code: "superpowers:requesting-code-review"
```

On the `claude-code` platform, this skill maps to the `superpowers:requesting-code-review` skill invocation. The harness adapter reads this and triggers that skill when `code-review` is invoked. No other platforms are bound yet -- adding support for a new platform means adding one line here without changing anything else.

```yaml
platform_requirements:
  requires_code_execution: false
  requires_file_access: true
  requires_network: false
```

The code review skill needs filesystem access (`requires_file_access: true`) to read the code artifact from disk. It does not need a code execution sandbox or network access -- reviewing code is a reading and analysis task, not a running task. Declaring these requirements precisely ensures the harness does not invoke this skill on a platform that cannot provide file access.
