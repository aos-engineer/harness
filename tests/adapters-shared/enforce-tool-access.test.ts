import { describe, test, expect, mock } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BaseWorkflow } from "../../adapters/shared/src/base-workflow";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";

const mockRuntime = { sendMessage: mock(async () => ({ text: "ok" })) } as any;

describe("BaseWorkflow.enforceToolAccess (spec D3.3)", () => {
  test("default policy: executeCode bash → denied, no spawn", async () => {
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
    });
    await expect(
      wf.executeCode({ agentId: "test" } as any, "echo hi", { language: "bash" }),
    ).rejects.toThrow(/execute_code.*not enabled/);
  });

  test("policy allows [python], bash call denied, python call allowed", async () => {
    const profile = {
      ...DEFAULT_TOOL_POLICY,
      execute_code: { enabled: true, languages: ["python"] as any, max_timeout_ms: 30000 },
    };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(profile as any, {}),
    });

    await expect(
      wf.executeCode({ agentId: "test" } as any, "ls", { language: "bash" }),
    ).rejects.toThrow(/language.*bash.*not in profile/);

    // python call: the gate should let us through (actual spawn may fail if
    // python3 is absent, but executeCode resolves instead of throwing).
    const result = await wf.executeCode({ agentId: "test" } as any, "print('hi')", {
      language: "python",
      timeout_ms: 2000,
      cwd: "/tmp",
    });
    expect(result).toBeDefined();
    expect(result.exit_code).toBeDefined();
  });

  test("per-call timeout cannot exceed profile max_timeout_ms", async () => {
    const profile = {
      ...DEFAULT_TOOL_POLICY,
      execute_code: { enabled: true, languages: ["bash"] as any, max_timeout_ms: 5000 },
    };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(profile as any, {}),
    });
    await expect(
      wf.executeCode({ agentId: "test" } as any, "sleep 1", {
        language: "bash",
        timeout_ms: 10_000,
      }),
    ).rejects.toThrow(/timeout.*exceeds profile max/);
  });

  test("tool-denied events are appended to transcript (D7.1)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-transcript-"));
    const transcriptPath = join(tmp, "transcript.jsonl");
    try {
      const wf = new BaseWorkflow(mockRuntime, "/tmp", {
        toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
        transcriptPath,
      });
      await expect(
        wf.executeCode({ agentId: "arbiter" } as any, "echo hi", { language: "bash" }),
      ).rejects.toThrow();
      const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.type).toBe("tool-denied");
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry.tool).toBe("execute_code");
      expect(entry.agent).toBe("arbiter");
      expect(entry.reason).toMatch(/not enabled/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("readFile denials are also appended to transcript", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-transcript-"));
    const transcriptPath = join(tmp, "transcript.jsonl");
    try {
      const wf = new BaseWorkflow(mockRuntime, "/tmp", {
        toolPolicy: buildToolPolicy(
          {
            ...DEFAULT_TOOL_POLICY,
            read_file: { enabled: false },
          },
          {},
        ),
        transcriptPath,
      });
      await expect(wf.readFile("/tmp/missing.txt")).rejects.toThrow(/read_file/);
      const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.type).toBe("tool-denied");
      expect(entry.tool).toBe("read_file");
      expect(entry.agent).toBe("system");
      expect(entry.detail).toBe("/tmp/missing.txt");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("listEnabledTools returns a frozen view", () => {
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
    });
    const view = wf.listEnabledTools();
    expect((view as any).execute_code.enabled).toBe(false);
    expect(() => {
      (view as any).execute_code.enabled = true;
    }).toThrow();
  });
});
