# AOS Harness Integration Testing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the complete AOS Harness end-to-end: Pi adapter loads without errors, `/aos-run` command works, agent subprocesses spawn correctly, the deliberation loop functions, and a structured memo is produced. Fix all issues found.

**Architecture:** This plan uses Pi CLI's `drive` skill (tmux-based terminal automation) to run Pi in a tmux session, send commands, and verify output — enabling automated integration testing without interactive manual work.

**Prerequisites:**
- Pi CLI installed and accessible via `pi` command
- `ANTHROPIC_API_KEY` set in environment (or Pi authenticated via subscription)
- Bun installed
- All runtime tests passing (verified: 65/65)

**Spec:** `docs/specs/2026-03-23-aos-harness-design.md`

---

## File Structure

```
aos-harness/
├── tests/
│   └── integration/
│       ├── smoke-test.sh             # Shell script: load extension, verify startup
│       └── validate-config.ts        # Bun script: load all configs programmatically
├── .gitignore                        # Add .aos/ to gitignore
└── justfile                          # Task runner for common commands
```

---

### Task 1: Project Hygiene — .gitignore + justfile

**Files:**
- Create: `.gitignore`
- Create: `justfile`

- [ ] **Step 1: Create .gitignore**

Create `.gitignore`:

```
# Dependencies
node_modules/
bun.lock

# AOS session data
.aos/

# Superpowers brainstorm sessions
.superpowers/

# OS files
.DS_Store

# Build output
dist/
```

- [ ] **Step 2: Create justfile**

Create `justfile`:

```just
set dotenv-load := true
set shell := ["bash", "-lc"]

default:
    @just --list

# Run all runtime unit tests
test:
    cd runtime && bun test

# Type check runtime
typecheck:
    cd runtime && bun x tsc --noEmit

# Validate all core configs load correctly
validate:
    cd runtime && bun run ../tests/integration/validate-config.ts

# Launch AOS via Pi adapter
run:
    cd adapters/pi && bun install --silent && pi -e src/index.ts

# Clean session data
clean:
    rm -rf .aos/
```

- [ ] **Step 3: Commit**

```bash
cd aos-harness
git add .gitignore justfile
git commit -m "chore: add .gitignore and justfile task runner"
```

---

### Task 2: Config Validation Script

**Files:**
- Create: `tests/integration/validate-config.ts`

- [ ] **Step 1: Create test directory**

```bash
mkdir -p tests/integration
```

- [ ] **Step 2: Create validate-config.ts**

Create `tests/integration/validate-config.ts`:

```typescript
/**
 * Integration test: Validate all core configs load correctly via the runtime.
 * Run with: bun run tests/integration/validate-config.ts
 */

import { join } from "node:path";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { loadAgent, loadProfile, loadDomain, validateBrief } from "../../runtime/src/config-loader";
import { applyDomain } from "../../runtime/src/domain-merger";
import { resolveTemplate } from "../../runtime/src/template-resolver";
import { ConstraintEngine } from "../../runtime/src/constraint-engine";
import { DelegationRouter } from "../../runtime/src/delegation-router";
import type { AgentConfig, AuthMode } from "../../runtime/src/types";

const projectRoot = join(import.meta.dir, "../..");
const coreDir = join(projectRoot, "core");
let passed = 0;
let failed = 0;
const errors: string[] = [];

function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✗ ${label}: ${e.message}`);
    errors.push(`${label}: ${e.message}`);
    failed++;
  }
}

// ── 1. Discover and load all agents ──────────────────────────────

console.log("\n── Agent Loading ──");

function discoverAgentDirs(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const subDir = join(dir, entry.name);
    if (existsSync(join(subDir, "agent.yaml"))) {
      results.push(subDir);
    } else {
      results.push(...discoverAgentDirs(subDir));
    }
  }
  return results;
}

const agentDirs = discoverAgentDirs(join(coreDir, "agents"));
const agents: AgentConfig[] = [];

for (const dir of agentDirs) {
  const name = dir.split("/").pop()!;
  check(`Agent: ${name}`, () => {
    const agent = loadAgent(dir);
    if (!agent.id) throw new Error("Missing id");
    if (!agent.name) throw new Error("Missing name");
    if (!agent.cognition?.objective_function) throw new Error("Missing cognition.objective_function");
    if (!agent.persona?.temperament?.length) throw new Error("Missing persona.temperament");
    if (!agent.persona?.thinking_patterns?.length) throw new Error("Missing persona.thinking_patterns");
    if (!agent.persona?.heuristics?.length) throw new Error("Missing persona.heuristics");
    if (agent.systemPrompt === undefined) throw new Error("Missing prompt.md");
    if (!agent.systemPrompt.includes("{{")) throw new Error("No template variables in prompt.md");
    agents.push(agent);
  });
}

check(`Expected 12 agents, found ${agents.length}`, () => {
  if (agents.length !== 12) throw new Error(`Expected 12, got ${agents.length}`);
});

// ── 2. Load profile ──────────────────────────────────────────────

console.log("\n── Profile Loading ──");

let profile: ReturnType<typeof loadProfile> | null = null;

check("Profile: strategic-council", () => {
  profile = loadProfile(join(coreDir, "profiles/strategic-council"));
  if (!profile.assembly?.orchestrator) throw new Error("Missing assembly.orchestrator");
  if (!profile.assembly?.perspectives?.length) throw new Error("Missing assembly.perspectives");
  if (!profile.constraints) throw new Error("Missing constraints");
  if (!profile.input?.required_sections?.length) throw new Error("Missing input.required_sections");
  if (!profile.delegation?.tension_pairs?.length) throw new Error("Missing delegation.tension_pairs");
});

check("Profile references valid agents", () => {
  if (!profile) throw new Error("Profile not loaded");
  const agentIds = new Set(agents.map(a => a.id));
  const orchestrator = profile.assembly.orchestrator;
  if (!agentIds.has(orchestrator)) throw new Error(`Orchestrator "${orchestrator}" not found in agents`);
  for (const p of profile.assembly.perspectives) {
    if (!agentIds.has(p.agent)) throw new Error(`Perspective "${p.agent}" not found in agents`);
  }
});

check("Profile tension pairs reference valid agents", () => {
  if (!profile) throw new Error("Profile not loaded");
  const agentIds = new Set(agents.map(a => a.id));
  for (const [a, b] of profile.delegation.tension_pairs) {
    if (!agentIds.has(a)) throw new Error(`Tension pair agent "${a}" not found`);
    if (!agentIds.has(b)) throw new Error(`Tension pair agent "${b}" not found`);
  }
});

// ── 3. Load domain ───────────────────────────────────────────────

console.log("\n── Domain Loading ──");

check("Domain: saas", () => {
  const domain = loadDomain(join(coreDir, "domains/saas"));
  if (!domain.overlays || Object.keys(domain.overlays).length === 0) throw new Error("No overlays");
  if (!domain.lexicon?.metrics?.length) throw new Error("Missing lexicon.metrics");

  // Verify overlays reference valid agent IDs
  const agentIds = new Set(agents.map(a => a.id));
  for (const overlayAgentId of Object.keys(domain.overlays)) {
    if (!agentIds.has(overlayAgentId)) {
      throw new Error(`Overlay for unknown agent: "${overlayAgentId}"`);
    }
  }

  // Test domain merging
  const merged = applyDomain(agents, domain);
  if (merged.length !== agents.length) throw new Error("Domain merge changed agent count");
});

// ── 4. Validate brief ────────────────────────────────────────────

console.log("\n── Brief Validation ──");

check("Brief: sample-product-decision", () => {
  if (!profile) throw new Error("Profile not loaded");
  const briefPath = join(coreDir, "briefs/sample-product-decision/brief.md");
  const result = validateBrief(briefPath, profile.input.required_sections);
  if (!result.valid) throw new Error(`Missing sections: ${result.missing.map(s => s.heading).join(", ")}`);
});

// ── 5. Template resolution ───────────────────────────────────────

console.log("\n── Template Resolution ──");

check("Arbiter prompt template resolves", () => {
  const arbiter = agents.find(a => a.id === "arbiter");
  if (!arbiter?.systemPrompt) throw new Error("Arbiter not found or no prompt");
  const resolved = resolveTemplate(arbiter.systemPrompt, {
    session_id: "test-session",
    participants: "catalyst, sentinel, architect",
    constraints: "2-10 min | $1-$10",
    brief: "# Test Brief\n\n## Situation\nTest",
    output_path: "/tmp/test-memo.md",
    deliberation_dir: "/tmp/test-session",
    expertise_block: "- arbiter-notes.md [read-write]",
  });
  if (resolved.includes("{{session_id}}")) throw new Error("session_id not resolved");
  if (resolved.includes("{{brief}}")) throw new Error("brief not resolved");
  if (!resolved.includes("test-session")) throw new Error("session_id value not present");
});

check("Perspective agent prompt template resolves", () => {
  const catalyst = agents.find(a => a.id === "catalyst");
  if (!catalyst?.systemPrompt) throw new Error("Catalyst not found or no prompt");
  const resolved = resolveTemplate(catalyst.systemPrompt, {
    session_id: "test-session",
    agent_id: "catalyst",
    agent_name: "Catalyst",
    participants: "catalyst, sentinel",
    constraints: "2-10 min",
    brief: "# Test",
    expertise_block: "",
    deliberation_dir: "/tmp",
    transcript_path: "/tmp/transcript.jsonl",
  });
  if (resolved.includes("{{agent_id}}")) throw new Error("agent_id not resolved");
  if (resolved.includes("{{brief}}")) throw new Error("brief not resolved");
});

// ── 6. Constraint engine ─────────────────────────────────────────

console.log("\n── Constraint Engine ──");

check("Constraint engine initializes from profile", () => {
  if (!profile) throw new Error("Profile not loaded");
  const auth: AuthMode = { type: "api_key", metered: true };
  const engine = new ConstraintEngine(profile.constraints, auth);
  const state = engine.getState();
  if (state.rounds_completed !== 0) throw new Error("Initial rounds should be 0");
  if (state.metered !== true) throw new Error("Should be metered");
});

// ── 7. Delegation router ────────────────────────────────────────

console.log("\n── Delegation Router ──");

check("Delegation router initializes from profile", () => {
  if (!profile) throw new Error("Profile not loaded");
  const router = new DelegationRouter(
    profile.assembly.perspectives,
    profile.delegation.tension_pairs,
    profile.delegation.bias_limit,
    profile.delegation.opening_rounds,
  );
  const result = router.resolve({ type: "broadcast" }, 1);
  if (result.parallel.length === 0) throw new Error("No parallel agents in broadcast");
  // Provocateur should be in sequential (speaks-last)
  const provocateurInSequential = result.sequential.includes("provocateur");
  if (!provocateurInSequential) throw new Error("Provocateur should be in sequential (speaks-last)");
});

// ── Summary ──────────────────────────────────────────────────────

console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log(`\n  Errors:`);
  for (const e of errors) {
    console.log(`    ✗ ${e}`);
  }
}
console.log(`${"═".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run the validation**

```bash
cd aos-harness
bun run tests/integration/validate-config.ts
```

Expected: All checks pass. If any fail, fix the underlying issue before proceeding.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add integration config validation script"
```

---

### Task 3: Fix Issues Found by Config Validation

- [ ] **Step 1: Run the validation script and capture output**

```bash
cd aos-harness
bun run tests/integration/validate-config.ts 2>&1
```

- [ ] **Step 2: Fix any failures**

Common expected issues:
- Domain overlay agent IDs might not match actual agent IDs (e.g., overlay key is "catalyst" but agent YAML has different casing)
- Template variables in prompts might use inconsistent naming (e.g., `{{BRIEF}}` vs `{{brief}}`)
- Profile's `assembly.perspectives` might reference agents by wrong ID
- Brief might be missing a required section

For each failure: identify the root cause, fix the config file, re-run validation.

- [ ] **Step 3: Re-run until all pass**

```bash
bun run tests/integration/validate-config.ts
```

Expected: All checks pass (0 failures).

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: address integration validation findings"
```

---

### Task 4: Pi Extension Load Test

Test that the Pi extension loads without runtime errors — NOT a full deliberation, just startup.

- [ ] **Step 1: Verify Pi is available**

```bash
which pi && pi --version
```

If Pi is not installed, this task and Task 5 must be deferred.

- [ ] **Step 2: Test extension loading**

```bash
cd adapters/pi
timeout 10 pi -e src/index.ts --help 2>&1 || echo "EXIT: $?"
```

Expected: Pi starts, loads the extension, shows the AOS startup notification. If it errors, capture the error and fix.

Common issues:
- Import path resolution failures (runtime → adapter relative paths)
- Missing peer dependencies (Pi types, TypeBox)
- TypeScript compilation errors in extension

- [ ] **Step 3: Fix any load errors**

For each error: trace back to the source file, fix, re-test.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: address Pi extension load errors"
```

---

### Task 5: End-to-End Deliberation Test

This is the full integration test — a real deliberation with real model calls.

**IMPORTANT:** This task costs real API money ($1-$10 depending on constraints). Ensure the profile constraints are set appropriately:
- `min_minutes: 1, max_minutes: 3` (keep it short)
- `min_budget: 0.50, max_budget: 3.00` (cap spending)
- `min_rounds: 1, max_rounds: 3` (limit rounds)

- [ ] **Step 1: Create a minimal test profile**

Create `core/profiles/quick-test/profile.yaml` — a stripped-down version of strategic-council with only 4 required agents (catalyst, sentinel, architect, provocateur), tight constraints (max 3 min, $3, 3 rounds), and the sample brief.

- [ ] **Step 2: Run the deliberation**

```bash
cd aos-harness
pi -e adapters/pi/src/index.ts
# In Pi TUI: /aos-run → select "quick-test" → select "sample-product-decision"
```

- [ ] **Step 3: Observe and document**

Watch for:
- Does `/aos-run` list profiles and briefs correctly?
- Does brief validation pass?
- Does the Arbiter receive its system prompt?
- Does `delegate("all", ...)` spawn agent subprocesses?
- Do agents respond with differentiated perspectives?
- Does the streaming widget show responses in real time?
- Do constraint gauges update?
- Does the Arbiter call `end()` when constraints are met?
- Is a memo produced with frontmatter?
- Is a transcript written?

- [ ] **Step 4: Fix any issues found**

For each issue: trace to root cause, fix, re-test if budget allows.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: complete end-to-end deliberation test, fix integration issues"
git tag v0.1.0
```

---

## Success Criteria

1. `bun run tests/integration/validate-config.ts` — all checks pass
2. `just test` — 65+ runtime unit tests pass
3. Pi extension loads without errors
4. At least one complete deliberation produces a structured memo
5. Transcript JSONL file is written with correct event types
