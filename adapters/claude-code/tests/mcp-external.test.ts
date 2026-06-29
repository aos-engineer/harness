import { test, expect, describe } from "bun:test";
import { ClaudeCodeAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import type { VendorMcpServerSpec } from "@aos-harness/runtime/types";

class StubEventBus extends BaseEventBus {}
const base = { bridgeScriptPath: "/x/bridge.ts", socketPath: "/tmp/s.sock" };

function mcpConfig(args: string[]): any {
  return JSON.parse(args[args.indexOf("--mcp-config") + 1]!);
}
function allowedTools(args: string[]): string {
  return args[args.indexOf("--allowedTools") + 1]!;
}

describe("claude-code buildMcpArgs — Tier 2 external MCP", () => {
  test("byte-identical to before when there are no external servers", () => {
    const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
    const withNone = rt.buildMcpArgs(base);
    const withEmpty = rt.buildMcpArgs({ ...base, externalServers: [] });
    expect(withNone).toEqual(withEmpty);
    expect(mcpConfig(withNone)).toEqual({
      mcpServers: {
        aos: { command: "bun", args: ["/x/bridge.ts"], env: { AOS_BRIDGE_SOCKET: "/tmp/s.sock" } },
      },
    });
    expect(allowedTools(withNone)).toBe("mcp__aos__delegate mcp__aos__end");
  });

  test("registers stdio + http external servers and allows them", () => {
    const externalServers: VendorMcpServerSpec[] = [
      { id: "github", transport: "stdio", command: "bunx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "tok" } },
      { id: "sonar", transport: "http", url: "https://sonar.example.com/mcp", headers: { authorization: "Bearer s" } },
    ];
    const args = new ClaudeCodeAgentRuntime(new StubEventBus()).buildMcpArgs({ ...base, externalServers });
    const cfg = mcpConfig(args);
    expect(cfg.mcpServers.aos).toBeDefined();
    expect(cfg.mcpServers.github).toEqual({ command: "bunx", args: ["-y", "srv"], env: { GITHUB_TOKEN: "tok" } });
    expect(cfg.mcpServers.sonar).toEqual({
      type: "http",
      url: "https://sonar.example.com/mcp",
      headers: { authorization: "Bearer s" },
    });
    expect(allowedTools(args)).toBe("mcp__aos__delegate mcp__aos__end mcp__github mcp__sonar");
  });
});
