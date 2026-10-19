// A pack is data: pack.yaml plus one markdown instruction file per stage. Loading parses the YAML with the
// JSON schema only, validates it against the public pack schema, checks the cross-references a schema
// cannot express, and refuses anything that looks like code. Every problem is collected, so a pack author
// fixes them in one pass instead of one per run.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { JSON_SCHEMA, load } from "js-yaml";
import schema from "../../schema/pack.schema.json" with { type: "json" };
import type {
  ActionDef, ActionName, ClassifyRule, GateDef, ModelHint, Provenance, Requirement, ResolvedPack, StageDef, Tier, TierDef,
} from "../types.ts";
import { PackError } from "../util/errors.ts";
import { integrityOf, readPack, type PackEntry } from "./files.ts";

// pack.yaml as the schema admits it, before defaults are filled in.
type RawRequirement =
  | { kind: "command"; role: string; result: "exit_zero"; provenance: Provenance; fresh?: boolean }
  | { kind: "review"; status: "approved"; provenance: Provenance; fresh?: boolean }
  | { kind: "artifact" | "citation" | "skill"; provenance: Provenance; fresh?: boolean; match?: string | null };
interface RawGate { decider: GateDef["decider"]; tasks?: GateDef["tasks"]; requires?: RawRequirement[] }
interface RawStage { name: string; writes: StageDef["writes"]; gate: RawGate; bind?: string[]; model?: ModelHint | null }
interface RawPack {
  name: string; version: string;
  roles: Record<string, string[]>;
  classify: { rules: ClassifyRule[]; default: Tier };
  budget: { iterations: number };
  tiers: Partial<Record<Tier, { stages: RawStage[] }>>;
  actions: Record<ActionName, ActionDef>;
}

// Script extensions a pack might ship expecting someone to run them. The kernel never executes pack
// files; this check keeps packs honest about being data.
const CODE_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".sh"];

/** Loads and validates the pack in `dir`. Throws PackError listing every issue found. */
export function loadPack(dir: string): ResolvedPack {
  const root = resolve(dir);
  const entries = readPack(root);
  const byPath = new Map(entries.map((e) => [e.rel, e]));
  const issues = dataOnlyIssues(entries);
  let cause: unknown;

  let doc: unknown;
  const yamlEntry = byPath.get("pack.yaml");
  if (!yamlEntry) issues.push("pack.yaml: not found");
  else if (yamlEntry.kind === "file") {
    try {
      doc = load(yamlEntry.content.toString("utf8"), { schema: JSON_SCHEMA, filename: "pack.yaml" });
    } catch (e) {
      cause = e;
      issues.push(`pack.yaml: invalid YAML: ${firstLine(e)}`);
    }
  }

  let instructions: Record<string, string> = {};
  if (yamlEntry?.kind === "file" && cause === undefined) {
    const validate = validator();
    if (!validate(doc)) {
      issues.push(...schemaIssues(validate.errors ?? []));
    } else {
      const pack = doc as RawPack;
      issues.push(...semanticIssues(pack, byPath));
      instructions = readInstructions(pack, byPath);
    }
  }

  if (issues.length > 0) {
    const unique = [...new Set(issues)];
    throw new PackError(`invalid pack at ${root}:\n  - ${unique.join("\n  - ")}`, unique, cause === undefined ? undefined : { cause });
  }
  return resolveDefaults(doc as RawPack, instructions, integrityOf(entries));
}

// Compiling the schema takes tens of milliseconds and importing ajv about as long again. A hook process
// may import the kernel barrel on every tool call without ever loading a pack, so both wait for the first
// loadPack call.
const requireFromHere = createRequire(import.meta.url);
let compiled: ValidateFunction | undefined;
function validator(): ValidateFunction {
  if (!compiled) {
    const { Ajv } = requireFromHere("ajv") as typeof import("ajv");
    // The discriminator option reports errors only from the union member a value selects
    // (by `allow` or `kind`), instead of one error per member.
    compiled = new Ajv({ allErrors: true, discriminator: true }).compile(schema);
  }
  return compiled;
}

function dataOnlyIssues(entries: PackEntry[]): string[] {
  const issues: string[] = [];
  for (const e of entries) {
    if (e.kind !== "file") {
      issues.push(`${e.rel}: must be a regular file; packs may not contain symlinks or special files`);
    } else if (CODE_EXTENSIONS.some((ext) => e.rel.toLowerCase().endsWith(ext))) {
      issues.push(`${e.rel}: packs are data only, and this is a script file`);
    } else if ((e.mode & 0o111) !== 0) {
      issues.push(`${e.rel}: packs are data only, and this file is executable`);
    }
  }
  return issues;
}

function schemaIssues(errors: ErrorObject[]): string[] {
  const issues: string[] = [];
  for (const e of errors) {
    // An if/then/else failure always comes with the more specific error from the branch that ran.
    if (e.keyword === "if") continue;
    const at = formatPointer(e.instancePath);
    if (e.keyword === "additionalProperties") {
      issues.push(`${at}: must NOT have additional properties: ${JSON.stringify(e.params.additionalProperty)}`);
    } else if (e.keyword === "discriminator" && e.params.error === "mapping") {
      issues.push(`${at}.${e.params.tag}: unknown value ${JSON.stringify(e.params.tagValue)}`);
    } else {
      issues.push(`${at}: ${e.message ?? e.keyword}`);
    }
  }
  return issues;
}

/** "/tiers/bounded/stages/0/name" -> "tiers.bounded.stages[0].name", matching how issues name paths. */
function formatPointer(pointer: string): string {
  if (pointer === "") return "(root)";
  let out = "";
  for (const raw of pointer.slice(1).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (/^[0-9]+$/.test(seg)) out += `[${seg}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

function semanticIssues(pack: RawPack, byPath: Map<string, PackEntry>): string[] {
  const issues: string[] = [];
  const tiers = Object.keys(pack.tiers) as Tier[];
  const stageNames = (tier: Tier): string[] => pack.tiers[tier]?.stages.map((s) => s.name) ?? [];

  for (const tier of tiers) {
    const seen = new Set<string>();
    pack.tiers[tier]!.stages.forEach((stage, i) => {
      const at = `tiers.${tier}.stages[${i}]`;
      if (seen.has(stage.name)) issues.push(`${at}: duplicate stage "${stage.name}" in tier "${tier}"`);
      seen.add(stage.name);
      const file = instructionsPath(tier, stage.name);
      if (!byPath.has(file)) issues.push(`${at}: missing instructions file ${file}`);
      (stage.gate.requires ?? []).forEach((req, j) => {
        if (req.kind === "command" && !Object.hasOwn(pack.roles, req.role)) {
          issues.push(`${at}.gate.requires[${j}].role: role "${req.role}" is not defined in roles`);
        }
      });
    });
  }

  for (const [name, action] of Object.entries(pack.actions)) {
    for (const tier of tiers) {
      if (!action.policy[tier]) issues.push(`actions.${name}.policy.${tier}: missing policy for tier "${tier}"`);
    }
    for (const [tier, policy] of Object.entries(action.policy) as [Tier, ActionDef["policy"][Tier]][]) {
      const at = `actions.${name}.policy.${tier}`;
      const known = stageNames(tier);
      if (policy?.allow === "in_stages") {
        for (const s of policy.stages) if (!known.includes(s)) issues.push(`${at}: in_stages "${s}" names no stage in tier "${tier}"`);
      } else if (policy?.allow === "after_gate" && !known.includes(policy.gate)) {
        issues.push(`${at}: after_gate "${policy.gate}" names no stage in tier "${tier}"`);
      }
    }
    action.patterns.forEach((src, j) => {
      const problem = regexProblem(src, "");
      if (problem) issues.push(`actions.${name}.patterns[${j}]: invalid regular expression: ${problem}`);
    });
  }

  // The classifier matches case-insensitively, so validate with the same flag it compiles with.
  pack.classify.rules.forEach((rule, i) => rule.any.forEach((src, j) => {
    const problem = regexProblem(src, "i");
    if (problem) issues.push(`classify.rules[${i}].any[${j}]: invalid regular expression: ${problem}`);
  }));
  // A rule may propose a tier the pack does not define: the caller decides what an unsupported tier means.
  // The default has no such escape, because it is what every unmatched brief gets.
  if (!tiers.includes(pack.classify.default)) {
    issues.push(`classify.default: tier "${pack.classify.default}" is not defined in tiers`);
  }
  return issues;
}

function readInstructions(pack: RawPack, byPath: Map<string, PackEntry>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tier of Object.keys(pack.tiers) as Tier[]) {
    for (const stage of pack.tiers[tier]!.stages) {
      // Symlinks and missing files are already issues; reading only regular files keeps the pack inside its directory.
      const entry = byPath.get(instructionsPath(tier, stage.name));
      if (entry?.kind === "file") out[`${tier}/${stage.name}`] = entry.content.toString("utf8");
    }
  }
  return out;
}

function resolveDefaults(pack: RawPack, instructions: Record<string, string>, integrity: string): ResolvedPack {
  const tiers: Partial<Record<Tier, TierDef>> = {};
  for (const tier of Object.keys(pack.tiers) as Tier[]) {
    tiers[tier] = { stages: pack.tiers[tier]!.stages.map(resolveStage) };
  }
  return {
    name: pack.name,
    version: pack.version,
    roles: pack.roles,
    classify: pack.classify,
    tiers,
    actions: pack.actions,
    budget: pack.budget,
    integrity,
    instructions,
  };
}

function resolveStage(stage: RawStage): StageDef {
  return {
    name: stage.name,
    writes: stage.writes,
    gate: { decider: stage.gate.decider, requires: (stage.gate.requires ?? []).map(resolveRequirement), tasks: stage.gate.tasks ?? "none" },
    bind: stage.bind ?? [],
    model: stage.model ?? null,
  };
}

function resolveRequirement(req: RawRequirement): Requirement {
  const fresh = req.fresh ?? false;
  switch (req.kind) {
    case "command": return { kind: req.kind, role: req.role, result: req.result, provenance: req.provenance, fresh };
    case "review": return { kind: req.kind, status: req.status, provenance: req.provenance, fresh };
    default: return { kind: req.kind, provenance: req.provenance, fresh, match: req.match ?? null };
  }
}

const instructionsPath = (tier: Tier, stage: string): string => `stages/${tier}/${stage}.md`;

function regexProblem(src: string, flags: string): string | null {
  try {
    new RegExp(src, flags);
    return null;
  } catch (e) {
    return firstLine(e);
  }
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
}
