import { test, expect, describe } from "bun:test";
import { CodexAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import type { VendorMcpServerSpec } from "@aos-harness/runtime/types";

class StubEventBus extends BaseEventBus {}
const base = { bridgeScriptPath: "/x/bridge.ts", socketPath: "/tmp/s.sock" };

describe("codex buildMcpArgs — Tier 2 external MCP", () => {
  test("identical to before when there are no external servers", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    expect(rt.buildMcpArgs(base)).toEqual(rt.buildMcpArgs({ ...base, externalServers: [] }));
  });

  test("registers stdio servers and skips http", () => {
    const externalServers: VendorMcpServerSpec[] = [
      { id: "github", transport: "stdio", command: "bunx", args: ["srv"], env: { GH: "x" } },
      { id: "sonar", transport: "http", url: "https://s.example.com/mcp" },
    ];
    const joined = new CodexAgentRuntime(new StubEventBus())
      .buildMcpArgs({ ...base, externalServers })
      .join(" ");
    expect(joined).toContain(`mcp_servers.github.command="bunx"`);
    expect(joined).toContain(`mcp_servers.github.args=["srv"]`);
    expect(joined).toContain(`mcp_servers.github.env={GH="x"}`);
    expect(joined).not.toContain("sonar"); // http is not exposed via codex -c config
  });
});
