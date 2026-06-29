import { describe, it, expect } from "bun:test";
import { composeAdapter } from "../src/compose";
import type { AgentRuntimeAdapter, EventBusAdapter, UIAdapter, WorkflowAdapter } from "@aos-harness/runtime/types";

function stubRuntime(): AgentRuntimeAdapter {
  return {
    spawnAgent: async () => ({ id: "test", agentId: "a", sessionId: "s" }),
    sendMessage: async () => ({ text: "", tokensIn: 0, tokensOut: 0, cost: 0, contextTokens: 0, model: "", status: "success" as const }),
    destroyAgent: async () => {},
    setOrchestratorPrompt: () => {},
    injectContext: async () => {},
    getContextUsage: () => ({ tokens: 0, percent: 0 }),
    setModel: () => {},
    getAuthMode: () => ({ type: "unknown" as const, metered: false }),
    getModelCost: () => ({ inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: "USD" }),
    abort: () => {},
    spawnSubAgent: async () => ({ id: "test", agentId: "a", sessionId: "s" }),
    destroySubAgent: async () => {},
  };
}

function stubEventBus(): EventBusAdapter {
  return {
    onSessionStart: () => {},
    onSessionShutdown: () => {},
    onBeforeAgentStart: () => {},
    onAgentEnd: () => {},
    onToolCall: () => {},
    onToolResult: () => {},
    onMessageEnd: () => {},
    onCompaction: () => {},
  };
}

function stubUI(): UIAdapter {
  return {
    registerCommand: () => {},
    registerTool: () => {},
    renderAgentResponse: () => {},
    renderCustomMessage: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setStatus: () => {},
    setTheme: () => {},
    promptSelect: async () => 0,
    promptConfirm: async () => false,
    promptInput: async () => "",
    notify: () => {},
    blockInput: () => {},
    unblockInput: () => {},
    steerMessage: () => {},
  };
}

function stubWorkflow(): WorkflowAdapter {
  return {
    dispatchParallel: async () => [],
    isolateWorkspace: async () => ({ path: "/tmp", cleanup: async () => {} }),
    writeFile: async () => {},
    readFile: async () => "",
    openInEditor: async () => {},
    persistState: async () => {},
    loadState: async () => null,
    executeCode: async () => ({ success: true, exit_code: 0, stdout: "", stderr: "", duration_ms: 0 }),
    invokeSkill: async () => ({ success: true, output: "" }),
    createArtifact: async () => {},
    loadArtifact: async () => ({ manifest: {} as any, content: "" }),
    submitForReview: async () => ({ status: "approved" as const, feedback: "", reviewer: "" }),
    enforceToolAccess: async () => ({ allowed: true }),
  };
}

describe("composeAdapter", () => {
  it("composes 4 layers into a single AOSAdapter", () => {
    const adapter = composeAdapter(stubRuntime(), stubEventBus(), stubUI(), stubWorkflow());
    expect(typeof adapter.spawnAgent).toBe("function");
    expect(typeof adapter.onSessionStart).toBe("function");
    expect(typeof adapter.registerCommand).toBe("function");
    expect(typeof adapter.dispatchParallel).toBe("function");
  });

  it("preserves this binding", async () => {
    class CountingRuntime {
      count = 0;
      async spawnAgent() {
        this.count++;
        return { id: "test", agentId: "a", sessionId: "s" };
      }
      sendMessage = stubRuntime().sendMessage;
      destroyAgent = stubRuntime().destroyAgent;
      setOrchestratorPrompt = stubRuntime().setOrchestratorPrompt;
      injectContext = stubRuntime().injectContext;
      getContextUsage = stubRuntime().getContextUsage;
      setModel = stubRuntime().setModel;
      getAuthMode = stubRuntime().getAuthMode;
      getModelCost = stubRuntime().getModelCost;
      abort = stubRuntime().abort;
      spawnSubAgent = stubRuntime().spawnSubAgent;
      destroySubAgent = stubRuntime().destroySubAgent;
    }

    const runtime = new CountingRuntime();
    const adapter = composeAdapter(runtime, stubEventBus(), stubUI(), stubWorkflow());
    await adapter.spawnAgent({} as any, "session-1");
    expect(runtime.count).toBe(1);
  });
});
