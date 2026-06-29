import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProfile, loadWorkflow } from "../src/config-loader";
import { WorkflowRunner, type WorkflowConfig } from "../src/workflow-runner";
import { MockAdapter } from "./mock-adapter";
import type { TranscriptEntry, AgentResponse, DelegationDelegate } from "../src/types";

const coreDir = join(import.meta.dir, "..", "..", "core");

/**
 * Create a mock delegation delegate that records all calls and returns
 * synthetic agent responses. This will be used once WorkflowRunner
 * accepts a delegationDelegate option.
 */
function createMockDelegate(): DelegationDelegate & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    delegateToAgents: async (agentIds: string[], message: string): Promise<AgentResponse[]> => {
      calls.push({ method: "delegateToAgents", agentIds, message });
      return agentIds.map(id => ({
        text: `[${id} response] Analyzed: ${message.slice(0, 50)}...`,
        tokensIn: 100,
        tokensOut: 200,
        cost: 0,
        contextTokens: 0,
        model: "mock-delegate",
        status: "success" as const,
      }));
    },
    delegateTensionPair: async (agent1: string, agent2: string, message: string): Promise<AgentResponse[]> => {
      calls.push({ method: "delegateTensionPair", agent1, agent2, message });
      return [
        { text: `[${agent1}] Initial analysis of: ${message.slice(0, 50)}`, tokensIn: 100, tokensOut: 200, cost: 0, contextTokens: 0, model: "mock-delegate", status: "success" as const },
        { text: `[${agent2}] Challenge: I disagree because...`, tokensIn: 100, tokensOut: 200, cost: 0, contextTokens: 0, model: "mock-delegate", status: "success" as const },
      ];
    },
    delegateToOrchestrator: async (message: string): Promise<AgentResponse> => {
      calls.push({ method: "delegateToOrchestrator", message });
      return {
        text: `# Execution Package\n\nSynthesized from all inputs.\n\n${message.slice(0, 100)}`,
        tokensIn: 500,
        tokensOut: 1000,
        cost: 0,
        contextTokens: 0,
        model: "mock-delegate",
        status: "success" as const,
      };
    },
  };
}

/**
 * Detect whether the WorkflowRunner constructor accepts a delegationDelegate option.
 * If so, the runner will use real delegation; otherwise it falls back to "pending".
 */
function runnerSupportsDelegation(): boolean {
  // Inspect WorkflowRunner constructor by trying to create one with the option.
  // If the runner ignores it, delegation calls won't be recorded.
  // We detect this by checking if the delegate gets called after execution.
  return false; // Will be updated when WorkflowRunner adds delegation support
}

describe("CTO Execution Workflow E2E", () => {
  it("runs the full 8-step CTO workflow end-to-end", async () => {
    // Load real configs
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));

    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-e2e-"));
    const transcript: TranscriptEntry[] = [];
    const delegate = createMockDelegate();

    const runner = new WorkflowRunner(workflow, adapter, {
      sessionDir,
      onTranscriptEvent: (e: TranscriptEntry) => transcript.push(e),
      profileConfig: profile,
      // delegationDelegate will be used once WorkflowRunner supports it:
      // delegationDelegate: delegate,
    } as any);

    const results = await runner.execute();

    // ── All 8 steps completed ──────────────────────────────────────
    expect(runner.getCompletedSteps().length).toBe(8);
    expect(runner.getCompletedSteps()).toEqual([
      "understand", "design", "challenge", "plan",
      "tasks", "security-review", "stress-test", "synthesize",
    ]);

    // ── Transcript has correct workflow lifecycle events ────────────
    const eventTypes = transcript.map(e => e.type);
    expect(eventTypes).toContain("workflow_start");
    expect(eventTypes).toContain("workflow_end");
    expect(eventTypes.filter(t => t === "step_start").length).toBe(8);
    expect(eventTypes.filter(t => t === "step_end").length).toBe(8);

    // ── 3 gate approvals (understand, design, plan) ────────────────
    const gateResults = transcript.filter(e => e.type === "gate_result");
    expect(gateResults.length).toBe(3);
    for (const gr of gateResults) {
      expect(gr.result).toBe("approved");
    }

    // ── Artifacts were created for steps with output ────────────────
    const artifactWrites = transcript.filter(e => e.type === "artifact_write");
    expect(artifactWrites.length).toBeGreaterThan(0);

    // Each step with an output field should produce an artifact_write event
    const stepsWithOutput = workflow.steps.filter(s => s.output);
    expect(artifactWrites.length).toBe(stepsWithOutput.length);

    // ── Step outputs are in results map ─────────────────────────────
    for (const step of workflow.steps) {
      const key = step.output ?? step.id;
      expect(results.has(key)).toBe(true);
    }

    // ── Delegation behavior (conditional on runner support) ─────────
    if (delegate.calls.length > 0) {
      // Future: WorkflowRunner uses the delegate
      const targetedCalls = delegate.calls.filter((c: any) => c.method === "delegateToAgents");
      expect(targetedCalls.length).toBeGreaterThan(0);

      const tensionCalls = delegate.calls.filter((c: any) => c.method === "delegateTensionPair");
      expect(tensionCalls.length).toBe(1);
      expect(tensionCalls[0].agent1).toBe("architect");
      expect(tensionCalls[0].agent2).toBe("operator");

      const synthCalls = delegate.calls.filter((c: any) => c.method === "delegateToOrchestrator");
      expect(synthCalls.length).toBe(1);
    } else {
      // Current: delegation returns "pending" structured objects
      // Verify that targeted-delegation steps return structured output with delegation: "pending"
      const understandOutput = results.get("requirements_analysis") as any;
      expect(understandOutput).toBeDefined();
      expect(understandOutput.action).toBe("targeted-delegation");
      expect(understandOutput.delegation).toBe("pending");

      // Tension-pair step returns structured output
      const challengeOutput = results.get("revised_architecture") as any;
      expect(challengeOutput).toBeDefined();
      expect(challengeOutput.action).toBe("tension-pair");
      expect(challengeOutput.delegation).toBe("pending");
      expect(challengeOutput.tension_flow).toHaveLength(3);

      // Orchestrator-synthesis step returns structured output
      const synthesizeOutput = results.get("execution_package") as any;
      expect(synthesizeOutput).toBeDefined();
      expect(synthesizeOutput.action).toBe("orchestrator-synthesis");
    }
  });

  it("gates block and re-run on rejection", async () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));

    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-e2e-gates-"));
    const transcript: TranscriptEntry[] = [];

    // First gate: reject once then approve. Others: approve immediately.
    let firstGateCallCount = 0;
    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({ method: "promptConfirm", args: [title, message], timestamp: Date.now() });
      if (message.includes("requirements capture")) {
        firstGateCallCount++;
        return firstGateCallCount > 1; // reject first time, approve second
      }
      return true;
    };

    adapter.promptInput = async (label: string) => {
      adapter.calls.push({ method: "promptInput", args: [label], timestamp: Date.now() });
      return "Please add more detail to the user stories.";
    };

    const runner = new WorkflowRunner(workflow, adapter, {
      sessionDir,
      onTranscriptEvent: (e: TranscriptEntry) => transcript.push(e),
      profileConfig: profile,
    });

    const results = await runner.execute();

    // All 8 steps should still complete
    expect(runner.getCompletedSteps().length).toBe(8);

    // The first gate should have produced 2 gate_result events (rejected + approved)
    const gateResults = transcript.filter(e => e.type === "gate_result");
    const rejections = gateResults.filter(e => e.result === "rejected");
    const approvals = gateResults.filter(e => e.result === "approved");
    expect(rejections.length).toBeGreaterThanOrEqual(1);
    expect(approvals.length).toBe(3);
  });

  it("produces structured output from every step", async () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));

    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-e2e-output-"));

    const runner = new WorkflowRunner(workflow, adapter, {
      sessionDir,
      profileConfig: profile,
    });

    const results = await runner.execute();

    // Every step should have produced output
    expect(results.size).toBeGreaterThanOrEqual(8);

    // No output should be null or undefined
    for (const [key, value] of results) {
      expect(value).toBeDefined();
      expect(value).not.toBeNull();
    }

    // Targeted-delegation outputs should have agent lists
    const reqAnalysis = results.get("requirements_analysis") as any;
    expect(reqAnalysis.agents).toBeDefined();
    expect(reqAnalysis.agents.length).toBeGreaterThan(0);

    // Orchestrator-synthesis output should have synthesis_inputs
    const execPackage = results.get("execution_package") as any;
    expect(execPackage.synthesis_inputs).toBeDefined();
    expect(Object.keys(execPackage.synthesis_inputs).length).toBeGreaterThan(0);
  });

  it("step inputs correctly chain artifacts from previous steps", async () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));

    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-e2e-chain-"));

    const runner = new WorkflowRunner(workflow, adapter, {
      sessionDir,
      profileConfig: profile,
    });

    const results = await runner.execute();

    // The "design" step should have received requirements_analysis as input
    const designOutput = results.get("architecture_decision_record") as any;
    expect(designOutput.inputs).toBeDefined();
    expect(designOutput.inputs["requirements_analysis"]).toBeDefined();

    // The "synthesize" step should have all 6 prior artifacts as synthesis_inputs
    const synthOutput = results.get("execution_package") as any;
    const synthInputKeys = Object.keys(synthOutput.synthesis_inputs);
    expect(synthInputKeys).toContain("requirements_analysis");
    expect(synthInputKeys).toContain("revised_architecture");
    expect(synthInputKeys).toContain("phase_plan");
    expect(synthInputKeys).toContain("task_breakdown");
    expect(synthInputKeys).toContain("risk_assessment");
    expect(synthInputKeys).toContain("stress_test_findings");
  });
});
