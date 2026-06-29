import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureProjectPiGitignore,
  getGlobalPiExtensionPath,
  getProjectPiExtensionPath,
  hasPiExtensionShim,
  writeGlobalPiShim,
  writeProjectPiShim,
} from "../../cli/src/pi-extension-setup";

describe("Pi extension shim setup", () => {
  test("writes project-local shim and gitignore entry", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-pi-shim-"));

    const shimPath = writeProjectPiShim(root);
    const gitignorePath = ensureProjectPiGitignore(root);

    expect(shimPath).toBe(getProjectPiExtensionPath(root));
    expect(readFileSync(shimPath, "utf-8")).toContain("aos init");
    expect(readFileSync(shimPath, "utf-8")).toContain('export { default } from "@aos-harness/pi-adapter";');
    expect(readFileSync(gitignorePath, "utf-8")).toContain(".pi/extensions/");
    expect(hasPiExtensionShim(root)).toBe(true);
  });

  test("writes global shim under Pi's global extension directory", () => {
    const home = mkdtempSync(join(tmpdir(), "aos-pi-home-"));

    const shimPath = writeGlobalPiShim(home);

    expect(shimPath).toBe(getGlobalPiExtensionPath(home));
    expect(readFileSync(shimPath, "utf-8")).toContain("aos setup-pi --global");
    expect(readFileSync(shimPath, "utf-8")).toContain('export { default } from "@aos-harness/pi-adapter";');
  });
});
