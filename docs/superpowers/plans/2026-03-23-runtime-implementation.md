# AOS Harness Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AOS Harness runtime — 7 TypeScript modules (~1200 lines) that load config, resolve templates, evaluate constraints, route delegation, merge domains, and drive the session lifecycle. All testable with a mock adapter, no platform dependency.

**Architecture:** Config-first design. YAML agent/profile/domain files are loaded, validated against JSON Schema, and composed into a running session via the `AOSEngine` class. The engine consumes an `AOSAdapter` interface (4 layers) but the runtime itself has no platform-specific code. Tests use a `MockAdapter`.

**Tech Stack:** TypeScript, Bun (runtime + test runner), `js-yaml` (YAML parsing). JSON Schema validation via Ajv deferred to a follow-up task — Phase 1 uses manual field-presence validation.

**Spec:** `docs/specs/2026-03-23-aos-harness-design.md` (Sections 3, 4, 5, 6)

---

## File Structure

```
aos-harness/
├── runtime/
│   ├── src/
│   │   ├── types.ts                    # All shared interfaces and type definitions
│   │   ├── config-loader.ts            # YAML parsing + JSON Schema validation
│   │   ├── template-resolver.ts        # {{VARIABLE}} substitution
│   │   ├── domain-merger.ts            # Deep-merge domain overlays onto agents
│   │   ├── constraint-engine.ts        # Time/budget/rounds evaluation + conflict resolution
│   │   ├── delegation-router.ts        # Broadcast/targeted/tension-pair + bias limit + speaks-last
│   │   └── engine.ts                   # AOSEngine class — session lifecycle orchestrator
│   ├── tests/
│   │   ├── mock-adapter.ts             # MockAdapter implementing all 4 layers
│   │   ├── types.test.ts               # Type guard tests
│   │   ├── config-loader.test.ts       # Schema validation tests
│   │   ├── template-resolver.test.ts   # Variable substitution tests
│   │   ├── domain-merger.test.ts       # Merge rule tests
│   │   ├── constraint-engine.test.ts   # Constraint evaluation + conflict tests
│   │   ├── delegation-router.test.ts   # Routing + bias limit + speaks-last tests
│   │   └── engine.test.ts              # Session lifecycle integration tests
│   ├── fixtures/
│   │   ├── agents/
│   │   │   ├── arbiter/
│   │   │   │   ├── agent.yaml
│   │   │   │   └── prompt.md
│   │   │   └── catalyst/
│   │   │       ├── agent.yaml
│   │   │       └── prompt.md
│   │   ├── profiles/
│   │   │   └── test-council/
│   │   │       └── profile.yaml
│   │   ├── domains/
│   │   │   └── test-domain/
│   │   │       └── domain.yaml
│   │   └── briefs/
│   │       └── test-brief/
│   │           └── brief.md
│   ├── package.json
│   └── tsconfig.json
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `runtime/package.json`
- Create: `runtime/tsconfig.json`

- [ ] **Step 1: Initialize the runtime package**

```bash
cd aos-harness
mkdir -p runtime/src runtime/tests runtime/fixtures
```

- [ ] **Step 2: Create package.json**

Create `runtime/package.json`:

```json
{
  "name": "@aos-harness/runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "src/engine.ts",
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "bun x tsc --noEmit"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `runtime/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd runtime && bun install`
Expected: Lock file created, node_modules populated.

- [ ] **Step 5: Commit**

```bash
cd aos-harness
git init
git add runtime/package.json runtime/tsconfig.json runtime/bun.lock
git commit -m "chore: scaffold runtime package with bun, typescript, js-yaml, ajv"
```

---

### Task 2: Types Module

**Files:**
- Create: `runtime/src/types.ts`
- Create: `runtime/tests/types.test.ts`

- [ ] **Step 1: Write type guard tests**

Create `runtime/tests/types.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  type AgentConfig,
  type ProfileConfig,
  type DomainConfig,
  type ConstraintState,
  type AgentResponse,
  type AuthMode,
  type ModelCost,
  type DelegationTarget,
  isConstraintConflict,
  isMetered,
  createDefaultConstraintState,
} from "../src/types";

describe("ConstraintState", () => {
  it("createDefaultConstraintState returns zeroed state", () => {
    const state = createDefaultConstraintState();
    expect(state.elapsed_minutes).toBe(0);
    expect(state.budget_spent).toBe(0);
    expect(state.rounds_completed).toBe(0);
    expect(state.past_all_minimums).toBe(false);
    expect(state.hit_maximum).toBe(false);
    expect(state.can_end).toBe(false);
    expect(state.bias_ratio).toBe(0);
    expect(state.bias_blocked).toBe(false);
    expect(state.metered).toBe(true);
  });

  it("isConstraintConflict detects budget max before time min", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "constraint_conflict";
    state.conflict_detail = "budget_max hit before time_min met";
    expect(isConstraintConflict(state)).toBe(true);
  });

  it("isConstraintConflict returns false for normal hit", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "time";
    expect(isConstraintConflict(state)).toBe(false);
  });
});

describe("AuthMode", () => {
  it("isMetered returns true for api_key auth", () => {
    const auth: AuthMode = { type: "api_key", metered: true };
    expect(isMetered(auth)).toBe(true);
  });

  it("isMetered returns false for subscription auth", () => {
    const auth: AuthMode = { type: "subscription", metered: false, subscription_tier: "max" };
    expect(isMetered(auth)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/types.test.ts`
Expected: FAIL — cannot find module `../src/types`

- [ ] **Step 3: Implement types.ts**

Create `runtime/src/types.ts`:

```typescript
// ── AOS Harness Runtime Types ─────────────────────────────────

// ── Auth & Cost ─────────────────────────────────────────────────

export interface AuthMode {
  type: "api_key" | "subscription" | "unknown";
  subscription_tier?: string;
  metered: boolean;
}

export interface ModelCost {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  currency: string;
}

export type ModelTier = "economy" | "standard" | "premium";
export type ThinkingMode = "off" | "on" | "extended";
export type RiskTolerance = "very-low" | "low" | "moderate" | "high" | "very-high";
export type FailureAction = "skip" | "abort_round" | "abort_session";
export type BudgetExceededAction = "drop_optional" | "warn_arbiter" | "block_round";

// ── Agent Config ────────────────────────────────────────────────

export interface AgentCognition {
  objective_function: string;
  time_horizon: {
    primary: string;
    secondary: string;
    peripheral: string;
  };
  core_bias: string;
  risk_tolerance: RiskTolerance;
  default_stance: string;
}

export interface Heuristic {
  name: string;
  rule: string;
}

export interface AgentPersona {
  temperament: string[];
  thinking_patterns: string[];
  heuristics: Heuristic[];
  evidence_standard: {
    convinced_by: string[];
    not_convinced_by: string[];
  };
  red_lines: string[];
}

export interface TensionPair {
  agent: string;
  dynamic: string;
}

export interface ExpertiseEntry {
  path: string;
  mode: "read-only" | "read-write";
  use_when: string;
}

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
  // Resolved at runtime
  systemPrompt?: string;
}

// ── Profile Config ──────────────────────────────────────────────

export interface AssemblyMember {
  agent: string;
  required: boolean;
  structural_advantage?: "speaks-last";
}

export interface ProfileConstraints {
  time: { min_minutes: number; max_minutes: number };
  budget: { min: number; max: number; currency: string } | null;
  rounds: { min: number; max: number };
}

export interface ErrorHandling {
  agent_timeout_seconds: number;
  retry_policy: { max_retries: number; backoff: "exponential" | "linear" };
  on_agent_failure: FailureAction;
  on_orchestrator_failure: "save_transcript_and_exit";
  partial_results: "include_with_status_flag";
}

export interface BudgetEstimation {
  strategy: "rolling_average" | "fixed_estimate";
  fixed_estimate_tokens: number;
  safety_margin: number;
  on_estimate_exceeded: BudgetExceededAction;
}

export interface InputSection {
  heading: string;
  guidance: string;
}

export interface ProfileConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  version: string;
  assembly: {
    orchestrator: string;
    perspectives: AssemblyMember[];
  };
  delegation: {
    default: "broadcast" | "round-robin" | "targeted";
    opening_rounds: number;
    tension_pairs: [string, string][];
    bias_limit: number;
  };
  constraints: ProfileConstraints;
  error_handling: ErrorHandling;
  budget_estimation: BudgetEstimation;
  input: {
    format: "brief" | "question" | "document" | "freeform";
    required_sections: InputSection[];
    context_files: boolean;
  };
  output: {
    format: string;
    path_template: string;
    sections: string[];
    artifacts: { type: string }[];
    frontmatter: string[];
  };
  expertise: {
    enabled: boolean;
    path_template: string;
    mode: "per-agent" | "shared" | "none";
  };
  controls: {
    halt: boolean;
    wrap: boolean;
    interject: boolean;
  };
}

// ── Domain Config ───────────────────────────────────────────────

export interface DomainOverlay {
  thinking_patterns?: string[];
  heuristics?: Heuristic[];
  red_lines?: string[];
  evidence_standard?: {
    convinced_by?: string[];
    not_convinced_by?: string[];
  };
  temperament?: string[];
}

export interface DomainConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  lexicon: {
    metrics: string[];
    frameworks: string[];
    stages: string[];
  };
  overlays: Record<string, DomainOverlay>;
  additional_input_sections: InputSection[];
  additional_output_sections: { section: string; description: string }[];
  guardrails: string[];
}

// ── Constraint State ────────────────────────────────────────────

export interface ConstraintState {
  elapsed_minutes: number;
  budget_spent: number;
  rounds_completed: number;
  past_min_time: boolean;
  past_min_budget: boolean;
  past_min_rounds: boolean;
  past_all_minimums: boolean;
  approaching_max_time: boolean;
  approaching_max_budget: boolean;
  approaching_max_rounds: boolean;
  approaching_any_maximum: boolean;
  hit_maximum: boolean;
  hit_reason: "none" | "time" | "budget" | "rounds" | "constraint_conflict";
  conflict_detail?: string;
  can_end: boolean;
  bias_ratio: number;
  most_addressed: string[];
  least_addressed: string[];
  bias_blocked: boolean;
  metered: boolean;
}

// ── Agent Runtime Types ─────────────────────────────────────────

export interface AgentHandle {
  id: string;
  agentId: string;
  sessionId: string;
}

export interface MessageOpts {
  contextFiles?: string[];
  signal?: AbortSignal;
  onStream?: (partial: string) => void;
}

export interface AgentResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  contextTokens: number;
  model: string;
  status: "success" | "failed" | "aborted";
  error?: string;
}

export interface ContextUsage {
  tokens: number;
  percent: number;
}

// ── Delegation ──────────────────────────────────────────────────

export type DelegationTarget =
  | { type: "broadcast" }
  | { type: "targeted"; agents: string[] }
  | { type: "tension"; pair: [string, string] };

// ── Transcript Events ───────────────────────────────────────────

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
  | "session_end";

export interface TranscriptEntry {
  type: TranscriptEventType;
  timestamp: string;
  [key: string]: unknown;
}

// ── Adapter Interface ───────────────────────────────────────────

export interface AgentRuntimeAdapter {
  spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle>;
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
  destroyAgent(handle: AgentHandle): Promise<void>;
  setOrchestratorPrompt(prompt: string): void;
  injectContext(handle: AgentHandle, files: string[]): Promise<void>;
  getContextUsage(handle: AgentHandle): ContextUsage;
  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void;
  getAuthMode(): AuthMode;
  getModelCost(tier: ModelTier): ModelCost;
  abort(): void;
}

export interface EventBusAdapter {
  onSessionStart(handler: () => Promise<void>): void;
  onSessionShutdown(handler: () => Promise<void>): void;
  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void;
  onAgentEnd(handler: () => Promise<void>): void;
  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void;
  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void;
  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void;
  onCompaction(handler: () => Promise<void>): void;
}

export interface UIAdapter {
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
  registerTool(name: string, schema: Record<string, unknown>, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  renderAgentResponse(agent: string, response: string, color: string): void;
  renderCustomMessage(type: string, content: string, details: Record<string, unknown>): void;
  setWidget(id: string, renderer: (() => string[]) | undefined): void;
  setFooter(renderer: (width: number) => string[]): void;
  setStatus(key: string, text: string): void;
  setTheme(name: string): void;
  promptSelect(label: string, options: string[]): Promise<number>;
  promptConfirm(title: string, message: string): Promise<boolean>;
  promptInput(label: string): Promise<string>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  blockInput(allowedCommands: string[]): void;
  unblockInput(): void;
  steerMessage(message: string): void;
}

export interface WorkflowAdapter {
  dispatchParallel(agents: AgentHandle[], message: string, opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void }): Promise<AgentResponse[]>;
  isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  openInEditor(path: string, editor: string): Promise<void>;
  persistState(key: string, value: unknown): Promise<void>;
  loadState(key: string): Promise<unknown>;
}

export type AOSAdapter = AgentRuntimeAdapter & EventBusAdapter & UIAdapter & WorkflowAdapter;

// ── Helper Functions ────────────────────────────────────────────

export function createDefaultConstraintState(): ConstraintState {
  return {
    elapsed_minutes: 0,
    budget_spent: 0,
    rounds_completed: 0,
    past_min_time: false,
    past_min_budget: false,
    past_min_rounds: false,
    past_all_minimums: false,
    approaching_max_time: false,
    approaching_max_budget: false,
    approaching_max_rounds: false,
    approaching_any_maximum: false,
    hit_maximum: false,
    hit_reason: "none",
    can_end: false,
    bias_ratio: 0,
    most_addressed: [],
    least_addressed: [],
    bias_blocked: false,
    metered: true,
  };
}

export function isConstraintConflict(state: ConstraintState): boolean {
  return state.hit_reason === "constraint_conflict";
}

export function isMetered(auth: AuthMode): boolean {
  return auth.metered;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/types.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Type check**

Run: `cd runtime && bun x tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd aos-harness
git add runtime/src/types.ts runtime/tests/types.test.ts
git commit -m "feat(runtime): add types module with all shared interfaces and type helpers"
```

---

### Task 3: Template Resolver

**Files:**
- Create: `runtime/src/template-resolver.ts`
- Create: `runtime/tests/template-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `runtime/tests/template-resolver.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { resolveTemplate } from "../src/template-resolver";

describe("resolveTemplate", () => {
  it("replaces single variable", () => {
    expect(resolveTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = resolveTemplate("{{a}} and {{b}}", { a: "X", b: "Y" });
    expect(result).toBe("X and Y");
  });

  it("replaces same variable multiple times", () => {
    const result = resolveTemplate("{{x}} then {{x}}", { x: "Z" });
    expect(result).toBe("Z then Z");
  });

  it("leaves unknown variables as-is", () => {
    expect(resolveTemplate("{{known}} {{unknown}}", { known: "yes" })).toBe("yes {{unknown}}");
  });

  it("handles empty variables map", () => {
    expect(resolveTemplate("{{a}}", {})).toBe("{{a}}");
  });

  it("handles template with no variables", () => {
    expect(resolveTemplate("no vars here", { a: "unused" })).toBe("no vars here");
  });

  it("handles empty string", () => {
    expect(resolveTemplate("", { a: "b" })).toBe("");
  });

  it("handles multiline templates", () => {
    const template = "Line 1: {{x}}\nLine 2: {{y}}";
    expect(resolveTemplate(template, { x: "A", y: "B" })).toBe("Line 1: A\nLine 2: B");
  });

  it("resolves all spec-defined variables", () => {
    const vars = {
      date: "2026-03-23",
      session_id: "abc123",
      brief_slug: "test-brief",
      brief: "# Brief content",
      format: "memo",
      agent_id: "catalyst",
      agent_name: "Catalyst",
      profile_id: "strategic-council",
      domain_id: "saas",
      participants: "catalyst, sentinel, architect",
      constraints: "2-10 min | $1-$10 | 2-8 rounds",
      expertise_block: "- scratch-pad.md [read-write]",
      skills_block: "",
      output_path: "/output/memos/memo.md",
      deliberation_dir: "/sessions/abc123",
      transcript_path: "/sessions/abc123/transcript.jsonl",
    };
    const template = "Session {{session_id}} for {{profile_id}}";
    expect(resolveTemplate(template, vars)).toBe("Session abc123 for strategic-council");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/template-resolver.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement template-resolver.ts**

Create `runtime/src/template-resolver.ts`:

```typescript
/**
 * Template Resolver — replaces {{VARIABLE}} placeholders with runtime values.
 * Unknown variables are left as-is (not removed, not errored).
 * See spec Section 6.13 for the full variable reference.
 */

export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  if (!template) return template;

  return template.replace(/\{\{([\w-]+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key] : match;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/template-resolver.test.ts`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/template-resolver.ts runtime/tests/template-resolver.test.ts
git commit -m "feat(runtime): add template resolver with {{VARIABLE}} substitution"
```

---

### Task 4: Domain Merger

**Files:**
- Create: `runtime/src/domain-merger.ts`
- Create: `runtime/tests/domain-merger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `runtime/tests/domain-merger.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/domain-merger.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement domain-merger.ts**

Create `runtime/src/domain-merger.ts`:

```typescript
/**
 * Domain Merger — deep-merges domain overlays onto agent configs.
 *
 * Merge rules (spec Section 6.12):
 * - thinking_patterns: APPENDED after agent patterns
 * - heuristics: APPENDED (no dedup by name — both kept)
 * - red_lines: APPENDED (union, never removes)
 * - evidence_standard.convinced_by: APPENDED
 * - evidence_standard.not_convinced_by: APPENDED
 * - temperament: APPENDED
 * - tensions: NOT merged (profile-level only)
 * - Domain NEVER removes or replaces agent-level config. Only adds.
 */

import type { AgentConfig, DomainOverlay, DomainConfig } from "./types";

export function mergeDomainOverlay(
  agent: AgentConfig,
  overlay: DomainOverlay,
): AgentConfig {
  const merged: AgentConfig = structuredClone(agent);

  if (overlay.thinking_patterns && overlay.thinking_patterns.length > 0) {
    merged.persona.thinking_patterns = [
      ...merged.persona.thinking_patterns,
      ...overlay.thinking_patterns,
    ];
  }

  if (overlay.heuristics && overlay.heuristics.length > 0) {
    merged.persona.heuristics = [
      ...merged.persona.heuristics,
      ...overlay.heuristics,
    ];
  }

  if (overlay.red_lines && overlay.red_lines.length > 0) {
    merged.persona.red_lines = [
      ...merged.persona.red_lines,
      ...overlay.red_lines,
    ];
  }

  if (overlay.temperament && overlay.temperament.length > 0) {
    merged.persona.temperament = [
      ...merged.persona.temperament,
      ...overlay.temperament,
    ];
  }

  if (overlay.evidence_standard) {
    if (overlay.evidence_standard.convinced_by && overlay.evidence_standard.convinced_by.length > 0) {
      merged.persona.evidence_standard.convinced_by = [
        ...merged.persona.evidence_standard.convinced_by,
        ...overlay.evidence_standard.convinced_by,
      ];
    }
    if (overlay.evidence_standard.not_convinced_by && overlay.evidence_standard.not_convinced_by.length > 0) {
      merged.persona.evidence_standard.not_convinced_by = [
        ...merged.persona.evidence_standard.not_convinced_by,
        ...overlay.evidence_standard.not_convinced_by,
      ];
    }
  }

  return merged;
}

/**
 * Apply all matching domain overlays to a set of agents.
 * Returns new agent configs — originals are not mutated.
 */
export function applyDomain(
  agents: AgentConfig[],
  domain: DomainConfig,
): AgentConfig[] {
  return agents.map((agent) => {
    const overlay = domain.overlays[agent.id];
    if (!overlay) return agent;
    return mergeDomainOverlay(agent, overlay);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/domain-merger.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/domain-merger.ts runtime/tests/domain-merger.test.ts
git commit -m "feat(runtime): add domain merger with append-only merge rules"
```

---

### Task 5: Constraint Engine

**Files:**
- Create: `runtime/src/constraint-engine.ts`
- Create: `runtime/tests/constraint-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `runtime/tests/constraint-engine.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { ConstraintEngine } from "../src/constraint-engine";
import type { ProfileConstraints, AuthMode } from "../src/types";

const defaultConstraints: ProfileConstraints = {
  time: { min_minutes: 2, max_minutes: 10 },
  budget: { min: 1.0, max: 10.0, currency: "USD" },
  rounds: { min: 2, max: 8 },
};

const meteredAuth: AuthMode = { type: "api_key", metered: true };
const subscriptionAuth: AuthMode = { type: "subscription", metered: false, subscription_tier: "max" };

describe("ConstraintEngine", () => {
  it("initializes with zeroed state", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    const state = engine.getState();
    expect(state.elapsed_minutes).toBe(0);
    expect(state.budget_spent).toBe(0);
    expect(state.rounds_completed).toBe(0);
    expect(state.metered).toBe(true);
  });

  it("tracks elapsed time", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(0.5, 3.0);
    const state = engine.getState();
    expect(state.elapsed_minutes).toBe(3.0);
    expect(state.rounds_completed).toBe(1);
  });

  it("tracks budget", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(2.5, 1.0);
    expect(engine.getState().budget_spent).toBe(2.5);
  });

  it("detects past minimums", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(1.5, 3.0); // round 1: $1.5 cost, 3min elapsed
    engine.recordRound(0.5, 5.0); // round 2: $0.5 cost (2.0 total), 5min elapsed
    const state = engine.getState();
    expect(state.past_min_time).toBe(true);
    expect(state.past_min_budget).toBe(true);
    expect(state.past_min_rounds).toBe(true);
    expect(state.past_all_minimums).toBe(true);
    expect(state.can_end).toBe(true);
  });

  it("detects approaching maximum (80%+)", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(8.5, 8.5); // $8.5 of $10, 8.5 of 10 min
    engine.recordRound(0, 0); // round 2
    const state = engine.getState();
    expect(state.approaching_max_budget).toBe(true);
    expect(state.approaching_max_time).toBe(true);
    expect(state.approaching_any_maximum).toBe(true);
  });

  it("detects hit maximum - time", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(1.0, 11.0); // over 10 min max
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("time");
  });

  it("detects hit maximum - budget", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(11.0, 1.0); // over $10 max
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("budget");
  });

  it("detects constraint conflict - budget max before time min", () => {
    const constraints: ProfileConstraints = {
      time: { min_minutes: 5, max_minutes: 10 },
      budget: { min: 1.0, max: 2.0, currency: "USD" },
      rounds: { min: 2, max: 8 },
    };
    const engine = new ConstraintEngine(constraints, meteredAuth);
    engine.recordRound(3.0, 1.0); // $3 > $2 max, but only 1 min < 5 min min
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("constraint_conflict");
    expect(state.conflict_detail).toContain("budget");
    expect(state.can_end).toBe(true); // max overrides
  });

  it("can_end is false when minimums not met and no max hit", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    engine.recordRound(0.1, 0.5); // barely anything
    const state = engine.getState();
    expect(state.can_end).toBe(false);
  });

  it("disables budget in subscription mode", () => {
    const engine = new ConstraintEngine(defaultConstraints, subscriptionAuth);
    const state = engine.getState();
    expect(state.metered).toBe(false);
    // Budget fields should be zero/inactive
    engine.recordRound(999.0, 3.0); // huge "cost" but unmetered
    const after = engine.getState();
    expect(after.budget_spent).toBe(0); // not tracked
    expect(after.hit_maximum).toBe(false); // budget max not enforced
  });

  it("disables budget when budget constraint is null", () => {
    const constraints: ProfileConstraints = {
      time: { min_minutes: 2, max_minutes: 10 },
      budget: null,
      rounds: { min: 2, max: 8 },
    };
    const engine = new ConstraintEngine(constraints, meteredAuth);
    engine.recordRound(999.0, 3.0);
    const state = engine.getState();
    expect(state.budget_spent).toBe(0);
    expect(state.past_min_budget).toBe(true); // always true when disabled
  });

  it("detects rounds maximum", () => {
    const constraints: ProfileConstraints = {
      time: { min_minutes: 0, max_minutes: 100 },
      budget: null,
      rounds: { min: 1, max: 3 },
    };
    const engine = new ConstraintEngine(constraints, meteredAuth);
    engine.recordRound(0, 1);
    engine.recordRound(0, 1);
    engine.recordRound(0, 1);
    const state = engine.getState();
    expect(state.hit_maximum).toBe(true);
    expect(state.hit_reason).toBe("rounds");
  });

  it("estimateCost returns cost for a round", () => {
    const engine = new ConstraintEngine(defaultConstraints, meteredAuth);
    const cost = engine.estimateRoundCost(8, 2000, {
      inputPerMillionTokens: 3.0,
      outputPerMillionTokens: 15.0,
      currency: "USD",
    });
    // 8 agents × 2000 input tokens × $3/M + 8 agents × 2000 output tokens × $15/M
    // = 8 × 0.006 + 8 × 0.03 = 0.048 + 0.24 = 0.288
    expect(cost).toBeCloseTo(0.288, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/constraint-engine.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement constraint-engine.ts**

Create `runtime/src/constraint-engine.ts`:

```typescript
/**
 * Constraint Engine — evaluates time/budget/rounds against profile constraints.
 *
 * Constraint priority (spec Section 6.6):
 * 1. budget_max (hard ceiling, always wins)
 * 2. time_max (hard ceiling, always wins)
 * 3. rounds_max (hard ceiling, always wins)
 * 4-6. Soft floors overridden by any max ceiling
 *
 * Auth-aware (spec Section 6.7):
 * - metered: true → budget fully tracked
 * - metered: false OR budget: null → budget disabled, fields zeroed
 */

import type { ProfileConstraints, AuthMode, ConstraintState, ModelCost } from "./types";
import { createDefaultConstraintState } from "./types";

export class ConstraintEngine {
  private state: ConstraintState;
  private constraints: ProfileConstraints;
  private budgetEnabled: boolean;

  constructor(constraints: ProfileConstraints, authMode: AuthMode) {
    this.constraints = constraints;
    this.budgetEnabled = authMode.metered && constraints.budget !== null;
    this.state = createDefaultConstraintState();
    this.state.metered = authMode.metered;

    // If budget disabled, mark min as always met
    if (!this.budgetEnabled) {
      this.state.past_min_budget = true;
    }
  }

  /**
   * Record the result of a completed round.
   * @param roundCost - Total cost of this round (ignored if budget disabled)
   * @param elapsedMinutes - Total elapsed time from session start
   */
  recordRound(roundCost: number, elapsedMinutes: number): void {
    this.state.rounds_completed += 1;
    this.state.elapsed_minutes = elapsedMinutes;

    if (this.budgetEnabled) {
      this.state.budget_spent += roundCost;
    }

    this.evaluate();
  }

  /**
   * Update elapsed time without completing a round (for mid-round checks).
   */
  updateTime(elapsedMinutes: number): void {
    this.state.elapsed_minutes = elapsedMinutes;
    this.evaluate();
  }

  getState(): ConstraintState {
    return { ...this.state };
  }

  /**
   * Estimate the cost of a round before dispatching.
   */
  estimateRoundCost(
    agentCount: number,
    estimatedTokensPerAgent: number,
    modelCost: ModelCost,
  ): number {
    const inputCost = agentCount * estimatedTokensPerAgent * (modelCost.inputPerMillionTokens / 1_000_000);
    const outputCost = agentCount * estimatedTokensPerAgent * (modelCost.outputPerMillionTokens / 1_000_000);
    return inputCost + outputCost;
  }

  /**
   * Check if a round with estimated cost would exceed remaining budget.
   * Returns remaining budget after estimated cost (negative = would exceed).
   */
  checkBudgetHeadroom(estimatedCost: number, safetyMargin: number): number {
    if (!this.budgetEnabled || !this.constraints.budget) return Infinity;
    const remaining = this.constraints.budget.max - this.state.budget_spent;
    const estimateWithMargin = estimatedCost * (1 + safetyMargin);
    return remaining - estimateWithMargin;
  }

  private evaluate(): void {
    const { time, budget, rounds } = this.constraints;
    const s = this.state;

    // ── Minimums ──
    s.past_min_time = s.elapsed_minutes >= time.min_minutes;
    s.past_min_rounds = s.rounds_completed >= rounds.min;

    if (this.budgetEnabled && budget) {
      s.past_min_budget = s.budget_spent >= budget.min;
    }
    // If budget disabled, past_min_budget stays true (set in constructor)

    s.past_all_minimums = s.past_min_time && s.past_min_budget && s.past_min_rounds;

    // ── Approaching maximums (80%+) ──
    s.approaching_max_time = s.elapsed_minutes >= time.max_minutes * 0.8;
    s.approaching_max_rounds = s.rounds_completed >= rounds.max * 0.8;

    if (this.budgetEnabled && budget) {
      s.approaching_max_budget = s.budget_spent >= budget.max * 0.8;
    } else {
      s.approaching_max_budget = false;
    }

    s.approaching_any_maximum = s.approaching_max_time || s.approaching_max_budget || s.approaching_max_rounds;

    // ── Hard maximums ──
    const hitTime = s.elapsed_minutes >= time.max_minutes;
    const hitBudget = this.budgetEnabled && budget ? s.budget_spent >= budget.max : false;
    const hitRounds = s.rounds_completed >= rounds.max;

    s.hit_maximum = hitTime || hitBudget || hitRounds;

    if (s.hit_maximum) {
      // Check for constraint conflict (max hit before min met)
      const conflicts: string[] = [];
      if (hitBudget && !s.past_min_time) conflicts.push("budget_max hit before time_min met");
      if (hitBudget && !s.past_min_rounds) conflicts.push("budget_max hit before rounds_min met");
      if (hitTime && !s.past_min_budget) conflicts.push("time_max hit before budget_min met");
      if (hitTime && !s.past_min_rounds) conflicts.push("time_max hit before rounds_min met");
      if (hitRounds && !s.past_min_time) conflicts.push("rounds_max hit before time_min met");
      if (hitRounds && !s.past_min_budget) conflicts.push("rounds_max hit before budget_min met");

      if (conflicts.length > 0) {
        s.hit_reason = "constraint_conflict";
        s.conflict_detail = conflicts.join("; ");
      } else if (hitBudget) {
        s.hit_reason = "budget";
      } else if (hitTime) {
        s.hit_reason = "time";
      } else {
        s.hit_reason = "rounds";
      }
    } else {
      s.hit_reason = "none";
      s.conflict_detail = undefined;
    }

    // ── Can end? ──
    s.can_end = s.past_all_minimums || s.hit_maximum;
  }

  /**
   * Update bias tracking fields from delegation router state.
   */
  updateBias(biasRatio: number, mostAddressed: string[], leastAddressed: string[], blocked: boolean): void {
    this.state.bias_ratio = biasRatio;
    this.state.most_addressed = mostAddressed;
    this.state.least_addressed = leastAddressed;
    this.state.bias_blocked = blocked;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/constraint-engine.test.ts`
Expected: 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/constraint-engine.ts runtime/tests/constraint-engine.test.ts
git commit -m "feat(runtime): add constraint engine with conflict resolution and auth-aware budget"
```

---

### Task 6: Delegation Router

**Files:**
- Create: `runtime/src/delegation-router.ts`
- Create: `runtime/tests/delegation-router.test.ts`

- [ ] **Step 1: Write failing tests**

Create `runtime/tests/delegation-router.test.ts`:

```typescript
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
    expect(counts.get("provocateur")).toBe(1); // speaks-last still counts
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
    // catalyst:sentinel ratio = 2:1 = at limit
    const result = router.resolve({ type: "targeted", agents: ["catalyst"] }, 3);
    expect(result.blocked).toBe(true);
    expect(result.neglected).toContain("sentinel");
  });

  it("bias ratio only considers required agents", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    router.resolve({ type: "broadcast" }, 1); // all at 1
    router.resolve({ type: "targeted", agents: ["navigator"] }, 2); // optional at 2
    const bias = router.getBiasState();
    // navigator is optional, excluded from ratio
    expect(bias.ratio).toBe(1); // required agents all at 1
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
    const result = router.resolve({ type: "targeted", agents: ["catalyst"] }, 1); // round 1 < 2
    // Should resolve as broadcast instead of targeted
    expect(result.parallel).toContain("sentinel");
    expect(result.parallel).toContain("architect");
  });

  it("allows targeted after opening rounds", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1); // opening_rounds=1
    const result = router.resolve({ type: "targeted", agents: ["catalyst"] }, 2); // round 2 > 1
    expect(result.parallel).toEqual(["catalyst"]);
  });

  it("throws on unknown agent in targeted call", () => {
    const router = new DelegationRouter(members, tensionPairs, 5, 1);
    expect(() => {
      router.resolve({ type: "targeted", agents: ["nonexistent"] }, 1);
    }).toThrow("Unknown agent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd runtime && bun test tests/delegation-router.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement delegation-router.ts**

Create `runtime/src/delegation-router.ts`:

```typescript
/**
 * Delegation Router — resolves delegation targets and enforces bias limits.
 *
 * Spec references:
 * - Section 6.4: Structural advantage (speaks-last)
 * - Section 6.8: Bias limit counting rules
 * - Profile schema: delegation.default, opening_rounds, tension_pairs, bias_limit
 */

import type { AssemblyMember, DelegationTarget } from "./types";

export interface RoutingResult {
  /** Agents to call in parallel */
  parallel: string[];
  /** Agents to call sequentially after parallel completes (speaks-last) */
  sequential: string[];
  /** Whether the delegation was blocked due to bias limit */
  blocked: boolean;
  /** Agents that need to be addressed (when blocked) */
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
  private callCounts: Map<string, number> = new Map();
  private speaksLast: string | null = null;

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

    // Initialize call counts
    for (const m of members) {
      this.callCounts.set(m.agent, 0);
    }

    // Find speaks-last agent
    const speaksLastMember = members.find((m) => m.structural_advantage === "speaks-last");
    if (speaksLastMember) {
      this.speaksLast = speaksLastMember.agent;
    }
  }

  resolve(target: DelegationTarget, currentRound: number): RoutingResult {
    switch (target.type) {
      case "broadcast":
        return this.resolveBroadcast();
      case "targeted":
        return this.resolveTargeted(target.agents, currentRound);
      case "tension":
        return this.resolveTension(target.pair);
    }
  }

  private resolveBroadcast(): RoutingResult {
    const parallel: string[] = [];
    const sequential: string[] = [];

    for (const m of this.members) {
      if (m.agent === this.speaksLast) {
        sequential.push(m.agent);
      } else {
        parallel.push(m.agent);
      }
    }

    // Record calls for all agents (broadcast counts for everyone)
    for (const agent of [...parallel, ...sequential]) {
      this.callCounts.set(agent, (this.callCounts.get(agent) || 0) + 1);
    }

    return { parallel, sequential, blocked: false, neglected: [] };
  }

  private resolveTargeted(agents: string[], currentRound: number): RoutingResult {
    // Validate agents exist
    const knownIds = new Set(this.members.map((m) => m.agent));
    for (const a of agents) {
      if (!knownIds.has(a)) {
        throw new Error(`Unknown agent: "${a}". Available: ${[...knownIds].join(", ")}`);
      }
    }

    // Enforce opening_rounds — force broadcast during opening rounds
    if (currentRound > 0 && currentRound <= this.openingRounds) {
      return this.resolveBroadcast();
    }

    // Check bias limit before allowing targeted call
    const biasCheck = this.wouldExceedBias(agents);
    if (biasCheck.blocked) {
      return {
        parallel: [],
        sequential: [],
        blocked: true,
        neglected: biasCheck.neglected,
      };
    }

    // Targeted calls: speaks-last agent responds normally (no special ordering)
    for (const agent of agents) {
      this.callCounts.set(agent, (this.callCounts.get(agent) || 0) + 1);
    }

    return { parallel: agents, sequential: [], blocked: false, neglected: [] };
  }

  private resolveTension(pair: [string, string]): RoutingResult {
    // Tension pairs are essentially targeted calls to two specific agents
    return this.resolveTargeted([...pair], -1);
  }

  private wouldExceedBias(targetAgents: string[]): { blocked: boolean; neglected: string[] } {
    // Simulate the call
    const simulated = new Map(this.callCounts);
    for (const a of targetAgents) {
      simulated.set(a, (simulated.get(a) || 0) + 1);
    }

    // Calculate ratio for required agents only
    const requiredMembers = this.members.filter((m) => m.required);
    const requiredCounts = requiredMembers.map((m) => simulated.get(m.agent) || 0);

    if (requiredCounts.length === 0) return { blocked: false, neglected: [] };

    const maxCount = Math.max(...requiredCounts);
    const minCount = Math.min(...requiredCounts);

    if (minCount === 0) {
      // If any required agent has 0 calls and we're adding more to others, check
      const ratio = maxCount; // N:0 → effectively infinite
      if (ratio >= this.biasLimit) {
        const neglected = requiredMembers
          .filter((m) => (simulated.get(m.agent) || 0) === minCount)
          .map((m) => m.agent);
        return { blocked: true, neglected };
      }
    } else {
      const ratio = maxCount / minCount;
      if (ratio >= this.biasLimit) {
        const neglected = requiredMembers
          .filter((m) => (simulated.get(m.agent) || 0) === minCount)
          .map((m) => m.agent);
        return { blocked: true, neglected };
      }
    }

    return { blocked: false, neglected: [] };
  }

  getCallCounts(): Map<string, number> {
    return new Map(this.callCounts);
  }

  getBiasState(): BiasState {
    const requiredMembers = this.members.filter((m) => m.required);
    const requiredCounts = requiredMembers.map((m) => ({
      agent: m.agent,
      count: this.callCounts.get(m.agent) || 0,
    }));

    if (requiredCounts.length === 0) {
      return { ratio: 0, most_addressed: [], least_addressed: [], blocked: false };
    }

    const maxCount = Math.max(...requiredCounts.map((c) => c.count));
    const minCount = Math.min(...requiredCounts.map((c) => c.count));
    const ratio = minCount === 0 ? maxCount : maxCount / minCount;

    const most = requiredCounts.filter((c) => c.count === maxCount).map((c) => c.agent);
    const least = requiredCounts.filter((c) => c.count === minCount).map((c) => c.agent);

    const blocked = ratio >= this.biasLimit && maxCount > minCount;

    return { ratio: Math.round(ratio * 10) / 10, most_addressed: most, least_addressed: least, blocked };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd runtime && bun test tests/delegation-router.test.ts`
Expected: 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/delegation-router.ts runtime/tests/delegation-router.test.ts
git commit -m "feat(runtime): add delegation router with bias limits and speaks-last enforcement"
```

---

### Task 7: Config Loader

**Files:**
- Create: `runtime/src/config-loader.ts`
- Create: `runtime/tests/config-loader.test.ts`
- Create: `runtime/fixtures/` (test fixtures)

- [ ] **Step 1: Create test fixtures**

Create `runtime/fixtures/agents/catalyst/agent.yaml`:

```yaml
schema: aos/agent/v1
id: catalyst
name: Catalyst
role: Acceleration and monetization

cognition:
  objective_function: "Maximize revenue within 90 days with viable unit economics"
  time_horizon:
    primary: 30-90 days
    secondary: this quarter
    peripheral: next quarter
  core_bias: speed-and-monetization
  risk_tolerance: moderate
  default_stance: "I want a version customers will pay for in 90 days."

persona:
  temperament:
    - Impatient — velocity is a virtue
    - Ruthless about monetization
  thinking_patterns:
    - "Can we turn this into revenue fast?"
    - "Are we overbuilding before validating willingness to pay?"
  heuristics:
    - name: Ship-It Heuristic
      rule: "If you can ship 60% of the value this week, do it."
    - name: Revenue Test
      rule: "Before building anything: who pays, how much, when?"
  evidence_standard:
    convinced_by: [conversion data, revenue numbers, payback math]
    not_convinced_by: [engagement metrics without conversion]
  red_lines:
    - No extended building without revenue milestones

tensions:
  - agent: sentinel
    dynamic: "short-term extraction vs long-term trust"

report:
  structure: "Lead with stance, then reasoning. End with commercial viability challenge."

tools: null
skills: []
expertise:
  - path: expertise/catalyst-notes.md
    mode: read-write
    use_when: "Track financial implications and stance evolution"

model:
  tier: standard
  thinking: off
```

Create `runtime/fixtures/agents/catalyst/prompt.md`:

```markdown
# Catalyst

You are the Catalyst — the acceleration and monetization perspective.

## Session: {{session_id}}
## Participants: {{participants}}
## Constraints: {{constraints}}

## Expertise
{{expertise_block}}

## Brief
{{brief}}
```

Create `runtime/fixtures/profiles/test-council/profile.yaml`:

```yaml
schema: aos/profile/v1
id: test-council
name: Test Council
description: "Test profile for unit tests"
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    - agent: catalyst
      required: true

delegation:
  default: broadcast
  opening_rounds: 1
  tension_pairs: []
  bias_limit: 5

constraints:
  time:
    min_minutes: 1
    max_minutes: 5
  budget:
    min: 0.50
    max: 5.00
    currency: USD
  rounds:
    min: 1
    max: 4

error_handling:
  agent_timeout_seconds: 60
  retry_policy:
    max_retries: 1
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:
  strategy: fixed_estimate
  fixed_estimate_tokens: 2000
  safety_margin: 0.15
  on_estimate_exceeded: warn_arbiter

input:
  format: brief
  required_sections:
    - heading: "## Situation"
      guidance: "What is happening right now?"
    - heading: "## Key Question"
      guidance: "The single most important question."
  context_files: true

output:
  format: memo
  path_template: "output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md"
  sections: [ranked_recommendations, agent_stances]
  artifacts: []
  frontmatter: [date, duration, budget_used, participants]

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent

controls:
  halt: true
  wrap: true
  interject: false
```

Create `runtime/fixtures/briefs/test-brief/brief.md`:

```markdown
# Brief: Test Decision

## Situation
We are testing the AOS Harness constraint engine.

## Key Question
Does the harness correctly validate and load configuration?
```

- [ ] **Step 2: Write failing tests**

Create `runtime/tests/config-loader.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { loadAgent, loadProfile, loadDomain, validateBrief } from "../src/config-loader";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

describe("loadAgent", () => {
  it("loads a valid agent from yaml + prompt.md", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.id).toBe("catalyst");
    expect(agent.name).toBe("Catalyst");
    expect(agent.cognition.core_bias).toBe("speed-and-monetization");
    expect(agent.persona.heuristics).toHaveLength(2);
    expect(agent.systemPrompt).toContain("{{session_id}}");
  });

  it("throws on missing agent.yaml", () => {
    expect(() => loadAgent("/nonexistent/path")).toThrow();
  });

  it("validates schema field", () => {
    // agent.yaml must have schema: aos/agent/v1
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.schema).toBe("aos/agent/v1");
  });
});

describe("loadProfile", () => {
  it("loads a valid profile", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "test-council"));
    expect(profile.id).toBe("test-council");
    expect(profile.constraints.time.max_minutes).toBe(5);
    expect(profile.assembly.perspectives).toHaveLength(1);
  });

  it("throws on missing profile.yaml", () => {
    expect(() => loadProfile("/nonexistent/path")).toThrow();
  });
});

describe("loadDomain", () => {
  it("loads a valid domain", () => {
    const domain = loadDomain(join(fixturesDir, "domains", "test-domain"));
    expect(domain.id).toBe("test-domain");
    expect(domain.overlays.catalyst).toBeDefined();
    expect(domain.overlays.catalyst.thinking_patterns).toHaveLength(1);
  });

  it("throws on missing domain.yaml", () => {
    expect(() => loadDomain("/nonexistent/path")).toThrow();
  });
});

describe("validateBrief", () => {
  it("validates a brief with all required sections", () => {
    const briefPath = join(fixturesDir, "briefs", "test-brief", "brief.md");
    const requiredSections = [
      { heading: "## Situation", guidance: "" },
      { heading: "## Key Question", guidance: "" },
    ];
    const result = validateBrief(briefPath, requiredSections);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("reports missing sections", () => {
    const briefPath = join(fixturesDir, "briefs", "test-brief", "brief.md");
    const requiredSections = [
      { heading: "## Situation", guidance: "" },
      { heading: "## Stakes", guidance: "What's at risk?" },
      { heading: "## Key Question", guidance: "" },
    ];
    const result = validateBrief(briefPath, requiredSections);
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].heading).toBe("## Stakes");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd runtime && bun test tests/config-loader.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 4: Implement config-loader.ts**

Create `runtime/src/config-loader.ts`:

```typescript
/**
 * Config Loader — loads and validates YAML config files.
 * Uses js-yaml for parsing (no hand-rolled regex).
 * See spec Sections 3.1, 4.1, 5.1 for schemas.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AgentConfig, ProfileConfig, DomainConfig, InputSection } from "./types";

export class ConfigError extends Error {
  constructor(message: string, public path: string) {
    super(`Config error in ${path}: ${message}`);
    this.name = "ConfigError";
  }
}

export function loadAgent(agentDir: string): AgentConfig {
  const yamlPath = join(agentDir, "agent.yaml");
  const promptPath = join(agentDir, "prompt.md");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("agent.yaml not found", agentDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw) as AgentConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("agent.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/agent/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/agent/v1"`,
      yamlPath,
    );
  }

  // Required fields check
  const required = ["id", "name", "role", "cognition", "persona", "model"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  // Load system prompt
  if (existsSync(promptPath)) {
    config.systemPrompt = readFileSync(promptPath, "utf-8");
  }

  // Defaults
  config.tensions = config.tensions || [];
  config.tools = config.tools ?? null;
  config.skills = config.skills || [];
  config.expertise = config.expertise || [];

  return config;
}

export function loadProfile(profileDir: string): ProfileConfig {
  const yamlPath = join(profileDir, "profile.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("profile.yaml not found", profileDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw) as ProfileConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("profile.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/profile/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/profile/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "assembly", "constraints", "input", "output"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  return config;
}

export function loadDomain(domainDir: string): DomainConfig {
  const yamlPath = join(domainDir, "domain.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("domain.yaml not found", domainDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw) as DomainConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("domain.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/domain/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/domain/v1"`,
      yamlPath,
    );
  }

  // Defaults
  config.overlays = config.overlays || {};
  config.additional_input_sections = config.additional_input_sections || [];
  config.additional_output_sections = config.additional_output_sections || [];
  config.guardrails = config.guardrails || [];

  return config;
}

export interface BriefValidation {
  valid: boolean;
  content: string;
  missing: InputSection[];
}

export function validateBrief(
  briefPath: string,
  requiredSections: InputSection[],
): BriefValidation {
  if (!existsSync(briefPath)) {
    throw new ConfigError("Brief file not found", briefPath);
  }

  const content = readFileSync(briefPath, "utf-8");
  const contentLower = content.toLowerCase();

  const missing = requiredSections.filter(
    (s) => !contentLower.includes(s.heading.toLowerCase()),
  );

  return {
    valid: missing.length === 0,
    content,
    missing,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd runtime && bun test tests/config-loader.test.ts`
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add runtime/src/config-loader.ts runtime/tests/config-loader.test.ts runtime/fixtures/
git commit -m "feat(runtime): add config loader with YAML parsing and brief validation"
```

---

### Task 8: Mock Adapter + Engine Integration Test

**Files:**
- Create: `runtime/tests/mock-adapter.ts`
- Create: `runtime/src/engine.ts`
- Create: `runtime/tests/engine.test.ts`

- [ ] **Step 1: Create arbiter and domain fixtures**

Create `runtime/fixtures/agents/arbiter/agent.yaml`:

```yaml
schema: aos/agent/v1
id: arbiter
name: Arbiter
role: Decision integrator and synthesizer

cognition:
  objective_function: "Synthesize competing perspectives into actionable recommendations"
  time_horizon:
    primary: session duration
    secondary: implementation horizon
    peripheral: strategic horizon
  core_bias: neutrality
  risk_tolerance: moderate
  default_stance: "I integrate — I do not advocate."

persona:
  temperament:
    - Neutral — no personal bias
    - Decisive under ambiguity
  thinking_patterns:
    - "Which tensions are most productive to explore?"
    - "Where is the room converging vs. diverging?"
  heuristics:
    - name: Convergence Test
      rule: "If 3+ agents agree, stress-test via Provocateur before accepting."
  evidence_standard:
    convinced_by: [multi-perspective agreement, stress-tested arguments]
    not_convinced_by: [unanimous enthusiasm without challenge]
  red_lines:
    - No decision without documented dissent

tensions: []

report:
  structure: "Ranked recommendations with rationale, agent stances table, dissent section."

tools: null
skills: []
expertise:
  - path: expertise/arbiter-notes.md
    mode: read-write
    use_when: "Track convergence, divergence, evolving thesis"

model:
  tier: premium
  thinking: on
```

Create `runtime/fixtures/agents/arbiter/prompt.md`:

```markdown
# Arbiter

You are the Arbiter — the neutral decision synthesizer.

## Session: {{session_id}}
## Participants: {{participants}}
## Constraints: {{constraints}}

## Brief
{{brief}}
```

Create `runtime/fixtures/domains/test-domain/domain.yaml`:

```yaml
schema: aos/domain/v1
id: test-domain
name: Test Domain
description: "Test domain for unit tests"

lexicon:
  metrics: [test-metric]
  frameworks: [test-framework]
  stages: [test-stage]

overlays:
  catalyst:
    thinking_patterns:
      - "Domain-specific thinking pattern"
    heuristics:
      - name: Domain Heuristic
        rule: "Domain-specific rule"

additional_input_sections: []
additional_output_sections: []
guardrails:
  - "Test guardrail"
```

- [ ] **Step 2: Create MockAdapter**

Create `runtime/tests/mock-adapter.ts`:

```typescript
/**
 * MockAdapter — in-memory adapter for testing the engine without any platform.
 * Records all calls for assertion. Returns configurable responses.
 */

import type {
  AOSAdapter,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  MessageOpts,
  AuthMode,
  ModelCost,
  ContextUsage,
  ModelTier,
  ThinkingMode,
} from "../src/types";

export class MockAdapter implements AOSAdapter {
  public calls: { method: string; args: unknown[] }[] = [];
  public agentResponses: Map<string, string> = new Map();
  public authMode: AuthMode = { type: "api_key", metered: true };
  public modelCosts: Record<string, ModelCost> = {
    economy: { inputPerMillionTokens: 0.25, outputPerMillionTokens: 1.25, currency: "USD" },
    standard: { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0, currency: "USD" },
    premium: { inputPerMillionTokens: 15.0, outputPerMillionTokens: 75.0, currency: "USD" },
  };

  private nextHandleId = 1;
  private handlers: Record<string, Function[]> = {};

  // ── Layer 1: Agent Runtime ────────────────────────────────────

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    this.calls.push({ method: "spawnAgent", args: [config.id, sessionId] });
    return { id: `handle-${this.nextHandleId++}`, agentId: config.id, sessionId };
  }

  async sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse> {
    this.calls.push({ method: "sendMessage", args: [handle.agentId, message.slice(0, 50)] });
    const text = this.agentResponses.get(handle.agentId) || `Response from ${handle.agentId}`;
    return {
      text,
      tokensIn: 500,
      tokensOut: 300,
      cost: 0.012,
      contextTokens: 800,
      model: "mock-model",
      status: "success",
    };
  }

  async destroyAgent(handle: AgentHandle): Promise<void> {
    this.calls.push({ method: "destroyAgent", args: [handle.agentId] });
  }

  setOrchestratorPrompt(prompt: string): void {
    this.calls.push({ method: "setOrchestratorPrompt", args: [prompt.slice(0, 50)] });
  }

  async injectContext(handle: AgentHandle, files: string[]): Promise<void> {
    this.calls.push({ method: "injectContext", args: [handle.agentId, files] });
  }

  getContextUsage(_handle: AgentHandle): ContextUsage {
    return { tokens: 800, percent: 0.08 };
  }

  setModel(_handle: AgentHandle, _modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void {}

  getAuthMode(): AuthMode {
    return this.authMode;
  }

  getModelCost(tier: ModelTier): ModelCost {
    return this.modelCosts[tier];
  }

  abort(): void {
    this.calls.push({ method: "abort", args: [] });
  }

  // ── Layer 2: Event Bus ────────────────────────────────────────

  onSessionStart(handler: () => Promise<void>): void {
    (this.handlers["sessionStart"] ??= []).push(handler);
  }
  onSessionShutdown(handler: () => Promise<void>): void {
    (this.handlers["sessionShutdown"] ??= []).push(handler);
  }
  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void {
    (this.handlers["beforeAgentStart"] ??= []).push(handler);
  }
  onAgentEnd(handler: () => Promise<void>): void {}
  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void {}
  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void {}
  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void {}
  onCompaction(handler: () => Promise<void>): void {}

  // ── Layer 3: User Interface ───────────────────────────────────

  registerCommand(_name: string, _handler: (args: string) => Promise<void>): void {}
  registerTool(_name: string, _schema: Record<string, unknown>, _handler: (params: Record<string, unknown>) => Promise<unknown>): void {}
  renderAgentResponse(agent: string, response: string, _color: string): void {
    this.calls.push({ method: "renderAgentResponse", args: [agent, response.slice(0, 50)] });
  }
  renderCustomMessage(_type: string, _content: string, _details: Record<string, unknown>): void {}
  setWidget(_id: string, _renderer: (() => string[]) | undefined): void {}
  setFooter(_renderer: (width: number) => string[]): void {}
  setStatus(_key: string, _text: string): void {}
  setTheme(_name: string): void {}
  async promptSelect(_label: string, _options: string[]): Promise<number> { return 0; }
  async promptConfirm(_title: string, _message: string): Promise<boolean> { return true; }
  async promptInput(_label: string): Promise<string> { return ""; }
  notify(message: string, level: "info" | "warning" | "error"): void {
    this.calls.push({ method: "notify", args: [level, message.slice(0, 80)] });
  }
  blockInput(_allowedCommands: string[]): void {
    this.calls.push({ method: "blockInput", args: [_allowedCommands] });
  }
  unblockInput(): void {
    this.calls.push({ method: "unblockInput", args: [] });
  }
  steerMessage(message: string): void {
    this.calls.push({ method: "steerMessage", args: [message.slice(0, 50)] });
  }

  // ── Layer 4: Workflow Engine ──────────────────────────────────

  async dispatchParallel(agents: AgentHandle[], message: string): Promise<AgentResponse[]> {
    this.calls.push({ method: "dispatchParallel", args: [agents.map((a) => a.agentId)] });
    const responses: AgentResponse[] = [];
    for (const handle of agents) {
      responses.push(await this.sendMessage(handle, message));
    }
    return responses;
  }

  async isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    return { path: "/tmp/mock-workspace", cleanup: async () => {} };
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.calls.push({ method: "writeFile", args: [path, content.slice(0, 50)] });
  }

  async readFile(path: string): Promise<string> {
    return "";
  }

  async openInEditor(_path: string, _editor: string): Promise<void> {}

  async persistState(key: string, value: unknown): Promise<void> {
    this.calls.push({ method: "persistState", args: [key] });
  }

  async loadState(_key: string): Promise<unknown> {
    return null;
  }
}
```

- [ ] **Step 2: Write engine integration tests**

Create `runtime/tests/engine.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { AOSEngine } from "../src/engine";
import { MockAdapter } from "./mock-adapter";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

describe("AOSEngine", () => {
  it("constructs with adapter and profile", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    expect(engine).toBeDefined();
  });

  it("getConstraintState returns initial state", () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    const state = engine.getConstraintState();
    expect(state.rounds_completed).toBe(0);
    expect(state.metered).toBe(true);
  });

  it("getConstraintState reflects unmetered auth", () => {
    const adapter = new MockAdapter();
    adapter.authMode = { type: "subscription", metered: false, subscription_tier: "max" };
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    const state = engine.getConstraintState();
    expect(state.metered).toBe(false);
  });

  it("delegateMessage calls adapter and returns responses", async () => {
    const adapter = new MockAdapter();
    adapter.agentResponses.set("catalyst", "Ship it now.");
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    const responses = await engine.delegateMessage("all", "What should we do?");
    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0].text).toBe("Ship it now.");
  });

  it("delegateMessage updates constraint state", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    await engine.delegateMessage("all", "First round");
    const state = engine.getConstraintState();
    expect(state.rounds_completed).toBe(1);
    expect(state.budget_spent).toBeGreaterThan(0);
  });

  it("start() validates brief and initializes session", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    await engine.start(join(fixturesDir, "briefs", "test-brief", "brief.md"));
    const transcript = engine.getTranscript();
    expect(transcript.length).toBe(1);
    expect(transcript[0].type).toBe("session_start");
  });

  it("start() throws on invalid brief", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    expect(engine.start("/nonexistent/brief.md")).rejects.toThrow();
  });

  it("end() throws when minimums not met", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    // No rounds completed — minimums not met
    expect(engine.end("Wrap up")).rejects.toThrow("Cannot end");
  });

  it("end() succeeds after minimums met", async () => {
    const adapter = new MockAdapter();
    const engine = new AOSEngine(
      adapter,
      join(fixturesDir, "profiles", "test-council"),
      { agentsDir: join(fixturesDir, "agents") },
    );
    // Run enough rounds to meet minimums (min_rounds: 1, min_budget: 0.50)
    await engine.delegateMessage("all", "Round 1");
    const responses = await engine.end("Wrap up");
    expect(responses.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd runtime && bun test tests/engine.test.ts`
Expected: FAIL — cannot find module `../src/engine`

- [ ] **Step 4: Implement engine.ts**

Create `runtime/src/engine.ts`:

```typescript
/**
 * AOS Engine — the main entry point for the runtime.
 * Composes config-loader, template-resolver, domain-merger,
 * constraint-engine, and delegation-router.
 * Drives the session lifecycle via the AOSAdapter interface.
 *
 * See spec Section 6.2 (Engine Class) and 6.3 (Session Lifecycle).
 */

import { join } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import type {
  AOSAdapter,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  ConstraintState,
  ProfileConfig,
  DomainConfig,
  TranscriptEntry,
} from "./types";
import { loadAgent, loadProfile, loadDomain, validateBrief } from "./config-loader";
import { resolveTemplate } from "./template-resolver";
import { applyDomain } from "./domain-merger";
import { ConstraintEngine } from "./constraint-engine";
import { DelegationRouter, type RoutingResult } from "./delegation-router";

export interface EngineOpts {
  domain?: string;
  agentsDir: string;
  domainDir?: string;
}

export class AOSEngine {
  private adapter: AOSAdapter;
  private profile: ProfileConfig;
  private agents: Map<string, AgentConfig> = new Map();
  private handles: Map<string, AgentHandle> = new Map();
  private constraintEngine: ConstraintEngine;
  private delegationRouter: DelegationRouter;
  private sessionId: string;
  private startTime: number = Date.now();
  private transcriptEntries: TranscriptEntry[] = [];
  private started: boolean = false;

  constructor(adapter: AOSAdapter, profilePath: string, opts: EngineOpts) {
    this.adapter = adapter;
    this.sessionId = this.generateSessionId();

    // Load profile
    this.profile = loadProfile(profilePath);

    // Load agents referenced in profile
    const agentIds = [
      this.profile.assembly.orchestrator,
      ...this.profile.assembly.perspectives.map((p) => p.agent),
    ];

    for (const id of agentIds) {
      const agentDir = join(opts.agentsDir, id);
      if (existsSync(agentDir)) {
        this.agents.set(id, loadAgent(agentDir));
      }
    }

    // Apply domain if specified
    if (opts.domain && opts.domainDir) {
      const domain = loadDomain(opts.domainDir);
      const agentList = [...this.agents.values()];
      const merged = applyDomain(agentList, domain);
      for (const agent of merged) {
        this.agents.set(agent.id, agent);
      }
    }

    // Initialize constraint engine
    const authMode = adapter.getAuthMode();
    this.constraintEngine = new ConstraintEngine(this.profile.constraints, authMode);

    // Initialize delegation router
    this.delegationRouter = new DelegationRouter(
      this.profile.assembly.perspectives,
      this.profile.delegation.tension_pairs,
      this.profile.delegation.bias_limit,
      this.profile.delegation.opening_rounds,
    );
  }

  /**
   * Initialize the session: validate brief, inject orchestrator prompt, block input.
   * Must be called before delegateMessage.
   */
  async start(inputPath: string): Promise<void> {
    // Validate brief
    const briefValidation = validateBrief(
      inputPath,
      this.profile.input.required_sections,
    );
    if (!briefValidation.valid) {
      const missing = briefValidation.missing.map((s) => s.heading).join(", ");
      throw new Error(`Brief missing required sections: ${missing}`);
    }

    this.startTime = Date.now();
    this.started = true;

    // Write session_start transcript entry
    this.recordTranscript({
      type: "session_start",
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      profile: this.profile.id,
      participants: [...this.agents.keys()],
      constraints: this.profile.constraints,
      auth_mode: this.adapter.getAuthMode(),
    });
  }

  getConstraintState(): ConstraintState {
    const state = this.constraintEngine.getState();
    const bias = this.delegationRouter.getBiasState();
    this.constraintEngine.updateBias(
      bias.ratio,
      bias.most_addressed,
      bias.least_addressed,
      bias.blocked,
    );
    return this.constraintEngine.getState();
  }

  async delegateMessage(
    to: string | string[] | "all",
    message: string,
  ): Promise<AgentResponse[]> {
    // Resolve delegation target
    const target = this.parseTarget(to);
    const round = this.constraintEngine.getState().rounds_completed + 1;
    const routing = this.delegationRouter.resolve(target, round);

    if (routing.blocked) {
      throw new Error(
        `Bias limit reached. Address neglected agents first: ${routing.neglected.join(", ")}`,
      );
    }

    // Spawn agents if needed, then dispatch
    const parallelHandles = await this.ensureHandles(routing.parallel);
    const sequentialHandles = await this.ensureHandles(routing.sequential);

    // Parallel dispatch
    const parallelResponses = await this.adapter.dispatchParallel(parallelHandles, message);

    // Sequential dispatch (speaks-last)
    const sequentialResponses: AgentResponse[] = [];
    for (const handle of sequentialHandles) {
      const resp = await this.adapter.sendMessage(handle, message);
      sequentialResponses.push(resp);
    }

    const allResponses = [...parallelResponses, ...sequentialResponses];

    // Calculate round cost and elapsed time
    const roundCost = allResponses.reduce((sum, r) => sum + r.cost, 0);
    const elapsedMinutes = (Date.now() - this.startTime) / 1000 / 60;

    // Record round in constraint engine
    this.constraintEngine.recordRound(roundCost, elapsedMinutes);

    return allResponses;
  }

  async end(closingMessage: string): Promise<AgentResponse[]> {
    const state = this.getConstraintState();
    if (!state.can_end) {
      throw new Error("Cannot end: minimums not met and no maximum hit.");
    }

    // Final statements from all agents (speaks-last goes last)
    const routing = this.delegationRouter.resolve({ type: "broadcast" }, -1);
    const parallelHandles = await this.ensureHandles(routing.parallel);
    const sequentialHandles = await this.ensureHandles(routing.sequential);

    const parallelResponses = await this.adapter.dispatchParallel(parallelHandles, closingMessage);
    const sequentialResponses: AgentResponse[] = [];
    for (const handle of sequentialHandles) {
      const resp = await this.adapter.sendMessage(handle, closingMessage);
      sequentialResponses.push(resp);
    }

    return [...parallelResponses, ...sequentialResponses];
  }

  private parseTarget(to: string | string[] | "all") {
    if (to === "all") return { type: "broadcast" as const };
    if (Array.isArray(to)) return { type: "targeted" as const, agents: to };
    return { type: "targeted" as const, agents: [to] };
  }

  private async ensureHandles(agentIds: string[]): Promise<AgentHandle[]> {
    const handles: AgentHandle[] = [];
    for (const id of agentIds) {
      if (!this.handles.has(id)) {
        const config = this.agents.get(id);
        if (!config) throw new Error(`Agent "${id}" not loaded`);
        const handle = await this.adapter.spawnAgent(config, this.sessionId);
        this.handles.set(id, handle);
      }
      handles.push(this.handles.get(id)!);
    }
    return handles;
  }

  private recordTranscript(entry: TranscriptEntry): void {
    this.transcriptEntries.push(entry);
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcriptEntries];
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 8);
  }
}
```

- [ ] **Step 5: Run all tests**

Run: `cd runtime && bun test`
Expected: All tests PASS across all test files

- [ ] **Step 6: Type check the full project**

Run: `cd runtime && bun x tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add runtime/src/engine.ts runtime/tests/mock-adapter.ts runtime/tests/engine.test.ts
git commit -m "feat(runtime): add AOSEngine with session lifecycle, mock adapter, and integration tests"
```

---

### Task 9: Final Validation

- [ ] **Step 1: Run full test suite**

Run: `cd runtime && bun test --verbose`
Expected: All tests pass. Target: 40+ tests across 7 test files.

- [ ] **Step 2: Type check**

Run: `cd runtime && bun x tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Verify file structure matches plan**

Run: `find runtime -type f -not -path '*/node_modules/*' -not -path '*/bun.lock' | sort`

Expected:
```
runtime/fixtures/agents/catalyst/agent.yaml
runtime/fixtures/agents/catalyst/prompt.md
runtime/fixtures/briefs/test-brief/brief.md
runtime/fixtures/profiles/test-council/profile.yaml
runtime/package.json
runtime/src/config-loader.ts
runtime/src/constraint-engine.ts
runtime/src/delegation-router.ts
runtime/src/domain-merger.ts
runtime/src/engine.ts
runtime/src/template-resolver.ts
runtime/src/types.ts
runtime/tests/config-loader.test.ts
runtime/tests/constraint-engine.test.ts
runtime/tests/delegation-router.test.ts
runtime/tests/domain-merger.test.ts
runtime/tests/engine.test.ts
runtime/tests/mock-adapter.ts
runtime/tests/types.test.ts
runtime/tsconfig.json
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: runtime v0.1.0 — all modules implemented and tested"
```
