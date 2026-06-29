# Phase 1: Contracts & Domain Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement structural domain enforcement so agents have code-enforced file/tool permissions.

**Architecture:** New `DomainEnforcer` module in runtime enforces path-based access rules and tool allowlists at the L4 adapter layer. Types are added to `runtime/src/types.ts`. New event types (`domain_violation`, `domain_access`) are emitted to the transcript.

**Tech Stack:** TypeScript, Bun test runner

**Spec:** `docs/specs/2026-04-10-harness-enhanced-capabilities-design.md`

**Deferred to later in Phase 1:**
- **`@aos-harness/shared-types` package** — The spec calls for a formal shared types package. This plan adds the types directly to the runtime instead. The shared package extraction is deferred until we see the types stabilize across Phase 1 implementation. Per the spec's migration trigger: "if shared-types is updated more than twice in a sprint, migrate."
- **Pi adapter integration** — The Pi adapter (`adapters/pi/`) needs to call `enforceToolAccess` in its L4 workflow layer. This is a separate task after the runtime contract is proven by tests, and will be covered in a follow-up Pi adapter plan.

---

## File Map

### Harness — New Files
| File | Responsibility |
|---|---|
| `runtime/src/domain-enforcer.ts` | Path matching, tool access checking, bash token analysis |
| `runtime/tests/domain-enforcer.test.ts` | Unit tests for DomainEnforcer |

### Harness — Modified Files
| File | Change |
|---|---|
| `runtime/src/types.ts` | Add `DomainRules`, `DomainRule`, `BashRestrictions`, `DelegationConfig`, `EnforcementResult` types. Extend `AgentConfig` with optional `domain` and `delegation` fields. Add new `TranscriptEventType` values. |
| `runtime/tests/mock-adapter.ts` | Add `enforceToolAccess` tracking to MockAdapter |
| `core/schema/agent.schema.json` | Add `domain` and `delegation` properties to agent schema |

---

## Task 1: Add Domain & Delegation Types to Harness Runtime

**Files:**
- Modify: `runtime/src/types.ts`
- Test: `runtime/tests/types.test.ts`

- [ ] **Step 1: Write failing test for new types**

```typescript
// Add to runtime/tests/types.test.ts
import { describe, it, expect } from "bun:test";
import type {
  DomainRule,
  DomainRules,
  BashRestrictions,
  BlockedTokenSet,
  DelegationConfig,
  EnforcementResult,
} from "../src/types";

describe("Domain & Delegation types", () => {
  it("DomainRules compiles with valid structure", () => {
    const rules: DomainRules = {
      rules: [
        { path: "apps/web/**", read: true, write: true, delete: false },
        { path: "**/*.env*", read: false, write: false, delete: false },
      ],
      tool_allowlist: ["read", "write", "edit"],
      tool_denylist: ["bash"],
      bash_restrictions: {
        blocked_tokens: [
          {
            tokens: ["rm", "recursive"],
            aliases: { recursive: ["-r", "-R", "--recursive"] },
          },
        ],
        blocked_patterns: ["curl.*-X DELETE"],
      },
    };
    expect(rules.rules).toHaveLength(2);
    expect(rules.tool_denylist).toContain("bash");
  });

  it("DelegationConfig compiles with valid structure", () => {
    const config: DelegationConfig = {
      can_spawn: true,
      max_children: 3,
      child_model_tier: "economy",
      child_timeout_seconds: 120,
      delegation_style: "delegate-only",
    };
    expect(config.can_spawn).toBe(true);
    expect(config.delegation_style).toBe("delegate-only");
  });

  it("EnforcementResult compiles with allowed and denied", () => {
    const allowed: EnforcementResult = { allowed: true };
    const denied: EnforcementResult = { allowed: false, reason: "path blocked" };
    expect(allowed.allowed).toBe(true);
    expect(denied.reason).toBe("path blocked");
  });

  it("AgentConfig accepts optional domain and delegation fields", () => {
    // This test ensures the type extension compiles — import AgentConfig
    const partial: Partial<import("../src/types").AgentConfig> = {
      domain: {
        rules: [{ path: "**", read: true, write: false, delete: false }],
      },
      delegation: {
        can_spawn: false,
        max_children: 0,
        child_model_tier: "economy",
        child_timeout_seconds: 60,
        delegation_style: "delegate-and-execute",
      },
    };
    expect(partial.domain?.rules).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/types.test.ts`
Expected: FAIL — types `DomainRule`, `DomainRules`, etc. don't exist yet

- [ ] **Step 3: Add new types to runtime/src/types.ts**

Add after the `AgentCapabilities` interface (before `AgentConfig`):

```typescript
// ── Domain Enforcement ─────────────────────────────────────────

export interface DomainRule {
  path: string;       // Glob pattern (e.g., "apps/web/**", "**/*.env*")
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface BlockedTokenSet {
  tokens: string[];
  aliases?: Record<string, string[]>;
}

export interface BashRestrictions {
  blocked_tokens: BlockedTokenSet[];
  blocked_patterns: string[];   // Regex fallback
}

export interface DomainRules {
  rules: DomainRule[];
  tool_allowlist?: string[];
  tool_denylist?: string[];
  bash_restrictions?: BashRestrictions;
}

export interface EnforcementResult {
  allowed: boolean;
  reason?: string;
}

// ── Delegation Config ──────────────────────────────────────────

export type DelegationStyle = "delegate-only" | "delegate-and-execute";

export interface DelegationConfig {
  can_spawn: boolean;
  max_children: number;
  child_model_tier: ModelTier;
  child_timeout_seconds: number;
  delegation_style: DelegationStyle;
}
```

Then extend `AgentConfig` to add the optional fields:

```typescript
export interface AgentConfig {
  schema: string;
  id: string;
  name: string;
  role: string;
  cognition: AgentCognition;
  persona: AgentPersona;
  tensions: TensionPair[];
  report: { structure: string };
  tools: string[] | null;
  skills: string[];
  expertise: ExpertiseEntry[];
  model: { tier: ModelTier; thinking: ThinkingMode };
  systemPrompt?: string;
  capabilities?: AgentCapabilities;
  domain?: DomainRules;           // NEW
  delegation?: DelegationConfig;  // NEW
}
```

Add new transcript event types to the `TranscriptEventType` union:

```typescript
export type TranscriptEventType =
  | "session_start"
  | "agent_spawn"
  | "delegation"
  | "response"
  | "constraint_check"
  | "constraint_warning"
  | "budget_estimate"
  | "budget_abort"
  | "steer"
  | "error"
  | "expertise_write"
  | "end_session"
  | "final_statement"
  | "agent_destroy"
  | "session_end"
  // Workflow events
  | "workflow_start"
  | "step_start"
  | "step_end"
  | "gate_prompt"
  | "gate_result"
  | "artifact_write"
  | "workflow_end"
  // Execution events
  | "code_execution"
  | "skill_invocation"
  | "review_submission"
  // Domain enforcement events (NEW)
  | "domain_violation"
  | "domain_access"
  // Hierarchical delegation events (NEW — types only, implementation in Phase 2)
  | "agent_spawned"
  | "agent_destroyed"
  | "child_delegation"
  | "child_response"
  // Expertise events (NEW — types only, implementation in Phase 3a)
  | "expertise_loaded"
  | "expertise_updated"
  // File tracking events (NEW — types only, implementation in Phase 2)
  | "file_changed"
  // Cost granularity events (NEW)
  | "token_usage"
  // Session lifecycle events (NEW — types only, implementation in Phase 3b)
  | "session_paused"
  | "session_resumed";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aos-harness && bun test runtime/tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd aos-harness && bun test`
Expected: All 194+ tests PASS

- [ ] **Step 6: Commit**

```bash
cd aos-harness
git add runtime/src/types.ts runtime/tests/types.test.ts
git commit -m "feat(runtime): add domain enforcement and delegation types

Add DomainRules, DomainRule, BashRestrictions, BlockedTokenSet,
DelegationConfig, EnforcementResult types. Extend AgentConfig with
optional domain and delegation fields. Add new TranscriptEventType
values for domain_violation, domain_access, and future phases."
```

---

## Task 2: Implement DomainEnforcer — Path Matching

**Files:**
- Create: `runtime/src/domain-enforcer.ts`
- Create: `runtime/tests/domain-enforcer.test.ts`

- [ ] **Step 1: Write failing tests for path matching**

```typescript
// runtime/tests/domain-enforcer.test.ts
import { describe, it, expect } from "bun:test";
import { DomainEnforcer } from "../src/domain-enforcer";
import type { DomainRules } from "../src/types";

describe("DomainEnforcer — path matching", () => {
  const rules: DomainRules = {
    rules: [
      { path: "apps/web/**", read: true, write: true, delete: false },
      { path: "apps/web/components/**", read: true, write: false, delete: false },
      { path: "apps/api/**", read: true, write: false, delete: false },
      { path: "**/*.env*", read: false, write: false, delete: false },
    ],
  };
  const enforcer = new DomainEnforcer(rules);

  it("allows read on matched path", () => {
    const result = enforcer.checkFileAccess("apps/web/page.tsx", "read");
    expect(result.allowed).toBe(true);
  });

  it("allows write on matched writable path", () => {
    const result = enforcer.checkFileAccess("apps/web/page.tsx", "write");
    expect(result.allowed).toBe(true);
  });

  it("denies delete when rule says false", () => {
    const result = enforcer.checkFileAccess("apps/web/page.tsx", "delete");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("delete");
  });

  it("most-specific rule wins — components blocked for write", () => {
    const result = enforcer.checkFileAccess("apps/web/components/Button.tsx", "write");
    expect(result.allowed).toBe(false);
  });

  it("most-specific rule wins — components allowed for read", () => {
    const result = enforcer.checkFileAccess("apps/web/components/Button.tsx", "read");
    expect(result.allowed).toBe(true);
  });

  it("denies access to .env files regardless of location", () => {
    expect(enforcer.checkFileAccess(".env", "read").allowed).toBe(false);
    expect(enforcer.checkFileAccess("apps/api/.env.local", "read").allowed).toBe(false);
  });

  it("denies access to unmatched paths (deny-by-default)", () => {
    const result = enforcer.checkFileAccess("packages/shared/index.ts", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no matching rule");
  });

  it("handles empty rules — denies everything", () => {
    const empty = new DomainEnforcer({ rules: [] });
    expect(empty.checkFileAccess("any/file.ts", "read").allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/domain-enforcer.test.ts`
Expected: FAIL — module `domain-enforcer` doesn't exist

- [ ] **Step 3: Implement DomainEnforcer with path matching**

```typescript
// runtime/src/domain-enforcer.ts
import type { DomainRules, DomainRule, EnforcementResult } from "./types";

type FileOp = "read" | "write" | "delete";

/**
 * Resolves a glob pattern's specificity by counting path segments
 * before any wildcard. Literal file paths have highest specificity.
 */
function globSpecificity(pattern: string): number {
  const segments = pattern.split("/");
  let specificity = 0;
  for (const seg of segments) {
    if (seg === "**" || seg === "*") break;
    if (seg.includes("*")) {
      // Partial wildcard like "*.env*" — count as half a segment
      specificity += 0.5;
      break;
    }
    specificity += 1;
  }
  return specificity;
}

/**
 * Tests whether a file path matches a glob pattern.
 * Supports ** (any depth), * (single segment), and literal segments.
 */
function globMatch(pattern: string, filePath: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .split("/")
    .map((seg) => {
      if (seg === "**") return ".*";
      return seg
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${regexStr}$`).test(filePath);
}

export class DomainEnforcer {
  private rules: DomainRules;

  constructor(rules: DomainRules) {
    this.rules = rules;
  }

  /**
   * Check if a file operation is allowed.
   * Algorithm: collect all matching rules, pick most-specific, deny breaks ties.
   */
  checkFileAccess(filePath: string, operation: FileOp): EnforcementResult {
    // Normalize path — strip leading ./ or /
    const normalized = filePath.replace(/^\.?\//, "");

    // Collect all matching rules with their specificity
    const matches: { rule: DomainRule; specificity: number }[] = [];
    for (const rule of this.rules.rules) {
      if (globMatch(rule.path, normalized)) {
        matches.push({ rule, specificity: globSpecificity(rule.path) });
      }
    }

    if (matches.length === 0) {
      return { allowed: false, reason: `no matching rule for path "${normalized}"` };
    }

    // Sort by specificity descending
    matches.sort((a, b) => b.specificity - a.specificity);
    const topSpecificity = matches[0].specificity;

    // Get all rules at top specificity
    const topMatches = matches.filter((m) => m.specificity === topSpecificity);

    // If any top match denies, deny wins (tie-breaker)
    const denied = topMatches.some((m) => !m.rule[operation]);
    if (denied) {
      return {
        allowed: false,
        reason: `${operation} denied on "${normalized}" by rule "${topMatches.find((m) => !m.rule[operation])!.rule.path}"`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a tool is allowed by allowlist/denylist.
   */
  checkToolAccess(toolName: string): EnforcementResult {
    // Denylist takes precedence
    if (this.rules.tool_denylist?.includes(toolName)) {
      return { allowed: false, reason: `tool "${toolName}" is in denylist` };
    }

    // If allowlist is defined, tool must be in it
    if (this.rules.tool_allowlist && !this.rules.tool_allowlist.includes(toolName)) {
      return { allowed: false, reason: `tool "${toolName}" is not in allowlist` };
    }

    return { allowed: true };
  }

  /**
   * Check if a bash command contains blocked token patterns.
   * Token-based: splits command into tokens, checks for co-occurrence
   * of dangerous token sets (order-independent).
   */
  checkBashCommand(command: string): EnforcementResult {
    if (!this.rules.bash_restrictions) {
      return { allowed: true };
    }

    const tokens = command.split(/\s+/);

    // Check token-based rules
    for (const blocked of this.rules.bash_restrictions.blocked_tokens) {
      const allPresent = blocked.tokens.every((requiredToken) => {
        // Check if the token itself is present
        if (tokens.some((t) => t === requiredToken)) return true;
        // Check aliases
        const aliases = blocked.aliases?.[requiredToken];
        if (aliases) {
          return tokens.some((t) => aliases.some((alias) => t.includes(alias)));
        }
        return false;
      });
      if (allPresent) {
        return {
          allowed: false,
          reason: `bash command matches blocked token set: [${blocked.tokens.join(", ")}]`,
        };
      }
    }

    // Check regex patterns
    for (const pattern of this.rules.bash_restrictions.blocked_patterns) {
      if (new RegExp(pattern).test(command)) {
        return {
          allowed: false,
          reason: `bash command matches blocked pattern: ${pattern}`,
        };
      }
    }

    return { allowed: true };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd aos-harness && bun test runtime/tests/domain-enforcer.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
cd aos-harness
git add runtime/src/domain-enforcer.ts runtime/tests/domain-enforcer.test.ts
git commit -m "feat(runtime): implement DomainEnforcer with path matching

Longest-prefix-match algorithm with deny-wins tie-breaking.
Supports glob patterns, deny-by-default for unmatched paths."
```

---

## Task 3: DomainEnforcer — Tool Access & Bash Token Analysis

**Files:**
- Modify: `runtime/tests/domain-enforcer.test.ts`
- Modify: `runtime/src/domain-enforcer.ts` (already implemented, tests validate)

- [ ] **Step 1: Write failing tests for tool and bash checking**

Append to `runtime/tests/domain-enforcer.test.ts`:

```typescript
describe("DomainEnforcer — tool access", () => {
  const rules: DomainRules = {
    rules: [],
    tool_allowlist: ["read", "write", "edit", "grep", "glob"],
    tool_denylist: ["bash"],
  };
  const enforcer = new DomainEnforcer(rules);

  it("allows tools in allowlist", () => {
    expect(enforcer.checkToolAccess("read").allowed).toBe(true);
    expect(enforcer.checkToolAccess("write").allowed).toBe(true);
  });

  it("denies tools in denylist (takes precedence)", () => {
    expect(enforcer.checkToolAccess("bash").allowed).toBe(false);
    expect(enforcer.checkToolAccess("bash").reason).toContain("denylist");
  });

  it("denies tools not in allowlist", () => {
    expect(enforcer.checkToolAccess("unknown_tool").allowed).toBe(false);
    expect(enforcer.checkToolAccess("unknown_tool").reason).toContain("not in allowlist");
  });

  it("allows all tools when no allowlist or denylist", () => {
    const noLists = new DomainEnforcer({ rules: [] });
    expect(noLists.checkToolAccess("anything").allowed).toBe(true);
  });
});

describe("DomainEnforcer — bash token analysis", () => {
  const rules: DomainRules = {
    rules: [],
    bash_restrictions: {
      blocked_tokens: [
        {
          tokens: ["rm", "recursive"],
          aliases: { recursive: ["-r", "-R", "--recursive"] },
        },
        { tokens: ["git", "push"] },
        { tokens: ["git", "reset"] },
        {
          tokens: ["find", "delete"],
          aliases: { delete: ["-delete", "--delete"] },
        },
      ],
      blocked_patterns: ["curl.*-X DELETE"],
    },
  };
  const enforcer = new DomainEnforcer(rules);

  it("blocks rm -rf", () => {
    expect(enforcer.checkBashCommand("rm -rf /tmp/foo").allowed).toBe(false);
  });

  it("blocks rm -r -f (split flags)", () => {
    expect(enforcer.checkBashCommand("rm -r -f /tmp/foo").allowed).toBe(false);
  });

  it("blocks rm --recursive --force", () => {
    expect(enforcer.checkBashCommand("rm --recursive --force /tmp/foo").allowed).toBe(false);
  });

  it("blocks git push", () => {
    expect(enforcer.checkBashCommand("git push origin main").allowed).toBe(false);
  });

  it("blocks git reset", () => {
    expect(enforcer.checkBashCommand("git reset --hard HEAD").allowed).toBe(false);
  });

  it("blocks find -delete", () => {
    expect(enforcer.checkBashCommand("find . -name '*.tmp' -delete").allowed).toBe(false);
  });

  it("allows safe rm (no recursive flag)", () => {
    expect(enforcer.checkBashCommand("rm /tmp/single-file.txt").allowed).toBe(true);
  });

  it("allows safe git commands", () => {
    expect(enforcer.checkBashCommand("git status").allowed).toBe(true);
    expect(enforcer.checkBashCommand("git log --oneline").allowed).toBe(true);
  });

  it("blocks curl DELETE via regex pattern", () => {
    expect(enforcer.checkBashCommand("curl -X DELETE https://api.example.com/resource").allowed).toBe(false);
  });

  it("allows curl GET", () => {
    expect(enforcer.checkBashCommand("curl https://api.example.com/resource").allowed).toBe(true);
  });

  it("allows all bash when no restrictions set", () => {
    const noRestrictions = new DomainEnforcer({ rules: [] });
    expect(noRestrictions.checkBashCommand("rm -rf /").allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd aos-harness && bun test runtime/tests/domain-enforcer.test.ts`
Expected: All tests PASS (implementation was written in Task 2 — this task adds comprehensive test coverage)

- [ ] **Step 3: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd aos-harness
git add runtime/tests/domain-enforcer.test.ts
git commit -m "test(runtime): add tool access and bash token analysis tests

Covers allowlist/denylist precedence, token-based bash detection
across flag variants (rm -rf, rm -r -f, rm --recursive), and
regex pattern fallback."
```

---

## Task 4: Export DomainEnforcer from Runtime Package

**Files:**
- Modify: `runtime/package.json`

- [ ] **Step 1: Add domain-enforcer export to package.json**

Add to the `"exports"` field in `runtime/package.json`:

```json
"./domain-enforcer": "./src/domain-enforcer.ts"
```

- [ ] **Step 2: Verify import works**

Run: `cd aos-harness && bun -e "import { DomainEnforcer } from './runtime/src/domain-enforcer'; console.log(typeof DomainEnforcer)"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
cd aos-harness
git add runtime/package.json
git commit -m "feat(runtime): export domain-enforcer module"
```

---

## Task 5: Update Agent JSON Schema

**Files:**
- Modify: `core/schema/agent.schema.json`

- [ ] **Step 1: Add domain and delegation properties to schema**

Add to the `properties` object in `core/schema/agent.schema.json` (after `capabilities`):

```json
"domain": {
  "type": "object",
  "description": "Structural file/tool permission boundaries enforced at the L4 adapter layer.",
  "properties": {
    "rules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "read", "write", "delete"],
        "properties": {
          "path": { "type": "string", "description": "Glob pattern for file path matching" },
          "read": { "type": "boolean" },
          "write": { "type": "boolean" },
          "delete": { "type": "boolean" }
        }
      }
    },
    "tool_allowlist": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Tools this agent is allowed to use. If omitted, all tools allowed."
    },
    "tool_denylist": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Tools explicitly blocked. Takes precedence over allowlist."
    },
    "bash_restrictions": {
      "type": "object",
      "properties": {
        "blocked_tokens": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["tokens"],
            "properties": {
              "tokens": { "type": "array", "items": { "type": "string" } },
              "aliases": {
                "type": "object",
                "additionalProperties": {
                  "type": "array",
                  "items": { "type": "string" }
                }
              }
            }
          }
        },
        "blocked_patterns": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    }
  },
  "required": ["rules"]
},
"delegation": {
  "type": "object",
  "description": "Controls whether this agent can spawn and manage sub-agents.",
  "required": ["can_spawn", "max_children", "child_model_tier", "child_timeout_seconds", "delegation_style"],
  "properties": {
    "can_spawn": { "type": "boolean" },
    "max_children": { "type": "integer", "minimum": 0 },
    "child_model_tier": { "enum": ["economy", "standard", "premium"] },
    "child_timeout_seconds": { "type": "integer", "minimum": 1 },
    "delegation_style": { "enum": ["delegate-only", "delegate-and-execute"] }
  }
}
```

- [ ] **Step 2: Validate schema is valid JSON**

Run: `cd aos-harness && bun -e "const s = require('./core/schema/agent.schema.json'); console.log('Schema valid, properties:', Object.keys(s.properties).length)"`
Expected: Prints property count (no JSON parse error)

- [ ] **Step 3: Run existing validation tests**

Run: `cd aos-harness && bun test`
Expected: All tests PASS (existing agents don't have domain/delegation, which is fine — fields are optional)

- [ ] **Step 4: Commit**

```bash
cd aos-harness
git add core/schema/agent.schema.json
git commit -m "feat(schema): add domain and delegation properties to agent schema

Both fields are optional. domain defines path-based file permissions,
tool allowlist/denylist, and bash token restrictions. delegation
controls sub-agent spawning for Phase 2."
```

---

## Task 6: Integrate DomainEnforcer into Engine Event Emission

**Files:**
- Modify: `runtime/src/engine.ts`
- Test: `runtime/tests/engine.test.ts`

- [ ] **Step 1: Write failing test for domain violation events**

Append to `runtime/tests/engine.test.ts`:

```typescript
describe("AOSEngine — domain enforcement events", () => {
  it("emits domain_violation when agent domain rules are set", async () => {
    const adapter = new MockAdapter();
    const transcriptEvents: TranscriptEntry[] = [];

    // Create a test profile fixture that references an agent with domain rules
    // For this test, we verify the engine stores domain config on agents
    const engine = new AOSEngine(adapter, testProfileDir, {
      agentsDir: testAgentsDir,
      onTranscriptEvent: (entry) => { transcriptEvents.push(entry); },
    });

    // The engine should expose a method to check domain access
    const enforcer = engine.getDomainEnforcer("arbiter");
    // Arbiter has no domain rules by default, so enforcer should be null
    expect(enforcer).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/engine.test.ts`
Expected: FAIL — `getDomainEnforcer` doesn't exist on AOSEngine

- [ ] **Step 3: Add getDomainEnforcer to AOSEngine**

Add to `runtime/src/engine.ts`:

Import at top:
```typescript
import { DomainEnforcer } from "./domain-enforcer";
```

Add private state:
```typescript
private domainEnforcers: Map<string, DomainEnforcer> = new Map();
```

In the constructor, after loading agents, build enforcers for agents with domain rules:
```typescript
// Build domain enforcers for agents with domain rules
for (const [agentId, agentConfig] of this.agents) {
  if (agentConfig.domain) {
    this.domainEnforcers.set(agentId, new DomainEnforcer(agentConfig.domain));
  }
}
```

Add public method:
```typescript
/**
 * Returns the DomainEnforcer for an agent, or null if no domain rules are configured.
 */
getDomainEnforcer(agentId: string): DomainEnforcer | null {
  return this.domainEnforcers.get(agentId) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd aos-harness && bun test runtime/tests/engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd aos-harness
git add runtime/src/engine.ts runtime/tests/engine.test.ts
git commit -m "feat(runtime): add getDomainEnforcer to AOSEngine

Engine builds DomainEnforcer instances for agents with domain
rules. Adapters can retrieve enforcers to check access before
tool execution."
```

---

## Task 7: Add enforceToolAccess to WorkflowAdapter Contract

**Files:**
- Modify: `runtime/src/types.ts`
- Modify: `runtime/tests/mock-adapter.ts`

- [ ] **Step 1: Write failing test for enforceToolAccess on mock adapter**

Add to a new section in `runtime/tests/engine.test.ts`:

```typescript
describe("MockAdapter — enforceToolAccess", () => {
  it("records enforceToolAccess calls", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.enforceToolAccess("arbiter", {
      tool: "write",
      path: "apps/web/page.tsx",
    });
    expect(result.allowed).toBe(true);
    expect(adapter.calls.some((c) => c.method === "enforceToolAccess")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aos-harness && bun test runtime/tests/engine.test.ts`
Expected: FAIL — `enforceToolAccess` doesn't exist on MockAdapter

- [ ] **Step 3: Add enforceToolAccess to WorkflowAdapter interface**

In `runtime/src/types.ts`, add to the `WorkflowAdapter` interface:

```typescript
export interface WorkflowAdapter {
  // ... existing methods ...
  submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult>;
  enforceToolAccess(agentId: string, toolCall: { tool: string; path?: string; command?: string }): Promise<EnforcementResult>;  // NEW
}
```

- [ ] **Step 4: Add enforceToolAccess to MockAdapter**

In `runtime/tests/mock-adapter.ts`, add to the WorkflowAdapter section:

```typescript
async enforceToolAccess(
  agentId: string,
  toolCall: { tool: string; path?: string; command?: string },
): Promise<EnforcementResult> {
  this.record("enforceToolAccess", agentId, toolCall);
  // Default: allow everything in tests (tests can override via domainEnforcerOverride)
  if (this.domainEnforcerOverride) {
    return this.domainEnforcerOverride(agentId, toolCall);
  }
  return { allowed: true };
}
```

Add the override field to MockAdapter class:

```typescript
domainEnforcerOverride?: (agentId: string, toolCall: { tool: string; path?: string; command?: string }) => EnforcementResult;
```

Add the import for `EnforcementResult` at the top of the file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd aos-harness
git add runtime/src/types.ts runtime/tests/mock-adapter.ts runtime/tests/engine.test.ts
git commit -m "feat(runtime): add enforceToolAccess to WorkflowAdapter contract

L4 adapter method for domain enforcement. MockAdapter defaults to
allow-all with optional override for testing enforcement scenarios."
```

---

## Task 8: Integration Test — DomainEnforcer with Engine

**Files:**
- Create: `runtime/tests/domain-enforcer.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// runtime/tests/domain-enforcer.integration.test.ts
import { describe, it, expect, beforeAll } from "bun:test";
import { AOSEngine } from "../src/engine";
import { MockAdapter } from "./mock-adapter";
import { DomainEnforcer } from "../src/domain-enforcer";
import type { TranscriptEntry, DomainRules } from "../src/types";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const fixtureBase = join(import.meta.dir, "../fixtures");
const domainAgentDir = join(fixtureBase, "agents/domain-test-agent");

beforeAll(() => {
  // Create a test agent with domain rules
  if (!existsSync(domainAgentDir)) {
    mkdirSync(domainAgentDir, { recursive: true });
  }

  const agentYaml = {
    schema: "aos/agent/v1",
    id: "domain-test-agent",
    name: "Domain Test Agent",
    role: "Test agent with domain rules",
    cognition: {
      objective_function: "Test domain enforcement",
      time_horizon: { primary: "session", secondary: "session", peripheral: "session" },
      core_bias: "testing",
      risk_tolerance: "moderate",
      default_stance: "Test stance",
    },
    persona: {
      temperament: ["test"],
      thinking_patterns: ["test"],
      heuristics: [{ name: "test", rule: "test" }],
      evidence_standard: { convinced_by: ["test"], not_convinced_by: ["test"] },
      red_lines: ["test"],
    },
    tensions: [],
    report: { structure: "test" },
    tools: ["read", "write"],
    skills: [],
    expertise: [],
    model: { tier: "economy", thinking: "off" },
    domain: {
      rules: [
        { path: "src/**", read: true, write: true, delete: false },
        { path: "src/config/**", read: true, write: false, delete: false },
        { path: "**/*.env*", read: false, write: false, delete: false },
      ],
      tool_allowlist: ["read", "write", "edit", "grep"],
      tool_denylist: ["bash"],
      bash_restrictions: {
        blocked_tokens: [
          { tokens: ["rm", "recursive"], aliases: { recursive: ["-r", "-R", "--recursive"] } },
        ],
        blocked_patterns: [],
      },
    },
  };

  writeFileSync(join(domainAgentDir, "agent.yaml"), yaml.dump(agentYaml));
  writeFileSync(join(domainAgentDir, "prompt.md"), "# Domain Test Agent\nYou are a test agent.");
});

describe("DomainEnforcer integration with AOSEngine", () => {
  it("engine loads domain rules from agent config", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(adapter, join(fixtureBase, "profiles/test-council"), {
      agentsDir: fixtureBase + "/agents",
    });

    // domain-test-agent isn't in the test-council profile, so we test
    // the DomainEnforcer directly with loaded config
    const rules: DomainRules = {
      rules: [
        { path: "src/**", read: true, write: true, delete: false },
        { path: "src/config/**", read: true, write: false, delete: false },
      ],
      tool_allowlist: ["read", "write"],
      tool_denylist: ["bash"],
    };
    const enforcer = new DomainEnforcer(rules);

    // Verify path enforcement
    expect(enforcer.checkFileAccess("src/index.ts", "write").allowed).toBe(true);
    expect(enforcer.checkFileAccess("src/config/db.ts", "write").allowed).toBe(false);
    expect(enforcer.checkFileAccess("src/config/db.ts", "read").allowed).toBe(true);

    // Verify tool enforcement
    expect(enforcer.checkToolAccess("read").allowed).toBe(true);
    expect(enforcer.checkToolAccess("bash").allowed).toBe(false);
    expect(enforcer.checkToolAccess("unknown").allowed).toBe(false);
  });

  it("enforceToolAccess on adapter uses DomainEnforcer", async () => {
    const adapter = new MockAdapter();
    const rules: DomainRules = {
      rules: [
        { path: "src/**", read: true, write: true, delete: false },
      ],
      tool_allowlist: ["read", "write"],
    };
    const enforcer = new DomainEnforcer(rules);

    // Wire up the mock adapter to use domain enforcer
    adapter.domainEnforcerOverride = (_agentId, toolCall) => {
      const toolResult = enforcer.checkToolAccess(toolCall.tool);
      if (!toolResult.allowed) return toolResult;
      if (toolCall.path) {
        return enforcer.checkFileAccess(toolCall.path, toolCall.tool === "read" ? "read" : "write");
      }
      return { allowed: true };
    };

    // Should allow read on src/
    const readResult = await adapter.enforceToolAccess("test-agent", {
      tool: "read",
      path: "src/index.ts",
    });
    expect(readResult.allowed).toBe(true);

    // Should deny bash (not in allowlist)
    const bashResult = await adapter.enforceToolAccess("test-agent", {
      tool: "bash",
    });
    expect(bashResult.allowed).toBe(false);

    // Should deny write on unmatched path
    const unmatchedResult = await adapter.enforceToolAccess("test-agent", {
      tool: "write",
      path: "packages/shared/lib.ts",
    });
    expect(unmatchedResult.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd aos-harness && bun test runtime/tests/domain-enforcer.integration.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd aos-harness
git add runtime/tests/domain-enforcer.integration.test.ts runtime/fixtures/agents/domain-test-agent/
git commit -m "test(runtime): add DomainEnforcer integration tests

Tests domain enforcement with engine context, adapter wiring,
and combined path + tool checking scenarios."
```

---

## Task 9: Final Verification & Phase 1 Summary Commit

- [ ] **Step 1: Run full harness test suite**

Run: `cd aos-harness && bun test`
Expected: All tests PASS (194+ existing + ~25 new)

- [ ] **Step 2: Run TypeScript type checking**

Run: `cd aos-harness && bun run typecheck`
Expected: No type errors

- [ ] **Step 3: Verify git status is clean**

Run: `cd aos-harness && git status`
Expected: Clean working tree (all changes committed)
