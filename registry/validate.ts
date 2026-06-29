/**
 * AOS Community Registry Validator
 *
 * Validates registry.json against registry.schema.json using basic
 * field-level checks (no external dependencies required).
 *
 * Run: bun run registry/validate.ts
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const registryPath = resolve(__dirname, "registry.json");
const schemaPath = resolve(__dirname, "registry.schema.json");

const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ID_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
const MAX_DESCRIPTION_LENGTH = 200;

let errors: string[] = [];
let warnings: string[] = [];

function err(msg: string) {
  errors.push(msg);
}

function warn(msg: string) {
  warnings.push(msg);
}

// --- Top-level checks ---

if (registry.version !== "1") {
  err(`version must be "1", got "${registry.version}"`);
}

for (const key of ["agents", "profiles", "domains"]) {
  if (!Array.isArray(registry[key])) {
    err(`"${key}" must be an array`);
  }
}

// --- Agent validation ---

function validateAgent(agent: any, index: number) {
  const prefix = `agents[${index}] (${agent.id ?? "unknown"})`;

  const required = [
    "id",
    "name",
    "author",
    "description",
    "tags",
    "source",
    "version",
    "compatible_profiles",
    "schema_version",
  ];
  for (const field of required) {
    if (agent[field] === undefined || agent[field] === null) {
      err(`${prefix}: missing required field "${field}"`);
    }
  }

  if (typeof agent.id === "string" && !ID_PATTERN.test(agent.id)) {
    err(`${prefix}: id does not match namespace/name pattern`);
  }

  if (
    typeof agent.description === "string" &&
    agent.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    err(
      `${prefix}: description exceeds ${MAX_DESCRIPTION_LENGTH} chars (${agent.description.length})`
    );
  }

  if (typeof agent.version === "string" && !SEMVER_PATTERN.test(agent.version)) {
    err(`${prefix}: version "${agent.version}" is not valid semver`);
  }

  if (Array.isArray(agent.tags) && agent.tags.length === 0) {
    err(`${prefix}: tags must have at least 1 item`);
  }

  if (
    agent.compatible_profiles !== undefined &&
    !Array.isArray(agent.compatible_profiles)
  ) {
    err(`${prefix}: compatible_profiles must be an array`);
  }
}

// --- Profile validation ---

function validateProfile(profile: any, index: number) {
  const prefix = `profiles[${index}] (${profile.id ?? "unknown"})`;

  const required = [
    "id",
    "name",
    "author",
    "description",
    "agent_count",
    "tags",
    "source",
    "version",
  ];
  for (const field of required) {
    if (profile[field] === undefined || profile[field] === null) {
      err(`${prefix}: missing required field "${field}"`);
    }
  }

  if (typeof profile.id === "string" && !ID_PATTERN.test(profile.id)) {
    err(`${prefix}: id does not match namespace/name pattern`);
  }

  if (
    typeof profile.description === "string" &&
    profile.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    err(
      `${prefix}: description exceeds ${MAX_DESCRIPTION_LENGTH} chars (${profile.description.length})`
    );
  }

  if (typeof profile.version === "string" && !SEMVER_PATTERN.test(profile.version)) {
    err(`${prefix}: version "${profile.version}" is not valid semver`);
  }

  if (
    typeof profile.agent_count === "number" &&
    (!Number.isInteger(profile.agent_count) || profile.agent_count < 1)
  ) {
    err(`${prefix}: agent_count must be a positive integer`);
  }

  if (Array.isArray(profile.tags) && profile.tags.length === 0) {
    err(`${prefix}: tags must have at least 1 item`);
  }
}

// --- Domain validation ---

function validateDomain(domain: any, index: number) {
  const prefix = `domains[${index}] (${domain.id ?? "unknown"})`;

  const required = [
    "id",
    "name",
    "author",
    "description",
    "tags",
    "source",
    "version",
  ];
  for (const field of required) {
    if (domain[field] === undefined || domain[field] === null) {
      err(`${prefix}: missing required field "${field}"`);
    }
  }

  if (typeof domain.id === "string" && !ID_PATTERN.test(domain.id)) {
    err(`${prefix}: id does not match namespace/name pattern`);
  }

  if (
    typeof domain.description === "string" &&
    domain.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    err(
      `${prefix}: description exceeds ${MAX_DESCRIPTION_LENGTH} chars (${domain.description.length})`
    );
  }

  if (typeof domain.version === "string" && !SEMVER_PATTERN.test(domain.version)) {
    err(`${prefix}: version "${domain.version}" is not valid semver`);
  }

  if (Array.isArray(domain.tags) && domain.tags.length === 0) {
    err(`${prefix}: tags must have at least 1 item`);
  }
}

// --- Uniqueness checks ---

function checkUniqueness(items: any[], category: string) {
  const ids = new Set<string>();
  for (const item of items) {
    if (typeof item.id === "string") {
      if (ids.has(item.id)) {
        err(`${category}: duplicate id "${item.id}"`);
      }
      ids.add(item.id);
    }
  }
}

// --- Run validation ---

if (Array.isArray(registry.agents)) {
  registry.agents.forEach(validateAgent);
  checkUniqueness(registry.agents, "agents");
}

if (Array.isArray(registry.profiles)) {
  registry.profiles.forEach(validateProfile);
  checkUniqueness(registry.profiles, "profiles");
}

if (Array.isArray(registry.domains)) {
  registry.domains.forEach(validateDomain);
  checkUniqueness(registry.domains, "domains");
}

// --- Report ---

const agentCount = registry.agents?.length ?? 0;
const profileCount = registry.profiles?.length ?? 0;
const domainCount = registry.domains?.length ?? 0;

console.log("AOS Registry Validation Report");
console.log("==============================");
console.log(`Agents:   ${agentCount}`);
console.log(`Profiles: ${profileCount}`);
console.log(`Domains:  ${domainCount}`);
console.log(`Total:    ${agentCount + profileCount + domainCount}`);
console.log();

if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`  ⚠ ${w}`);
  }
  console.log();
}

if (errors.length > 0) {
  console.log(`FAIL — ${errors.length} error(s):`);
  for (const e of errors) {
    console.log(`  ✗ ${e}`);
  }
  process.exit(1);
} else {
  console.log("PASS — all entries valid.");
  process.exit(0);
}
