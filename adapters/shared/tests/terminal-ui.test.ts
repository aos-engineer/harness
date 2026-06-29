import { describe, it, expect } from "bun:test";
import { TerminalUI } from "../src/terminal-ui";

describe("TerminalUI", () => {
  it("registers and dispatches commands", async () => {
    const ui = new TerminalUI();
    let received = "";
    ui.registerCommand("test-cmd", async (args) => {
      received = args;
    });
    await ui.dispatchCommand("test-cmd", "hello world");
    expect(received).toBe("hello world");
  });

  it("dispatchCommand returns false for unknown command", async () => {
    const ui = new TerminalUI();
    const result = await ui.dispatchCommand("nonexistent", "");
    expect(result).toBe(false);
  });

  it("registers tools", () => {
    const ui = new TerminalUI();
    ui.registerTool("my-tool", { input: { type: "string" } }, async (params) => {
      return { result: params.input };
    });
    expect(ui.hasTool("my-tool")).toBe(true);
  });

  it("blockInput and unblockInput control state", () => {
    const ui = new TerminalUI();
    expect(ui.isInputBlocked()).toBe(false);

    ui.blockInput(["help", "status"]);
    expect(ui.isInputBlocked()).toBe(true);
    expect(ui.getAllowedCommands()).toEqual(["help", "status"]);

    ui.unblockInput();
    expect(ui.isInputBlocked()).toBe(false);
    expect(ui.getAllowedCommands()).toEqual([]);
  });

  it("steerMessage queues a message", () => {
    const ui = new TerminalUI();
    ui.steerMessage("do something");
    expect(ui.consumeSteeredMessage()).toBe("do something");
    expect(ui.consumeSteeredMessage()).toBeNull();
  });

  it("setStatus and setWidget do not throw", () => {
    const ui = new TerminalUI();
    ui.setStatus("key", "value");
    ui.setWidget("widget-1", () => ["line1", "line2"]);
    ui.setWidget("widget-1", undefined);
    ui.setTheme("dark");
  });

  it("notify writes to console without throwing", () => {
    const ui = new TerminalUI();
    ui.notify("test info", "info");
    ui.notify("test warn", "warning");
    ui.notify("test error", "error");
  });
});
