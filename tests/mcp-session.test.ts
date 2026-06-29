import { test, expect, describe, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionMcpManager } from "../cli/src/mcp-session";

// End-to-end Phase 1 activation: a project that declares an aos/mcp/v1 registry
// under core/mcp/ produces a started McpToolsetManager whose tools are callable
// — the same manager adapter-session injects into BaseWorkflow.

const FIXTURE = join(import.meta.dir, "..", "runtime", "tests", "fixtures", "mock-mcp-server.ts");
const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

function projectWithServer(): string {
  const root = mkdtempSync(join(tmpdir(), "aos-sess-"));
  created.push(root);
  const dir = join(root, "core", "mcp", "tools");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "mcp.yaml"),
    [
      "schema: aos/mcp/v1",
      "id: tools",
      "servers:",
      "  - id: mock",
      "    transport: stdio",
      "    command: bun",
      `    args: ["${FIXTURE}"]`,
    ].join("\n"),
  );
  return root;
}

describe("createSessionMcpManager", () => {
  test("returns null when the project has no core/mcp", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-sess-"));
    created.push(root);
    const mgr = await createSessionMcpManager(root, () => {});
    expect(mgr).toBeNull();
  });

  test("discovers, starts, and exposes a declared server end-to-end", async () => {
    const root = projectWithServer();
    const logs: string[] = [];
    const mgr = await createSessionMcpManager(root, (m) => logs.push(m));
    expect(mgr).not.toBeNull();
    expect(mgr!.listServers()).toEqual(["mock"]);

    const result = await mgr!.callTool("mock", "shout", { input: "go" });
    expect(result.content?.[0]?.text).toBe("GO");

    expect(logs.some((l) => l.includes("server(s) ready"))).toBe(true);
    await mgr!.shutdown();
  });

  test("a malformed registry is non-fatal (returns null)", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-sess-"));
    created.push(root);
    const dir = join(root, "core", "mcp", "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.yaml"), "schema: aos/mcp/v1\nid: bad\nservers: []");
    const logs: string[] = [];
    const mgr = await createSessionMcpManager(root, (m) => logs.push(m));
    expect(mgr).toBeNull();
    expect(logs.some((l) => l.includes("disabled"))).toBe(true);
  });
});
