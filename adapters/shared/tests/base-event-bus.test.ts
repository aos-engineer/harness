import { describe, it, expect } from "bun:test";
import { BaseEventBus } from "../src/base-event-bus";

describe("BaseEventBus", () => {
  it("stores and fires onSessionStart handler", async () => {
    const bus = new BaseEventBus();
    let called = false;
    bus.onSessionStart(async () => {
      called = true;
    });
    await bus.fireSessionStart();
    expect(called).toBe(true);
  });

  it("stores and fires onToolCall handler with args", async () => {
    const bus = new BaseEventBus();
    let receivedTool = "";
    let receivedInput: unknown = null;
    bus.onToolCall(async (toolName, input) => {
      receivedTool = toolName;
      receivedInput = input;
      return { block: false };
    });
    const result = await bus.fireToolCall("Read", { path: "/foo" });
    expect(receivedTool).toBe("Read");
    expect(receivedInput).toEqual({ path: "/foo" });
    expect(result).toEqual({ block: false });
  });

  it("fires onMessageEnd with usage data", async () => {
    const bus = new BaseEventBus();
    let receivedUsage: { cost: number; tokens: number } | null = null;
    bus.onMessageEnd(async (usage) => {
      receivedUsage = usage;
    });
    await bus.fireMessageEnd({ cost: 0.05, tokens: 1500 });
    expect(receivedUsage).toEqual({ cost: 0.05, tokens: 1500 });
  });

  it("returns empty result when no handler registered", async () => {
    const bus = new BaseEventBus();
    await bus.fireSessionStart(); // should not throw
    const result = await bus.fireToolCall("Read", {});
    expect(result).toEqual({ block: false });
  });

  it("fires events sequentially (no interleaving)", async () => {
    const bus = new BaseEventBus();
    const order: number[] = [];
    bus.onToolCall(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
      return { block: false };
    });
    const p1 = bus.fireToolCall("A", {});
    const p2 = bus.fireToolCall("B", {});
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 1, 2]);
  });

  it("fires onBeforeAgentStart and returns systemPrompt", async () => {
    const bus = new BaseEventBus();
    bus.onBeforeAgentStart(async (prompt) => {
      return { systemPrompt: `Modified: ${prompt}` };
    });
    const result = await bus.fireBeforeAgentStart("original");
    expect(result).toEqual({ systemPrompt: "Modified: original" });
  });
});
