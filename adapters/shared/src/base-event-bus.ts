// ── BaseEventBus (L2) ─────────────────────────────────────────────
// Concrete handler storage + sequential async dispatch.
// All fire*() methods serialize through a queue to prevent interleaving.

import type { EventBusAdapter } from "@aos-harness/runtime/types";

export class BaseEventBus implements EventBusAdapter {
  private handlers: {
    sessionStart: (() => Promise<void>) | null;
    sessionShutdown: (() => Promise<void>) | null;
    beforeAgentStart: ((prompt: string) => Promise<{ systemPrompt?: string }>) | null;
    agentEnd: (() => Promise<void>) | null;
    toolCall: ((toolName: string, input: unknown) => Promise<{ block?: boolean }>) | null;
    toolResult: ((toolName: string, input: unknown, result: unknown) => Promise<void>) | null;
    messageEnd: ((usage: { cost: number; tokens: number }) => Promise<void>) | null;
    compaction: (() => Promise<void>) | null;
  } = {
    sessionStart: null,
    sessionShutdown: null,
    beforeAgentStart: null,
    agentEnd: null,
    toolCall: null,
    toolResult: null,
    messageEnd: null,
    compaction: null,
  };

  // Sequential dispatch queue
  private queue: Promise<void> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.queue = this.queue.then(() => fn().then(resolve, reject));
    return result;
  }

  // ── Registration (EventBusAdapter interface) ───────────────────

  onSessionStart(handler: () => Promise<void>): void {
    this.handlers.sessionStart = handler;
  }

  onSessionShutdown(handler: () => Promise<void>): void {
    this.handlers.sessionShutdown = handler;
  }

  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void {
    this.handlers.beforeAgentStart = handler;
  }

  onAgentEnd(handler: () => Promise<void>): void {
    this.handlers.agentEnd = handler;
  }

  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void {
    this.handlers.toolCall = handler;
  }

  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void {
    this.handlers.toolResult = handler;
  }

  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void {
    this.handlers.messageEnd = handler;
  }

  onCompaction(handler: () => Promise<void>): void {
    this.handlers.compaction = handler;
  }

  // ── Fire methods (called by BaseAgentRuntime) ──────────────────

  fireSessionStart(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.sessionStart) await this.handlers.sessionStart();
    });
  }

  fireSessionShutdown(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.sessionShutdown) await this.handlers.sessionShutdown();
    });
  }

  fireBeforeAgentStart(prompt: string): Promise<{ systemPrompt?: string }> {
    return this.enqueue(async () => {
      if (this.handlers.beforeAgentStart) {
        return await this.handlers.beforeAgentStart(prompt);
      }
      return {};
    });
  }

  fireAgentEnd(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.agentEnd) await this.handlers.agentEnd();
    });
  }

  fireToolCall(toolName: string, input: unknown): Promise<{ block?: boolean }> {
    return this.enqueue(async () => {
      if (this.handlers.toolCall) {
        return await this.handlers.toolCall(toolName, input);
      }
      return { block: false };
    });
  }

  fireToolResult(toolName: string, input: unknown, result: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.toolResult) {
        await this.handlers.toolResult(toolName, input, result);
      }
    });
  }

  fireMessageEnd(usage: { cost: number; tokens: number }): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.messageEnd) await this.handlers.messageEnd(usage);
    });
  }

  fireCompaction(): Promise<void> {
    return this.enqueue(async () => {
      if (this.handlers.compaction) await this.handlers.compaction();
    });
  }
}
