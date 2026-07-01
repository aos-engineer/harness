#!/usr/bin/env bun
/**
 * Release preflight: fail fast (BEFORE publishing anything) when the NPM_TOKEN
 * can authenticate but lacks publish rights.
 *
 * A read-only / under-scoped token otherwise gets partway into `npm publish`
 * and dies with a confusing `E404 — not found or you do not have permission`
 * MID-release (some packages published, some not). This step turns that into a
 * clear, upfront failure that names the fix.
 *
 * Only runs on the publish path (a token is present). Auth is provided the same
 * way as the publish step — `NODE_AUTH_TOKEN` + the `.npmrc` written by
 * actions/setup-node.
 *
 * Checks:
 *   1. `npm whoami` succeeds (token authenticates).
 *   2. Every `@aos-harness/*` package in the publish set has `read-write` access.
 *   3. Best-effort: the unscoped `aos-harness` CLI is `read-write`. Skipped with
 *      a note when the token cannot enumerate the account's packages (normal for
 *      a granular token) — the publish step is the backstop for that one.
 */
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCOPE = "@aos-harness";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Keep in lockstep with the publish set in scripts/publish.ts.
const PUBLISHED_DIRS = [
  "runtime",
  "adapters/shared",
  "adapters/claude-code",
  "adapters/codex",
  "adapters/gemini",
  "adapters/pi",
  "cli",
];

function pkgName(dir: string): string {
  return (JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf-8")) as { name: string }).name;
}

const names = PUBLISHED_DIRS.map(pkgName);
const scoped = names.filter((n) => n.startsWith(`${SCOPE}/`));
const unscoped = names.filter((n) => !n.startsWith(`${SCOPE}/`));

function fail(reason: string): never {
  console.error(`\n✗ npm preflight failed: ${reason}\n`);
  console.error(
    "The NPM_TOKEN in the `npm-publish` environment authenticates but cannot publish\n" +
      "these packages. Generate a WRITE-capable token for the publishing account and\n" +
      "update the secret (gh secret set NPM_TOKEN --env npm-publish):\n" +
      "  • Classic → Automation token (full publish rights, bypasses 2FA), or\n" +
      `  • Granular token with Read and write on the ${SCOPE} scope AND the unscoped\n` +
      "    `aos-harness` package, with no IP allowlist that blocks GitHub Actions.\n" +
      `Verify locally with:  npm access list packages ${SCOPE}   (should show read-write)\n`,
  );
  process.exit(1);
}

// 1. Authentication
const who = await $`npm whoami`.nothrow().quiet();
if (who.exitCode !== 0) {
  fail("`npm whoami` failed — NPM_TOKEN is missing, invalid, or expired.");
}
const whoami = who.stdout.toString().trim();
console.log(`▸ Authenticated as: ${whoami}`);

// 2. Write access to the scoped packages
const acc = await $`npm access list packages ${SCOPE} --json`.nothrow().quiet();
if (acc.exitCode !== 0) {
  fail(`could not read access for ${SCOPE} packages — the token likely has no access to the scope.`);
}
let access: Record<string, string>;
try {
  access = JSON.parse(acc.stdout.toString()) as Record<string, string>;
} catch {
  fail(`could not parse \`npm access list packages ${SCOPE} --json\` output.`);
}
const notWritable = scoped.filter((n) => access[n] !== "read-write");
if (notWritable.length > 0) {
  fail(
    `no read-write access to: ${notWritable.map((n) => `${n} (${access[n] ?? "no access"})`).join(", ")}`,
  );
}
console.log(`▸ read-write confirmed for ${scoped.length} ${SCOPE}/* package(s)`);

// 3. Unscoped CLI — best effort (granular tokens often cannot enumerate account packages)
for (const name of unscoped) {
  const ua = await $`npm access list packages ${whoami} --json`.nothrow().quiet();
  if (ua.exitCode !== 0) {
    console.log(`▸ (cannot enumerate ${whoami}'s packages to check \`${name}\` — granular token; publish step will validate)`);
    continue;
  }
  let userAccess: Record<string, string>;
  try {
    userAccess = JSON.parse(ua.stdout.toString()) as Record<string, string>;
  } catch {
    console.log(`▸ (could not parse account package access for \`${name}\` — publish step will validate)`);
    continue;
  }
  if (userAccess[name] !== "read-write") {
    fail(`no read-write access to the unscoped \`${name}\` package (${userAccess[name] ?? "no access"}).`);
  }
  console.log(`▸ read-write confirmed for ${name}`);
}

console.log("✓ npm preflight passed — token can publish all release packages.");
