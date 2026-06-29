import { describe, it, expect } from "bun:test";
import { mergeDomainOverlay } from "../src/domain-merger";
import type { AgentConfig, DomainOverlay } from "../src/types";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    schema: "aos/agent/v1",
    id: "test-agent",
    name: "Test Agent",
    role: "Test role",
    cognition: {
      objective_function: "test",
      time_horizon: { primary: "now", secondary: "later", peripheral: "never" },
      core_bias: "testing",
      risk_tolerance: "moderate",
      default_stance: "test stance",
    },
    persona: {
      temperament: ["calm"],
      thinking_patterns: ["base pattern"],
      heuristics: [{ name: "Base Heuristic", rule: "base rule" }],
      evidence_standard: { convinced_by: ["data"], not_convinced_by: ["vibes"] },
      red_lines: ["base red line"],
    },
    tensions: [],
    report: { structure: "test" },
    tools: null,
    skills: [],
    expertise: [],
    model: { tier: "standard", thinking: "off" },
    ...overrides,
  };
}

describe("mergeDomainOverlay", () => {
  it("appends thinking patterns", () => {
    const agent = makeAgent();
    const overlay: DomainOverlay = { thinking_patterns: ["domain pattern"] };
    const result = mergeDomainOverlay(agent, overlay);
    expect(result.persona.thinking_patterns).toEqual(["base pattern", "domain pattern"]);
  });

  it("appends heuristics (no dedup by name)", () => {
    const agent = makeAgent();
    const overlay: DomainOverlay = {
      heuristics: [{ name: "Base Heuristic", rule: "domain rule" }],
    };
    const result = mergeDomainOverlay(agent, overlay);
    expect(result.persona.heuristics).toHaveLength(2);
    expect(result.persona.heuristics[1].rule).toBe("domain rule");
  });

  it("appends red lines", () => {
    const agent = makeAgent();
    const overlay: DomainOverlay = { red_lines: ["domain red line"] };
    const result = mergeDomainOverlay(agent, overlay);
    expect(result.persona.red_lines).toEqual(["base red line", "domain red line"]);
  });

  it("appends evidence_standard.convinced_by", () => {
    const agent = makeAgent();
    const overlay: DomainOverlay = {
      evidence_standard: { convinced_by: ["domain data"] },
    };
    const result = mergeDomainOverlay(agent, overlay);
    expect(result.persona.evidence_standard.convinced_by).toEqual(["data", "domain data"]);
  });

  it("appends temperament", () => {
    const agent = makeAgent();
    const overlay: DomainOverlay = { temperament: ["assertive"] };
    const result = mergeDomainOverlay(agent, overlay);
    expect(result.persona.temperament).toEqual(["calm", "assertive"]);
  });

  it("does not mutate the original agent", () => {
    const agent = makeAgent();
    const original = agent.persona.thinking_patterns.length;
    mergeDomainOverlay(agent, { thinking_patterns: ["new"] });
    expect(agent.persona.thinking_patterns).toHaveLength(original);
  });

  it("handles empty overlay", () => {
    const agent = makeAgent();
    const result = mergeDomainOverlay(agent, {});
    expect(result.persona.thinking_patterns).toEqual(["base pattern"]);
  });

  it("never removes agent-level config", () => {
    const agent = makeAgent();
    const overlay: DomainOverlay = {
      thinking_patterns: [],
      heuristics: [],
      red_lines: [],
    };
    const result = mergeDomainOverlay(agent, overlay);
    expect(result.persona.thinking_patterns).toEqual(["base pattern"]);
    expect(result.persona.heuristics).toHaveLength(1);
    expect(result.persona.red_lines).toEqual(["base red line"]);
  });
});
