import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadAgent, loadProfile, loadWorkflow } from "../src/config-loader";

const coreDir = join(import.meta.dir, "..", "..", "core");

describe("Artifact generation profile integration", () => {
  it("loads the design-variations profile with artifact-gallery output", () => {
    const profile = loadProfile(join(coreDir, "profiles", "design-variations"));
    expect(profile.id).toBe("design-variations");
    expect(profile.output.format).toBe("artifact-gallery");
    expect(profile.runtime_requirements).toEqual({
      serve: false,
      channels: false,
      mempalace: false,
      a2a_serve: false,
    });
    expect(profile.workflow).toBe("design-variations-workflow");
  });

  it("loads the artifact-renderer agent with html output capability", () => {
    const agent = loadAgent(join(coreDir, "agents", "perspectives", "artifact-renderer"));
    expect(agent.id).toBe("artifact-renderer");
    expect(agent.capabilities?.can_produce_files).toBe(true);
    expect(agent.capabilities?.can_serve_artifacts).toBe(true);
    expect(agent.capabilities?.output_types).toContain("html");
  });

  it("loads the design-variations workflow", () => {
    const workflow = loadWorkflow(join(coreDir, "workflows", "design-variations.workflow.yaml"));
    expect(workflow.id).toBe("design-variations-workflow");
    expect(workflow.steps.map((step) => step.id)).toEqual([
      "brief-expansion",
      "render-gallery",
      "accessibility-review",
    ]);
    expect(workflow.gates[0]?.after).toBe("brief-expansion");
  });
});
