import { describe, it, expect, beforeEach } from "bun:test";
import { MemPalaceProvider } from "../src/mempalace-provider";
import type { MemoryConfig, HealthStatus } from "../src/memory-provider";
import type { McpClient } from "../src/mcp-client";

function createMockClient(): McpClient & { _callLog: Array<{ method: string; params: unknown }> } {
  const callLog: Array<{ method: string; params: unknown }> = [];

  return {
    _callLog: callLog,
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    call: async (method: string, params?: Record<string, unknown>) => {
      callLog.push({ method, params: params ?? {} });
      if (method === "tools/call" && params?.name === "mempalace_status") {
        return {
          content: [{
            text: JSON.stringify({
              total_drawers: 42,
              wings: { "test-project": 30, "other-project": 12 },
            }),
          }],
        };
      }
      if (method === "tools/call" && params?.name === "mempalace_search") {
        return {
          content: [{
            text: JSON.stringify({
              results: [{
                content: "We decided to use Clerk",
                wing: "test-project",
                room: "architect",
                hall: "hall_facts",
                similarity: 0.92,
                source: "session-1.jsonl",
              }],
            }),
          }],
        };
      }
      if (method === "tools/call" && params?.name === "mempalace_add_drawer") {
        return {
          content: [{ text: JSON.stringify({ id: "drawer-abc-123", ok: true }) }],
        };
      }
      return {};
    },
    healthCheck: async (): Promise<HealthStatus> => ({ healthy: true, latencyMs: 5 }),
  } as unknown as McpClient & { _callLog: Array<{ method: string; params: unknown }> };
}

const CONFIG: MemoryConfig = {
  provider: "mempalace",
  mempalace: {
    palacePath: "~/.mempalace/palace",
    projectWing: "test-project",
    wakeLayers: ["L0", "L1"],
    autoHall: true,
    maxWakeTokens: 1200,
    maxDrawerTokens: 500,
  },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

describe("MemPalaceProvider", () => {
  let provider: MemPalaceProvider;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    mockClient = createMockClient();
    provider = new MemPalaceProvider(mockClient);
    await provider.initialize(CONFIG);
  });

  it("has correct id and name", () => {
    expect(provider.id).toBe("mempalace");
    expect(provider.name).toBe("MemPalace");
  });

  it("isAvailable checks MCP client health", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it("healthCheck delegates to MCP client", async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it("recall calls mempalace_search with correct params", async () => {
    const result = await provider.recall("auth decisions", {
      projectId: "test-project",
      agentId: "architect",
      hall: "hall_facts",
      maxResults: 3,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].content).toBe("We decided to use Clerk");
    expect(result.entries[0].similarity).toBe(0.92);

    const searchCall = mockClient._callLog.find(
      (c) => c.method === "tools/call" && (c.params as any).name === "mempalace_search",
    );
    expect(searchCall).toBeDefined();
  });

  it("remember calls mempalace_add_drawer with correct params", async () => {
    const id = await provider.remember("Important decision about auth", {
      projectId: "test-project",
      agentId: "architect",
      hall: "hall_facts",
      sessionId: "sess-123",
    });

    expect(id).toBe("drawer-abc-123");

    const addCall = mockClient._callLog.find(
      (c) => c.method === "tools/call" && (c.params as any).name === "mempalace_add_drawer",
    );
    expect(addCall).toBeDefined();
    const addParams = (addCall!.params as any).arguments;
    expect(addParams.wing).toBe("test-project");
    expect(addParams.room).toBe("architect");
  });

  it("remember rejects content exceeding maxDrawerTokens", async () => {
    const longContent = "x".repeat(2500); // ~625 tokens > 500 cap
    try {
      await provider.remember(longContent, {
        projectId: "test-project",
        agentId: "architect",
      });
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("exceeds");
    }
  });

  it("status calls mempalace_status", async () => {
    const s = await provider.status();
    expect(s.provider).toBe("mempalace");
    expect(s.available).toBe(true);
    expect(s.drawerCount).toBe(42);
  });
});
