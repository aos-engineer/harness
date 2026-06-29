import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { BaseEventBus } from "@aos-harness/adapter-shared";

export class PiEventBus extends BaseEventBus {
  wire(pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, _ctx) => {
      await this.fireSessionStart();
    });
    pi.on("session_shutdown", async (_event, _ctx) => {
      await this.fireSessionShutdown();
    });
    pi.on("before_agent_start", async (event, _ctx) => {
      const result = await this.fireBeforeAgentStart(event.prompt);
      if (result.systemPrompt !== undefined) {
        return { systemPrompt: result.systemPrompt };
      }
      return undefined;
    });
    pi.on("agent_end", async (_event, _ctx) => {
      await this.fireAgentEnd();
    });
    pi.on("tool_call", async (event, _ctx) => {
      const result = await this.fireToolCall(event.toolName, event.input);
      if (result.block) return { block: true };
      return undefined;
    });
    pi.on("tool_result", async (event, _ctx) => {
      await this.fireToolResult(event.toolName, event.input, event.content);
    });
    pi.on("message_end", async (event, _ctx) => {
      const msg = event.message as { usage?: { cost?: { total?: number }; totalTokens?: number } };
      const cost = msg.usage?.cost?.total ?? 0;
      const tokens = msg.usage?.totalTokens ?? 0;
      await this.fireMessageEnd({ cost, tokens });
    });
    pi.on("session_before_compact", async (_event, _ctx) => {
      await this.fireCompaction();
      return undefined;
    });
  }
}
