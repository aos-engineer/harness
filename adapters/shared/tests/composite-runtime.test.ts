import { test, expect, describe } from "bun:test";
import { CompositeRuntime, LOCAL_CONNECTOR_KIND } from "../src/composite-runtime";
import { BaseWorkflow } from "../src/base-workflow";
import { UnsupportedError } from "@aos-harness/runtime/types";
import type { Connector, AgentResponse, ContextUsage } from "@aos-harness/runtime/types";

function resp(text: string): AgentResponse {
  return { text, tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "mock", status: "success" };
}

/** A full recording connector — stands in for a local CLI runtime. */
function fullConnector(name: string) {
  const calls: Array<[string, ...unknown[]]> = [];
  const connector: Connector = {
    async spawnAgent(config: any, sessionId) {
      calls.push(["spawnAgent", config.id]);
      return { id: `${name}-${config.id}`, agentId: config.id, sessionId };
    },
    async sendMessage(handle, message) {
      calls.push(["sendMessage", handle.id]);
      return resp(`${name}:${message}`);
    },
    async destroyAgent(handle) { calls.push(["destroyAgent", handle.id]); },
    getAuthMode() { return { type: "subscription", metered: false }; },
    getModelCost() { return { inputPerMillionTokens: 1, outputPerMillionTokens: 2, currency: "USD" }; },
    async spawnSubAgent(parentId, config: any, sessionId) {
      calls.push(["spawnSubAgent", parentId]);
      return { id: `${name}-child`, agentId: config.id, sessionId, parentAgentId: parentId };
    },
    async destroySubAgent(parentId, childId) { calls.push(["destroySubAgent", parentId, childId]); },
    async injectContext(handle) { calls.push(["injectContext", handle.id]); },
    getContextUsage(handle) { calls.push(["getContextUsage", handle.id]); return {} as ContextUsage; },
    setModel(handle, mc) { calls.push(["setModel", handle.id, mc.tier]); },
    setOrchestratorPrompt(p) { calls.push(["setOrchestratorPrompt", p]); },
    abort() { calls.push(["abort"]); },
  };
  return { connector, calls, names: () => calls.map((c) => c[0]) };
}

describe("CompositeRuntime", () => {
  test("local passthrough: stamps 'local' and faithfully delegates every method", async () => {
    const local = fullConnector("local");
    const rt = new CompositeRuntime(local.connector);

    const h = await rt.spawnAgent({ id: "a" } as any, "s1");
    expect(h.connectorKind).toBe(LOCAL_CONNECTOR_KIND);
    expect((await rt.sendMessage(h, "hi")).text).toBe("local:hi");
    await rt.destroyAgent(h);
    await rt.injectContext(h, ["f"]);
    rt.getContextUsage(h);
    rt.setModel(h, { tier: "standard", thinking: "off" });
    rt.setOrchestratorPrompt("P");
    expect(rt.getAuthMode().metered).toBe(false);
    expect(rt.getModelCost("standard").currency).toBe("USD");
    const child = await rt.spawnSubAgent("a", { id: "c" } as any, "s1");
    expect(child.connectorKind).toBe(LOCAL_CONNECTOR_KIND);
    await rt.destroySubAgent("a", child.id);
    rt.abort();

    expect(new Set(local.names())).toEqual(
      new Set([
        "spawnAgent", "sendMessage", "destroyAgent", "injectContext", "getContextUsage",
        "setModel", "setOrchestratorPrompt", "spawnSubAgent", "destroySubAgent", "abort",
      ]),
    );
  });

  test("ONE dispatchParallel call partitions a mixed roster by connectorKind", async () => {
    const local = fullConnector("local");
    const remote = fullConnector("remote");
    const rt = new CompositeRuntime(local.connector, {
      connectors: { a2a: remote.connector },
      resolveKind: (cfg: any) => (cfg.id.startsWith("remote-") ? "a2a" : "local"),
    });

    const localH = await rt.spawnAgent({ id: "local-1" } as any, "s");
    const remoteH = await rt.spawnAgent({ id: "remote-1" } as any, "s");
    expect(localH.connectorKind).toBe("local");
    expect(remoteH.connectorKind).toBe("a2a");

    // BaseWorkflow.dispatchParallel makes a single call that fans out to
    // sendMessage per handle — this is exactly what the engine does, so the
    // partition requires NO engine/DelegationRouter change.
    const wf = new BaseWorkflow(rt as any, process.cwd());
    const results = await wf.dispatchParallel([localH, remoteH], "ping");
    expect(results.map((r) => r.text)).toEqual(["local:ping", "remote:ping"]);
    expect(local.names().filter((n) => n === "sendMessage")).toHaveLength(1);
    expect(remote.names().filter((n) => n === "sendMessage")).toHaveLength(1);
  });

  test("a remote connector lacking extended methods raises UnsupportedError", async () => {
    const local = fullConnector("local");
    const minimalRemote: Connector = {
      async spawnAgent(c: any, s) { return { id: "r", agentId: c.id, sessionId: s }; },
      async sendMessage() { return resp("r"); },
      async destroyAgent() {},
      getAuthMode() { return { type: "api_key", metered: true }; },
      getModelCost() { return { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: "USD" }; },
    };
    const rt = new CompositeRuntime(local.connector, {
      connectors: { a2a: minimalRemote },
      resolveKind: () => "a2a",
    });
    const h = await rt.spawnAgent({ id: "x" } as any, "s");
    expect(h.connectorKind).toBe("a2a");
    await expect(rt.injectContext(h, [])).rejects.toThrow(UnsupportedError);
    expect(() => rt.getContextUsage(h)).toThrow(UnsupportedError);
    expect(() => rt.setModel(h, { tier: "standard", thinking: "off" })).toThrow(UnsupportedError);
  });

  test("an unknown connectorKind fails loudly", async () => {
    const rt = new CompositeRuntime(fullConnector("local").connector);
    await expect(
      rt.sendMessage({ id: "x", agentId: "x", sessionId: "s", connectorKind: "ghost" }, "hi"),
    ).rejects.toThrow(/no connector registered/);
  });
});
