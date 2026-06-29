import { describe, it, expect } from "bun:test";
import { DelegationRouter } from "../src/delegation-router";
import type { AssemblyMember } from "../src/types";

const members: AssemblyMember[] = [
  { agent: "catalyst", required: true },
  { agent: "sentinel", required: true },
  { agent: "architect", required: true },
  { agent: "provocateur", required: true, structural_advantage: "speaks-last" },
  { agent: "navigator", required: false },
];

const tensionPairs: [string, string][] = [
  ["catalyst", "sentinel"],
  ["architect", "navigator"],
];

describe("DelegationRouter", () => {
  it("broadcast resolves to all required agents except speaks-last", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    const result = router.resolve({ type: "broadcast" }, 1);
    expect(result.parallel).toEqual(["catalyst", "sentinel", "architect", "navigator"]);
    expect(result.sequential).toEqual(["provocateur"]);
  });

  it("targeted resolves to specific agents", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    const result = router.resolve({ type: "targeted", agents: ["catalyst", "sentinel"] }, 2);
    expect(result.parallel).toEqual(["catalyst", "sentinel"]);
    expect(result.sequential).toEqual([]);
  });

  it("targeted to speaks-last agent works normally (no special ordering)", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    const result = router.resolve({ type: "targeted", agents: ["provocateur"] }, 2);
    expect(result.parallel).toEqual(["provocateur"]);
    expect(result.sequential).toEqual([]);
  });

  it("tension pair resolves to the two agents", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    const result = router.resolve({ type: "tension", pair: ["catalyst", "sentinel"] }, 2);
    expect(result.parallel).toEqual(["catalyst", "sentinel"]);
  });

  it("tracks call counts correctly", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    router.resolve({ type: "broadcast" }, 1);
    const counts = router.getCallCounts();
    expect(counts.get("catalyst")).toBe(1);
    expect(counts.get("provocateur")).toBe(1);
  });

  it("targeted calls increment only addressed agents", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    router.resolve({ type: "broadcast" }, 1); // all get 1
    router.resolve({ type: "targeted", agents: ["catalyst"] }, 2); // catalyst gets 2
    const counts = router.getCallCounts();
    expect(counts.get("catalyst")).toBe(2);
    expect(counts.get("sentinel")).toBe(1);
  });

  it("blocks targeted calls when bias limit exceeded", () => {
    const router = new DelegationRouter(members, tensionPairs, 2, 1); // bias_limit=2
    router.resolve({ type: "broadcast" }, 1); // all at 1
    router.resolve({ type: "targeted", agents: ["catalyst"] }, 2); // catalyst at 2
    const result = router.resolve({ type: "targeted", agents: ["catalyst"] }, 3);
    expect(result.blocked).toBe(true);
    expect(result.neglected).toContain("sentinel");
  });

  it("bias ratio only considers required agents", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    router.resolve({ type: "broadcast" }, 1); // all at 1
    router.resolve({ type: "targeted", agents: ["navigator"] }, 2); // optional at 2
    const bias = router.getBiasState();
    expect(bias.ratio).toBe(1);
  });

  it("getBiasState returns most and least addressed", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    router.resolve({ type: "broadcast" }, 1);
    router.resolve({ type: "targeted", agents: ["catalyst", "sentinel"] }, 2);
    const bias = router.getBiasState();
    expect(bias.most_addressed).toContain("catalyst");
    expect(bias.least_addressed).toContain("architect");
  });

  it("forces broadcast during opening rounds even if targeted", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 2); // opening_rounds=2
    const result = router.resolve({ type: "targeted", agents: ["catalyst"] }, 1);
    expect(result.parallel).toContain("sentinel");
    expect(result.parallel).toContain("architect");
  });

  it("allows targeted after opening rounds", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1); // opening_rounds=1
    const result = router.resolve({ type: "targeted", agents: ["catalyst"] }, 2);
    expect(result.parallel).toEqual(["catalyst"]);
  });

  it("throws on unknown agent in targeted call", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    expect(() => {
      router.resolve({ type: "targeted", agents: ["nonexistent"] }, 1);
    }).toThrow("Unknown agent");
  });
});
