#!/usr/bin/env bun
/**
 * Waits until npm serves <name>@<version> under <dist-tag>, then installs it into a scratch directory and
 * runs `aos --version`, so the release is proven installable from the registry, not just uploaded.
 *
 * Usage: bun run scripts/release/wait-for-npm.ts <name> <version> <dist-tag>
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [name, version, distTag] = process.argv.slice(2);
if (!name || !version || !distTag) {
  console.error("usage: wait-for-npm.ts <name> <version> <dist-tag>");
  process.exit(2);
}

const run = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { cwd, encoding: "utf8" });

let served = false;
for (let attempt = 1; attempt <= 30; attempt++) {
  const r = run("npm", ["view", `${name}@${distTag}`, "version"]);
  if (r.status === 0 && r.stdout.trim() === version) {
    served = true;
    break;
  }
  await Bun.sleep(10_000);
}
if (!served) {
  console.error(`${name}@${distTag} did not resolve to ${version} within five minutes`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "aos-npm-verify-"));
const install = run("npm", ["install", "--no-save", "--prefer-online", `${name}@${version}`], dir);
if (install.status !== 0) {
  console.error(`npm install ${name}@${version} failed:\n${install.stderr}`);
  process.exit(1);
}
const smoke = run("bun", [join(dir, "node_modules", name, "dist", "aos.js"), "--version"]);
if (smoke.status !== 0 || !smoke.stdout.includes(version)) {
  console.error(`the installed CLI did not report ${version}:\n${smoke.stdout}${smoke.stderr}`);
  process.exit(1);
}
console.log(`${name}@${version} is served under ${distTag} and runs: ${smoke.stdout.trim()}`);
