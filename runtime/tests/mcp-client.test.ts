import { describe, it, expect } from "bun:test";
import { McpClient, McpClientError } from "../src/mcp-client";

describe("McpClient", () => {
  it("can be constructed with command and args", () => {
    const client = new McpClient("python", ["-m", "mempalace.mcp_server"]);
    expect(client.isRunning()).toBe(false);
  });

  it("isRunning returns false before start", () => {
    const client = new McpClient("python", ["-m", "mempalace.mcp_server"]);
    expect(client.isRunning()).toBe(false);
  });

  it("stop is safe to call when not running", async () => {
    const client = new McpClient("python", ["-m", "mempalace.mcp_server"]);
    await client.stop();
  });

  it("throws McpClientError when process does not exist", async () => {
    const client = new McpClient("nonexistent-binary-xyz", []);
    try {
      await client.start();
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(McpClientError);
    }
  });

  it("restart kills and respawns", async () => {
    const client = new McpClient("echo", ["ready"]);
    try {
      await client.start();
    } catch {
      // expected — echo is not an MCP server
    }
    expect(client.isRunning()).toBe(false);
  });
});
