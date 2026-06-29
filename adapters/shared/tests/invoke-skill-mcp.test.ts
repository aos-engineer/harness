import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BaseWorkflow } from "../src/base-workflow";

// Proves the Phase 1 payoff: a skill declaring `mcp_binding` resolves
// invokeSkill to a native MCP tool call (via the injected toolset manager)
// instead of sending prompt.md as an LLM prompt — and falls back gracefully
// when the bound server is unavailable.

const testDir = join(import.meta.dir, "__mcp-skill-workspace__");
const handle = { id: "a", agentId: "agent-a", sessionId: "s1" } as any;

function writeSkill(id: string, mcpBinding?: object): void {
  const dir = join(testDir, "core", "skills", id);
  mkdirSync(dir, { recursive: true });
  const doc: Record<string, unknown> = {
    schema: "aos/skill/v1",
    id,
    name: id,
    description: "PROMPT_FALLBACK_MARKER",
    version: "1.0.0",
    input: {},
    output: {},
  };
  if (mcpBinding) doc.mcp_binding = mcpBinding;
  writeFileSync(join(dir, "skill.yaml"), JSON.stringify(doc));
}

const llmRuntime = {
  // The LLM fallback path echoes a recognizable string so we can tell the
  // two code paths apart.
  sendMessage: async () => ({
    text: "LLM_PATH_RESPONSE",
    tokensIn: 1,
    tokensOut: 1,
    cost: 0,
    contextTokens: 0,
    model: "mock",
    status: "success" as const,
  }),
};

beforeEach(() => mkdirSync(testDir, { recursive: true }));
afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe("invokeSkill + mcp_binding", () => {
  it("resolves a bound skill to a native MCP tool call", async () => {
    writeSkill("code-review", { server: "sonar", tools: ["analyze"] });
    const calls: Array<{ server: string; tool: string; args: unknown }> = [];
    const mcp = {
      hasServer: (id: string) => id === "sonar",
      callTool: async (server: string, tool: string, args: Record<string, unknown>) => {
        calls.push({ server, tool, args });
        return { content: [{ type: "text", text: `analyzed ${JSON.stringify(args)}` }] };
      },
    };
    const wf = new BaseWorkflow(llmRuntime, testDir, { mcpToolsetManager: mcp });

    const result = await wf.invokeSkill(handle, "code-review", { args: "go", context: { repo: "x" } });

    expect(result.success).toBe(true);
    expect(result.output).toContain("analyzed");
    // skill context keys + args become the tool arguments
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toBe("analyze");
    expect(calls[0]!.args).toEqual({ repo: "x", input: "go" });
    // the LLM path was NOT taken
    expect(result.output).not.toContain("LLM_PATH_RESPONSE");
  });

  it("surfaces an MCP tool isError result as a failure", async () => {
    writeSkill("flaky", { server: "sonar", tools: ["analyze"] });
    const mcp = {
      hasServer: () => true,
      callTool: async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
    };
    const wf = new BaseWorkflow(llmRuntime, testDir, { mcpToolsetManager: mcp });
    const result = await wf.invokeSkill(handle, "flaky", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("falls back to the LLM path when the bound server is unavailable", async () => {
    writeSkill("code-review", { server: "sonar", tools: ["analyze"] });
    const mcp = { hasServer: () => false, callTool: async () => ({ content: [] }) };
    const wf = new BaseWorkflow(llmRuntime, testDir, { mcpToolsetManager: mcp });
    const result = await wf.invokeSkill(handle, "code-review", {});
    expect(result.success).toBe(true);
    expect(result.output).toBe("LLM_PATH_RESPONSE");
  });

  it("uses the LLM path for skills with no mcp_binding", async () => {
    writeSkill("plain");
    const wf = new BaseWorkflow(llmRuntime, testDir, {
      mcpToolsetManager: { hasServer: () => true, callTool: async () => ({ content: [] }) },
    });
    const result = await wf.invokeSkill(handle, "plain", {});
    expect(result.output).toBe("LLM_PATH_RESPONSE");
  });

  it("short-circuits when the abort signal is already tripped (no work done)", async () => {
    writeSkill("plain");
    let sent = false;
    const wf = new BaseWorkflow(
      { sendMessage: async () => { sent = true; return { text: "x", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "m", status: "success" as const }; } },
      testDir,
    );
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await wf.invokeSkill(handle, "plain", {}, { signal: ctrl.signal });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aborted/);
    expect(sent).toBe(false); // never reached the runtime
  });

  it("threads the abort signal into the LLM send", async () => {
    writeSkill("plain");
    let seen: AbortSignal | undefined = undefined;
    const wf = new BaseWorkflow(
      { sendMessage: async (_h: any, _m: string, opts?: { signal?: AbortSignal }) => { seen = opts?.signal; return { text: "ok", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "m", status: "success" as const }; } },
      testDir,
    );
    const ctrl = new AbortController();
    await wf.invokeSkill(handle, "plain", {}, { signal: ctrl.signal });
    expect(seen).toBe(ctrl.signal);
  });

  it("threads the abort signal into the MCP tool call", async () => {
    writeSkill("code-review", { server: "sonar", tools: ["analyze"] });
    let seen: AbortSignal | undefined = undefined;
    const mcp = {
      hasServer: () => true,
      callTool: async (_s: string, _t: string, _a: Record<string, unknown>, signal?: AbortSignal) => {
        seen = signal;
        return { content: [{ type: "text", text: "ok" }] };
      },
    };
    const wf = new BaseWorkflow(llmRuntime, testDir, { mcpToolsetManager: mcp });
    const ctrl = new AbortController();
    await wf.invokeSkill(handle, "code-review", {}, { signal: ctrl.signal });
    expect(seen).toBe(ctrl.signal);
  });
});
