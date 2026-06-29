// Integration test: runs the REAL createEnginePass() through the REAL AOSEngine
// with the REAL paperclip-worker profile + workflow + agents, using a MockAdapter
// for the model (canned per-agent responses). No model, no secret, no `claude`
// CLI. This validates that the worker profile/workflow actually execute end to
// end and the package is extracted correctly.

import { test, expect, describe, afterAll } from "bun:test";
import { join } from "node:path";
import { rmSync, readFileSync } from "node:fs";
import { createEnginePass } from "../../cli/src/paperclip/pass-runner";
import type { WorkerConfig } from "../../cli/src/paperclip/config";
import type { Issue } from "../../cli/src/paperclip/types";
import { MockAdapter } from "../../runtime/tests/mock-adapter";

const ROOT = join(import.meta.dir, "..", ".."); // aos-framework root

function cfg(): WorkerConfig {
  return {
    port: 8080,
    wakeToken: "x",
    platform: "claude-code",
    root: ROOT,
    profileDir: join(ROOT, "core", "profiles", "paperclip-worker"),
    workflowsDir: join(ROOT, "core", "workflows"),
    paperclip: { apiBase: "http://x", apiKey: "x", authHeader: "Authorization", authScheme: "Bearer" },
  };
}

const issue: Issue = {
  id: "ITEST-1",
  title: "Add a /metrics endpoint to the gateway",
  definitionOfDone: "Expose Prometheus metrics on /metrics.",
  companyId: "C1",
};

afterAll(() => {
  try {
    rmSync(join(ROOT, "output", "paperclip-worker"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("createEnginePass (real engine + profile + workflow, mock model)", () => {
  test("runs the worker workflow and assembles the work product", async () => {
    const mock = new MockAdapter();
    // Canned per-agent responses; the orchestrator's response is the package.
    mock.agentResponses.set("architect", "Approach: add a /metrics route returning Prometheus text.");
    mock.agentResponses.set("sentinel", "Risk: label cardinality explosion. Mitigation: bound the labels.");
    mock.agentResponses.set(
      "arbiter",
      [
        "Summary: add a /metrics endpoint exposing Prometheus metrics.",
        "Plan: register a /metrics route on the gateway and emit counters.",
        "Risks: label cardinality (bounded labels).",
      ].join("\n"),
    );

    const pass = createEnginePass(cfg(), { adapterFactory: () => mock });
    const result = await pass({ issue });

    // The assembled package is the orchestrator-synthesis output.
    expect(result.package).toContain("/metrics");

    // All three workflow steps produced their artifacts.
    expect(result.sections.analysis).toBeDefined();
    expect(result.sections.risks).toBeDefined();
    expect(result.sections.work_product).toBeDefined();

    // Cost is captured from the engine constraint state (mock charges per call).
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.rounds).toBeGreaterThanOrEqual(0);

    // The mock model was actually invoked for the worker agents.
    const messaged = mock.calls.filter((c) => c.method === "sendMessage").map((c) => c.args[0]);
    expect(messaged).toContain("architect");
    expect(messaged).toContain("sentinel");
  });

  test("the brief the engine consumed embedded the issue", async () => {
    const mock = new MockAdapter();
    mock.agentResponses.set("arbiter", "Work product: add /metrics.");
    const pass = createEnginePass(cfg(), { adapterFactory: () => mock });
    const result = await pass({ issue });

    expect(result.briefPath).toBeDefined();
    const brief = readFileSync(result.briefPath!, "utf-8");
    expect(brief).toContain(issue.title!);
    expect(brief).toContain("## Task");
    expect(brief).toContain("## Definition of Done");
  });
});
