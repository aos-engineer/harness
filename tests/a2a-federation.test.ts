import { test, expect, describe, afterEach } from "bun:test";
import { A2aClient } from "../runtime/src/a2a-client";
import { A2aServer, type AgentExecutor } from "../runtime/src/a2a-server";
import { MeshEgressPolicy } from "../runtime/src/egress-policy";
import { a2aToAgentResponse } from "../runtime/src/task-mapper";
import { handleRequest } from "../cli/src/paperclip/http";
import { buildA2aServerDeps } from "../cli/src/paperclip/a2a-ingress";

// The plan's first-class acceptance test: AOS's Phase-3 A2A egress client drives
// AOS's Phase-4 A2A ingress server over the real Paperclip HTTP handler — proving
// ingress + egress compose into an AOS↔AOS federation primitive.

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
});

const aosReplies: AgentExecutor = async (i) => ({
  artifacts: [{ artifactId: "a", parts: [{ kind: "text", text: `AOS replies: ${i.text}` }] }],
});

function startIngress(opts: { authToken?: string } = {}): { baseUrl: string } {
  let a2aServer!: A2aServer;
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      handleRequest(req, {
        wakeToken: "",
        dispatch: () => {},
        a2a: buildA2aServerDeps(a2aServer, { authToken: opts.authToken }),
      }),
  });
  // The advertised endpoint needs the bound port.
  a2aServer = new A2aServer({
    card: { name: "aos-deployment", skills: [{ id: "deliberate", name: "Deliberate" }] },
    endpointUrl: `http://localhost:${server.port}/a2a`,
    executor: aosReplies,
  });
  servers.push({ stop: () => server.stop(true) });
  return { baseUrl: `http://localhost:${server.port}` };
}

function client(): A2aClient {
  return new A2aClient({ egress: new MeshEgressPolicy({ allowPrivate: true }), pollIntervalMs: 1, sleep: async () => {} });
}

describe("AOS↔AOS A2A federation (ingress + egress round-trip)", () => {
  test("an A2aClient resolves the card and gets the AOS artifact back", async () => {
    const { baseUrl } = startIngress();
    const c = client();
    const card = await c.fetchAgentCard(baseUrl);
    expect(card.name).toBe("aos-deployment");
    expect(card.url).toContain("/a2a");

    const result = await c.sendMessage(card.url, "hello from peer");
    expect(a2aToAgentResponse(result).text).toBe("AOS replies: hello from peer");
  });

  test("the JSON-RPC endpoint enforces the out-of-band bearer token", async () => {
    const { baseUrl } = startIngress({ authToken: "s3cret" });
    const unauth = await fetch(`${baseUrl}/a2a`, {
      method: "POST",
      body: JSON.stringify({ id: 1, method: "tasks/get", params: { id: "x" } }),
    });
    expect(unauth.status).toBe(401);

    const authed = await fetch(`${baseUrl}/a2a`, {
      method: "POST",
      headers: { authorization: "Bearer s3cret" },
      body: JSON.stringify({ id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "ok" }] } } }),
    });
    expect(authed.status).toBe(200);
    const body: any = await authed.json();
    expect(body.result.status.state).toBe("completed");
  });

  test("rejects an oversized inbound body (413)", async () => {
    const { baseUrl } = startIngress();
    const huge = "x".repeat(1024 * 1024 + 16); // > 1 MiB
    const res = await fetch(`${baseUrl}/a2a`, { method: "POST", body: huge });
    expect(res.status).toBe(413);
  });
});
