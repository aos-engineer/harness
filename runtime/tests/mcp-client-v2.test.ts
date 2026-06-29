import { test, expect, describe } from "bun:test";
import { McpClientV2, mcpResultToText } from "../src/mcp-client-v2";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "fixtures", "mock-mcp-server.ts");

function newClient(): McpClientV2 {
  return new McpClientV2({ kind: "stdio", command: "bun", args: [FIXTURE], startTimeoutMs: 300 });
}

describe("McpClientV2 (stdio)", () => {
  test("performs the initialize handshake and reports server info", async () => {
    const client = newClient();
    await client.start();
    const info = client.getServerInfo();
    expect(info.name).toBe("mock");
    expect(info.protocolVersion).toBe("2025-06-18");
    await client.stop();
  });

  test("lists tools after initialization", async () => {
    const client = newClient();
    await client.start();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "shout"]);
    await client.stop();
  });

  test("calls a tool and flattens the result", async () => {
    const client = newClient();
    await client.start();
    const result = await client.callTool("shout", { input: "hello" });
    expect(mcpResultToText(result)).toBe("HELLO");
    await client.stop();
  });

  test("surfaces tool isError results", async () => {
    const client = newClient();
    await client.start();
    const result = await client.callTool("boom", {});
    expect(result.isError).toBe(true);
    await client.stop();
  });

  test("listTools before start() throws (initialize is mandatory)", async () => {
    const client = newClient();
    await expect(client.listTools()).rejects.toThrow(/not initialized/);
  });
});
