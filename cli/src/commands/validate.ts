/**
 * aos validate — Validate all agents, profiles, domains, and briefs.
 * Reuses the same validation logic as tests/integration/validate-config.ts.
 */

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { c, type ParsedArgs } from "../colors";
import { getHarnessRoot, discoverDirs } from "../utils";

const HELP = `
${c.bold("aos validate")} — Validate all AOS configuration

${c.bold("USAGE")}
  aos validate

${c.bold("DESCRIPTION")}
  Loads and validates all agents, profiles, domains, skills, and briefs in core/.
  Reports any schema violations, missing fields, or reference errors.
  Uses the runtime config-loader and integration validation logic.

${c.bold("CHECKS")}
  - All agents load and have required fields (id, name, cognition, persona, etc.)
  - All agents have prompt.md with template variables
  - Profiles load and reference valid agents
  - Execution profiles reference valid workflows
  - Tension pairs reference valid agents
  - Domains load and overlays reference valid agents
  - Domain merging produces valid output
  - Skills load and have required fields (id, name, input, output, etc.)
  - Skills reference valid compatible agents
  - Briefs are well-formed (deliberation or execution shape)
  - Template resolution works for all agents
  - Constraint engine initializes from profiles
  - Delegation router initializes from profiles
`;

interface CheckResult {
  label: string;
  passed: boolean;
  error?: string;
}

export async function validateCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  const root = getHarnessRoot();
  const coreDir = join(root, "core");

  // Import runtime modules
  const { loadAgent, loadProfile, loadDomain, loadWorkflow, loadSkill } = await import("@aos-harness/runtime/config-loader");
  const { applyDomain } = await import("@aos-harness/runtime/domain-merger");
  const { resolveTemplate } = await import("@aos-harness/runtime/template-resolver");
  const { ConstraintEngine } = await import("@aos-harness/runtime/constraint-engine");
  const { DelegationRouter } = await import("@aos-harness/runtime/delegation-router");

  const results: CheckResult[] = [];

  function check(label: string, fn: () => void): void {
    try {
      fn();
      results.push({ label, passed: true });
    } catch (e: any) {
      results.push({ label, passed: false, error: e.message });
    }
  }

  // ── 1. Load all agents ────────────────────────────────────────

  console.log(`\n${c.bold("Validating agents...")}`);

  const agentDirs = discoverDirs(join(coreDir, "agents"), "agent.yaml");
  const agents: any[] = [];

  for (const dir of agentDirs) {
    const name = basename(dir);
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

  // ── 2. Load all profiles ──────────────────────────────────────

  console.log(`${c.bold("Validating profiles...")}`);

  const profileDirs = discoverDirs(join(coreDir, "profiles"), "profile.yaml");
  const profiles: any[] = [];

  for (const dir of profileDirs) {
    const name = basename(dir);
    check(`Profile: ${name}`, () => {
      const profile = loadProfile(dir);
      if (!profile.assembly?.orchestrator) throw new Error("Missing assembly.orchestrator");
      if (!profile.assembly?.perspectives?.length) throw new Error("Missing assembly.perspectives");
      if (!profile.constraints) throw new Error("Missing constraints");
      if (!profile.input?.required_sections?.length) throw new Error("Missing input.required_sections");
      profiles.push(profile);
    });
  }

  // Cross-reference: profiles must reference valid agents
  const agentIds = new Set(agents.map((a) => a.id));

  for (const profile of profiles) {
    check(`Profile "${profile.id}" references valid agents`, () => {
      if (!agentIds.has(profile.assembly.orchestrator)) {
        throw new Error(`Orchestrator "${profile.assembly.orchestrator}" not found in agents`);
      }
      for (const p of profile.assembly.perspectives) {
        if (!agentIds.has(p.agent)) {
          throw new Error(`Perspective "${p.agent}" not found in agents`);
        }
      }
    });

    if (profile.delegation?.tension_pairs) {
      check(`Profile "${profile.id}" tension pairs valid`, () => {
        for (const [a, b] of profile.delegation.tension_pairs) {
          if (!agentIds.has(a)) throw new Error(`Tension pair agent "${a}" not found`);
          if (!agentIds.has(b)) throw new Error(`Tension pair agent "${b}" not found`);
        }
      });
    }
  }

  // Cross-reference: execution profiles must reference valid workflows
  const workflowsDir = join(coreDir, "workflows");

  for (const profile of profiles) {
    if (!profile.workflow) continue;
    check(`Profile "${profile.id}" workflow "${profile.workflow}"`, () => {
      const workflowId = profile.workflow!;
      // Reject path-traversal / absolute segments before building candidates so
      // a profile's workflow id can't escape core/workflows (defense-in-depth).
      if (workflowId.includes("..") || workflowId.includes("/") || workflowId.includes("\\") || workflowId.includes("\0")) {
        throw new Error(`invalid workflow id "${workflowId}" (must not contain path separators or "..")`);
      }
      // Try several naming conventions
      const candidates = [
        join(workflowsDir, `${workflowId.replace(/-workflow$/, "")}.workflow.yaml`),
        join(workflowsDir, `${workflowId}.workflow.yaml`),
        join(workflowsDir, `${workflowId}.yaml`),
        join(workflowsDir, workflowId, "workflow.yaml"),
      ];

      let found = false;
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          const wf = loadWorkflow(candidate);
          // Validate that workflow steps reference agents in the profile assembly
          const profileAgentIds = new Set([
            profile.assembly.orchestrator,
            ...profile.assembly.perspectives.map((p: { agent: string }) => p.agent),
          ]);
          for (const step of wf.steps) {
            if (step.agents) {
              for (const agent of step.agents) {
                if (!profileAgentIds.has(agent)) {
                  throw new Error(
                    `Workflow step "${step.id}" references agent "${agent}" not in profile assembly`,
                  );
                }
              }
            }
          }
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error(`Workflow file not found for "${workflowId}" in ${workflowsDir}`);
      }
    });
  }

  // ── 3. Load all skills ─────────────────────────────────────────

  console.log(`${c.bold("Validating skills...")}`);

  const skillDirs = discoverDirs(join(coreDir, "skills"), "skill.yaml");
  const skills: any[] = [];

  for (const dir of skillDirs) {
    const name = basename(dir);
    check(`Skill: ${name}`, () => {
      const skill = loadSkill(dir);
      if (!skill.id) throw new Error("Missing id");
      if (!skill.name) throw new Error("Missing name");
      if (!skill.description) throw new Error("Missing description");
      if (!skill.input) throw new Error("Missing input");
      if (!skill.output) throw new Error("Missing output");
      skills.push(skill);
    });
  }

  // Cross-reference: skill compatible_agents must reference valid agent IDs
  for (const skill of skills) {
    if (skill.compatible_agents?.length) {
      check(`Skill "${skill.id}" references valid agents`, () => {
        for (const agent of skill.compatible_agents) {
          if (!agentIds.has(agent)) {
            throw new Error(`Compatible agent "${agent}" not found in agents`);
          }
        }
      });
    }
  }

  // ── 4. Load all domains ───────────────────────────────────────

  console.log(`${c.bold("Validating domains...")}`);

  const domainDirs = discoverDirs(join(coreDir, "domains"), "domain.yaml");

  for (const dir of domainDirs) {
    const name = basename(dir);
    check(`Domain: ${name}`, () => {
      const domain = loadDomain(dir);
      if (!domain.id) throw new Error("Missing id");
      if (!domain.name) throw new Error("Missing name");

      // Verify overlays reference valid agent IDs
      if (domain.overlays) {
        for (const overlayAgentId of Object.keys(domain.overlays)) {
          if (!agentIds.has(overlayAgentId)) {
            throw new Error(`Overlay for unknown agent: "${overlayAgentId}"`);
          }
        }
      }

      // Test domain merging
      if (agents.length > 0) {
        const merged = applyDomain(agents, domain);
        if (merged.length !== agents.length) {
          throw new Error("Domain merge changed agent count");
        }
      }
    });
  }

  // ── 5. Validate briefs ────────────────────────────────────────
  //
  // Briefs are authored per-profile; checking every brief against every
  // profile's required_sections (a cross-product) produces noise — `incident-
  // response` and `strategic-council` have different required sections by
  // design. We only check each brief is well-formed (matches one of the
  // canonical kinds: deliberation or execution). Run-time enforcement of
  // profile-specific required sections happens in `aos run` — both via the
  // brief lint summary and via the runtime config-loader's validateBrief
  // against the chosen profile.

  console.log(`${c.bold("Validating briefs...")}`);

  const briefsDir = join(coreDir, "briefs");
  if (existsSync(briefsDir)) {
    const { readFileSync } = await import("node:fs");
    const { validateBrief: lintBrief } = await import("../brief/validate");

    for (const entry of readdirSync(briefsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const briefPath = join(briefsDir, entry.name, "brief.md");
      if (!existsSync(briefPath)) continue;

      check(`Brief "${entry.name}" is well-formed`, () => {
        const content = readFileSync(briefPath, "utf-8");
        const result = lintBrief(content);
        if (result.errors.length > 0) {
          throw new Error(result.errors.map((e) => e.message).join(" "));
        }
        if (result.warnings.length > 0) {
          console.log(c.dim(`    ${result.warnings.length} warning(s) — run \`aos brief validate ${briefPath}\` for details.`));
        }
      });
    }
  }

  // ── 6. Template resolution ────────────────────────────────────

  console.log(`${c.bold("Validating template resolution...")}`);

  for (const agent of agents) {
    if (!agent.systemPrompt) continue;
    check(`Template: ${agent.id}`, () => {
      const vars: Record<string, string> = {
        session_id: "test-session",
        agent_id: agent.id,
        agent_name: agent.name,
        participants: "catalyst, sentinel, architect",
        constraints: "2-10 min | $1-$10",
        brief: "# Test Brief\n\n## Situation\nTest",
        output_path: "/tmp/test-memo.md",
        deliberation_dir: "/tmp/test-session",
        expertise_block: `- ${agent.id}-notes.md [read-write]`,
        transcript_path: "/tmp/transcript.jsonl",
      };
      const resolved = resolveTemplate(agent.systemPrompt, vars);
      if (resolved.includes("{{session_id}}")) throw new Error("session_id not resolved");
      if (resolved.includes("{{brief}}")) throw new Error("brief not resolved");
    });
  }

  // ── 7. Constraint engine ──────────────────────────────────────

  console.log(`${c.bold("Validating constraint engine...")}`);

  for (const profile of profiles) {
    check(`Constraint engine: ${profile.id}`, () => {
      const auth = { type: "api_key" as const, metered: true };
      const engine = new ConstraintEngine(profile.constraints, auth);
      const state = engine.getState();
      if (state.rounds_completed !== 0) throw new Error("Initial rounds should be 0");
    });
  }

  // ── 8. Delegation router ──────────────────────────────────────

  console.log(`${c.bold("Validating delegation router...")}`);

  for (const profile of profiles) {
    if (!profile.delegation) continue;
    check(`Delegation router: ${profile.id}`, () => {
      const router = new DelegationRouter(
        profile.assembly.perspectives,
        profile.delegation.tension_pairs,
        profile.delegation.bias_limit,
        profile.delegation.opening_rounds,
      );
      const result = router.resolve({ type: "broadcast" }, 1);
      if (result.parallel.length === 0 && result.sequential.length === 0) {
        throw new Error("No agents resolved from broadcast");
      }
    });
  }

  // ── Summary ───────────────────────────────────────────────────

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log();

  for (const r of results) {
    if (r.passed) {
      console.log(`  ${c.green("PASS")} ${r.label}`);
    } else {
      console.log(`  ${c.red("FAIL")} ${r.label}: ${r.error}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${c.green(`${passed} passed`)}, ${failed > 0 ? c.red(`${failed} failed`) : `${failed} failed`}`);
  console.log(`${"=".repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}
