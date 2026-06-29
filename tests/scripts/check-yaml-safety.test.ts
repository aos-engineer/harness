// tests/scripts/check-yaml-safety.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const SCRIPT = join(process.cwd(), "scripts/check-yaml-safety.ts");

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "yaml-safety-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("check-yaml-safety.ts (spec D3)", () => {
  test("safe yaml.load with JSON_SCHEMA passes", async () => {
    const root = makeFixture({
      "src/a.ts": `import yaml from "js-yaml"; yaml.load(x, { schema: yaml.JSON_SCHEMA });`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  test("yaml.load without schema fails", async () => {
    const root = makeFixture({
      "src/a.ts": `import yaml from "js-yaml"; yaml.load(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("a.ts");
    rmSync(root, { recursive: true, force: true });
  });

  test("destructured load without schema fails (no binding resolution needed)", async () => {
    const root = makeFixture({
      "src/a.ts": `import { load } from "js-yaml"; load(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  test("comment containing JSON_SCHEMA does NOT count as a schema argument", async () => {
    const root = makeFixture({
      "src/a.ts": `import yaml from "js-yaml"; // JSON_SCHEMA\nyaml.load(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1); // still fails — schema not in args
    rmSync(root, { recursive: true, force: true });
  });

  test("test files are excluded by path, not substring", async () => {
    const root = makeFixture({
      "src/latest-config.ts": `import yaml from "js-yaml"; yaml.load(x);`, // contains "test" in name → must still FAIL
      "tests/foo.test.ts": `import yaml from "js-yaml"; yaml.load(x);`,      // under tests/ → pass
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("latest-config.ts");
    expect(r.stderr.toString()).not.toContain("tests/foo.test.ts");
    rmSync(root, { recursive: true, force: true });
  });

  test("// yaml-safety-ignore comment with reason suppresses", async () => {
    const root = makeFixture({
      "src/a.ts": `// yaml-safety-ignore: local loader, not js-yaml\nload(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  test("// yaml-safety-ignore without reason fails", async () => {
    const root = makeFixture({
      "src/a.ts": `// yaml-safety-ignore\nload(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/reason required/i);
    rmSync(root, { recursive: true, force: true });
  });
});
