import { test, expect, describe, afterEach } from "bun:test";
import { A2aClient } from "../src/a2a-client";
import { MeshEgressPolicy } from "../src/egress-policy";
import { a2aToAgentResponse } from "../src/task-mapper";
import { startMockA2aAgent } from "./fixtures/mock-a2a-agent";

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
});

function localClient(extra: Record<string, unknown> = {}): A2aClient {
  return new A2aClient({
    egress: new MeshEgressPolicy({ allowPrivate: true }),
    pollIntervalMs: 1,
    sleep: async () => {},
    ...extra,
  });
}

describe("A2aClient", () => {
  test("fetches the agent card and exposes its endpoint", async () => {
    const a = startMockA2aAgent();
    servers.push(a);
    const card = await localClient().fetchAgentCard(a.cardUrl);
    expect(card.name).toBe("mock-peer");
    expect(card.url).toContain("/rpc");
  });

  test("sendMessage returns a completed task", async () => {
    const a = startMockA2aAgent();
    servers.push(a);
    const client = localClient();
    const card = await client.fetchAgentCard(a.cardUrl);
    const result = await client.sendMessage(card.url, "question");
    expect(a2aToAgentResponse(result).text).toBe("the answer is 42");
  });

  test("drives a working task to completion via tasks/get polling", async () => {
    const a = startMockA2aAgent({ mode: "slow" });
    servers.push(a);
    const client = localClient();
    const card = await client.fetchAgentCard(a.cardUrl);
    const result = await client.sendMessage(card.url, "q");
    expect(a2aToAgentResponse(result).status).toBe("success");
    expect(a.seen.some((s) => s.method === "tasks/get")).toBe(true);
  });

  test("blocks an SSRF redirect to a private host (egress re-validation)", async () => {
    const a = startMockA2aAgent({ redirectTo: "http://169.254.169.254/evil" });
    servers.push(a);
    const port = new URL(a.cardUrl).port;
    // Allow the loopback card host, but the redirect target must still be blocked.
    const client = new A2aClient({ egress: new MeshEgressPolicy({ allowlist: [`localhost:${port}`] }) });
    await expect(client.fetchAgentCard(a.cardUrl)).rejects.toThrow();
  });

  test("an 'unknown' task state resolves (not a 10-min poll-storm then throw)", async () => {
    const a = startMockA2aAgent({ mode: "unknown" });
    servers.push(a);
    const client = localClient();
    const card = await client.fetchAgentCard(a.cardUrl);
    const result = await client.sendMessage(card.url, "q"); // must NOT hang/throw
    const r = a2aToAgentResponse(result);
    expect(r.status).toBe("success");
    expect(r.a2aState).toBe("unknown");
    // it must not have poll-stormed
    expect(a.seen.filter((s) => s.method === "tasks/get").length).toBe(0);
  });

  test("a hostile over-cap response body is rejected (no OOM)", async () => {
    const a = startMockA2aAgent({ mode: "huge", hugeBytes: 2_000_000 });
    servers.push(a);
    const client = localClient({ maxResponseBytes: 64 * 1024 });
    const card = await client.fetchAgentCard(a.cardUrl);
    await expect(client.sendMessage(card.url, "q")).rejects.toThrow(/exceeds/);
  });
});
