/**
 * aos create — Scaffold new agents, profiles, and domains.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { c, type ParsedArgs } from "../colors";
import { getHarnessRoot, toKebabCase } from "../utils";

const HELP = `
${c.bold("aos create")} — Scaffold new agents, profiles, domains, skills, and briefs

${c.bold("USAGE")}
  aos create agent <name>       Create a new custom agent
  aos create profile <name>     Create a new profile
  aos create domain <name>      Create a new domain pack
  aos create skill <name>       Create a new skill definition
  aos create brief [slug]       Create a new deliberation or execution brief

${c.bold("DESCRIPTION")}
  Generates well-structured scaffolds that pass "aos validate" out of the box.
  Custom agents are created under core/agents/custom/.
  Profiles, domains, and skills are created under their respective core/ directories.

${c.bold("EXAMPLES")}
  aos create agent risk-analyst
  aos create profile security-review
  aos create domain healthcare
  aos create skill dependency-analysis
  aos create brief my-decision --kind deliberation --non-interactive --title "Decision" \\
    --situation "..." --stakes "..." --constraints "..." --key-question "?"
`;

// ── Agent scaffold ──────────────────────────────────────────────

function agentYaml(id: string, name: string): string {
  return `schema: aos/agent/v1
id: ${id}
name: ${name}
role: "TODO: Describe this agent's role in one line."

cognition:
  objective_function: "TODO: What does this agent optimize for?"
  time_horizon:
    primary: "TODO: Primary time frame (e.g. 30-90 days)"
    secondary: "TODO: Secondary time frame"
    peripheral: "TODO: Background time frame"
  core_bias: todo-define-bias
  risk_tolerance: moderate
  default_stance: "TODO: Default position in one sentence."

persona:
  temperament:
    - "TODO: Describe a temperament trait"
  thinking_patterns:
    - "TODO: What question does this role always ask?"
  heuristics:
    - name: TODO Heuristic
      rule: "TODO: Describe the decision rule."
  evidence_standard:
    convinced_by:
      - "TODO: What evidence convinces this agent?"
    not_convinced_by:
      - "TODO: What evidence does this agent reject?"
  red_lines:
    - "TODO: Non-negotiable boundary"

tensions:
  - agent: TODO-other-agent-id
    dynamic: "TODO: Describe the productive tension with the other agent."

report:
  structure: "TODO: How should this agent format its responses?"

tools: null
skills: []
expertise:
  - path: expertise/${id}-notes.md
    mode: read-write
    use_when: "TODO: When should this agent use its scratch pad?"

model:
  tier: standard
  thinking: "off"
`;
}

function agentPromptMd(id: string, name: string): string {
  return `# {{agent_name}}

## Session: {{session_id}}
## Agent: {{agent_id}}
## Participants: {{participants}}
## Constraints: {{constraints}}

## Expertise
{{expertise_block}}

## Deliberation Directory: {{deliberation_dir}}
## Transcript: {{transcript_path}}

## Brief
{{brief}}

---

## 1. Identity & Role

You are the **${name}** — TODO: describe this agent's identity and purpose in the deliberation.

TODO: Write 2-3 paragraphs establishing this agent's voice, perspective, and approach to deliberation.

---

## 2. Core Bias

TODO: Explain this agent's core bias and how it shapes their analysis.

---

## 3. How You Think

TODO: Describe the thinking patterns, heuristics, and reasoning approach.

---

## 4. What Convinces You

TODO: Describe the evidence standard — what moves this agent and what does not.

---

## 5. Red Lines

TODO: List the non-negotiable boundaries this agent enforces.

---

## 6. Response Format

TODO: Describe how this agent structures its contributions to the deliberation.
`;
}

// ── Profile scaffold ────────────────────────────────────────────

function profileYaml(id: string, name: string): string {
  return `schema: aos/profile/v1
id: ${id}
name: ${name}
description: "TODO: Describe what this profile does and when to use it."
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    - agent: catalyst
      required: true
    - agent: sentinel
      required: true
    - agent: architect
      required: false

delegation:
  default: broadcast
  opening_rounds: 1
  tension_pairs:
    - [catalyst, sentinel]
  bias_limit: 5

constraints:
  time:
    min_minutes: 2
    max_minutes: 10
  budget:
    min: 1.00
    max: 10.00
    currency: USD
  rounds:
    min: 2
    max: 8

error_handling:
  agent_timeout_seconds: 120
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:
  strategy: rolling_average
  fixed_estimate_tokens: 2000
  safety_margin: 0.15
  on_estimate_exceeded: drop_optional

input:
  format: brief
  required_sections:
    - heading: "## Situation"
      guidance: "What is happening right now? State the facts."
    - heading: "## Stakes"
      guidance: "What is at risk? Upside and downside."
    - heading: "## Constraints"
      guidance: "Budget, timeline, team capacity, technical boundaries."
    - heading: "## Key Question"
      guidance: "The single most important question to answer."
  context_files: true

output:
  format: memo
  path_template: "output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md"
  sections:
    - ranked_recommendations
    - agent_stances
    - dissent_and_tensions
    - next_actions
  artifacts:
    - type: diagram
  frontmatter:
    - date
    - duration
    - budget_used
    - participants
    - brief_path
    - transcript_path

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent

controls:
  halt: true
  wrap: true
  interject: false
`;
}

function profileReadme(name: string, id: string): string {
  return `# ${name}

TODO: Describe this profile, its purpose, and when to use it.

## Agents

This profile uses the following agents:

- **Arbiter** (orchestrator) — neutral session chair
- **Catalyst** (required) — acceleration and monetization
- **Sentinel** (required) — risk and protection
- **Architect** (optional) — systems design and feasibility

## Usage

\`\`\`bash
aos run ${id}
aos run ${id} --domain saas --brief path/to/brief.md
\`\`\`

## Required Brief Sections

- **## Situation** — What is happening right now
- **## Stakes** — What is at risk
- **## Constraints** — Boundaries and limits
- **## Key Question** — The question to answer
`;
}

// ── Domain scaffold ─────────────────────────────────────────────

function domainYaml(id: string, name: string): string {
  return `schema: aos/domain/v1
id: ${id}
name: ${name}
description: "TODO: Describe this domain pack and what industry or context it covers."
version: 1.0.0

lexicon:
  metrics:
    - "TODO: Define a key metric for this domain (e.g. 'ARR - Annual Recurring Revenue')"
  frameworks:
    - "TODO: Define a key framework used in this domain"
  stages:
    - "TODO: Define lifecycle stages relevant to this domain"

overlays:
  catalyst:
    lens_additions:
      - label: "TODO Domain Lens"
        instruction: "TODO: How should the Catalyst adjust its analysis for this domain?"
    evidence_standard: "TODO: What evidence standard applies in this domain?"

additional_input_sections:
  - heading: "## TODO Domain Context"
    guidance: "TODO: What domain-specific information should the brief include?"

additional_output_sections:
  - todo_analysis: "TODO: What domain-specific analysis should appear in the output?"

guardrails:
  - id: todo_guardrail
    rule: "TODO: Define a domain-specific guardrail or constraint."
`;
}

function domainReadme(name: string, id: string): string {
  return `# ${name}

TODO: Describe this domain pack, the industry it covers, and how it enhances deliberation.

## Usage

\`\`\`bash
aos run strategic-council --domain ${id}
\`\`\`

## What It Does

This domain pack:
- Injects domain-specific lexicon (metrics, frameworks, lifecycle stages)
- Adds agent overlays that sharpen each perspective for this domain
- Adds domain-specific input requirements and output sections
- Enforces domain guardrails
`;
}

// ── Skill scaffold ───────────────────────────────────────────

function skillYaml(id: string, name: string): string {
  return `schema: aos/skill/v1
id: ${id}
name: ${name}
description: "TODO: Describe what this skill does in one sentence."
version: 1.0.0

input:
  required:
    - id: todo_input
      type: artifact
      description: "TODO: Describe the required input"
  optional:
    - id: todo_context
      type: text
      description: "TODO: Describe optional context"

output:
  artifacts:
    - id: todo_output
      format: markdown
      description: "TODO: Describe the output artifact"
  structured_result: false

compatible_agents: []

platform_bindings: {}

platform_requirements:
  requires_code_execution: false
  requires_file_access: false
  requires_network: false
`;
}

// ── Command handler ─────────────────────────────────────────────

export async function createCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help || !args.subcommand) {
    console.log(HELP);
    return;
  }

  const type = args.subcommand;
  const name = args.positional[1];

  if (!name && type !== "brief") {
    console.error(c.red(`Missing name. Usage: aos create ${type} <name>`));
    process.exit(1);
  }

  if (type === "brief") {
    await createBrief(args);
    return;
  }

  const id = toKebabCase(name!);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    console.error(c.red(`Invalid name "${name}": must kebab-case to /^[a-z0-9][a-z0-9-]*$/`));
    console.error(c.dim(`Allowed characters: a-z, 0-9, hyphen. Must start with a letter or digit.`));
    process.exit(2);
  }
  const displayName = id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const root = getHarnessRoot();

  switch (type) {
    case "agent": {
      const dir = join(root, "core", "agents", "custom", id);
      if (existsSync(dir)) {
        console.error(c.red(`Agent "${id}" already exists at: ${dir}`));
        process.exit(1);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "agent.yaml"), agentYaml(id, displayName), "utf-8");
      writeFileSync(join(dir, "prompt.md"), agentPromptMd(id, displayName), "utf-8");

      console.log(`
${c.green(`Agent "${id}" created successfully!`)}

${c.bold("Files")}
  ${c.cyan(join(dir, "agent.yaml"))}
  ${c.cyan(join(dir, "prompt.md"))}

${c.bold("Next Steps")}
  1. Edit ${c.cyan("agent.yaml")} — fill in the TODO fields with your agent's cognition, persona, and tensions
  2. Edit ${c.cyan("prompt.md")} — write the system prompt that defines this agent's voice
  3. Add the agent to a profile's assembly section to include it in deliberations
  4. Run ${c.cyan("aos validate")} to check everything is well-formed
`);
      break;
    }

    case "profile": {
      const dir = join(root, "core", "profiles", id);
      if (existsSync(dir)) {
        console.error(c.red(`Profile "${id}" already exists at: ${dir}`));
        process.exit(1);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "profile.yaml"), profileYaml(id, displayName), "utf-8");
      writeFileSync(join(dir, "README.md"), profileReadme(displayName, id), "utf-8");

      console.log(`
${c.green(`Profile "${id}" created successfully!`)}

${c.bold("Files")}
  ${c.cyan(join(dir, "profile.yaml"))}
  ${c.cyan(join(dir, "README.md"))}

${c.bold("Next Steps")}
  1. Edit ${c.cyan("profile.yaml")} — configure the agent assembly, constraints, and input/output
  2. Run ${c.cyan(`aos run ${id}`)} to test
  3. Run ${c.cyan("aos validate")} to check everything is well-formed
`);
      break;
    }

    case "domain": {
      const dir = join(root, "core", "domains", id);
      if (existsSync(dir)) {
        console.error(c.red(`Domain "${id}" already exists at: ${dir}`));
        process.exit(1);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "domain.yaml"), domainYaml(id, displayName), "utf-8");
      writeFileSync(join(dir, "README.md"), domainReadme(displayName, id), "utf-8");

      console.log(`
${c.green(`Domain "${id}" created successfully!`)}

${c.bold("Files")}
  ${c.cyan(join(dir, "domain.yaml"))}
  ${c.cyan(join(dir, "README.md"))}

${c.bold("Next Steps")}
  1. Edit ${c.cyan("domain.yaml")} — define the lexicon, overlays, and guardrails
  2. Use it with: ${c.cyan(`aos run strategic-council --domain ${id}`)}
  3. Run ${c.cyan("aos validate")} to check everything is well-formed
`);
      break;
    }

    case "skill": {
      const dir = join(root, "core", "skills", id);
      if (existsSync(dir)) {
        console.error(c.red(`Skill "${id}" already exists at: ${dir}`));
        process.exit(1);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "skill.yaml"), skillYaml(id, displayName), "utf-8");

      console.log(`
${c.green(`Skill "${id}" created successfully!`)}

${c.bold("Files")}
  ${c.cyan(join(dir, "skill.yaml"))}

${c.bold("Next Steps")}
  1. Edit ${c.cyan("skill.yaml")} — define the input/output schema and compatible agents
  2. Add the skill ID to an agent's "skills" array to make it available
  3. Run ${c.cyan("aos validate")} to check everything is well-formed
`);
      break;
    }

    default:
      console.error(c.red(`Unknown type: "${type}". Use "agent", "profile", "domain", "skill", or "brief".`));
      process.exit(1);
  }
}

async function createBrief(args: ParsedArgs): Promise<void> {
  const { renderBriefTemplate } = await import("../brief/template");
  const { validateBrief } = await import("../brief/validate");
  const { atomicWriteBrief } = await import("../brief/write");
  const { runBriefPromptLoop } = await import("../brief/prompts");

  const slugPositional = args.positional[1];
  const kindFlag = args.flags.kind as ("deliberation" | "execution" | undefined);
  const titleFlag = args.flags.title as string | undefined;
  const fromNotes = args.flags["from-notes"] as string | undefined;
  const seedText = (args.flags.idea as string | undefined) ??
    (fromNotes ? readFileSync(fromNotes, "utf-8") : undefined);
  const nonInteractive = Boolean(args.flags["non-interactive"]);
  const force = Boolean(args.flags.force);

  let slug: string;
  let kind: "deliberation" | "execution";
  let title: string;
  let sections: any = {};

  if (nonInteractive) {
    if (!slugPositional) {
      console.error(c.red("--non-interactive requires <slug> positional."));
      process.exit(2);
    }
    if (kindFlag !== "deliberation" && kindFlag !== "execution") {
      console.error(c.red("--non-interactive requires --kind deliberation or --kind execution."));
      process.exit(2);
    }
    if (!titleFlag) {
      console.error(c.red("--non-interactive requires --title."));
      process.exit(2);
    }

    slug = toKebabCase(slugPositional);
    kind = kindFlag;
    title = titleFlag;
    sections = kind === "deliberation"
      ? {
          situation: args.flags.situation as string | undefined,
          stakes: args.flags.stakes as string | undefined,
          constraints: args.flags.constraints as string | undefined,
          keyQuestion: args.flags["key-question"] as string | undefined,
        }
      : {
          featureVision: args.flags.feature as string | undefined,
          context: args.flags.context as string | undefined,
          constraints: args.flags.constraints as string | undefined,
          successCriteria: args.flags["success-criteria"] as string | undefined,
        };
  } else {
    const reader = await createStdinLineReader();
    const result = await runBriefPromptLoop({
      reader,
      kind: kindFlag,
      slug: slugPositional ? toKebabCase(slugPositional) : undefined,
      title: titleFlag,
      seedText,
    });
    slug = toKebabCase(result.slug);
    kind = result.kind;
    title = result.title;
    sections = result.sections;
  }

  const rendered = renderBriefTemplate({ kind, title, prefilled: sections, seedText });
  const validation = validateBrief(rendered, { expectedKind: kind, strict: true });
  if (validation.errors.length > 0) {
    console.error(c.red("Brief incomplete:"));
    for (const err of validation.errors) {
      const sectionLabel = err.section ? `[${err.section}] ` : "";
      console.error(c.red(`  ${sectionLabel}${err.message}`));
    }
    process.exit(1);
  }

  const outFlag = args.flags.out as string | undefined;
  const targetPath = outFlag
    ? resolve(process.cwd(), outFlag)
    : Boolean(args.flags.shared)
      ? join(getHarnessRoot(), "core", "briefs", slug, "brief.md")
      : resolve(process.cwd(), "briefs", slug, "brief.md");

  try {
    await atomicWriteBrief(targetPath, rendered, { force });
  } catch (err: any) {
    console.error(c.red(err.message));
    process.exit(1);
  }

  console.log(c.green(`Brief saved to ${targetPath}`));
  console.log(c.dim(`Run with: aos run <profile> --brief ${targetPath}`));
}

async function createStdinLineReader() {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  const lines = new TextDecoder().decode(Buffer.concat(chunks)).split(/\r?\n/);
  let index = 0;
  return {
    async readLine(): Promise<string> {
      return lines[index++] ?? "";
    },
  };
}
