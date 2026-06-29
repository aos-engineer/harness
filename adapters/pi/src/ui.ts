// ── Pi UI Layer (L3) ─────────────────────────────────────────────
// TUI widgets, command/tool registration, message rendering,
// user interaction prompts, and input control.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { UIAdapter } from "@aos-harness/runtime/types";

// ── Helpers ──────────────────────────────────────────────────────

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

// ── PiUI ─────────────────────────────────────────────────────────

export class PiUI implements UIAdapter {
  private pi: ExtensionAPI;
  private ctx: any; // ExtensionContext — set after session_start
  private inputBlocked = false;
  private allowedCommands: string[] = [];

  constructor(pi: ExtensionAPI) {
    this.pi = pi;

    // Register the agent response renderer once at construction time
    this.pi.registerMessageRenderer(
      "aos-agent-response",
      (message, _options, theme) => {
        const details = message.details as
          | { agent?: string; color?: string }
          | undefined;
        const agentName = details?.agent || "Agent";
        const color = details?.color || "#ffffff";

        const { r, g, b } = parseHexColor(color);
        const bgOpen = `\x1b[48;2;${r};${g};${b}m`;
        const fgDark = `\x1b[38;2;30;30;30m`;
        const reset = `\x1b[0m`;
        const header = `${bgOpen}${fgDark} ${agentName} ${reset}`;

        const body =
          typeof message.content === "string" ? message.content : "";
        return new Text(header + "\n" + theme.fg("dim", body), 0, 0);
      },
    );
  }

  /** Set the Pi ExtensionContext (available after session_start). */
  setContext(ctx: any): void {
    this.ctx = ctx;
  }

  // ── Commands ─────────────────────────────────────────────────

  registerCommand(
    name: string,
    handler: (args: string) => Promise<void>,
  ): void {
    this.pi.registerCommand(name, {
      description: "AOS: " + name,
      handler: async (args, _ctx) => {
        await handler(args || "");
      },
    });
  }

  // ── Tools ────────────────────────────────────────────────────

  registerTool(
    name: string,
    schema: Record<string, unknown>,
    handler: (params: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.pi.registerTool({
      name,
      label: name,
      description: `AOS tool: ${name}`,
      parameters: Type.Object(schema as any),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = await handler(params as Record<string, unknown>);
        const text =
          typeof result === "string" ? result : JSON.stringify(result);
        return {
          content: [{ type: "text" as const, text }],
          details: result as Record<string, unknown>,
        };
      },
      renderCall(args, theme) {
        const label = theme.fg("toolTitle", theme.bold(`${name} `));
        const preview = args.message
          ? String(args.message).length > 80
            ? String(args.message).slice(0, 80) + "..."
            : String(args.message)
          : JSON.stringify(args).slice(0, 80);
        return new Text(
          label + "\n  " + theme.fg("dim", preview),
          0,
          0,
        );
      },
      renderResult(result, { expanded }, theme) {
        const content = result.content?.[0];
        const text =
          content?.type === "text"
            ? content.text
            : "Done";
        if (!expanded) {
          const short =
            text.length > 120 ? text.slice(0, 120) + "..." : text;
          return new Text(theme.fg("dim", short), 0, 0);
        }
        return new Text(text, 0, 0);
      },
    });
  }

  // ── Rendering ────────────────────────────────────────────────

  renderAgentResponse(
    agent: string,
    response: string,
    color: string,
  ): void {
    this.pi.sendMessage({
      customType: "aos-agent-response",
      content: response,
      display: true,
      details: { agent, color },
    });
  }

  renderCustomMessage(
    type: string,
    content: string,
    details: Record<string, unknown>,
  ): void {
    this.pi.sendMessage({
      customType: type,
      content,
      display: true,
      details,
    });
  }

  // ── Widgets & Footer ────────────────────────────────────────

  setWidget(id: string, renderer: (() => string[]) | undefined): void {
    if (!this.ctx) return;
    if (!renderer) {
      this.ctx.ui.setWidget(id, undefined);
      return;
    }
    this.ctx.ui.setWidget(id, () => ({
      render(width: number): string[] {
        return renderer();
      },
      invalidate() {},
    }));
  }

  setFooter(renderer: (width: number) => string[]): void {
    if (!this.ctx) return;
    this.ctx.ui.setFooter(
      (_tui: any, _theme: any, _footerData: any) => ({
        dispose: () => {},
        invalidate() {},
        render(width: number): string[] {
          return renderer(width);
        },
      }),
    );
  }

  // ── Status & Theme ──────────────────────────────────────────

  setStatus(key: string, text: string): void {
    if (!this.ctx) return;
    this.ctx.ui.setStatus(key, text);
  }

  setTheme(name: string): void {
    if (!this.ctx) return;
    this.ctx.ui.setTheme(name);
  }

  // ── User Interaction ─────────────────────────────────────────

  async promptSelect(label: string, options: string[]): Promise<number> {
    if (!this.ctx) return 0;
    return await this.ctx.ui.select(label, options);
  }

  async promptConfirm(title: string, message: string): Promise<boolean> {
    if (!this.ctx) return false;
    return await this.ctx.ui.confirm(title, message);
  }

  async promptInput(label: string): Promise<string> {
    if (!this.ctx) return "";
    return await this.ctx.ui.input(label);
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    if (!this.ctx) return;
    this.ctx.ui.notify(message, level);
  }

  // ── Input Control ────────────────────────────────────────────

  blockInput(allowedCommands: string[]): void {
    this.inputBlocked = true;
    this.allowedCommands = allowedCommands;
  }

  unblockInput(): void {
    this.inputBlocked = false;
    this.allowedCommands = [];
  }

  steerMessage(message: string): void {
    this.pi.sendUserMessage(message, { deliverAs: "steer" });
  }

  // ── Public Helpers (used by entry point) ─────────────────────

  /** Check whether user input is currently blocked. */
  isInputBlocked(): boolean {
    return this.inputBlocked;
  }

  /** Get the list of commands allowed while input is blocked. */
  getAllowedCommands(): string[] {
    return this.allowedCommands;
  }
}
