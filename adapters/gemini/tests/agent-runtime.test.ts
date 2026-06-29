// ── GeminiAgentRuntime Tests ────────────────────────────────────
import { describe, it, expect, beforeEach } from "bun:test";
import { GeminiAgentRuntime } from "../src/agent-runtime";
import type { BaseEventBus } from "@aos-harness/adapter-shared";
import type { HandleState } from "@aos-harness/adapter-shared";
import type { AgentConfig } from "@aos-harness/runtime/types";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal stub EventBus
const mockEventBus: BaseEventBus = {
  fireToolCall: () => {},
  fireToolResult: () => {},
  fireMessageEnd: () => {},
} as unknown as BaseEventBus;

function makeState(overrides: Partial<HandleState> = {}): HandleState {
  const config: AgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    systemPrompt: "You are a test agent.",
    model: { tier: "standard", thinking: "on" },
    tools: [],
  } as unknown as AgentConfig;

  return {
    config,
    sessionFile: "/tmp/session.jsonl",
    contextFiles: [],
    modelConfig: { tier: "standard", thinking: "on" },
    lastContextTokens: 0,
    ...overrides,
  };
}

describe("GeminiAgentRuntime", () => {
  let runtime: GeminiAgentRuntime;

  beforeEach(() => {
    runtime = new GeminiAgentRuntime(mockEventBus);
  });

  // Test 1: cliBinary
  it("cliBinary returns 'gemini'", () => {
    expect(runtime.cliBinary()).toBe("gemini");
  });

  // Test 2: stdoutFormat
  it("stdoutFormat returns 'ndjson'", () => {
    expect(runtime.stdoutFormat()).toBe("ndjson");
  });

  // Test 3: buildArgs for first call
  it("buildArgs builds correct args for first call", () => {
    const root = mkdtempSync(join(tmpdir(), "gemini-ctx-"));
    const contextFile = join(root, "context.md");
    writeFileSync(contextFile, "Context body");
    const state = makeState({
      contextFiles: [contextFile],
    });
    const args = runtime.buildArgs(state, "Hello world", true);

    expect(args[0]).toBe("--output-format");
    expect(args[1]).toBe("stream-json");
    expect(args).toContain("--model");
    expect(args).toContain("--prompt");
    expect(args.join("\n")).toContain("You are a test agent.");
    expect(args.join("\n")).toContain("Context body");
    expect(args[args.length - 1]).toContain("Hello world");
  });

  // Test 4: buildArgs for subsequent call
  it("buildArgs builds correct args for subsequent call", () => {
    const root = mkdtempSync(join(tmpdir(), "gemini-session-"));
    const sessionFile = join(root, "session.txt");
    writeFileSync(sessionFile, "latest\n");
    const state = makeState({ sessionFile });
    const args = runtime.buildArgs(state, "Follow up", false);

    expect(args[0]).toBe("--output-format");
    expect(args).toContain("--model");
    expect(args).toContain("--resume");
    expect(args).toContain("latest");
    expect(args[args.length - 1]).toContain("Follow up");
  });

  // Test 5: parseEventLine handles result → message_end
  it("parseEventLine handles result type → message_end", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Final answer",
      usage: { input_tokens: 100, output_tokens: 50 },
      cost_usd: 0.005,
      model: "gemini-2.5-pro",
    });
    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event.text).toBe("Final answer");
      expect(event.tokensIn).toBe(100);
      expect(event.tokensOut).toBe(50);
      expect(event.cost).toBe(0.005);
      expect(event.model).toBe("gemini-2.5-pro");
    }
  });

  it("parseEventLine handles sessionId → session_update", () => {
    const line = JSON.stringify({ sessionId: "latest" });
    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("session_update");
    if (event!.type === "session_update") {
      expect(event.sessionId).toBe("latest");
    }
  });

  // Test 6: parseEventLine handles candidates format → message_end
  it("parseEventLine handles candidates format → message_end", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: "Candidates answer" }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 80,
        candidatesTokenCount: 40,
      },
    });
    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event.text).toBe("Candidates answer");
      expect(event.tokensIn).toBe(80);
      expect(event.tokensOut).toBe(40);
    }
  });

  // Test 7: defaultModelMap
  it("defaultModelMap returns correct models", () => {
    const map = runtime.defaultModelMap();
    expect(map.economy).toBe("gemini-2.5-flash-lite");
    expect(map.standard).toBe("gemini-2.5-flash");
    expect(map.premium).toBe("gemini-2.5-pro");
  });

  // Test 8: getAuthMode with GOOGLE_API_KEY
  it("getAuthMode returns api_key/metered when GOOGLE_API_KEY is set", () => {
    const original = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "test-key-123";
    try {
      const auth = runtime.getAuthMode();
      expect(auth.type).toBe("api_key");
      expect(auth.metered).toBe(true);
    } finally {
      if (original === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = original;
    }
  });
});
