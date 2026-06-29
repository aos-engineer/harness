import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { loadProfile, loadWorkflow, loadAgent } from "../src/config-loader";

const coreDir = join(import.meta.dir, "..", "..", "core");

describe("CTO Execution Profile Integration", () => {
  it("loads the CTO execution profile", () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    expect(profile.id).toBe("cto-execution");
    expect(profile.workflow).toBe("cto-execution-workflow");
    expect(profile.output.format).toBe("execution-package");
  });

  it("loads the CTO orchestrator agent", () => {
    const agent = loadAgent(join(coreDir, "agents", "orchestrators", "cto-orchestrator"));
    expect(agent.id).toBe("cto-orchestrator");
    expect(agent.cognition.core_bias).toBe("execution-quality");
  });

  it("loads the CTO execution workflow with 8 steps", () => {
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));
    expect(workflow.id).toBe("cto-execution-workflow");
    expect(workflow.steps.length).toBe(8);
  });

  it("workflow has 3 review gates with retry_with_feedback", () => {
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));
    expect(workflow.gates.length).toBe(3);
    for (const gate of workflow.gates) {
      expect(gate.on_rejection).toBe("retry_with_feedback");
    }
  });

  it("all workflow step agents exist in profile assembly", () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));

    const assemblyAgents = profile.assembly.perspectives.map((p: any) => p.agent);

    for (const step of workflow.steps) {
      if (step.agents) {
        for (const agentId of step.agents) {
          expect(assemblyAgents).toContain(agentId);
        }
      }
    }
  });

  it("all workflow input references are valid output IDs", () => {
    const workflow = loadWorkflow(join(coreDir, "workflows", "cto-execution.workflow.yaml"));
    const outputs = new Set<string>();

    for (const step of workflow.steps) {
      // Check inputs before adding this step's output
      if (step.input) {
        for (const ref of step.input) {
          expect(outputs.has(ref)).toBe(true);
        }
      }
      if (step.output) outputs.add(step.output);
    }
  });

  it("profile has role_override on all required perspectives", () => {
    const profile = loadProfile(join(coreDir, "profiles", "cto-execution"));
    const required = profile.assembly.perspectives.filter((p: any) => p.required);
    for (const p of required) {
      expect(p.role_override).toBeDefined();
      expect(typeof p.role_override).toBe("string");
      expect(p.role_override!.length).toBeGreaterThan(0);
    }
  });

  it("existing strategic-council profile still loads correctly", () => {
    const profile = loadProfile(join(coreDir, "profiles", "strategic-council"));
    expect(profile.id).toBe("strategic-council");
    // workflow should be null or undefined (deliberation mode)
    expect(profile.workflow).toBeNull();
  });

  it("existing arbiter agent still loads correctly", () => {
    const agent = loadAgent(join(coreDir, "agents", "orchestrators", "arbiter"));
    expect(agent.id).toBe("arbiter");
  });
});
