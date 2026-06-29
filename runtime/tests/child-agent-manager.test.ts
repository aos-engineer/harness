import { describe, it, expect } from "bun:test";
import { ChildAgentManager } from "../src/child-agent-manager";
import type { AgentHandle, DomainRules } from "../src/types";

describe("ChildAgentManager", () => {
  it("tracks spawned children", () => {
    const m = new ChildAgentManager(2);
    m.registerChild("p", { id: "h1", agentId: "c1", sessionId: "s", parentAgentId: "p", depth: 1 });
    expect(m.getChildren("p")).toHaveLength(1);
  });

  it("enforces max_children", () => {
    const m = new ChildAgentManager(2);
    m.registerChild("p", { id: "h1", agentId: "c1", sessionId: "s", parentAgentId: "p", depth: 1 });
    m.registerChild("p", { id: "h2", agentId: "c2", sessionId: "s", parentAgentId: "p", depth: 1 });
    expect(m.canSpawn("p", 2).allowed).toBe(false);
    expect(m.canSpawn("p", 2).reason).toBe("max_children_exceeded");
  });

  it("enforces depth limit", () => {
    const m = new ChildAgentManager(2);
    expect(m.canSpawnAtDepth(2).allowed).toBe(false);
    expect(m.canSpawnAtDepth(2).reason).toBe("depth_limit_exceeded");
  });

  it("allows spawn within limits", () => {
    const m = new ChildAgentManager(2);
    expect(m.canSpawn("p", 3).allowed).toBe(true);
    expect(m.canSpawnAtDepth(1).allowed).toBe(true);
  });

  it("removes child", () => {
    const m = new ChildAgentManager(2);
    m.registerChild("p", { id: "h1", agentId: "c1", sessionId: "s", parentAgentId: "p", depth: 1 });
    m.removeChild("p", "c1");
    expect(m.getChildren("p")).toHaveLength(0);
  });

  it("destroys all children", () => {
    const m = new ChildAgentManager(2);
    m.registerChild("p", { id: "h1", agentId: "c1", sessionId: "s", parentAgentId: "p", depth: 1 });
    m.registerChild("p", { id: "h2", agentId: "c2", sessionId: "s", parentAgentId: "p", depth: 1 });
    const destroyed = m.destroyAllChildren("p");
    expect(destroyed).toHaveLength(2);
    expect(m.getChildren("p")).toHaveLength(0);
  });

  it("narrows child domain within parent constraints", () => {
    const m = new ChildAgentManager(2);
    const parent: DomainRules = { rules: [{ path: "src/**", read: true, write: true, delete: false }] };
    const child: DomainRules = { rules: [{ path: "src/api/**", read: true, write: true, delete: true }] };
    const result = m.narrowDomain(parent, child);
    expect(result.rules[0].delete).toBe(false); // parent denies delete
    expect(result.rules[0].write).toBe(true); // parent allows write
  });

  it("returns empty array for unknown parent", () => {
    const m = new ChildAgentManager(2);
    expect(m.getChildren("nonexistent")).toEqual([]);
  });
});
