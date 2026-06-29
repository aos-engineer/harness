/**
 * Content loading utilities for the AOS site.
 * Reads YAML files from core/ at build time.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

// Resolve relative to the site directory (process.cwd() during Astro build)
const CORE_DIR = join(process.cwd(), '..', 'core');

export interface AgentData {
  id: string;
  name: string;
  role: string;
  category: 'orchestrator' | 'perspective' | 'operational';
  cognition: {
    objective_function: string;
    time_horizon: { primary: string; secondary: string; peripheral: string };
    core_bias: string;
    risk_tolerance: string;
    default_stance: string;
  };
  persona: {
    temperament: string[];
    thinking_patterns: string[];
    heuristics: { name: string; rule: string }[];
    evidence_standard: { convinced_by: string[]; not_convinced_by: string[] };
    red_lines: string[];
  };
  tensions: { agent: string; dynamic: string }[];
  model: { tier: string; thinking: string };
  promptExcerpt: string;
  capabilities?: {
    can_execute_code: boolean;
    can_produce_files: boolean;
    can_review_artifacts: boolean;
    output_types: string[];
  };
}

export interface ProfileData {
  id: string;
  name: string;
  description: string;
  assembly: {
    orchestrator: string;
    perspectives: { agent: string; required: boolean; structural_advantage?: string; role_override?: string }[];
  };
  constraints: {
    time: { min_minutes: number; max_minutes: number };
    budget: { min: number; max: number; currency: string } | null;
    rounds: { min: number; max: number };
  };
  delegation: {
    tension_pairs: [string, string][];
    bias_limit: number;
    opening_rounds: number;
  };
  workflow?: string | null;
  type: 'deliberation' | 'execution';
  output: { format: string; sections?: string[] };
}

export interface DomainData {
  id: string;
  name: string;
  description: string;
  overlayCount: number;
  lexicon: { metrics: string[]; frameworks: string[]; stages: string[] };
}

function loadYaml<T>(path: string): T {
  const raw = readFileSync(path, 'utf-8');
  return yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as T;
}

export function loadAllAgents(): AgentData[] {
  const agents: AgentData[] = [];
  const agentsDir = join(CORE_DIR, 'agents');

  const categories: Record<string, 'orchestrator' | 'perspective' | 'operational'> = {
    orchestrators: 'orchestrator',
    perspectives: 'perspective',
    operational: 'operational',
  };

  for (const [dir, category] of Object.entries(categories)) {
    const categoryDir = join(agentsDir, dir);
    if (!existsSync(categoryDir)) continue;

    for (const agentName of readdirSync(categoryDir)) {
      const agentDir = join(categoryDir, agentName);
      const yamlPath = join(agentDir, 'agent.yaml');
      const promptPath = join(agentDir, 'prompt.md');

      if (!existsSync(yamlPath)) continue;

      const data = loadYaml<any>(yamlPath);
      let promptExcerpt = '';
      if (existsSync(promptPath)) {
        const full = readFileSync(promptPath, 'utf-8');
        promptExcerpt = full.split('\n').slice(0, 15).join('\n');
      }

      agents.push({
        id: data.id,
        name: data.name,
        role: data.role,
        category,
        cognition: data.cognition,
        persona: data.persona,
        tensions: data.tensions ?? [],
        model: data.model,
        promptExcerpt,
        capabilities: data.capabilities,
      });
    }
  }

  return agents.sort((a, b) => {
    const order = { orchestrator: 0, perspective: 1, operational: 2 };
    return order[a.category] - order[b.category] || a.name.localeCompare(b.name);
  });
}

export function loadAllProfiles(): ProfileData[] {
  const profilesDir = join(CORE_DIR, 'profiles');
  if (!existsSync(profilesDir)) return [];

  return readdirSync(profilesDir)
    .filter((name: string) => existsSync(join(profilesDir, name, 'profile.yaml')))
    .map((name: string) => {
      const data = loadYaml<any>(join(profilesDir, name, 'profile.yaml'));
      return {
        id: data.id,
        name: data.name,
        description: data.description,
        assembly: data.assembly,
        constraints: data.constraints,
        delegation: data.delegation,
        workflow: data.workflow ?? null,
        type: data.workflow ? 'execution' as const : 'deliberation' as const,
        output: data.output ?? { format: 'memo' },
      };
    })
    .sort((a: ProfileData, b: ProfileData) => a.name.localeCompare(b.name));
}

export interface SkillData {
  id: string;
  name: string;
  description: string;
  input: { required: any[]; optional: any[] };
  output: { artifacts: any[]; structured_result?: boolean };
  compatible_agents: string[];
}

export function loadAllSkills(): SkillData[] {
  const skillsDir = join(CORE_DIR, 'skills');
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter((name: string) => existsSync(join(skillsDir, name, 'skill.yaml')))
    .map((name: string) => {
      const data = loadYaml<any>(join(skillsDir, name, 'skill.yaml'));
      return {
        id: data.id ?? name,
        name: data.name ?? name,
        description: data.description ?? '',
        input: {
          required: data.input?.required ?? [],
          optional: data.input?.optional ?? [],
        },
        output: {
          artifacts: data.output?.artifacts ?? [],
          structured_result: data.output?.structured_result,
        },
        compatible_agents: data.compatible_agents ?? [],
      };
    })
    .sort((a: SkillData, b: SkillData) => a.name.localeCompare(b.name));
}

export function loadWorkflow(workflowId: string): any {
  const yamlPath = join(CORE_DIR, 'workflows', `${workflowId}.workflow.yaml`);
  if (existsSync(yamlPath)) return loadYaml(yamlPath);
  const dirPath = join(CORE_DIR, 'workflows', workflowId, 'workflow.yaml');
  if (existsSync(dirPath)) return loadYaml(dirPath);
  return null;
}

export function loadAllDomains(): DomainData[] {
  const domainsDir = join(CORE_DIR, 'domains');
  if (!existsSync(domainsDir)) return [];

  return readdirSync(domainsDir)
    .filter((name: string) => existsSync(join(domainsDir, name, 'domain.yaml')))
    .map((name: string) => {
      const data = loadYaml<any>(join(domainsDir, name, 'domain.yaml'));
      return {
        id: data.id ?? name,
        name: data.name ?? name,
        description: data.description ?? '',
        overlayCount: data.overlays ? Object.keys(data.overlays).length : 0,
        lexicon: {
          metrics: data.lexicon?.metrics ?? [],
          frameworks: data.lexicon?.frameworks ?? [],
          stages: data.lexicon?.stages ?? [],
        },
      };
    })
    .sort((a: DomainData, b: DomainData) => a.name.localeCompare(b.name));
}
