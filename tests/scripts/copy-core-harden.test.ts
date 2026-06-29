import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { copyCoreTo } from "../../scripts/copy-core";

const SCRIPT = join(process.cwd(), "scripts/copy-core.ts");

describe("copy-core.ts hardening (spec D5)", () => {
  test("refuses if target is a symlink", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "copy-core-"));
    try {
      // Simulate a malicious symlink at the target
      mkdirSync(join(tmp, "real"));
      symlinkSync(join(tmp, "real"), join(tmp, "cli-core-symlink"));
      // Run the script with an override target env var (add this to the script below)
      const r = await $`bun run ${SCRIPT} --target=${join(tmp, "cli-core-symlink")}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/symlink|refuse/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("refuses if target resolves outside base assertion", async () => {
    const r = await $`bun run ${SCRIPT} --target=/tmp/out-of-scope`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/outside.*cli\/core/i);
  });

  test("excludes non-shipping education series briefs from packaged core", () => {
    const tmp = mkdtempSync(join(tmpdir(), "copy-core-filter-"));
    const target = join(tmp, "core");
    try {
      copyCoreTo(target);
      expect(existsSync(join(target, "briefs", "sample-product-decision", "brief.md"))).toBe(true);
      expect(existsSync(join(target, "briefs", "aos-education-series"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
