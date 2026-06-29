// ── BaseWorkflow (L4) ────────────────────────────────────────────
// Parallel dispatch, file operations, state persistence, artifacts,
// code execution, and skill invocation. CLI-agnostic.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import * as yaml from "js-yaml";
import type {
  WorkflowAdapter,
  AgentHandle,
  AgentResponse,
  MessageOpts,
  ArtifactManifest,
  LoadedArtifact,
  ExecuteCodeOpts,
  ExecutionResult,
  SkillInput,
  SkillResult,
  ReviewResult,
  ToolCommand,
} from "@aos-harness/runtime/types";
import { UnsupportedError } from "@aos-harness/runtime/types";
import { DEFAULT_TOOL_POLICY, type ToolsBlock } from "@aos-harness/runtime/profile-schema";
import { buildToolPolicy, type ToolPolicy } from "./tool-policy";

export interface BaseWorkflowOpts {
  toolPolicy?: ToolPolicy;
  transcriptPath?: string;
  /**
   * Phase 1 (MCP-inside): when provided, a skill declaring `mcp_binding`
   * resolves invokeSkill to a native MCP tool call instead of an LLM prompt.
   * Structural (not the concrete McpToolsetManager) to keep this adapter
   * loosely coupled to the runtime.
   */
  mcpToolsetManager?: McpToolResolver;
}

// Minimal interface for the agent runtime dependency
interface AgentMessageSender {
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
}

// Minimal structural view of runtime/src/mcp-toolset-manager.ts (exported so the
// public BaseWorkflowOpts can reference it under declaration emit).
export interface McpToolResult {
  content?: Array<{ text?: string; [k: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
}
export interface McpToolResolver {
  hasServer(serverId: string): boolean;
  callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult>;
}

/** Flatten an MCP tool result's content blocks into a single text string. */
function flattenMcpContent(result: McpToolResult): string {
  if (result.structuredContent !== undefined) {
    return typeof result.structuredContent === "string"
      ? result.structuredContent
      : JSON.stringify(result.structuredContent);
  }
  return (result.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
    .join("\n");
}

export class BaseWorkflow implements WorkflowAdapter {
  private agentRuntime: AgentMessageSender;
  private projectRoot: string;
  private readonly toolPolicy: ToolPolicy;
  private readonly transcriptPath?: string;
  private readonly mcpToolsetManager?: McpToolResolver;

  constructor(
    agentRuntime: AgentMessageSender,
    projectRoot: string = process.cwd(),
    opts?: BaseWorkflowOpts,
  ) {
    this.agentRuntime = agentRuntime;
    this.projectRoot = resolve(projectRoot);
    this.toolPolicy = opts?.toolPolicy ?? buildToolPolicy(DEFAULT_TOOL_POLICY, {});
    this.transcriptPath = opts?.transcriptPath;
    this.mcpToolsetManager = opts?.mcpToolsetManager;
  }

  private validatePath(filePath: string): string {
    const resolved = resolve(filePath);
    if (!resolved.startsWith(this.projectRoot)) {
      throw new Error(`Path "${filePath}" is outside the project directory`);
    }
    return resolved;
  }

  private validateStateKey(key: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new Error(`Invalid state key: "${key}" — must be alphanumeric with hyphens/underscores`);
    }
  }

  async dispatchParallel(
    handles: AgentHandle[],
    message: string,
    opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void; timeoutMs?: number },
  ): Promise<AgentResponse[]> {
    const tasks = handles.map((handle) =>
      this.agentRuntime.sendMessage(handle, message, {
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs,
        onStream: opts?.onStream
          ? (partial: string) => opts.onStream!(handle.agentId, partial)
          : undefined,
      }),
    );

    const results = await Promise.allSettled(tasks);

    return results.map((result): AgentResponse => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return {
        text: "",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        contextTokens: 0,
        model: "",
        status: "failed",
        error: err,
      };
    });
  }

  async isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const id = `aos-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worktreePath = join(".aos", "worktrees", id);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("git", ["worktree", "add", "--detach", worktreePath], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git worktree add failed (exit ${code}): ${stderr.trim()}`));
      });
    });

    const cleanup = async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("git", ["worktree", "remove", "--force", worktreePath], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git worktree remove failed (exit ${code}): ${stderr.trim()}`));
        });
      });
    };

    return { path: worktreePath, cleanup };
  }

  async writeFile(path: string, content: string): Promise<void> {
    const gate = await this.enforceToolAccess("system", {
      tool: "write_file",
      path,
    });
    if (!gate.allowed) {
      throw new UnsupportedError("writeFile", gate.reason ?? "denied by policy");
    }
    const safe = this.validatePath(path);
    const dir = dirname(safe);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(safe, content, "utf-8");
  }

  async readFile(path: string): Promise<string> {
    const gate = await this.enforceToolAccess("system", {
      tool: "read_file",
      path,
    });
    if (!gate.allowed) {
      throw new UnsupportedError("readFile", gate.reason ?? "denied by policy");
    }
    const safe = this.validatePath(path);
    if (!existsSync(safe)) {
      throw new Error(`File not found: ${path}`);
    }
    return readFileSync(safe, "utf-8");
  }

  private static ALLOWED_EDITORS = new Set(["code", "vim", "nvim", "nano", "emacs", "subl", "mate", "open"]);

  async openInEditor(path: string, editor: string): Promise<void> {
    const safePath = this.validatePath(path);
    const editorName = editor.split("/").pop() ?? editor;
    if (!BaseWorkflow.ALLOWED_EDITORS.has(editorName)) {
      throw new Error(`Editor "${editor}" is not in the allowed list: ${[...BaseWorkflow.ALLOWED_EDITORS].join(", ")}`);
    }
    spawn(editor, [safePath], { detached: true, stdio: "ignore" }).unref();
  }

  async persistState(key: string, value: unknown): Promise<void> {
    this.validateStateKey(key);
    const stateDir = join(this.projectRoot, ".aos", "state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const filePath = join(stateDir, `${key}.json`);
    writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  async loadState(key: string): Promise<unknown> {
    this.validateStateKey(key);
    const filePath = join(this.projectRoot, ".aos", "state", `${key}.json`);
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async createArtifact(artifact: ArtifactManifest, content: string): Promise<void> {
    await this.writeFile(artifact.content_path, content);
    const manifestPath = artifact.content_path.replace(/\.[^.]+$/, ".artifact.yaml");
    await this.writeFile(manifestPath, yaml.dump(artifact));
  }

  async loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact> {
    const manifestPath = join(sessionDir, "artifacts", `${artifactId}.artifact.yaml`);
    const manifestYaml = await this.readFile(manifestPath);
    const manifest = yaml.load(manifestYaml, { schema: yaml.JSON_SCHEMA }) as ArtifactManifest;
    const content = await this.readFile(manifest.content_path);
    return { manifest, content };
  }

  async submitForReview(
    artifact: LoadedArtifact,
    reviewer: AgentHandle,
    reviewPrompt?: string,
  ): Promise<ReviewResult> {
    const prompt =
      reviewPrompt ||
      `Review the following artifact and provide your assessment:

## Artifact: ${artifact.manifest.id}
- Produced by: ${artifact.manifest.produced_by.join(", ")}
- Format: ${artifact.manifest.format}

Respond with:
1. Status: APPROVED, REJECTED, or NEEDS-REVISION
2. If not approved, list issues with severity (critical/major/minor/suggestion)
3. Specific feedback for improvement`;

    const fullPrompt = `${prompt}\n\n---\n\n${artifact.content}`;

    try {
      const response = await this.agentRuntime.sendMessage(reviewer, fullPrompt);
      const text = response.text ?? "";

      const upperText = text.toUpperCase();
      let status: "approved" | "rejected" | "needs-revision" = "needs-revision";
      if (upperText.includes("APPROVED") && !upperText.includes("NOT APPROVED")) {
        status = "approved";
      } else if (upperText.includes("REJECTED")) {
        status = "rejected";
      }

      return { status, feedback: text, reviewer: reviewer.agentId };
    } catch (err: any) {
      return {
        status: "needs-revision",
        feedback: `Review failed: ${err.message}`,
        reviewer: reviewer.agentId,
      };
    }
  }

  async executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
    const language = opts?.language ?? "bash";
    const timeout = opts?.timeout_ms ?? 30000;
    const cwd = opts?.cwd ?? process.cwd();
    const sandbox = opts?.sandbox ?? "strict";

    const gate = await this.enforceToolAccess(
      (handle as any)?.agentId ?? "unknown",
      {
        tool: "execute_code",
        command: { language, timeout_ms: timeout },
      },
    );
    if (!gate.allowed) {
      throw new UnsupportedError("executeCode", gate.reason ?? "denied by policy");
    }

    let cmd: string;
    let args: string[];

    switch (language) {
      case "bash":
      case "sh":
        cmd = "/bin/bash";
        args = ["-c", code];
        break;
      case "typescript":
      case "ts":
        cmd = "bun";
        args = ["eval", code];
        break;
      case "python":
      case "py":
        cmd = "python3";
        args = ["-c", code];
        break;
      case "node":
      case "javascript":
      case "js":
        cmd = "node";
        args = ["-e", code];
        break;
      default:
        throw new Error(`Unsupported language: ${language}. Supported: bash, typescript, python, javascript`);
    }

    return new Promise<ExecutionResult>((resolve) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(cmd, args, {
        cwd: this.validatePath(cwd),
        env: {
          ...this.buildSafeEnv(sandbox),
          ...(opts?.env ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeout);

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > 1_048_576) {
          stdout = stdout.slice(0, 1_048_576) + "\n[TRUNCATED]";
          killed = true;
          child.kill("SIGKILL");
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1_048_576) {
          stderr = stderr.slice(0, 1_048_576) + "\n[TRUNCATED]";
        }
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timer);
        resolve({
          success: exitCode === 0 && !killed,
          exit_code: exitCode ?? (killed ? 137 : 1),
          stdout,
          stderr:
            killed && !stderr.includes("TRUNCATED")
              ? stderr + "\n[KILLED: timeout or output limit]"
              : stderr,
          duration_ms: Date.now() - startTime,
        });
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exit_code: 1,
          stdout,
          stderr: err.message,
          duration_ms: Date.now() - startTime,
        });
      });
    });
  }

  private buildSafeEnv(sandbox: "strict" | "relaxed"): Record<string, string> {
    const base: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      TERM: "dumb",
    };

    if (sandbox === "relaxed") {
      for (const key of ["NODE_PATH", "BUN_INSTALL", "PYTHONPATH", "SHELL"]) {
        if (process.env[key]) base[key] = process.env[key]!;
      }
    }

    return base;
  }

  async invokeSkill(
    handle: AgentHandle,
    skillId: string,
    input: SkillInput,
    opts?: { signal?: AbortSignal },
  ): Promise<SkillResult> {
    // Honor an already-tripped deadline before doing any work (e.g. the A2A
    // ingress executor timed out while this call was queued).
    if (opts?.signal?.aborted) {
      return { success: false, output: "", error: "skill invocation aborted" };
    }

    const skillDir = join(this.projectRoot, "core", "skills", skillId);
    const skillYamlPath = join(skillDir, "skill.yaml");

    if (!existsSync(skillYamlPath)) {
      throw new UnsupportedError("invokeSkill", `Skill "${skillId}" not found at ${skillYamlPath}`);
    }

    const skillYamlRaw = readFileSync(skillYamlPath, "utf-8");
    const skillConfig = yaml.load(skillYamlRaw, { schema: yaml.JSON_SCHEMA }) as any;

    // Phase 1 (MCP-inside): if the skill is bound to an MCP tool and that
    // server is available, resolve to a native tool call rather than sending
    // prompt.md as an LLM prompt. Skill input.context keys become the tool's
    // arguments; input.args (if any) is passed under the `input` key.
    const binding = skillConfig.mcp_binding as
      | { server: string; tools: string[] }
      | undefined;
    if (binding?.server && Array.isArray(binding.tools) && binding.tools.length > 0) {
      if (this.mcpToolsetManager?.hasServer(binding.server)) {
        const toolName = binding.tools[0]!;
        const args: Record<string, unknown> = { ...(input.context ?? {}) };
        if (input.args) args.input = input.args;
        try {
          const result = await this.mcpToolsetManager.callTool(binding.server, toolName, args, opts?.signal);
          const text = flattenMcpContent(result);
          return result.isError
            ? { success: false, output: text, error: text }
            : { success: true, output: text };
        } catch (err: any) {
          return { success: false, output: "", error: err?.message ?? String(err) };
        }
      }
      // Bound but the server isn't available — fall through to the LLM path,
      // which keeps the skill working (degraded) instead of hard-failing.
    }

    let skillPrompt = skillConfig.description;
    const promptPath = join(skillDir, "prompt.md");
    if (existsSync(promptPath)) {
      skillPrompt = readFileSync(promptPath, "utf-8");
    }

    const contextParts: string[] = [];
    if (input.args) contextParts.push(`Arguments: ${input.args}`);
    if (input.context) {
      for (const [key, value] of Object.entries(input.context)) {
        contextParts.push(`${key}: ${value}`);
      }
    }

    const fullPrompt = [skillPrompt, "", "## Input Context", contextParts.join("\n")].join("\n");

    try {
      const response = await this.agentRuntime.sendMessage(handle, fullPrompt, { signal: opts?.signal });
      return {
        success: true,
        output: response.text ?? JSON.stringify(response),
      };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: err.message ?? String(err),
      };
    }
  }

  async enforceToolAccess(
    agentId: string,
    toolCall: { tool: string; path?: string; command?: string | ToolCommand },
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.toolPolicy;
    const entry = (policy as any)[toolCall.tool];
    if (!entry?.enabled) {
      const reason = `tool "${toolCall.tool}" is not enabled in profile`;
      this.emitToolDenied(agentId, toolCall.tool, reason, toolCall.path ?? toolCall.command);
      return { allowed: false, reason };
    }
    const structured: ToolCommand | null =
      typeof toolCall.command === "object" && toolCall.command !== null
        ? toolCall.command
        : null;
    if (toolCall.tool === "execute_code" && structured) {
      const lang = structured.language ?? "bash";
      if (!policy.execute_code.languages.includes(lang as any)) {
        const reason = `language "${lang}" not in profile allowlist (${
          policy.execute_code.languages.join(", ") || "none"
        })`;
        this.emitToolDenied(agentId, toolCall.tool, reason, toolCall.path ?? toolCall.command);
        return { allowed: false, reason };
      }
      if (
        structured.timeout_ms &&
        structured.timeout_ms > policy.execute_code.max_timeout_ms
      ) {
        const reason = `timeout ${structured.timeout_ms}ms exceeds profile max ${policy.execute_code.max_timeout_ms}ms`;
        this.emitToolDenied(agentId, toolCall.tool, reason, toolCall.path ?? toolCall.command);
        return { allowed: false, reason };
      }
    }
    return { allowed: true };
  }

  private emitToolDenied(
    agentId: string,
    tool: string,
    reason: string,
    detail?: unknown,
  ): void {
    if (!this.transcriptPath) return;
    const timestamp = new Date().toISOString();
    const line = JSON.stringify({
      timestamp,
      ts: timestamp,
      type: "tool-denied",
      agent: agentId,
      tool,
      reason,
      detail: detail ?? null,
    });
    try {
      appendFileSync(this.transcriptPath, line + "\n");
    } catch {
      // Transcript unavailable — do not fail the deliberation
    }
  }

  /** Read-only view of the active tool policy. Spec D7.2. */
  listEnabledTools(): Readonly<Record<string, unknown>> {
    return this.toolPolicy as unknown as Readonly<Record<string, unknown>>;
  }

  /**
   * Spawn a worker agent bound to a narrowed copy of this session's
   * ToolPolicy. Workers inherit the parent policy and may only narrow it —
   * any attempt to enable a tool the session has disabled is rejected
   * (spec D3 worker inheritance rules).
   */
  async spawnWorker(opts: {
    agentId: string;
    toolsOverride?: Partial<ToolsBlock>;
  }): Promise<BaseWorkflow> {
    const session = this.toolPolicy;
    let workerPolicy: ToolPolicy = session;

    if (opts.toolsOverride) {
      // Narrow-only: any enabled=true on a session-denied tool → throw
      for (const [toolName, override] of Object.entries(opts.toolsOverride)) {
        const sessionEntry = (session as any)[toolName];
        if ((override as any)?.enabled && !sessionEntry?.enabled) {
          throw new Error(
            `worker ${opts.agentId} cannot widen session policy: tool "${toolName}" is disabled at session level`,
          );
        }
      }
      // Safe to narrow: intersect execute_code languages
      const ec = opts.toolsOverride.execute_code;
      let narrowedLangs = session.execute_code.languages;
      if (ec?.languages) {
        const requested = ec.languages as readonly string[];
        narrowedLangs = session.execute_code.languages.filter((l) =>
          requested.includes(l),
        ) as typeof session.execute_code.languages;
      }
      const narrowed: ToolsBlock = {
        ...session,
        execute_code: {
          ...session.execute_code,
          languages: narrowedLangs,
          enabled: Boolean(ec?.enabled ?? session.execute_code.enabled),
        },
      };
      workerPolicy = Object.freeze({
        ...narrowed,
        execute_code: Object.freeze(narrowed.execute_code),
      }) as ToolPolicy;
    }

    return new BaseWorkflow(this.agentRuntime, this.projectRoot, {
      toolPolicy: workerPolicy,
      transcriptPath: this.transcriptPath,
    });
  }
}
