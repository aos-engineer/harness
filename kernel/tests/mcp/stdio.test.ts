// The MCP entry points run as child processes, the way a host launches them. Both must answer over stdio
// and keep serving until the host closes stdin, then exit on their own.
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { projector } from "../../src/projection.ts";
import { loadState } from "../../src/store/store.ts";
import { existsSync } from "node:fs";
import { tmpDir, tmpGitRepo } from "../helpers.ts";
import { PACK } from "../ops-agent/fixtures.ts";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const CLI = join(REPO_ROOT, "cli/src/index.ts");
const BIN = join(REPO_ROOT, "hosts/claude-code/bin/aos-mcp.ts");
const TIMEOUT = 20_000;

interface Message { id?: number; result?: Record<string, unknown>; error?: unknown }

// Git settings from the developer's shell must not reach the server's git calls, and neither may a project
// directory a hook shell exports, or runs would land in that project.
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_") && !k.startsWith("AOS_") && k !== "CLAUDE_PROJECT_DIR") env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

class Peer {
  private buffer = "";
  private waiting = new Map<number, { resolve: (m: Message) => void; reject: (e: Error) => void }>();
  readonly stderr: string[] = [];
  readonly exited: Promise<number | null>;
  readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let nl = this.buffer.indexOf("\n"); nl >= 0; nl = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        const msg = JSON.parse(line) as Message;
        if (msg.id !== undefined) this.waiting.get(msg.id)?.resolve(msg);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
    this.exited = new Promise((resolve) => child.on("exit", (code) => {
      // A reply that can no longer arrive fails the test now instead of at the timeout.
      for (const w of this.waiting.values()) w.reject(new Error(`server exited ${code} before replying: ${this.stderr.join("")}`));
      resolve(code);
    }));
  }

  request(id: number, method: string, params: Record<string, unknown>): Promise<Message> {
    const reply = new Promise<Message>((resolve, reject) => this.waiting.set(id, { resolve, reject }));
    this.send({ jsonrpc: "2.0", id, method, params });
    return reply;
  }

  send(msg: Record<string, unknown>): void {
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  async initialize(): Promise<Message> {
    const r = await this.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "aos-test", version: "0.0.0" } });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return r;
  }
}

function launch(args: string[], cwd: string, env: Record<string, string> = {}): Peer {
  return new Peer(spawn("bun", args, { cwd, env: childEnv(env), stdio: ["pipe", "pipe", "pipe"] }));
}

async function startRun(peer: Peer): Promise<string> {
  const r = await peer.request(2, "tools/call", { name: "aos_run_start", arguments: { brief: "Fix README typo" } });
  const content = r.result?.content as Array<{ text: string }>;
  return JSON.parse(content[0]?.text ?? "null").runId;
}

describe("aos mcp", () => {
  test("answers initialize, serves tools from its working directory, and exits when stdin closes", async () => {
    const repo = tmpGitRepo();
    const peer = launch([CLI, "mcp", "--pack", PACK], repo);
    const init = await peer.initialize();
    expect(init.result?.serverInfo).toMatchObject({ name: "aos" });
    expect(init.result?.capabilities).toMatchObject({ tools: {} });

    const runId = await startRun(peer);
    expect(loadState({ root: repo, run: runId }, projector).state).toMatchObject({ host: "claude-code", root: repo });

    peer.child.stdin.end();
    expect(await peer.exited).toBe(0);
    expect(peer.stderr.join("")).toBe("");
  }, TIMEOUT);

  test("keeps serving after setup instead of exiting", async () => {
    const peer = launch([CLI, "mcp", "--pack", PACK], tmpGitRepo());
    await peer.initialize();
    const winner = await Promise.race([peer.exited.then(() => "exited"), new Promise((r) => setTimeout(() => r("serving"), 500))]);
    expect(winner).toBe("serving");
    peer.child.stdin.end();
    expect(await peer.exited).toBe(0);
  }, TIMEOUT);

  test("takes the pack and host from the environment when no flag is given", async () => {
    const repo = tmpGitRepo();
    const peer = launch([CLI, "mcp"], repo, { AOS_PACK: PACK, AOS_HOST: "codex" });
    await peer.initialize();
    const runId = await startRun(peer);
    expect(loadState({ root: repo, run: runId }, projector).state.host).toBe("codex");
    peer.child.stdin.end();
    expect(await peer.exited).toBe(0);
  }, TIMEOUT);

  test("rejects a --pack flag without a directory", async () => {
    const peer = launch([CLI, "mcp", "--pack"], tmpGitRepo());
    peer.child.stdin.end();
    expect(await peer.exited).toBe(2);
    expect(peer.stderr.join("")).toContain("--pack");
  }, TIMEOUT);
});

describe("plugin MCP entry point", () => {
  test("serves the reference pack by default and binds runs to the claude-code host", async () => {
    const repo = tmpGitRepo();
    const peer = launch([BIN], repo);
    await peer.initialize();
    const runId = await startRun(peer);
    expect(loadState({ root: repo, run: runId }, projector).state).toMatchObject({ host: "claude-code", tier: "bounded" });
    peer.child.stdin.end();
    expect(await peer.exited).toBe(0);
  }, TIMEOUT);
});

describe("plugin MCP entry point and the project directory", () => {
  test("puts runs under CLAUDE_PROJECT_DIR, wherever it was started", async () => {
    const project = tmpGitRepo();
    const elsewhere = tmpDir();
    const peer = launch([BIN], elsewhere, { CLAUDE_PROJECT_DIR: project });
    await peer.initialize();
    const runId = await startRun(peer);
    expect(loadState({ root: project, run: runId }, projector).state).toMatchObject({ root: project, git: true });
    expect(existsSync(join(elsewhere, ".aos"))).toBe(false);
    peer.child.stdin.end();
    expect(await peer.exited).toBe(0);
  }, TIMEOUT);

  test("falls back to the working directory when CLAUDE_PROJECT_DIR is empty or unexpanded", async () => {
    for (const value of ["", "${CLAUDE_PROJECT_DIR}"]) {
      const repo = tmpGitRepo();
      const peer = launch([BIN], repo, { CLAUDE_PROJECT_DIR: value });
      await peer.initialize();
      const runId = await startRun(peer);
      expect(loadState({ root: repo, run: runId }, projector).state.root).toBe(repo);
      peer.child.stdin.end();
      expect(await peer.exited).toBe(0);
    }
  }, TIMEOUT);
});
