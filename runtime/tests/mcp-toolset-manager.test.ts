import { test, expect, describe } from "bun:test";
import { McpToolsetManager, flattenRegistries, type McpEventType } from "../src/mcp-toolset-manager";
import type { McpServerConfig } from "../src/types";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "fixtures", "mock-mcp-server.ts");

function stdioServer(id: string, tool_allowlist?: string[]): McpServerConfig {
  return { id, transport: "stdio", command: "bun", args: [FIXTURE], tool_allowlist };
}

describe("McpToolsetManager", () => {
  test("starts a server, discovers tools, calls one, and shuts down", async () => {
    const events: McpEventType[] = [];
    const mgr = new McpToolsetManager([stdioServer("mock")], {
      onEvent: (t) => events.push(t),
      startTimeoutMs: 300,
    });
    await mgr.start();

    expect(mgr.listServers()).toEqual(["mock"]);
    expect(mgr.listTools("mock").map((t) => t.name).sort()).toEqual(["echo", "shout"]);

    const result = await mgr.callTool("mock", "shout", { input: "hi" });
    expect(result.content?.[0]?.text).toBe("HI");

    expect(events).toContain("mcp_server_started");
    expect(events).toContain("mcp_tool_call");
    expect(events).toContain("mcp_tool_result");

    await mgr.shutdown();
    expect(mgr.listServers()).toEqual([]);
  });

  test("tool_allowlist narrows discovery and blocks disallowed calls", async () => {
    const mgr = new McpToolsetManager([stdioServer("mock", ["shout"])], { startTimeoutMs: 300 });
    await mgr.start();
    expect(mgr.listTools("mock").map((t) => t.name)).toEqual(["shout"]);
    await expect(mgr.callTool("mock", "echo", {})).rejects.toThrow(/allowlist/);
    await mgr.shutdown();
  });

  test("an unavailable server is non-fatal by default", async () => {
    const events: Array<[McpEventType, Record<string, unknown>]> = [];
    const mgr = new McpToolsetManager(
      [{ id: "broken", transport: "stdio", command: "aos-no-such-binary-xyz" }],
      { onEvent: (t, d) => events.push([t, d]), startTimeoutMs: 300 },
    );
    await mgr.start();
    expect(mgr.hasServer("broken")).toBe(false);
    expect(events.some(([t]) => t === "mcp_server_unavailable")).toBe(true);
    await mgr.shutdown();
  });

  test("http server URLs are gated by the egress policy (SSRF target blocked)", async () => {
    const mgr = new McpToolsetManager(
      [{ id: "metadata", transport: "http", url: "https://169.254.169.254/mcp" }],
      { startTimeoutMs: 300 },
    );
    await mgr.start();
    expect(mgr.hasServer("metadata")).toBe(false); // egress check threw → non-fatal skip
    await mgr.shutdown();
  });

  test("requireAll surfaces a start failure", async () => {
    const mgr = new McpToolsetManager(
      [{ id: "broken", transport: "stdio", command: "aos-no-such-binary-xyz" }],
      { requireAll: true, startTimeoutMs: 300 },
    );
    await expect(mgr.start()).rejects.toThrow(/failed to start/);
  });

  test("callTool on an unknown server throws", async () => {
    const mgr = new McpToolsetManager([], {});
    await mgr.start();
    await expect(mgr.callTool("nope", "x", {})).rejects.toThrow(/not available/);
    await mgr.shutdown();
  });

  test("getVendorServerSpecs resolves env/headers and egress-checks http", () => {
    const mgr = new McpToolsetManager(
      [
        { id: "gh", transport: "stdio", command: "bunx", args: ["srv"], env: { TOKEN: "${MY_TOK}" } },
        { id: "ok", transport: "http", url: "https://api.example.com/mcp", auth_ref: "MY_TOK" },
        { id: "bad", transport: "http", url: "https://169.254.169.254/mcp" }, // SSRF target
      ],
      { env: { MY_TOK: "secret123" } },
    );
    const byId = Object.fromEntries(mgr.getVendorServerSpecs().map((s) => [s.id, s]));
    expect(byId.gh!.env).toEqual({ TOKEN: "secret123" }); // ${MY_TOK} resolved
    expect(byId.ok!.headers).toEqual({ authorization: "Bearer secret123" }); // auth_ref resolved
    expect(byId.bad).toBeUndefined(); // egress-blocked metadata host omitted, not exposed
  });

  test("flattenRegistries dedupes by id and throws on conflict", () => {
    const flat = flattenRegistries([
      { schema: "aos/mcp/v1", id: "reg-a", servers: [stdioServer("x"), stdioServer("y")] },
    ]);
    expect(flat.map((s) => s.id).sort()).toEqual(["x", "y"]);

    expect(() =>
      flattenRegistries([
        { schema: "aos/mcp/v1", id: "reg-a", servers: [stdioServer("dup")] },
        { schema: "aos/mcp/v1", id: "reg-b", servers: [stdioServer("dup")] },
      ]),
    ).toThrow(/Duplicate MCP server id/);
  });
});
