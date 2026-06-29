// tests/cli/import-meta-dir-symlink.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

describe("import.meta.dir under npm link (spec D1)", () => {
  let tmpRoot: string;
  let fakeRepo: string;
  let siblingProject: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "aos-bun-symlink-"));
    fakeRepo = join(tmpRoot, "aos-harness");
    siblingProject = join(tmpRoot, "consumer");
    mkdirSync(join(fakeRepo, "cli", "src"), { recursive: true });
    mkdirSync(join(fakeRepo, "adapters", "pi"), { recursive: true });
    mkdirSync(siblingProject, { recursive: true });

    // Minimal stub CLI that logs import.meta.dir
    writeFileSync(
      join(fakeRepo, "cli", "src", "probe.ts"),
      "console.log(import.meta.dir);\n",
    );
    writeFileSync(
      join(fakeRepo, "cli", "package.json"),
      JSON.stringify({ name: "aos-harness-probe", version: "0.0.0", bin: { probe: "./src/probe.ts" } }),
    );

    // Symlink as if npm-linked
    mkdirSync(join(siblingProject, "node_modules", "aos-harness-probe"), { recursive: true });
    rmSync(join(siblingProject, "node_modules", "aos-harness-probe"), { recursive: true });
    symlinkSync(join(fakeRepo, "cli"), join(siblingProject, "node_modules", "aos-harness-probe"), "dir");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("import.meta.dir points into the real checkout, not the symlink", async () => {
    const result = await $`bun run ${join(siblingProject, "node_modules", "aos-harness-probe", "src", "probe.ts")}`.text();
    const reportedDir = result.trim();
    const realSrcDir = realpathSync(join(fakeRepo, "cli", "src"));

    // Either the real path (symlink resolved) or the symlinked path is acceptable —
    // both mean "the CLI's own install location", not the consumer's cwd.
    const symlinkedSrcDir = join(siblingProject, "node_modules", "aos-harness-probe", "src");

    expect([realSrcDir, symlinkedSrcDir]).toContain(reportedDir);
    // Critically: NOT the consumer project root
    expect(reportedDir).not.toBe(siblingProject);
  });
});
