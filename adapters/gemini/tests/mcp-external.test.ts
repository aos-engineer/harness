import { test, expect, describe, afterEach } from "bun:test";
import { GeminiAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import type { VendorMcpServerSpec } from "@aos-harness/runtime/types";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

class StubEventBus extends BaseEventBus {}
const base = { bridgeScriptPath: "/x/bridge.ts", socketPath: "/tmp/s.sock" };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("gemini — Tier 2 external MCP", () => {
  test("buildMcpArgs allows external stdio server names (additive)", () => {
    const rt = new GeminiAgentRuntime(new StubEventBus());
    expect(rt.buildMcpArgs()).toEqual(["--yolo", "--allowed-mcp-server-names", "aos"]);
    const ext: VendorMcpServerSpec[] = [{ id: "github", transport: "stdio", command: "bunx" }];
    expect(rt.buildMcpArgs({ ...base, externalServers: ext })).toEqual([
      "--yolo",
      "--allowed-mcp-server-names",
      "aos,github",
    ]);
  });

  test("writeMcpSettings includes external stdio servers in .gemini/settings.json", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-gem-"));
    dirs.push(root);
    const ext: VendorMcpServerSpec[] = [
      { id: "github", transport: "stdio", command: "bunx", args: ["srv"], env: { GH: "x" } },
    ];
    const restore = new GeminiAgentRuntime(new StubEventBus()).writeMcpSettings({
      ...base,
      projectRoot: root,
      externalServers: ext,
    });
    const settings = JSON.parse(readFileSync(join(root, ".gemini", "settings.json"), "utf-8"));
    expect(settings.mcpServers.aos).toBeDefined();
    expect(settings.mcpServers.github).toEqual({
      command: "bunx",
      args: ["srv"],
      env: { GH: "x" },
      trust: true,
      timeout: 600000,
    });
    restore();
  });
});
