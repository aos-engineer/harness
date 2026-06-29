import { test, expect, describe, afterEach } from "bun:test";
import { CompositeRuntime } from "../src/composite-runtime";
import { BaseWorkflow } from "../src/base-workflow";
import { A2aConnector, A2A_CONNECTOR_KIND } from "@aos-harness/runtime/a2a-connector";
import { A2aClient } from "@aos-harness/runtime/a2a-client";
import { MeshEgressPolicy } from "@aos-harness/runtime/egress-policy";
import type { Connector, AgentResponse } from "@aos-harness/runtime/types";
import { startMockA2aAgent } from "../../../runtime/tests/fixtures/mock-a2a-agent";

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
});

function localStub(): Connector {
  return {
    async spawnAgent(c: any, s) { return { id: `local-${c.id}`, agentId: c.id, sessionId: s }; },
    async sendMessage() {
      return { text: "local-reply", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "local", status: "success" } as AgentResponse;
    },
    async destroyAgent() {},
    getAuthMode() { return { type: "subscription", metered: false }; },
    getModelCost() { return { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: "USD" }; },
  };
}

describe("CompositeRuntime + A2aConnector (end-to-end egress)", () => {
  test("ONE dispatchParallel partitions a local + remote-A2A roster", async () => {
    const peer = startMockA2aAgent();
    servers.push(peer);
    const a2a = new A2aConnector(
      [{ schema: "aos/remote-agent/v1", id: "peer", kind: "a2a", agent_card_url: peer.cardUrl, transport: "jsonrpc", cost: "unmetered" }],
      { client: new A2aClient({ egress: new MeshEgressPolicy({ allowPrivate: true }), pollIntervalMs: 1, sleep: async () => {} }) },
    );
    const rt = new CompositeRuntime(localStub(), {
      connectors: { [A2A_CONNECTOR_KIND]: a2a },
      resolveKind: (cfg: any) => (a2a.handles(cfg.remote_ref) ? A2A_CONNECTOR_KIND : "local"),
    });

    const localH = await rt.spawnAgent({ id: "alice" } as any, "s");
    const remoteH = await rt.spawnAgent({ id: "bob", remote_ref: "peer" } as any, "s");
    expect(localH.connectorKind).toBe("local");
    expect(remoteH.connectorKind).toBe(A2A_CONNECTOR_KIND);

    // The engine broadcasts a round through exactly this call.
    const wf = new BaseWorkflow(rt as any, process.cwd());
    const results = await wf.dispatchParallel([localH, remoteH], "go");
    expect(results[0]!.text).toBe("local-reply");
    expect(results[1]!.text).toBe("the answer is 42"); // came back over A2A
  });
});
