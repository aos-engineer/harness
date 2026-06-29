#!/usr/bin/env bun
/**
 * Cross-platform copy/clean utilities for bundling core/ into cli/ before
 * npm publish. Uses Node.js fs APIs (supported by Bun) instead of shell
 * commands for Windows compatibility.
 *
 * As of 0.6.0 the CLI no longer bundles adapter source — adapters are
 * installed standalone by users via @aos-harness/<name>-adapter.
 */

import { cpSync, rmSync, existsSync, lstatSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const coreSrc = resolve(root, "core");
const coreDest = resolve(root, "cli", "core");
const excludedPaths = [
  `briefs${sep}aos-education-series`,
];

// Accept --target=<path> override for testing (not for production use).
const argTarget = process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);

// Defense-in-depth: target MUST be under <root>/cli/core
const allowedBase = resolve(root, "cli", "core");
const effectiveTarget = argTarget ?? coreDest;
const absTarget = resolve(effectiveTarget);
if (absTarget !== allowedBase && !absTarget.startsWith(allowedBase + sep)) {
  console.error(`copy-core: refusing to operate outside ${allowedBase} (cli/core): ${absTarget}`);
  process.exit(1);
}

// Symlink guard: do NOT follow if the target is a symlink
if (existsSync(absTarget)) {
  const st = lstatSync(absTarget);
  if (st.isSymbolicLink()) {
    console.error(`copy-core: refusing to rm a symlink target: ${absTarget}`);
    process.exit(1);
  }
}

export function copyCore(): void {
  copyCoreTo(absTarget);
  console.log(`  Copied core/ → cli/core/`);
}

export function copyCoreTo(target: string): void {
  if (!existsSync(coreSrc)) {
    throw new Error(`Source core/ not found at ${coreSrc}`);
  }
  const resolvedTarget = resolve(target);
  if (existsSync(resolvedTarget)) {
    rmSync(resolvedTarget, { recursive: true });
  }
  cpSync(coreSrc, resolvedTarget, {
    recursive: true,
    filter: (src) => shouldIncludeCorePath(src),
  });
}

export function cleanCore(): void {
  if (existsSync(absTarget)) {
    rmSync(absTarget, { recursive: true });
    console.log(`  Cleaned cli/core/`);
  }
}

function shouldIncludeCorePath(src: string): boolean {
  const rel = relative(coreSrc, src);
  if (rel === "") return true;
  return !excludedPaths.some((excluded) => rel === excluded || rel.startsWith(excluded + sep));
}

// Allow running directly: bun run scripts/copy-core.ts [copy|clean]
if (import.meta.main) {
  const action = process.argv.find((a) => a === "copy" || a === "clean") ?? "copy";
  if (action === "copy") copyCore();
  else if (action === "clean") cleanCore();
  else console.error(`Unknown action: ${action}. Use "copy" or "clean".`);
}
