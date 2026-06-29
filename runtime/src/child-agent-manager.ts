import type { AgentHandle, DomainRules, DomainRule } from "./types";
import { DomainEnforcer } from "./domain-enforcer";

interface SpawnCheck {
  allowed: boolean;
  reason?: "max_children_exceeded" | "depth_limit_exceeded";
}

export class ChildAgentManager {
  private maxDepth: number;
  private children: Map<string, AgentHandle[]> = new Map();

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  registerChild(parentId: string, childHandle: AgentHandle): void {
    const existing = this.children.get(parentId) ?? [];
    existing.push(childHandle);
    this.children.set(parentId, existing);
  }

  removeChild(parentId: string, childAgentId: string): void {
    const existing = this.children.get(parentId) ?? [];
    this.children.set(parentId, existing.filter((h) => h.agentId !== childAgentId));
  }

  destroyAllChildren(parentId: string): AgentHandle[] {
    const existing = this.children.get(parentId) ?? [];
    this.children.set(parentId, []);
    return existing;
  }

  getChildren(parentId: string): AgentHandle[] {
    return this.children.get(parentId) ?? [];
  }

  getMaxDepth(): number {
    return this.maxDepth;
  }

  canSpawn(parentId: string, maxChildren: number): SpawnCheck {
    const existing = this.children.get(parentId) ?? [];
    if (existing.length >= maxChildren) {
      return { allowed: false, reason: "max_children_exceeded" };
    }
    return { allowed: true };
  }

  canSpawnAtDepth(currentDepth: number): SpawnCheck {
    if (currentDepth >= this.maxDepth) {
      return { allowed: false, reason: "depth_limit_exceeded" };
    }
    return { allowed: true };
  }

  narrowDomain(parentDomain: DomainRules, childDomain: DomainRules): DomainRules {
    const parentEnforcer = new DomainEnforcer(parentDomain);
    const narrowedRules: DomainRule[] = [];
    for (const childRule of childDomain.rules) {
      // Test a representative path for each child rule pattern
      const testPath = childRule.path.replace(/\*\*/g, "test").replace(/\*/g, "test");
      const parentRead = parentEnforcer.checkFileAccess(testPath, "read");
      const parentWrite = parentEnforcer.checkFileAccess(testPath, "write");
      const parentDelete = parentEnforcer.checkFileAccess(testPath, "delete");
      narrowedRules.push({
        path: childRule.path,
        read: childRule.read && parentRead.allowed,
        write: childRule.write && parentWrite.allowed,
        delete: childRule.delete && parentDelete.allowed,
      });
    }
    return {
      rules: narrowedRules,
      tool_allowlist: childDomain.tool_allowlist,
      tool_denylist: childDomain.tool_denylist,
      bash_restrictions: childDomain.bash_restrictions,
    };
  }
}
