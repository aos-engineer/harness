# Layer 2: Adapter Execution Methods

**Date:** 2026-03-24
**Status:** Draft
**Detail Level:** Interface contracts
**Part of:** [AOS Execution Profiles Spec Suite](./00-overview.md)
**Depends on:** [Layer 1: Schema Additions](./01-schema-additions.md) (artifact schema, agent capabilities)

---

## 1. Design Principle

Execution capabilities are **new methods on the existing `WorkflowAdapter` interface** (Layer 4 of the 4-layer adapter contract). They are not a new "Layer 5" and not a separate "Execution Bridge" abstraction.

The rationale:

1. **One adapter, one interface.** The orchestrator and engine should not need to decide whether to talk to a "thinking adapter" or a "doing adapter." The engine calls `adapter.invokeSkill()` the same way it calls `adapter.sendMessage()`.
2. **Same `UnsupportedError` pattern.** Adapters that don't support execution throw `UnsupportedError`, and the engine degrades gracefully — the same pattern already established for methods like `steerMessage()` and `openInEditor()`.
3. **No maintenance drift.** Two parallel adapter systems would inevitably diverge in error handling, state management, and lifecycle semantics.

### Backwards Compatibility

Adding methods to `WorkflowAdapter` does not break existing adapters because:

- **`createArtifact()` and `loadArtifact()`** have default implementations provided by the AOS runtime base class. Existing adapters inherit these without code changes.
- **`executeCode()`, `invokeSkill()`, and `submitForReview()`** throw `UnsupportedError` by default. Existing adapters that don't override these gracefully degrade at runtime.

No existing adapter method signatures or semantics change. The new methods are additive.

---

## 2. New Methods on `WorkflowAdapter`

### 2.1 Interface Definition

```typescript
// Additions to WorkflowAdapter (Layer 4)
// These extend the existing interface from Section 6.1 of the harness spec.

interface WorkflowAdapter {
  // === Existing methods (unchanged) ===
  dispatchParallel(agents: AgentHandle[], message: string, opts?: ParallelOpts): Promise<AgentResponse[]>;
  isolateWorkspace(): Promise<WorkspaceHandle>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  openInEditor(path: string, editor: string): Promise<void>;
  persistState(key: string, value: any): Promise<void>;
  loadState(key: string): Promise<any>;

  // === New execution methods ===

  /**
   * Execute code in the platform's runtime environment.
   *
   * The agent produces code; the adapter executes it in a sandboxed
   * environment appropriate to the platform. Returns execution results
   * (stdout, stderr, exit code).
   *
   * Adapters that do not support code execution throw UnsupportedError.
   */
  executeCode(
    handle: AgentHandle,
    code: string,
    opts?: ExecuteCodeOpts
  ): Promise<ExecutionResult>;

  /**
   * Invoke a named skill via the platform's skill system.
   *
   * Skills are platform-specific capabilities (Claude Code skills,
   * Pi extensions, Codex tools). The adapter maps the skill ID to
   * the platform's invocation mechanism.
   *
   * Adapters that do not support skill invocation throw UnsupportedError.
   */
  invokeSkill(
    handle: AgentHandle,
    skillId: string,
    input: SkillInput
  ): Promise<SkillResult>;

  /**
   * Create an artifact file and its manifest.
   *
   * Writes the artifact content to the specified path and creates
   * the corresponding .artifact.yaml manifest file. Uses the
   * aos/artifact/v1 schema from Layer 1.
   *
   * A default implementation is provided by the AOS runtime base
   * class (see Section 3.3), so adapters are NOT required to
   * implement this method explicitly. The default composes
   * writeFile() + YAML serialization. Adapters may override for
   * platform-specific optimizations (e.g., indexing, UI notification).
   */
  createArtifact(
    artifact: ArtifactManifest,
    content: string
  ): Promise<void>;

  /**
   * Load an artifact by ID from the session's artifact directory.
   *
   * Reads the .artifact.yaml manifest and the content file.
   * Returns both the manifest metadata and the content string.
   *
   * A default implementation is provided by the AOS runtime base
   * class (see Section 3.4), so adapters are NOT required to
   * implement this method explicitly. The default composes
   * readFile() + YAML parsing. Adapters may override for
   * platform-specific optimizations.
   */
  loadArtifact(
    artifactId: string,
    sessionDir: string
  ): Promise<LoadedArtifact>;

  /**
   * Submit an artifact for review by another agent.
   *
   * Sends the artifact content + metadata as context to the reviewer
   * agent, with a structured review prompt. Returns the review result
   * (approved/rejected with feedback).
   *
   * This is a convenience method that composes injectContext() +
   * sendMessage(). Adapters may override for platform-specific
   * review workflows.
   */
  submitForReview(
    artifact: LoadedArtifact,
    reviewer: AgentHandle,
    reviewPrompt?: string
  ): Promise<ReviewResult>;
}
```

### 2.2 Supporting Types

```typescript
// --- executeCode ---

interface ExecuteCodeOpts {
  language?: string;                    // "typescript" | "python" | "bash" | etc.
  timeout_ms?: number;                  // Max execution time. Default: 30000 (30s)
  cwd?: string;                         // Working directory. Default: session dir
  env?: Record<string, string>;         // Additional environment variables
  sandbox?: "strict" | "relaxed";       // Sandbox level. Default: "strict"
                                        // strict: no network, limited fs access
                                        // relaxed: network allowed, full fs access
}

interface ExecutionResult {
  success: boolean;                     // exit code === 0
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  files_created?: string[];             // Paths of files created during execution
  files_modified?: string[];            // Paths of files modified during execution
}

// --- invokeSkill ---

interface SkillInput {
  args?: string;                        // Skill arguments (platform-specific)
  context?: Record<string, string>;     // Key-value context pairs
  artifacts?: string[];                 // Artifact IDs to pass as input
}

interface SkillResult {
  success: boolean;
  output: string;                       // Skill's text output
  artifacts_produced?: string[];        // Artifact IDs created by the skill
  files_created?: string[];
  files_modified?: string[];
  error?: string;                       // Error message if success === false
}

// --- createArtifact / loadArtifact ---

// ArtifactManifest is defined in Layer 1 (01-schema-additions.md, Section 4)

interface LoadedArtifact {
  manifest: ArtifactManifest;
  content: string;
}

// --- submitForReview ---

interface ReviewResult {
  status: "approved" | "rejected" | "needs-revision";
  feedback?: string;                    // Reviewer's feedback (present when rejected/needs-revision)
  reviewer: string;                     // Agent ID that performed the review
  issues?: ReviewIssue[];               // Structured list of issues found
}

interface ReviewIssue {
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string;
  location?: string;                    // File path or section reference
}
```

---

## 3. Method Semantics

### 3.1 `executeCode()`

**Purpose:** Run code that an agent has produced as part of a workflow step.

**When used:** During `execute-with-tools` workflow steps when an agent produces code that needs to be executed (tests, build scripts, data transformations, code generation tools).

**Security model:** The adapter is responsible for sandboxing. The engine does not validate or inspect the code. Platform-specific sandboxing:

- **Pi CLI:** Bash subprocess with restricted permissions. Uses the same sandbox as Pi's native tool execution.
- **Claude Code:** Routes through Claude Code's Bash tool, which has the user's configured permission mode.
- **Codex CLI:** Uses Codex's native sandboxed execution environment.

**Idempotency:** Not guaranteed. The engine should not retry `executeCode()` on failure unless the profile's `retry_policy` explicitly allows it. Side effects (file creation, network calls) may not be reversible.

**Transcript event:** Each `executeCode()` call emits a transcript event:
```jsonl
{"type":"code_execution","agent_id":"developer","language":"typescript","exit_code":0,"duration_ms":1234,"stdout_length":456,"stderr_length":0,"timestamp":"..."}
```

### 3.2 `invokeSkill()`

**Purpose:** Invoke a platform-specific skill (Claude Code skill, Pi extension, Codex tool) on behalf of an agent.

**When used:** When a workflow step requires a capability that is implemented as a platform skill rather than inline code. For example: running a test suite, performing a security scan, generating documentation, formatting code.

**Skill resolution:** The adapter maps the `skillId` to the platform's native skill invocation mechanism:

| Platform | Skill Resolution |
|---|---|
| Pi CLI | Skill registry lookup → Pi skill invocation |
| Claude Code | Skill tool → `Skill({ skill: skillId, args })` |
| Codex CLI | Extension registry lookup → Codex extension call |
| Generic | `UnsupportedError` |

**Skill ID portability:** Skill IDs are abstract identifiers, not platform-specific paths. The adapter maintains a mapping from abstract IDs to platform-specific skill names. Example:

```yaml
# In adapter config
skill_map:
  run-tests: "superpowers:test-driven-development"     # Claude Code
  security-scan: "scan"                                  # Claude Code
  code-review: "superpowers:requesting-code-review"      # Claude Code
  commit: "commit-code"                                  # Claude Code
```

Adapters that don't have a mapping for a given skill ID throw `UnsupportedError` with a message naming the missing skill.

**Artifact pass-through:** When `input.artifacts` is provided, the adapter loads those artifacts (via `loadArtifact()`) and passes them as context to the skill. The mechanism is platform-specific (file injection, context files, etc.).

### 3.3 `createArtifact()`

**Purpose:** Write an artifact's content and manifest to the session's artifact directory.

**When used:** After every workflow step that produces output. Called by `workflow-runner.ts`, not by agents directly.

**Implementation:** This method has a default implementation that all adapters can use:

```typescript
// Default implementation (adapters may override for optimization)
async createArtifact(artifact: ArtifactManifest, content: string): Promise<void> {
  // Write content file
  await this.writeFile(artifact.content_path, content);

  // Write manifest
  const manifestPath = artifact.content_path
    .replace(/\.[^.]+$/, '.artifact.yaml');
  const manifestYaml = serializeYaml(artifact);
  await this.writeFile(manifestPath, manifestYaml);
}
```

Adapters may override this for platform-specific behaviors (e.g., indexing artifacts for search, notifying the UI of new artifacts, triggering webhooks).

**Required:** No — a default implementation is provided by the runtime base class (shown above). Adapters inherit this automatically. Override only for platform-specific behavior.

### 3.4 `loadArtifact()`

**Purpose:** Read an artifact's manifest and content from the session's artifact directory.

**When used:** Before workflow steps that reference prior artifacts in their `input` field. Called by `workflow-runner.ts` during artifact injection.

**Implementation:** Default implementation available:

```typescript
// Default implementation
async loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact> {
  const manifestPath = `${sessionDir}/artifacts/${artifactId}.artifact.yaml`;
  const manifestYaml = await this.readFile(manifestPath);
  const manifest = parseYaml(manifestYaml) as ArtifactManifest;
  const content = await this.readFile(manifest.content_path);
  return { manifest, content };
}
```

**Error handling:** If the artifact doesn't exist (manifest file missing), throw a descriptive error: `Artifact "${artifactId}" not found at ${manifestPath}. This artifact is required as input for step "${stepId}".`

**Required:** No — default implementation provided by the runtime base class. Same rationale as `createArtifact()`.

### 3.5 `submitForReview()`

**Purpose:** Send an artifact to a reviewer agent and collect structured feedback.

**When used:** During review-oriented workflow steps, or when the orchestrator requests a review of an artifact outside of the formal workflow.

**Implementation:** Default implementation composes existing primitives:

```typescript
// Default implementation
async submitForReview(
  artifact: LoadedArtifact,
  reviewer: AgentHandle,
  reviewPrompt?: string
): Promise<ReviewResult> {
  // Inject artifact as context
  await this.injectContext(reviewer, [artifact.manifest.content_path]);

  // Build review message
  const prompt = reviewPrompt || `Review the following artifact and provide your assessment:
- Artifact: ${artifact.manifest.id}
- Produced by: ${artifact.manifest.produced_by.join(", ")}
- Format: ${artifact.manifest.format}

Respond with:
1. Status: APPROVED, REJECTED, or NEEDS-REVISION
2. If not approved, list issues with severity (critical/major/minor/suggestion)
3. Specific feedback for improvement`;

  // Send to reviewer
  const response = await this.sendMessage(reviewer, prompt);

  // Parse structured response
  return parseReviewResponse(response);
}
```

**Response parsing:** The `parseReviewResponse()` function attempts to extract structured review data from the agent's natural language response. It looks for:
- Status keywords: "APPROVED", "REJECTED", "NEEDS-REVISION" (case-insensitive)
- Issue blocks with severity markers
- Feedback sections

If parsing fails, the entire response is returned as `feedback` with `status: "needs-revision"` as a safe default.

**Required:** No — this is a convenience method. Adapters that don't implement it should throw `UnsupportedError`, and the engine falls back to manual artifact injection + `sendMessage()`.

---

## 4. Platform Implementation Guide

### 4.1 Implementation Priority

| Method | Priority | Rationale |
|---|---|---|
| `createArtifact()` | **Default provided** | Core to execution profiles. Default implementation composes `writeFile()` + YAML. Adapters may override. |
| `loadArtifact()` | **Default provided** | Core to execution profiles. Default implementation composes `readFile()` + YAML. Adapters may override. |
| `submitForReview()` | **High** | Needed for review workflows. Default implementation covers most cases. |
| `invokeSkill()` | **Medium** | Needed for `execute-with-tools` steps. Platform-specific. |
| `executeCode()` | **Medium** | Needed for `execute-with-tools` steps. Platform-specific. |

### 4.2 Platform Mapping

| Method | Pi CLI | Claude Code | Codex CLI |
|---|---|---|---|
| `executeCode()` | Bash subprocess with Pi's sandbox | Claude Code Bash tool via Agent tool dispatch | Codex sandboxed execution |
| `invokeSkill()` | Pi skill/extension registry | Claude Code Skill tool invocation | Codex extension invocation |
| `createArtifact()` | `writeFile()` + YAML serialization | `writeFile()` + YAML serialization | `writeFile()` + YAML serialization |
| `loadArtifact()` | `readFile()` + YAML parsing | `readFile()` + YAML parsing | `readFile()` + YAML parsing |
| `submitForReview()` | `injectContext()` + `sendMessage()` | `injectContext()` + `sendMessage()` | `injectContext()` + `sendMessage()` |

### 4.3 Pi CLI Adapter Implementation Notes

The Pi adapter (`adapters/pi/src/workflow.ts`) already implements `WorkflowAdapter` with `dispatchParallel`, `isolateWorkspace`, `writeFile`, `readFile`, `openInEditor`, `persistState`, and `loadState`.

**`executeCode()`** implementation:
- Use Pi's subprocess execution with `child_process.spawn()`
- Apply Pi's extension sandbox restrictions
- Capture stdout/stderr streams
- Enforce `timeout_ms` via process termination
- Track files created/modified by diffing the workspace before and after execution

**`invokeSkill()`** implementation:
- Look up skill in Pi's extension registry
- Map to Pi's native skill invocation API
- Pass context files via Pi's context injection mechanism
- Capture skill output and parse for artifact references

**Error handling:**
- All methods should catch platform-specific errors and wrap them in a consistent `ExecutionError` type
- `UnsupportedError` should include the method name and a suggestion for alternative approaches

### 4.4 Claude Code Adapter Implementation Notes

The Claude Code adapter (`adapters/claude-code/`) currently generates static artifacts. For execution support, it needs a runtime component.

**`executeCode()`** implementation:
- Route through the Agent tool, spawning a subagent with Bash tool access
- The subagent receives the code and executes it
- Capture the execution result from the agent's response
- Alternatively, if running within a Claude Code session, use the Bash tool directly

**`invokeSkill()`** implementation:
- Use the Skill tool: `Skill({ skill: skillId, args: input.args })`
- The skill_map in adapter config maps abstract skill IDs to Claude Code skill names
- Context files passed via the Agent tool's context mechanism

**Limitation:** Claude Code's code generation adapter is currently a static generator (Section Appendix B of the harness spec). Supporting runtime execution requires a shift from "generate .claude/ artifacts" to "run as a live adapter." This is a Claude Code adapter evolution, not a framework change.

### 4.5 Graceful Degradation

When an adapter does not implement a method:

```typescript
// In the adapter base class or mixin
executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
  throw new UnsupportedError(
    "executeCode",
    "This adapter does not support code execution. " +
    "The execute-with-tools workflow action requires an adapter with code execution support."
  );
}
```

**Engine behavior on `UnsupportedError`:**

1. The engine catches the error
2. Logs an `error` transcript event with `error_type: "unsupported_method"`
3. Applies the profile's `on_agent_failure` policy (typically `skip`)
4. The step is marked as failed in the artifact manifest: `review_status: "rejected"`, with metadata noting the unsupported method
5. The workflow continues to the next step — downstream steps that reference the failed artifact receive it with the failure metadata, allowing the orchestrator to adjust

This means an execution profile can run on an adapter that only partially supports execution. Steps that require unsupported methods fail gracefully, and the orchestrator produces the best execution package it can with the available capabilities.

---

## 5. Transcript Events for Execution Methods

### 5.1 New Event Types

| Event Type | When Emitted | Required Fields |
|---|---|---|
| `code_execution` | After `executeCode()` completes | agent_id, language, exit_code, duration_ms, stdout_length, stderr_length |
| `skill_invocation` | After `invokeSkill()` completes | agent_id, skill_id, success, duration_ms, artifacts_produced? |
| `review_submission` | After `submitForReview()` completes | artifact_id, reviewer_id, status, issues_count? |

### 5.2 Event Examples

```jsonl
{"type":"code_execution","agent_id":"developer","language":"typescript","exit_code":0,"duration_ms":2340,"stdout_length":128,"stderr_length":0,"files_created":["src/auth/handler.ts"],"timestamp":"..."}
{"type":"skill_invocation","agent_id":"developer","skill_id":"run-tests","success":true,"duration_ms":8500,"artifacts_produced":["test_results"],"timestamp":"..."}
{"type":"review_submission","artifact_id":"implementation","reviewer_id":"sentinel","status":"needs-revision","issues_count":2,"timestamp":"..."}
```

---

## 6. Security Considerations

### 6.1 Code Execution Sandboxing

`executeCode()` runs arbitrary code. Security is the adapter's responsibility, not the harness's. Guidelines:

1. **Default to strict sandbox.** No network access, limited filesystem access (session directory only).
2. **Relaxed sandbox requires explicit opt-in.** The `sandbox: "relaxed"` option should only be used when the workflow step explicitly requires network or full fs access.
3. **Never execute code as root/admin.** Adapters must ensure code runs with minimal privileges.
4. **Timeout enforcement.** Kill processes that exceed `timeout_ms`. Default 30 seconds.
5. **Output truncation.** Truncate stdout/stderr to prevent memory exhaustion. Recommended limit: 1MB.

### 6.2 Skill Invocation Trust

`invokeSkill()` invokes platform-specific skills that may have broad capabilities. Guidelines:

1. **Skill whitelist.** The agent's `capabilities.available_skills` declares which skills it can invoke. The engine validates skill invocations against this whitelist before calling the adapter.
2. **No transitive skill access.** A skill invoked via `invokeSkill()` does not inherit the invoking agent's permissions. It runs with its own declared permissions.
3. **Audit trail.** All skill invocations are logged in the transcript with the skill ID, input summary, and result summary.

### 6.3 Artifact Integrity

Artifacts are the communication channel between agents. Guidelines:

1. **No executable content in artifact manifests.** Manifest YAML is parsed with safe YAML loading (no custom tags, no code execution during parsing). The framework already enforces this via its YAML security fix.
2. **Artifact content is untrusted.** Agents receiving artifacts via `loadArtifact()` should treat the content as untrusted input, the same way they treat user brief content.
3. **Path traversal prevention.** `content_path` in artifact manifests must resolve to a path within the session directory. The adapter validates this before reading/writing.
