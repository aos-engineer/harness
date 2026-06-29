/**
 * aos list — List all available agents, profiles, and domains.
 */

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { c, type ParsedArgs } from "../colors";
import { getHarnessRoot, discoverDirs } from "../utils";

const HELP = `
${c.bold("aos list")} — List all available agents, profiles, domains, and skills

${c.bold("USAGE")}
  aos list

${c.bold("DESCRIPTION")}
  Discovers and displays all agents, profiles, domains, skills, and briefs
  in the core/ directory with brief descriptions.
`;

export async function listCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  const root = getHarnessRoot();
  const coreDir = join(root, "core");

  const { loadAgent, loadProfile, loadDomain, loadSkill } = await import("@aos-harness/runtime/config-loader");

  // ── Agents ────────────────────────────────────────────────────

  console.log(`\n${c.bold("Agents")}`);

  const agentDirs = discoverDirs(join(coreDir, "agents"), "agent.yaml");

  if (agentDirs.length === 0) {
    console.log(c.dim("  No agents found."));
  } else {
    // Group by category (parent directory name)
    const grouped: Record<string, { id: string; name: string; role: string }[]> = {};

    for (const dir of agentDirs) {
      try {
        const agent = loadAgent(dir);
        // Determine category from path: core/agents/<category>/<agent-name>
        const parts = dir.split("/");
        const agentIdx = parts.indexOf("agents");
        const category = agentIdx >= 0 && parts.length > agentIdx + 2
          ? parts[agentIdx + 1]
          : "other";

        if (!grouped[category]) grouped[category] = [];
        grouped[category].push({
          id: agent.id,
          name: agent.name,
          role: agent.role.length > 80 ? agent.role.slice(0, 77) + "..." : agent.role,
        });
      } catch {
        console.log(c.yellow(`  ? ${basename(dir)} (failed to load)`));
      }
    }

    for (const [category, agents] of Object.entries(grouped)) {
      console.log(`\n  ${c.bold(c.cyan(category))}`);
      for (const agent of agents) {
        console.log(`    ${c.bold(agent.id.padEnd(16))} ${c.dim(agent.role)}`);
      }
    }
  }

  // ── Profiles ──────────────────────────────────────────────────

  console.log(`\n${c.bold("Profiles")}`);

  const profileDirs = discoverDirs(join(coreDir, "profiles"), "profile.yaml");

  if (profileDirs.length === 0) {
    console.log(c.dim("  No profiles found."));
  } else {
    for (const dir of profileDirs) {
      try {
        const profile = loadProfile(dir);
        const agentCount = (profile.assembly.perspectives?.length || 0) + 1; // +1 for orchestrator
        const profileType = profile.workflow ? c.magenta("[execution]") : c.cyan("[deliberation]");
        const desc = profile.description
          ? (profile.description.length > 70 ? profile.description.slice(0, 67) + "..." : profile.description)
          : "(no description)";
        console.log(`  ${c.bold(profile.id.padEnd(24))} ${profileType} ${c.dim(`[${agentCount} agents]`)} ${desc}`);
      } catch {
        console.log(c.yellow(`  ? ${basename(dir)} (failed to load)`));
      }
    }
  }

  // ── Domains ───────────────────────────────────────────────────

  console.log(`\n${c.bold("Domains")}`);

  const domainDirs = discoverDirs(join(coreDir, "domains"), "domain.yaml");

  if (domainDirs.length === 0) {
    console.log(c.dim("  No domains found."));
  } else {
    for (const dir of domainDirs) {
      try {
        const domain = loadDomain(dir);
        const overlayCount = Object.keys(domain.overlays || {}).length;
        const desc = domain.description
          ? (domain.description.length > 80 ? domain.description.slice(0, 77) + "..." : domain.description)
          : "(no description)";
        console.log(`  ${c.bold(domain.id.padEnd(24))} ${c.dim(`[${overlayCount} overlays]`)} ${desc}`);
      } catch {
        console.log(c.yellow(`  ? ${basename(dir)} (failed to load)`));
      }
    }
  }

  // ── Skills ────────────────────────────────────────────────────

  console.log(`\n${c.bold("Skills")}`);

  const skillDirs = discoverDirs(join(coreDir, "skills"), "skill.yaml");

  if (skillDirs.length === 0) {
    console.log(c.dim("  No skills found."));
  } else {
    for (const dir of skillDirs) {
      try {
        const skill = loadSkill(dir);
        const compatAgents = skill.compatible_agents?.length
          ? c.dim(`[${skill.compatible_agents.join(", ")}]`)
          : c.dim("[all agents]");
        const desc = skill.description
          ? (skill.description.length > 60 ? skill.description.slice(0, 57) + "..." : skill.description)
          : "(no description)";
        console.log(`  ${c.bold(skill.id.padEnd(24))} ${compatAgents} ${desc}`);
      } catch {
        console.log(c.yellow(`  ? ${basename(dir)} (failed to load)`));
      }
    }
  }

  // ── Briefs ────────────────────────────────────────────────────

  console.log(`\n${c.bold("Briefs")}`);

  const briefsDir = join(coreDir, "briefs");
  if (existsSync(briefsDir)) {
    const briefEntries = readdirSync(briefsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

    if (briefEntries.length === 0) {
      console.log(c.dim("  No briefs found."));
    } else {
      for (const entry of briefEntries) {
        const briefPath = join(briefsDir, entry.name, "brief.md");
        const exists = existsSync(briefPath);
        console.log(`  ${c.bold(entry.name.padEnd(24))} ${exists ? c.green("brief.md") : c.red("missing brief.md")}`);
      }
    }
  } else {
    console.log(c.dim("  No briefs directory found."));
  }

  console.log();
}
