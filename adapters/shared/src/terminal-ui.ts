// ── TerminalUI (L3) ───────────────────────────────────────────────
// ANSI terminal-native UI for non-Pi adapters.
// Console-based rendering, readline prompts, command/tool registry.

import * as readline from "node:readline";
import type { UIAdapter } from "@aos-harness/runtime/types";

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

export class TerminalUI implements UIAdapter {
  private commands = new Map<string, (args: string) => Promise<void>>();
  private tools = new Map<string, { schema: Record<string, unknown>; handler: (params: Record<string, unknown>) => Promise<unknown> }>();
  private inputBlocked = false;
  private allowedCommands: string[] = [];
  private steeredMessage: string | null = null;

  registerCommand(name: string, handler: (args: string) => Promise<void>): void {
    this.commands.set(name, handler);
  }

  async dispatchCommand(name: string, args: string): Promise<boolean> {
    const handler = this.commands.get(name);
    if (!handler) return false;
    await handler(args);
    return true;
  }

  registerTool(
    name: string,
    schema: Record<string, unknown>,
    handler: (params: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(name, { schema, handler });
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  async invokeTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return await tool.handler(params);
  }

  renderAgentResponse(agent: string, response: string, color: string): void {
    const { r, g, b } = parseHexColor(color);
    const bgOpen = `\x1b[48;2;${r};${g};${b}m`;
    const fgDark = `\x1b[38;2;30;30;30m`;
    const reset = `\x1b[0m`;
    const dim = `\x1b[2m`;
    console.log(`${bgOpen}${fgDark} ${agent} ${reset}`);
    console.log(`${dim}${response}${reset}`);
  }

  renderCustomMessage(type: string, content: string, _details: Record<string, unknown>): void {
    console.log(`[${type}] ${content}`);
  }

  setWidget(_id: string, _renderer: (() => string[]) | undefined): void {}
  setFooter(_renderer: (width: number) => string[]): void {}
  setStatus(_key: string, _text: string): void {}
  setTheme(_name: string): void {}

  async promptSelect(label: string, options: string[]): Promise<number> {
    console.log(`\n${label}`);
    for (let i = 0; i < options.length; i++) {
      console.log(`  ${i + 1}. ${options[i]}`);
    }
    const answer = await this.readLine("Enter number: ");
    const idx = parseInt(answer, 10) - 1;
    return idx >= 0 && idx < options.length ? idx : 0;
  }

  async promptConfirm(title: string, message: string): Promise<boolean> {
    console.log(`\n${title}`);
    console.log(message);
    const answer = await this.readLine("Confirm? (y/n): ");
    return answer.toLowerCase().startsWith("y");
  }

  async promptInput(label: string): Promise<string> {
    return this.readLine(`${label}: `);
  }

  private readLine(prompt: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    const prefix = level === "error" ? "[ERROR]" : level === "warning" ? "[WARN]" : "[INFO]";
    const colorCode = level === "error" ? "\x1b[31m" : level === "warning" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    console.log(`${colorCode}${prefix}${reset} ${message}`);
  }

  blockInput(allowedCommands: string[]): void {
    this.inputBlocked = true;
    this.allowedCommands = allowedCommands;
  }

  unblockInput(): void {
    this.inputBlocked = false;
    this.allowedCommands = [];
  }

  isInputBlocked(): boolean {
    return this.inputBlocked;
  }

  getAllowedCommands(): string[] {
    return this.allowedCommands;
  }

  steerMessage(message: string): void {
    this.steeredMessage = message;
  }

  consumeSteeredMessage(): string | null {
    const msg = this.steeredMessage;
    this.steeredMessage = null;
    return msg;
  }
}
