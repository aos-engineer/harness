import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAdapterDir } from "../../cli/src/utils";

describe("getAdapterDir", () => {
  test("falls back to a globally installed adapter package directory", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-adapter-dir-"));
    const bunGlobal = join(root, "bun-global");
    const pkgDir = join(bunGlobal, "@aos-harness", "fake-adapter");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@aos-harness/fake-adapter", version: "0.8.0" }));
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const ok = true;\n");

    const resolved = getAdapterDir("fake", { AOS_BUN_GLOBAL_DIR: bunGlobal });
    expect(resolved).toBe(pkgDir);
  });
});
