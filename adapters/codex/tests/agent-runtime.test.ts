import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CodexAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal stub for BaseEventBus
class StubEventBus extends BaseEventBus {}

describe("CodexAgentRuntime", () => {
  it("cliBinary returns 'codex'", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    expect(rt.cliBinary()).toBe("codex");
  });

  it("stdoutFormat returns 'ndjson'", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    expect(rt.stdoutFormat()).toBe("ndjson");
  });

  describe("buildArgs", () => {
    const state = {
      config: {
        id: "test-agent",
        systemPrompt: "You are a helpful assistant.",
        model: { tier: "standard" as const, thinking: "on" as const },
        tools: [],
        skills: [],
      },
      sessionFile: "/tmp/test-session.jsonl",
      contextFiles: ["/tmp/context.md"],
      modelConfig: { tier: "standard" as const, thinking: "on" as const },
      lastContextTokens: 0,
    };

    it("first call uses codex exec json mode and inlines system/context into the prompt", () => {
      const rt = new CodexAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Hello world", true);

      expect(args[0]).toBe("exec");
      expect(args).toContain("--json");
      expect(args).toContain("--full-auto");
      expect(args).toContain("--model");
      expect(args.join("\n")).toContain("<system>");
      expect(args.join("\n")).toContain("You are a helpful assistant.");
      expect(args[args.length - 1]).toContain("Hello world");
    });

    it("first call inlines context file contents instead of passing --file", () => {
      const root = mkdtempSync(join(tmpdir(), "codex-ctx-"));
      const contextFile = join(root, "context.md");
      writeFileSync(contextFile, "Context file body");
      const rt = new CodexAgentRuntime(new StubEventBus());
      const args = rt.buildArgs({ ...state, contextFiles: [contextFile] }, "Hello", true);

      expect(args).not.toContain("--file");
      expect(args.join("\n")).toContain("Context file body");
    });

    it("subsequent call resumes via codex exec resume", () => {
      const root = mkdtempSync(join(tmpdir(), "codex-session-"));
      const sessionFile = join(root, "session.txt");
      writeFileSync(sessionFile, "thread_123\n");
      const rt = new CodexAgentRuntime(new StubEventBus());
      const args = rt.buildArgs({ ...state, sessionFile }, "Follow-up message", false);

      expect(args[0]).toBe("exec");
      expect(args[1]).toBe("resume");
      expect(args).toContain("thread_123");
      expect(args).toContain("--model");
      expect(args[args.length - 1]).toBe("Follow-up message");
    });
  });

  describe("parseEventLine", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());

    it("parses thread.started → session_update", () => {
      const line = JSON.stringify({
        type: "thread.started",
        thread_id: "thread_123",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("session_update");
      if (event!.type === "session_update") {
        expect(event.sessionId).toBe("thread_123");
      }
    });

    it("parses item.completed agent_message → text_delta", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "streaming text" },
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("text_delta");
      if (event!.type === "text_delta") {
        expect(event.text).toBe("streaming text");
      }
    });

    it("parses turn.completed → message_end", () => {
      const line = JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 80, output_tokens: 40 },
        model: "gpt-5.2-codex",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("message_end");
      if (event!.type === "message_end") {
        expect(event.text).toBe("");
        expect(event.tokensIn).toBe(80);
        expect(event.tokensOut).toBe(40);
        expect(event.model).toBe("gpt-5.2-codex");
      }
    });

    it("parses tool_call → tool_call", () => {
      const line = JSON.stringify({
        type: "tool_call",
        name: "bash",
        input: { command: "ls" },
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("tool_call");
      if (event!.type === "tool_call") {
        expect(event.name).toBe("bash");
        expect(event.input).toEqual({ command: "ls" });
      }
    });

    it("parses function_call → tool_call", () => {
      const line = JSON.stringify({
        type: "function_call",
        name: "search",
        args: { query: "openai" },
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("tool_call");
      if (event!.type === "tool_call") {
        expect(event.name).toBe("search");
      }
    });

    it("returns ignored for unknown event types", () => {
      const line = JSON.stringify({ type: "unknown_event", data: "foo" });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("ignored");
    });

    it("returns null for invalid JSON", () => {
      const event = rt.parseEventLine("not valid json");
      expect(event).toBeNull();
    });
  });

  it("defaultModelMap returns current Codex family defaults", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    const map = rt.defaultModelMap();
    expect(map.economy).toBe("gpt-5.1-codex-mini");
    expect(map.standard).toBe("gpt-5.2-codex");
    expect(map.premium).toBe("gpt-5.2-codex");
  });

  describe("getAuthMode", () => {
    let savedKey: string | undefined;

    beforeEach(() => {
      savedKey = process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    });

    it("returns api_key when OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "sk-test-openai-key";
      const rt = new CodexAgentRuntime(new StubEventBus());
      const auth = rt.getAuthMode();
      expect(auth.type).toBe("api_key");
      expect(auth.metered).toBe(true);
    });

    it("returns unknown when OPENAI_API_KEY is not set", () => {
      delete process.env.OPENAI_API_KEY;
      const rt = new CodexAgentRuntime(new StubEventBus());
      const auth = rt.getAuthMode();
      expect(auth.type).toBe("unknown");
      expect(auth.metered).toBe(false);
    });
  });
});
