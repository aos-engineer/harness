import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseWorkflow } from "../src/base-workflow";
import { buildToolPolicy } from "../src/tool-policy";
import { DEFAULT_TOOL_POLICY } from "@aos-harness/runtime/profile-schema";

describe("BaseWorkflow", () => {
  const testDir = join(import.meta.dir, "__test-workspace__");
  let workflow: BaseWorkflow;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    const mockRuntime = {
      sendMessage: async () => ({
        text: "Mock response",
        tokensIn: 10,
        tokensOut: 20,
        cost: 0.001,
        contextTokens: 0,
        model: "mock",
        status: "success" as const,
      }),
    };
    workflow = new BaseWorkflow(mockRuntime, testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("writeFile creates file with content", async () => {
    const filePath = join(testDir, "test.txt");
    await workflow.writeFile(filePath, "hello world");
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
  });

  it("writeFile creates parent directories", async () => {
    const filePath = join(testDir, "sub", "dir", "test.txt");
    await workflow.writeFile(filePath, "nested");
    expect(readFileSync(filePath, "utf-8")).toBe("nested");
  });

  it("writeFile rejects paths outside project root", async () => {
    expect(workflow.writeFile("/tmp/evil.txt", "hack")).rejects.toThrow("outside the project directory");
  });

  it("readFile returns file content", async () => {
    const filePath = join(testDir, "read-me.txt");
    await workflow.writeFile(filePath, "read this");
    const content = await workflow.readFile(filePath);
    expect(content).toBe("read this");
  });

  it("readFile throws for missing file", async () => {
    expect(workflow.readFile(join(testDir, "missing.txt"))).rejects.toThrow("File not found");
  });

  it("writeFile respects the tool policy", async () => {
    const restricted = new BaseWorkflow({ sendMessage: async () => ({ text: "" }) } as any, testDir, {
      toolPolicy: buildToolPolicy(
        {
          ...DEFAULT_TOOL_POLICY,
          write_file: { enabled: false },
        },
        {},
      ),
    });
    expect(restricted.writeFile(join(testDir, "blocked.txt"), "nope")).rejects.toThrow(
      'tool "write_file" is not enabled in profile',
    );
  });

  it("readFile respects the tool policy", async () => {
    const filePath = join(testDir, "policy-read.txt");
    await workflow.writeFile(filePath, "policy");

    const restricted = new BaseWorkflow({ sendMessage: async () => ({ text: "" }) } as any, testDir, {
      toolPolicy: buildToolPolicy(
        {
          ...DEFAULT_TOOL_POLICY,
          read_file: { enabled: false },
        },
        {},
      ),
    });
    expect(restricted.readFile(filePath)).rejects.toThrow(
      'tool "read_file" is not enabled in profile',
    );
  });

  it("persistState and loadState round-trip", async () => {
    await workflow.persistState("test-key", { foo: "bar", num: 42 });
    const loaded = await workflow.loadState("test-key");
    expect(loaded).toEqual({ foo: "bar", num: 42 });
  });

  it("loadState returns null for missing key", async () => {
    const loaded = await workflow.loadState("nonexistent");
    expect(loaded).toBeNull();
  });

  it("persistState rejects invalid key characters", async () => {
    expect(workflow.persistState("bad/key", {})).rejects.toThrow("Invalid state key");
  });

  it("dispatchParallel sends to all handles concurrently", async () => {
    const handles = [
      { id: "s:a", agentId: "a", sessionId: "s" },
      { id: "s:b", agentId: "b", sessionId: "s" },
    ];
    const results = await workflow.dispatchParallel(handles, "hello");
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("success");
    expect(results[1].status).toBe("success");
  });
});
