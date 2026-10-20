#!/usr/bin/env bun
/**
 * Checks the configuration a release ships, on every pull request, so a broken pack, marketplace entry,
 * or version drift fails review instead of a tag push or a user's install:
 *  1. every manifest in the release lockstep carries the same version;
 *  2. every pack (the sources under packs/ and the copy bundled into the plugin) loads as a valid,
 *     data-only pack;
 *  3. every marketplace entry points inside the repository at a plugin whose manifest has the same name;
 *  4. CHANGELOG.md has a non-empty section for that version, which the release workflow publishes as the
 *     release notes.
 *
 * Usage: bun run scripts/validate-configs.ts [root]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadPack } from "@aos-harness/kernel";
import { readVersions } from "./release/versioned.ts";

const BUNDLED_PACK = "hosts/claude-code/pack";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkVersions(root: string): string[] {
  const versions = readVersions(root);
  const missing = [...versions].filter(([, v]) => v === null).map(([file]) => file);
  const distinct = new Set([...versions.values()].filter((v) => v !== null));
  const problems = missing.map((file) => `${file}: no version field`);
  if (distinct.size > 1) {
    const listing = [...versions].filter(([, v]) => v !== null).map(([file, v]) => `${file}=${v}`).join(", ");
    problems.push(`versions disagree: ${listing}`);
  }
  return problems;
}

function packDirs(root: string): string[] {
  const packs = join(root, "packs");
  const sources = existsSync(packs)
    ? readdirSync(packs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `packs/${e.name}`)
    : [];
  return [...sources, BUNDLED_PACK].filter((dir) => existsSync(join(root, dir, "pack.yaml")));
}

function checkPacks(root: string): string[] {
  const dirs = packDirs(root);
  if (!dirs.includes(BUNDLED_PACK)) return [`${BUNDLED_PACK}: missing; run bun run build:plugin`];
  const problems: string[] = [];
  for (const dir of dirs) {
    try {
      loadPack(join(root, dir));
    } catch (err) {
      problems.push(`${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return problems;
}

interface MarketplaceEntry { name?: unknown; source?: unknown }

function checkMarketplace(root: string): string[] {
  const file = ".claude-plugin/marketplace.json";
  let doc: { name?: unknown; plugins?: unknown };
  try {
    doc = readJson(join(root, file)) as typeof doc;
  } catch (err) {
    return [`${file}: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (typeof doc.name !== "string" || doc.name === "") return [`${file}: no marketplace name`];
  if (!Array.isArray(doc.plugins) || doc.plugins.length === 0) return [`${file}: no plugins listed`];
  const problems: string[] = [];
  for (const entry of doc.plugins as MarketplaceEntry[]) {
    const label = `${file}: plugin ${JSON.stringify(entry.name)}`;
    if (typeof entry.name !== "string" || typeof entry.source !== "string") {
      problems.push(`${label} needs a string name and a relative source path`);
      continue;
    }
    const dir = resolve(root, entry.source);
    const inside = relative(root, dir);
    if (!entry.source.startsWith("./") || inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
      problems.push(`${label}: source ${entry.source} must be a ./ path inside the repository`);
      continue;
    }
    const manifest = join(dir, ".claude-plugin/plugin.json");
    if (!existsSync(manifest)) {
      problems.push(`${label}: ${entry.source} has no .claude-plugin/plugin.json`);
      continue;
    }
    const name = (readJson(manifest) as { name?: unknown }).name;
    if (name !== entry.name) problems.push(`${label}: ${entry.source} declares name ${JSON.stringify(name)}`);
  }
  return problems;
}

/**
 * The CHANGELOG section for a version, read the way the release workflow's awk reads it: every line after
 * a `## <version>` heading (alone or followed by a space) up to the next `## ` heading.
 */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

function checkChangelog(root: string): string[] {
  const version = readVersions(root).get("package.json");
  if (version === null || version === undefined) return []; // checkVersions reports it
  let changelog: string;
  try {
    changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  } catch {
    return ["CHANGELOG.md: missing; the release workflow publishes its section for each version"];
  }
  const section = changelogSection(changelog, version);
  if (section === null) return [`CHANGELOG.md: no "## ${version}" section, which the release workflow publishes as the notes`];
  if (section.trim() === "") return [`CHANGELOG.md: the "## ${version}" section is empty`];
  return [];
}

export function validateConfigs(root: string): string[] {
  return [...checkVersions(root), ...checkPacks(root), ...checkMarketplace(root), ...checkChangelog(root)];
}

if (import.meta.main) {
  const root = resolve(process.argv[2] ?? join(import.meta.dirname, ".."));
  const problems = validateConfigs(root);
  for (const problem of problems) console.error(`validate-configs: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log("validate-configs: versions agree, every pack loads, the marketplace points at its plugin, and the CHANGELOG has notes");
}
