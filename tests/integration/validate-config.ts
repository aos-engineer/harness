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

check(`Expected 15 agents, found ${agents.length}`, () => {
  if (agents.length !== 15) throw new Error(`Expected 15, got ${agents.length}`);
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
