# Phase 2: Hierarchical Delegation & File Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agents to spawn and manage sub-agents (depth-2+ delegation) and track file changes across agent activity.

**Architecture:** Extends L1 (AgentRuntimeAdapter) with `spawnSubAgent`/`destroySubAgent`. Engine manages parent-child relationships, domain inheritance, and depth tracking. L4 gains file change emission via post-tool hooks.

**Tech Stack:** TypeScript, Bun test runner

**Spec:** `docs/specs/2026-04-10-harness-enhanced-capabilities-design.md` — Sections 1 (Hierarchical Delegation), 4D (File Change Tracking)

---

## File Map

### Harness — New Files
| File | Responsibility |
|---|---|
| `runtime/src/child-agent-manager.ts` | Manages parent-child relationships, depth tracking, domain inheritance, spawn/destroy lifecycle |
| `runtime/tests/child-agent-manager.test.ts` | Unit tests for ChildAgentManager |

### Harness — Modified Files
| File | Change |
|---|---|
| `runtime/src/types.ts` | Add `ChildAgentConfig`, `SpawnResult`, `MessageChildResult`, extend `AgentHandle` with optional `parentAgentId` and `depth`, add `spawnSubAgent`/`destroySubAgent` to `AgentRuntimeAdapter`, add `FileChangeEvent` type |
| `runtime/src/engine.ts` | Integrate ChildAgentManager, add `spawnChildAgent`/`destroyChildAgent`/`messageChild` public methods, emit hierarchical events |
| `runtime/tests/mock-adapter.ts` | Add `spawnSubAgent`/`destroySubAgent` stubs |
| `runtime/tests/engine.test.ts` | Add hierarchical delegation tests |

---

## Task 1: Add Hierarchical Types to Runtime

**Files:**
- Modify: `runtime/src/types.ts`
- Test: `runtime/tests/types.test.ts`

- [ ] **Step 1: Write failing test for new types**

Append to `runtime/tests/types.test.ts`:

```typescript
describe("Hierarchical delegation types", () => {
  it("ChildAgentConfig compiles", () => {
    const config: import("../src/types").ChildAgentConfig = {
      name: "backend-dev",
      role: "Implements backend tasks",
      modelTier: "economy",
      systemPrompt: "You are a backend developer.",
      domainRules: {
        rules: [{ path: "src/api/**", read: true, write: true, delete: false }],
      },
      timeout: 120,
    };
    expect(config.name).toBe("backend-dev");
  });

  it("SpawnResult compiles with success and error", () => {
    const ok: import("../src/types").SpawnResult =
      { success: true, childAgentId: "child-1" };
    const depthErr: import("../src/types").SpawnResult =
      { success: false, error: "depth_limit_exceeded", currentDepth: 2, maxDepth: 2, suggestion: "execute_directly" };
    const maxErr: import("../src/types").SpawnResult =
      { success: false, error: "max_children_exceeded", active: 3, max: 3 };
    expect(ok.success).toBe(true);
    expect(depthErr.error).toBe("depth_limit_exceeded");
    expect(maxErr.error).toBe("max_children_exceeded");
  });

  it("AgentHandle accepts optional parentAgentId and depth", () => {
    const handle: import("../src/types").AgentHandle = {
      id: "h1", agentId: "child-1", sessionId: "s1",
      parentAgentId: "parent-1", depth: 1,
    };
    expect(handle.parentAgentId).toBe("parent-1");
    expect(handle.depth).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/types.test.ts`
Expected: FAIL — new types don't exist

- [ ] **Step 3: Add types to runtime/src/types.ts**

After the `DelegationConfig` interface (~line 113), add:

```typescript
// ── Child Agent Types ──────────────────────────────────────────

export interface ChildAgentConfig {
  name: string;
  role: string;
  modelTier?: ModelTier;
  systemPrompt?: string;
  domainRules?: DomainRules;
  timeout?: number;
}

export type SpawnResult =
  | { success: true; childAgentId: string }
  | { success: false; error: "depth_limit_exceeded"; currentDepth: number; maxDepth: number; suggestion: "execute_directly" }
  | { success: false; error: "max_children_exceeded"; active: number; max: number }
  | { success: false; error: "child_not_found"; childAgentId: string }
  | { success: false; error: "child_timeout"; childAgentId: string; elapsed_seconds: number; partial_response?: string };

export interface MessageChildResult {
  response: string;
  cost: TokenUsage;
}

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  model: string;
}

export interface FileChangeEvent {
  agentId: string;
  path: string;
  operation: "created" | "modified" | "deleted";
  diffSnippet?: string;
}
```

Extend `AgentHandle` to add optional fields:

```typescript
export interface AgentHandle {
  id: string;
  agentId: string;
  sessionId: string;
  parentAgentId?: string;  // NEW
  depth?: number;          // NEW — 0 for top-level, 1 for children, 2 for grandchildren
}
```

Add to `AgentRuntimeAdapter` interface (after `abort()`):

```typescript
  spawnSubAgent(parentId: string, config: ChildAgentConfig, sessionId: string): Promise<AgentHandle>;
  destroySubAgent(parentId: string, childId: string): Promise<void>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test runtime/tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: FAIL — MockAdapter doesn't implement new methods yet (that's Task 2)

- [ ] **Step 6: Commit types only**

```bash
git add runtime/src/types.ts runtime/tests/types.test.ts
git commit -m "feat(types): add hierarchical delegation and file tracking types

ChildAgentConfig, SpawnResult, MessageChildResult, TokenUsage,
FileChangeEvent. Extend AgentHandle with parentAgentId and depth.
Add spawnSubAgent/destroySubAgent to AgentRuntimeAdapter."
```

---

## Task 2: Update MockAdapter with Sub-Agent Methods

**Files:**
- Modify: `runtime/tests/mock-adapter.ts`

- [ ] **Step 1: Add spawnSubAgent and destroySubAgent to MockAdapter**

Import the new types at top (add to existing import):
```typescript
import type { ChildAgentConfig } from "../src/types";
```

Add to the AgentRuntimeAdapter section of MockAdapter (after `abort()`):

```typescript
  async spawnSubAgent(parentId: string, config: ChildAgentConfig, sessionId: string): Promise<AgentHandle> {
    this.record("spawnSubAgent", parentId, config.name, sessionId);
    const handle: AgentHandle = {
      id: `handle-${this.nextId++}`,
      agentId: config.name,
      sessionId,
      parentAgentId: parentId,
      depth: 1,
    };
    return handle;
  }

  async destroySubAgent(parentId: string, childId: string): Promise<void> {
    this.record("destroySubAgent", parentId, childId);
  }
```

- [ ] **Step 2: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add runtime/tests/mock-adapter.ts
git commit -m "test: add spawnSubAgent/destroySubAgent to MockAdapter"
```

---

## Task 3: Implement ChildAgentManager

**Files:**
- Create: `runtime/src/child-agent-manager.ts`
- Create: `runtime/tests/child-agent-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// runtime/tests/child-agent-manager.test.ts
import { describe, it, expect } from "bun:test";
import { ChildAgentManager } from "../src/child-agent-manager";
import type { AgentHandle, DomainRules, DelegationConfig } from "../src/types";

describe("ChildAgentManager", () => {
  const parentDelegation: DelegationConfig = {
    can_spawn: true,
    max_children: 2,
    child_model_tier: "economy",
    child_timeout_seconds: 120,
    delegation_style: "delegate-and-execute",
  };
  const parentDomain: DomainRules = {
    rules: [
      { path: "src/**", read: true, write: true, delete: false },
      { path: "tests/**", read: true, write: true, delete: false },
    ],
  };

  it("tracks spawned children", () => {
    const manager = new ChildAgentManager(2); // maxDepth = 2
    const handle: AgentHandle = { id: "h1", agentId: "child-1", sessionId: "s1", parentAgentId: "parent", depth: 1 };
    manager.registerChild("parent", handle);
    expect(manager.getChildren("parent")).toHaveLength(1);
    expect(manager.getChildren("parent")[0].agentId).toBe("child-1");
  });

  it("enforces max_children limit", () => {
    const manager = new ChildAgentManager(2);
    manager.registerChild("parent", { id: "h1", agentId: "c1", sessionId: "s1", parentAgentId: "parent", depth: 1 });
    manager.registerChild("parent", { id: "h2", agentId: "c2", sessionId: "s1", parentAgentId: "parent", depth: 1 });
    const result = manager.canSpawn("parent", 2); // maxChildren = 2
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("max_children_exceeded");
  });

  it("enforces depth limit", () => {
    const manager = new ChildAgentManager(2); // maxDepth = 2
    const result = manager.canSpawnAtDepth(2); // already at max depth
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("depth_limit_exceeded");
  });

  it("allows spawn when within limits", () => {
    const manager = new ChildAgentManager(2);
    expect(manager.canSpawn("parent", 3).allowed).toBe(true); // 0 children, max 3
    expect(manager.canSpawnAtDepth(1).allowed).toBe(true); // depth 1, max 2
  });

  it("removes child on destroy", () => {
    const manager = new ChildAgentManager(2);
    const handle: AgentHandle = { id: "h1", agentId: "c1", sessionId: "s1", parentAgentId: "parent", depth: 1 };
    manager.registerChild("parent", handle);
    expect(manager.getChildren("parent")).toHaveLength(1);
    manager.removeChild("parent", "c1");
    expect(manager.getChildren("parent")).toHaveLength(0);
  });

  it("destroys all children of a parent", () => {
    const manager = new ChildAgentManager(2);
    manager.registerChild("parent", { id: "h1", agentId: "c1", sessionId: "s1", parentAgentId: "parent", depth: 1 });
    manager.registerChild("parent", { id: "h2", agentId: "c2", sessionId: "s1", parentAgentId: "parent", depth: 1 });
    const destroyed = manager.destroyAllChildren("parent");
    expect(destroyed).toHaveLength(2);
    expect(manager.getChildren("parent")).toHaveLength(0);
  });

  it("narrows parent domain rules for child", () => {
    const manager = new ChildAgentManager(2);
    const childDomain: DomainRules = {
      rules: [
        { path: "src/api/**", read: true, write: true, delete: false },
      ],
    };
    const result = manager.narrowDomain(parentDomain, childDomain);
    // Child rule is within parent's src/** so it should be allowed
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].path).toBe("src/api/**");
  });

  it("rejects child domain rules that widen parent permissions", () => {
    const manager = new ChildAgentManager(2);
    const childDomain: DomainRules = {
      rules: [
        { path: "src/api/**", read: true, write: true, delete: true }, // parent denies delete!
      ],
    };
    const result = manager.narrowDomain(parentDomain, childDomain);
    // delete should be narrowed to false since parent denies it
    expect(result.rules[0].delete).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/child-agent-manager.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement ChildAgentManager**

```typescript
// runtime/src/child-agent-manager.ts
import type { AgentHandle, DomainRules, DomainRule } from "./types";
import { DomainEnforcer } from "./domain-enforcer";

interface SpawnCheck {
  allowed: boolean;
  reason?: "max_children_exceeded" | "depth_limit_exceeded";
}

export class ChildAgentManager {
  private maxDepth: number;
  private children: Map<string, AgentHandle[]> = new Map(); // parentId -> children

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

  /**
   * Narrow child domain rules to be within parent's permissions.
   * Child can only restrict, never widen, parent's rules.
   * Each child rule's permissions are ANDed with the parent's
   * matching rule permissions.
   */
  narrowDomain(parentDomain: DomainRules, childDomain: DomainRules): DomainRules {
    const parentEnforcer = new DomainEnforcer(parentDomain);
    const narrowedRules: DomainRule[] = [];

    for (const childRule of childDomain.rules) {
      // For each permission, AND with what parent allows on that path
      const parentRead = parentEnforcer.checkFileAccess(childRule.path.replace(/\*\*/g, "test"), "read");
      const parentWrite = parentEnforcer.checkFileAccess(childRule.path.replace(/\*\*/g, "test"), "write");
      const parentDelete = parentEnforcer.checkFileAccess(childRule.path.replace(/\*\*/g, "test"), "delete");

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd aos-harness && bun test runtime/tests/child-agent-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Export from package.json**

Add to `runtime/package.json` exports:
```json
"./child-agent-manager": "./src/child-agent-manager.ts"
```

- [ ] **Step 6: Run full suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add runtime/src/child-agent-manager.ts runtime/tests/child-agent-manager.test.ts runtime/package.json
git commit -m "feat(runtime): implement ChildAgentManager

Manages parent-child agent relationships, depth tracking,
max_children enforcement, and domain rule narrowing.
Children can only restrict parent permissions, never widen."
```

---

## Task 4: Integrate Hierarchical Delegation into AOSEngine

**Files:**
- Modify: `runtime/src/engine.ts`
- Test: `runtime/tests/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `runtime/tests/engine.test.ts`:

```typescript
describe("AOSEngine — hierarchical delegation", () => {
  it("spawnChildAgent returns error when agent has no delegation config", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(adapter, testProfileDir, {
      agentsDir: testAgentsDir,
      onTranscriptEvent: () => {},
    });
    const result = await engine.spawnChildAgent("arbiter", {
      name: "worker-1",
      role: "test worker",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it("getChildAgents returns empty array for agents with no children", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(adapter, testProfileDir, {
      agentsDir: testAgentsDir,
      onTranscriptEvent: () => {},
    });
    expect(engine.getChildAgents("arbiter")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/engine.test.ts`
Expected: FAIL — spawnChildAgent doesn't exist

- [ ] **Step 3: Add spawnChildAgent, destroyChildAgent, getChildAgents to AOSEngine**

In `runtime/src/engine.ts`:

Import at top:
```typescript
import { ChildAgentManager } from "./child-agent-manager";
import type { ChildAgentConfig, SpawnResult, AgentHandle } from "./types";
```

Add private field:
```typescript
private childAgentManager: ChildAgentManager;
```

Initialize in constructor (after domain enforcers):
```typescript
this.childAgentManager = new ChildAgentManager(
  this.profile.delegation?.max_depth ?? 2
);
```

Note: `max_depth` doesn't exist on `ProfileConfig` yet. Add it to the profile config delegation section in types.ts:
```typescript
// In ProfileConfig.delegation, add:
max_delegation_depth?: number;
```

Then in the constructor use:
```typescript
this.childAgentManager = new ChildAgentManager(
  this.profile.delegation?.max_delegation_depth ?? 2
);
```

Add public methods:

```typescript
async spawnChildAgent(parentAgentId: string, childConfig: ChildAgentConfig): Promise<SpawnResult> {
  const parentAgent = this.agents.get(parentAgentId);
  if (!parentAgent?.delegation?.can_spawn) {
    return { success: false, error: "depth_limit_exceeded", currentDepth: 0, maxDepth: 0, suggestion: "execute_directly" };
  }

  const parentHandle = this.handles.get(parentAgentId);
  const parentDepth = parentHandle?.depth ?? 0;

  // Check depth limit
  const depthCheck = this.childAgentManager.canSpawnAtDepth(parentDepth + 1);
  if (!depthCheck.allowed) {
    return {
      success: false,
      error: "depth_limit_exceeded",
      currentDepth: parentDepth,
      maxDepth: this.childAgentManager["maxDepth"],
      suggestion: "execute_directly",
    };
  }

  // Check max children
  const childCheck = this.childAgentManager.canSpawn(parentAgentId, parentAgent.delegation.max_children);
  if (!childCheck.allowed) {
    const children = this.childAgentManager.getChildren(parentAgentId);
    return {
      success: false,
      error: "max_children_exceeded",
      active: children.length,
      max: parentAgent.delegation.max_children,
    };
  }

  // Narrow domain rules if parent has domain
  let childDomain = childConfig.domainRules;
  if (parentAgent.domain && childDomain) {
    childDomain = this.childAgentManager.narrowDomain(parentAgent.domain, childDomain);
  } else if (parentAgent.domain) {
    childDomain = parentAgent.domain; // inherit parent's domain
  }

  // Spawn via adapter
  const handle = await this.adapter.spawnSubAgent(
    parentAgentId,
    { ...childConfig, domainRules: childDomain },
    this.sessionId,
  );
  handle.parentAgentId = parentAgentId;
  handle.depth = parentDepth + 1;

  // Track
  this.childAgentManager.registerChild(parentAgentId, handle);
  this.handles.set(handle.agentId, handle);

  // Build domain enforcer for child if it has domain rules
  if (childDomain) {
    this.domainEnforcers.set(handle.agentId, new DomainEnforcer(childDomain));
  }

  // Emit event
  this.pushTranscript({
    type: "agent_spawned",
    timestamp: new Date().toISOString(),
    parentAgentId,
    childAgentId: handle.agentId,
    depth: handle.depth,
  });

  return { success: true, childAgentId: handle.agentId };
}

async destroyChildAgent(parentAgentId: string, childAgentId: string): Promise<void> {
  const childHandle = this.handles.get(childAgentId);
  if (childHandle) {
    await this.adapter.destroySubAgent(parentAgentId, childAgentId);
    this.childAgentManager.removeChild(parentAgentId, childAgentId);
    this.handles.delete(childAgentId);
    this.domainEnforcers.delete(childAgentId);

    this.pushTranscript({
      type: "agent_destroyed",
      timestamp: new Date().toISOString(),
      parentAgentId,
      childAgentId,
      reason: "explicit_destroy",
    });
  }
}

getChildAgents(parentAgentId: string): AgentHandle[] {
  return this.childAgentManager.getChildren(parentAgentId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd aos-harness && bun test runtime/tests/engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add runtime/src/engine.ts runtime/src/types.ts runtime/tests/engine.test.ts
git commit -m "feat(runtime): add hierarchical delegation to AOSEngine

spawnChildAgent enforces depth limits and max_children, narrows
parent domain rules, emits agent_spawned events. destroyChildAgent
cleans up handles and enforcers. getChildAgents returns current
children for a parent."
```

---

## Task 5: Final Verification

- [ ] **Step 1: Run harness tests**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 2: Verify git status clean**

Run: `cd aos-harness && git status`
Expected: Clean working tree
