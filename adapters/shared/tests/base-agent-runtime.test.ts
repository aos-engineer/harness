import { describe, it, expect, beforeEach } from "bun:test";
import { BaseAgentRuntime } from "../src/base-agent-runtime";
import { BaseEventBus } from "../src/base-event-bus";
import type { HandleState, ParsedEvent, StdoutFormat, ModelInfo } from "../src/types";
import type { AuthMode, ModelCost, ModelTier, MessageOpts, AgentConfig } from "@aos-harness/runtime/types";

// Concrete test implementation that echoes messages via /bin/echo
class EchoRuntime extends BaseAgentRuntime {
  cliBinary(): string {
    return "/bin/echo";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, _isFirstCall: boolean, _opts?: MessageOpts): string[] {
    const event = JSON.stringify({
      type: "message_end",
      text: `echo: ${message}`,
      tokensIn: 10,
      tokensOut: 20,
      cost: 0.001,
      contextTokens: 100,
      model: "echo-model",
    });
    return [event];
  }

  parseEventLine(line: string): ParsedEvent | null {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "message_end") {
        return {
          type: "message_end",
          text: obj.text,
          tokensIn: obj.tokensIn,
          tokensOut: obj.tokensOut,
          cost: obj.cost,
          contextTokens: obj.contextTokens,
          model: obj.model,
        };
      }
      return { type: "ignored" };
    } catch {
      return null;
    }
  }

  buildSubprocessEnv(): Record<string, string> {
    return { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  }

  async discoverModels(): Promise<ModelInfo[]> {
    return [{ id: "echo-model", name: "Echo", contextWindow: 100000, provider: "test" }];
  }

  defaultModelMap(): Record<ModelTier, string> {
    return { economy: "echo-small", standard: "echo-medium", premium: "echo-large" };
  }

  getAuthMode(): AuthMode {
    return { type: "unknown", metered: false };
  }

  getModelCost(_tier: ModelTier): ModelCost {
    return { inputPerMillionTokens: 1, outputPerMillionTokens: 2, currency: "USD" };
  }
}

describe("BaseAgentRuntime", () => {
  let runtime: EchoRuntime;
  let eventBus: BaseEventBus;

  beforeEach(() => {
    eventBus = new BaseEventBus();
    runtime = new EchoRuntime(eventBus);
  });

  it("spawnAgent creates a handle", async () => {
    const config: AgentConfig = {
      id: "test-agent",
      name: "Test",
      systemPrompt: "You are a test agent",
      model: { tier: "standard", thinking: "on" },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-1");
    expect(handle.agentId).toBe("test-agent");
    expect(handle.sessionId).toBe("session-1");
    expect(handle.id).toBe("session-1:test-agent");
  });

  it("sendMessage returns response from subprocess", async () => {
    const config = {
      id: "echo-agent",
      name: "Echo",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-2");
    const response = await runtime.sendMessage(handle, "hello");

    expect(response.status).toBe("success");
    expect(response.text).toBe("echo: hello");
    expect(response.tokensIn).toBe(10);
    expect(response.tokensOut).toBe(20);
    expect(response.model).toBe("echo-model");
  });

  it("sendMessage fires eventBus.fireMessageEnd", async () => {
    let firedUsage: { cost: number; tokens: number } | null = null;
    eventBus.onMessageEnd(async (usage) => {
      firedUsage = usage;
    });

    const config = {
      id: "event-agent",
      name: "Event",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-3");
    await runtime.sendMessage(handle, "test");

    expect(firedUsage).not.toBeNull();
    expect(firedUsage!.cost).toBe(0.001);
  });

  it("destroyAgent removes handle", async () => {
    const config = {
      id: "destroy-agent",
      name: "Destroy",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-4");
    await runtime.destroyAgent(handle);

    const response = await runtime.sendMessage(handle, "should fail");
    expect(response.status).toBe("failed");
    expect(response.error).toContain("No state found");
  });

  it("setModel updates handle model config", async () => {
    const config = {
      id: "model-agent",
      name: "Model",
      systemPrompt: "",
      model: { tier: "economy" as const, thinking: "off" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-5");
    runtime.setModel(handle, { tier: "premium", thinking: "extended" });
    const usage = runtime.getContextUsage(handle);
    expect(usage.tokens).toBe(0);
  });

  it("abort kills active processes", async () => {
    runtime.abort();
  });

  it("injectContext stores context files", async () => {
    const config = {
      id: "ctx-agent",
      name: "Context",
      systemPrompt: "",
      model: { tier: "standard" as const, thinking: "on" as const },
    } as AgentConfig;

    const handle = await runtime.spawnAgent(config, "session-6");
    await runtime.injectContext(handle, ["file1.ts", "file2.ts"]);
  });

  it("resolveModelId checks env vars before defaults", () => {
    const modelId = runtime.resolveModelId("economy");
    expect(modelId).toBe("echo-small");
  });

  it("resolveModelId returns null when vendor default mode is enabled and no override exists", () => {
    const vendorDefaultRuntime = new EchoRuntime(eventBus, undefined, { useVendorDefaultModel: true });
    expect(vendorDefaultRuntime.resolveModelId("standard")).toBeNull();
  });
});
