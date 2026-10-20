#!/usr/bin/env bun
/**
 * Checks, before anything is published, that the pushed tag describes exactly the tree being released:
 *  1. the tag is v<version> and points at HEAD;
 *  2. HEAD is on origin/main, so only reviewed, merged code is released;
 *  3. the worktree is clean;
 *  4. every manifest that carries the version agrees with the tag (packages, the Claude Code plugin
 *     manifest), so the npm package and the marketplace plugin can never drift apart.
 *
 * Usage: bun run scripts/release/verify-tag.ts [tag]   (defaults to GITHUB_REF_NAME)
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const VERSIONED = [
  "package.json",
  "cli/package.json",
  "kernel/package.json",
  "hosts/claude-code/package.json",
  "hosts/claude-code/.claude-plugin/plugin.json",
  "packs/feature-delivery/package.json",
];

function git(...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function fail(message: string): never {
  console.error(`verify-tag: ${message}`);
  process.exit(1);
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) fail("pass a tag or set GITHUB_REF_NAME");
const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!m) fail(`tag ${tag} is not v<semver>`);
const version = m[1]!;

const head = git("rev-parse", "HEAD").out;
const tagged = git("rev-list", "-n", "1", tag);
if (!tagged.ok) fail(`tag ${tag} does not exist`);
if (tagged.out !== head) fail(`tag ${tag} (${tagged.out.slice(0, 7)}) does not point at HEAD (${head.slice(0, 7)})`);

git("fetch", "--quiet", "origin", "main");
if (!git("merge-base", "--is-ancestor", "HEAD", "origin/main").ok) fail(`HEAD ${head.slice(0, 7)} is not on origin/main; release only merged code`);

const dirty = git("status", "--porcelain").out;
if (dirty !== "") fail(`the worktree is not clean:\n${dirty}`);

const mismatched = VERSIONED.filter((file) => (JSON.parse(readFileSync(join(ROOT, file), "utf8")) as { version?: string }).version !== version);
if (mismatched.length > 0) fail(`these files do not carry version ${version}: ${mismatched.join(", ")}`);

console.log(`verify-tag: ${tag} matches HEAD on main, a clean tree, and ${VERSIONED.length} versioned manifests`);
