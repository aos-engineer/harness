// tests/scripts/verify-release-tag.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const SCRIPT = join(process.cwd(), "scripts/verify-release-tag.ts");

async function initRepo(tag: string, version: string, annotated: boolean, dirty: boolean): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), "rel-verify-"));
  await $`cd ${tmp} && git init -q && git config user.email t@t && git config user.name t`;
  mkdirSync(join(tmp, "cli"));
  const pkgs = ["cli", "runtime", "adapters/shared", "adapters/claude-code", "adapters/codex", "adapters/gemini", "adapters/pi"];
  for (const p of pkgs) {
    mkdirSync(join(tmp, p), { recursive: true });
    writeFileSync(join(tmp, p, "package.json"), JSON.stringify({ name: `@x/${p.replace('/','-')}`, version }, null, 2));
  }
  await $`cd ${tmp} && git add -A && git commit -qm init`;
  if (annotated) await $`cd ${tmp} && git tag -a ${tag} -m ${tag}`;
  else await $`cd ${tmp} && git tag ${tag}`;
  if (dirty) writeFileSync(join(tmp, "cli", "dirty.txt"), "x");
  return tmp;
}

describe("verify-release-tag.ts (spec D2)", () => {
  test("tag + version match + annotated + clean → exit 0", async () => {
    const repo = await initRepo("v0.7.0", "0.7.0", true, false);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(0);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test("version mismatch → exit 1", async () => {
    const repo = await initRepo("v0.7.0", "0.6.0", true, false);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/version mismatch|does not match/i);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test("lightweight tag → exit 0 (annotation check dropped; see script header)", async () => {
    // Annotated-tag check was dropped because actions/checkout peels
    // annotated tags in CI, making the distinction unreliable. Real
    // supply-chain guarantees come from HEAD match, version lockstep,
    // clean tree, and maintainer-only tag-push permission.
    const repo = await initRepo("v0.7.0", "0.7.0", false, false);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(0);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test("dirty tree → exit 1", async () => {
    const repo = await initRepo("v0.7.0", "0.7.0", true, true);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/clean|dirty|uncommitted/i);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
