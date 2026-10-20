import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpGitRepo } from "../../../kernel/tests/helpers.ts";

// A marketplace install runs the committed bundle through the launcher, with the pack copied into the
// plugin. The end-to-end runs drive the server from source, so this starts the shipped one exactly as
// .mcp.json does and checks that it serves the tools and can start a run with the bundled pack.
const PLUGIN = join(import.meta.dirname, "..");
const LAUNCHER = join(PLUGIN, "bin/aos.sh");
const TOOLS = ["aos_evidence_record", "aos_gate_check", "aos_request_approval", "aos_run_start", "aos_stage_advance", "aos_status", "aos_task_add", "aos_task_complete"];

let client: Client | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

function serverEnv(repo: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("AOS_") && !k.startsWith("CLAUDE") && !k.startsWith("GIT_")) env[k] = v;
  }
  // What .mcp.json sets, with the project dir Claude Code exports, and this test's bun on PATH.
  return { ...env, AOS_PACK: join(PLUGIN, "pack"), AOS_HOST: "claude-code", CLAUDE_PROJECT_DIR: repo, PATH: `${dirname(process.execPath)}:${env.PATH ?? ""}` };
}

test("the bundled MCP server serves every tool and starts a run with the bundled pack", async () => {
  const repo = tmpGitRepo();
  client = new Client({ name: "bundle-smoke", version: "0" });
  await client.connect(new StdioClientTransport({ command: "sh", args: [LAUNCHER, "mcp"], env: serverEnv(repo), cwd: repo, stderr: "pipe" }));

  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);

  const r = (await client.callTool({ name: "aos_run_start", arguments: { brief: "add a --shout flag to the greet command" } })) as { isError?: boolean; content: Array<{ text?: string }> };
  expect(r.isError ?? false).toBe(false);
  const started = JSON.parse(r.content[0]?.text ?? "{}") as { runId?: string; tier?: string };
  expect(started.tier).toBe("bounded");
  expect(existsSync(join(repo, ".aos", "runs", String(started.runId), "log.jsonl"))).toBe(true);

  // Later calls default to the run this session started.
  const s = (await client.callTool({ name: "aos_status", arguments: {} })) as { isError?: boolean; content: Array<{ text?: string }> };
  expect(s.isError ?? false).toBe(false);
  expect(s.content[0]?.text ?? "").toContain(String(started.runId));
}, 30_000);
