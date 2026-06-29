import type { AssemblyMember, DelegationTarget } from "./types";

export type { DelegationTarget };

export interface RoutingResult {
  parallel: string[];
  sequential: string[];
  blocked: boolean;
  neglected: string[];
}

export interface BiasState {
  ratio: number;
  most_addressed: string[];
  least_addressed: string[];
  blocked: boolean;
}

export class DelegationRouter {
  private members: AssemblyMember[];
  private tensionPairs: [string, string][];
  private biasLimit: number;
  private openingRounds: number;
  private callCounts: Map<string, number>;
  private speaksLastAgent: string | null;
  private memberNames: Set<string>;

  constructor(
    members: AssemblyMember[],
    tensionPairs: [string, string][],
    biasLimit: number,
    openingRounds: number,
  ) {
    this.members = members;
    this.tensionPairs = tensionPairs;
    this.biasLimit = biasLimit;
    this.openingRounds = openingRounds;
    this.callCounts = new Map();
    this.memberNames = new Set();

    this.speaksLastAgent = null;
    for (const m of members) {
      this.callCounts.set(m.agent, 0);
      this.memberNames.add(m.agent);
      if (m.structural_advantage === "speaks-last") {
        this.speaksLastAgent = m.agent;
      }
    }
  }

  resolve(target: DelegationTarget, currentRound: number): RoutingResult {
    switch (target.type) {
      case "broadcast":
        return this.resolveBroadcast();
      case "targeted":
        return this.resolveTargeted(target.agents, currentRound);
      case "tension":
        return this.resolveTension(target.pair, currentRound);
    }
  }

  private resolveBroadcast(): RoutingResult {
    const parallel: string[] = [];
    const sequential: string[] = [];

    for (const m of this.members) {
      if (m.agent === this.speaksLastAgent) {
        sequential.push(m.agent);
      } else {
        parallel.push(m.agent);
      }
    }

    // Increment all call counts
    for (const m of this.members) {
      this.callCounts.set(m.agent, (this.callCounts.get(m.agent) ?? 0) + 1);
    }

    return { parallel, sequential, blocked: false, neglected: [] };
  }

  private resolveTargeted(agents: string[], currentRound: number): RoutingResult {
    // Validate agents exist
    for (const agent of agents) {
      if (!this.memberNames.has(agent)) {
        throw new Error(`Unknown agent: ${agent}`);
      }
    }

    // Force broadcast during opening rounds
    if (currentRound <= this.openingRounds) {
      return this.resolveBroadcast();
    }

    // Check bias limit
    const biasCheck = this.wouldExceedBias(agents);
    if (biasCheck.blocked) {
      return {
        parallel: [],
        sequential: [],
        blocked: true,
        neglected: biasCheck.neglected,
      };
    }

    // Increment only addressed agents
    for (const agent of agents) {
      this.callCounts.set(agent, (this.callCounts.get(agent) ?? 0) + 1);
    }

    // No special speaks-last ordering for targeted calls
    return {
      parallel: [...agents],
      sequential: [],
      blocked: false,
      neglected: [],
    };
  }

  private resolveTension(pair: [string, string], currentRound: number): RoutingResult {
    return this.resolveTargeted(pair, currentRound);
  }

  private wouldExceedBias(targetAgents: string[]): { blocked: boolean; neglected: string[] } {
    // Simulate the call: compute what counts would be after
    const simulated = new Map(this.callCounts);
    for (const agent of targetAgents) {
      simulated.set(agent, (simulated.get(agent) ?? 0) + 1);
    }

    // Only consider required agents
    const requiredMembers = this.members.filter((m) => m.required);
    const requiredCounts = requiredMembers.map((m) => simulated.get(m.agent) ?? 0);

    if (requiredCounts.length === 0) {
      return { blocked: false, neglected: [] };
    }

    const maxCount = Math.max(...requiredCounts);
    const minCount = Math.min(...requiredCounts);

    if (minCount === 0) {
      // Don't block when agents haven't been called yet
      return { blocked: false, neglected: [] };
    }

    const ratio = maxCount / minCount;

    if (ratio >= this.biasLimit) {
      const neglected = requiredMembers
        .filter((m) => (simulated.get(m.agent) ?? 0) === minCount)
        .map((m) => m.agent);
      return { blocked: true, neglected };
    }

    return { blocked: false, neglected: [] };
  }

  getCallCounts(): Map<string, number> {
    return new Map(this.callCounts);
  }

  getBiasState(): BiasState {
    const requiredMembers = this.members.filter((m) => m.required);
    const requiredCounts = requiredMembers.map((m) => this.callCounts.get(m.agent) ?? 0);

    if (requiredCounts.length === 0) {
      return { ratio: 1, most_addressed: [], least_addressed: [], blocked: false };
    }

    const maxCount = Math.max(...requiredCounts);
    const minCount = Math.min(...requiredCounts);
    const ratio = minCount === 0 ? (maxCount > 0 ? Infinity : 1) : maxCount / minCount;

    const most_addressed = requiredMembers
      .filter((m) => (this.callCounts.get(m.agent) ?? 0) === maxCount)
      .map((m) => m.agent);

    const least_addressed = requiredMembers
      .filter((m) => (this.callCounts.get(m.agent) ?? 0) === minCount)
      .map((m) => m.agent);

    return {
      ratio,
      most_addressed,
      least_addressed,
      blocked: ratio >= this.biasLimit,
    };
  }
}
