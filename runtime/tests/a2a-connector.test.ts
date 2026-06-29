import { test, expect, describe, afterEach } from "bun:test";
import { A2aConnector } from "../src/a2a-connector";
import { A2aClient } from "../src/a2a-client";
import { MeshEgressPolicy } from "../src/egress-policy";
import type { RemoteAgentConfig } from "../src/types";
import { startMockA2aAgent } from "./fixtures/mock-a2a-agent";

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
});

function remote(id: string, cardUrl: string): RemoteAgentConfig {
  return { schema: "aos/remote-agent/v1", id, kind: "a2a", agent_card_url: cardUrl, transport: "jsonrpc", cost: "unmetered" };
}
function localClient(): A2aClient {
  return new A2aClient({ egress: new MeshEgressPolicy({ allowPrivate: true }), pollIntervalMs: 1, sleep: async () => {} });
}

describe("A2aConnector", () => {
  test("resolves the card on spawn, drives the task on send, emits events", async () => {
    const a = startMockA2aAgent();
    servers.push(a);
    const events: string[] = [];
    const conn = new A2aConnector([remote("peer", a.cardUrl)], { client: localClient(), onEvent: (t) => events.push(t) });

    expect(conn.handles("peer")).toBe(true);
    expect(conn.handles("nope")).toBe(false);

    const handle = await conn.spawnAgent({ id: "peer", remote_ref: "peer" } as any, "s1");
    expect(handle.agentId).toBe("peer");

    const resp = await conn.sendMessage(handle, "question");
    expect(resp.text).toBe("the answer is 42");
    expect(resp.status).toBe("success");
    expect(resp.cost).toBe(0);
    expect(events).toContain("a2a_task_created");
    expect(events).toContain("a2a_artifact_received");

    await conn.destroyAgent(handle);
  });

  test("spawnAgent throws for an unknown remote_ref", async () => {
    const conn = new A2aConnector([], { client: localClient() });
    await expect(conn.spawnAgent({ id: "x", remote_ref: "ghost" } as any, "s")).rejects.toThrow(/no remote agent/);
  });

  test("a failed remote task surfaces as failed + a2a_task_failed", async () => {
    const a = startMockA2aAgent({ mode: "fail" });
    servers.push(a);
    const events: string[] = [];
    const conn = new A2aConnector([remote("peer", a.cardUrl)], { client: localClient(), onEvent: (t) => events.push(t) });
    const handle = await conn.spawnAgent({ id: "peer", remote_ref: "peer" } as any, "s");
    const resp = await conn.sendMessage(handle, "q");
    expect(resp.status).toBe("failed");
    expect(events).toContain("a2a_task_failed");
  });

  test("getAuthMode is unmetered (remote spend excluded from budget gating)", () => {
    const conn = new A2aConnector([], { client: localClient() });
    expect(conn.getAuthMode().metered).toBe(false);
    expect(conn.getModelCost("standard").inputPerMillionTokens).toBe(0);
  });
});
