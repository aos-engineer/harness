// Drives a scratch repository through AOS the way Claude Code does. MCP tool calls go to the real server over
// an in-memory transport. Every hook runs the plugin's real entry point as a child process, with a payload
// built from the plugin's hook fixtures. Shell commands run for real, between their PreToolUse and their
// PostToolUse, so test runs, commits, and pushes touch a real git repository.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { approve, humanActor, runPaths, type RunLocation } from "@aos-harness/kernel";
import { createAosMcpServer } from "@aos-harness/kernel/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fx } from "../../hosts/claude-code/tests/fixture.ts";
import { git, tmpDir, tmpGitRepo, writeFile } from "../../kernel/tests/helpers.ts";

const BIN = join(import.meta.dirname, "../../hosts/claude-code/bin/aos-hook.ts");
const PACK = join(import.meta.dirname, "../../packs/feature-delivery");
const HOST = "claude-code";
// The name Claude Code gives a tool from the plugin's "aos" server; hooks.json matches on it.
const MCP_PREFIX = "mcp__plugin_aos_aos__";

type Obj = Record<string, unknown>;
type ClaudeEvent = "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "SessionStart" | "Stop";

const ARG: Record<ClaudeEvent, string> = {
  PreToolUse: "pre-tool-use",
  PostToolUse: "post-tool-use",
  PostToolUseFailure: "post-tool-use-failure",
  SessionStart: "session-start",
  Stop: "stop",
};

/** What one hook printed, read the way Claude Code reads it. */
export interface HookResult {
  /** stdout exactly as printed. An allow with nothing to say prints nothing. */
  raw: string;
  /** PreToolUse: the reason the tool call was denied, or null. */
  deny: string | null;
  /** Stop: the reason stopping was blocked, or null. */
  block: string | null;
  /** Text for the model (additionalContext) or the user (systemMessage), or null. */
  notice: string | null;
}

export interface McpResult { ok: boolean; text: string; body: Obj | null; content: unknown }

export interface BashResult {
  pre: HookResult;
  /** Null when PreToolUse denied the command, so it never ran. */
  post: HookResult | null;
  /** The command's real exit status; null when it never ran. */
  code: number | null;
  output: string;
}

export interface WriteResult { pre: HookResult; post: HookResult | null }

export interface Session {
  readonly repo: string;
  /** The run started through aos_run_start; throws before one exists. */
  readonly run: string;
  readonly loc: RunLocation;
  mcp(tool: string, args: Obj): Promise<McpResult>;
  /** The PostToolUse Claude Code sends after an aos MCP tool returns, with the tool's content as the response. */
  postMcp(tool: string, args: Obj, result: McpResult): HookResult;
  hook(event: ClaudeEvent, fixture: string, patch?: Obj): HookResult;
  bash(command: string): BashResult;
  write(rel: string, content: string): WriteResult;
  stop(): HookResult;
  sessionStart(source: "startup" | "resume" | "clear" | "compact"): HookResult;
  /** A new user prompt: Claude Code gives every prompt its own id, and the Stop loop keys on it. */
  nextPrompt(): void;
  human: { approve(stage: string): { request: string; stage: string } };
  logLines(): string[];
  close(): Promise<void>;
}

/**
 * A git repository with the given files committed, `.aos/` ignored as a project would, and a bare repository
 * as `origin`, so a push the guard allows really happens.
 */
export function scratchRepo(files: Record<string, string>): { repo: string; remote: string } {
  const repo = tmpGitRepo();
  const remote = tmpDir("aos-remote-");
  git(remote, "init", "-q", "--bare", "-b", "main");
  writeFile(repo, ".gitignore", ".aos/\n");
  for (const [rel, content] of Object.entries(files)) writeFile(repo, rel, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "scaffold");
  git(repo, "remote", "add", "origin", remote);
  return { repo, remote };
}

// Hooks and commands must not inherit this process's git setup, the project dir of a Claude Code session
// running the tests, or an AOS capture directory. Claude Code exports the project dir to its hooks, so the
// scratch repo plays that part.
function childEnv(repo: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_") || key.startsWith("CLAUDE_") || key.startsWith("AOS_")) continue;
    env[key] = value;
  }
  env.CLAUDE_PROJECT_DIR = repo;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  // The scratch repo's own `bun test` must find the same bun that runs this suite.
  env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? ""}`;
  return env;
}

// Fixtures describe a repository at /repo; every such path is moved to the scratch repo.
function retarget(value: unknown, repo: string): unknown {
  if (typeof value === "string") return value === "/repo" || value.startsWith("/repo/") ? repo + value.slice("/repo".length) : value;
  if (Array.isArray(value)) return value.map((v) => retarget(v, repo));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retarget(v, repo)]));
  return value;
}

function parseHook(stdout: string): HookResult {
  if (stdout === "") return { raw: "", deny: null, block: null, notice: null };
  const out = JSON.parse(stdout) as { hookSpecificOutput?: Obj; decision?: unknown; reason?: unknown; systemMessage?: unknown };
  const specific = out.hookSpecificOutput ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    raw: stdout,
    deny: specific.permissionDecision === "deny" ? str(specific.permissionDecisionReason) : null,
    block: out.decision === "block" ? str(out.reason) : null,
    notice: str(specific.additionalContext) ?? str(out.systemMessage),
  };
}

export async function session(repo: string): Promise<Session> {
  const sessionId = randomUUID();
  const env = childEnv(repo);
  let prompt = 1;
  let run: string | null = null;

  const server = createAosMcpServer({ cwd: repo, packDir: PACK, host: HOST });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "aos-e2e", version: "0.0.0" });
  await client.connect(clientSide);

  const currentRun = (): string => {
    if (run === null) throw new Error("no run yet: call aos_run_start first");
    return run;
  };
  const loc = (): RunLocation => ({ root: repo, run: currentRun() });

  function hook(event: ClaudeEvent, fixture: string, patch: Obj = {}): HookResult {
    const base = retarget(fx(fixture), repo) as Obj;
    for (const key of Object.keys(base)) if (key.startsWith("_")) delete base[key];
    const payload: Obj = { ...base, session_id: sessionId, cwd: repo, ...patch };
    if ("prompt_id" in base) payload.prompt_id = `prompt-${prompt}`;
    const r = spawnSync(process.execPath, [BIN, ARG[event]], { cwd: repo, env, input: JSON.stringify(payload), encoding: "utf8", timeout: 30_000 });
    // The entry point always exits 0 and speaks only through stdout; anything else is a finding.
    if (r.status !== 0) throw new Error(`hook ${event} exited ${r.status} (${r.signal ?? "no signal"}): ${r.stderr}`);
    return parseHook(r.stdout);
  }

  function shell(command: string): { code: number; output: string; stdout: string; stderr: string } {
    const r = spawnSync("/bin/bash", ["-c", command], { cwd: repo, env, encoding: "utf8", timeout: 120_000 });
    if (r.status === null) throw new Error(`command did not finish (${r.signal}): ${command}`);
    const output = [r.stdout, r.stderr].filter((s) => s !== "").join("\n");
    return { code: r.status, output, stdout: r.stdout, stderr: r.stderr };
  }

  return {
    repo,
    get run() {
      return currentRun();
    },
    get loc() {
      return loc();
    },

    async mcp(tool, args) {
      const r = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
      const text = r.content[0]?.text ?? "";
      const ok = r.isError !== true;
      const body = ok ? (JSON.parse(text) as Obj) : null;
      if (ok && tool === "aos_run_start" && typeof body?.runId === "string") run = body.runId;
      return { ok, text, body, content: r.content };
    },

    postMcp(tool, args, result) {
      // Claude Code's PostToolUse response shape for MCP tools is not documented; the tool's content
      // blocks are the closest stand-in, and the binding reads the run id from wherever it appears.
      return hook("PostToolUse", "post-tool-use-write", { tool_name: MCP_PREFIX + tool, tool_input: args, tool_response: result.content });
    },

    hook,

    bash(command) {
      const tool_input = { command, description: "Run a command" };
      const pre = hook("PreToolUse", "pre-tool-use-bash-true", { tool_input });
      if (pre.deny !== null) return { pre, post: null, code: null, output: "" };
      const r = shell(command);
      const post = r.code === 0
        ? hook("PostToolUse", "post-tool-use-bash-true", { tool_input, tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } })
        : hook("PostToolUseFailure", "post-tool-use-failure-bash-test-fail", { tool_input, error: `Exit code ${r.code}\n${r.output}`, is_interrupt: false });
      return { pre, post, code: r.code, output: r.output };
    },

    write(rel, content) {
      const path = join(repo, rel);
      const tool_input = { file_path: path, content };
      const pre = hook("PreToolUse", "pre-tool-use-write", { tool_input });
      if (pre.deny !== null) return { pre, post: null };
      let existed = true;
      try {
        readFileSync(path);
      } catch {
        existed = false;
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      const post = hook("PostToolUse", "post-tool-use-write", { tool_input, tool_response: { filePath: path, type: existed ? "update" : "create" } });
      return { pre, post };
    },

    stop: () => hook("Stop", "stop"),
    sessionStart: (source) => hook("SessionStart", "session-start-startup", { source }),
    nextPrompt() {
      prompt += 1;
    },

    human: {
      // The CLI's aos approve needs a real terminal, so the test calls the operation behind it with the
      // same actor the CLI passes.
      approve: (stage) => approve(loc(), { stage, actor: humanActor(), reason: null }),
    },

    logLines: () => readFileSync(runPaths(loc()).log, "utf8").split("\n").filter((l) => l !== ""),

    async close() {
      await client.close();
    },
  };
}

/** Removes the scratch repo and its remote. */
export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
