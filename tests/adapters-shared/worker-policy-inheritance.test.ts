import { describe, test, expect, mock } from "bun:test";
import { BaseWorkflow } from "../../adapters/shared/src/base-workflow";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";

const mockRuntime = { sendMessage: mock(async () => ({ text: "ok" })) } as any;

describe("Worker policy inheritance (spec D3 worker rules)", () => {
  test("parent denies execute_code; worker spawn requesting execute_code throws", async () => {
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
    });
    await expect(
      (wf as any).spawnWorker({
        agentId: "worker-1",
        toolsOverride: { execute_code: { enabled: true, languages: ["bash"] } },
      }),
    ).rejects.toThrow(/cannot widen session policy/);
  });

  test("parent allows [python, bash]; worker narrows to [python] — python call allowed, bash denied at worker", async () => {
    const profile = {
      ...DEFAULT_TOOL_POLICY,
      execute_code: {
        enabled: true,
        languages: ["python", "bash"] as any,
        max_timeout_ms: 30000,
      },
    };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(profile as any, {}),
    });
    const workerWf = await (wf as any).spawnWorker({
      agentId: "worker-1",
      toolsOverride: { execute_code: { enabled: true, languages: ["python"] } },
    });
    const bash = await workerWf.enforceToolAccess("worker-1", {
      tool: "execute_code",
      command: { language: "bash" },
    });
    expect(bash.allowed).toBe(false);
    const py = await workerWf.enforceToolAccess("worker-1", {
      tool: "execute_code",
      command: { language: "python" },
    });
    expect(py.allowed).toBe(true);
  });

  test("worker with no toolsOverride inherits parent session policy verbatim", async () => {
    const profile = {
      ...DEFAULT_TOOL_POLICY,
      execute_code: {
        enabled: true,
        languages: ["python"] as any,
        max_timeout_ms: 30000,
      },
    };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(profile as any, {}),
    });
    const workerWf = await (wf as any).spawnWorker({ agentId: "worker-1" });
    const py = await workerWf.enforceToolAccess("worker-1", {
      tool: "execute_code",
      command: { language: "python" },
    });
    expect(py.allowed).toBe(true);
  });
});
