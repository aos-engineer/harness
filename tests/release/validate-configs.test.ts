import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpDir } from "../../kernel/tests/helpers.ts";
import { VERSIONED } from "../../scripts/release/versioned.ts";
import { changelogSection, validateConfigs } from "../../scripts/validate-configs.ts";

const REPO = join(import.meta.dirname, "../..");
const SOURCE_PACK = join(REPO, "packs/feature-delivery");

function writeJson(root: string, rel: string, value: unknown): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify(value, null, 2));
}

/** A minimal repository shape that passes: one version everywhere, the pack in both places, one plugin. */
function fixture(): string {
  const root = tmpDir("aos-validate-");
  for (const file of VERSIONED) writeJson(root, file, { name: file === "hosts/claude-code/.claude-plugin/plugin.json" ? "aos" : "x", version: "1.2.3" });
  cpSync(SOURCE_PACK, join(root, "packs/feature-delivery"), { recursive: true, filter: (src) => !src.endsWith("package.json") });
  writeJson(root, "packs/feature-delivery/package.json", { name: "x", version: "1.2.3" });
  cpSync(SOURCE_PACK, join(root, "hosts/claude-code/pack"), { recursive: true, filter: (src) => !src.endsWith("package.json") });
  writeJson(root, ".claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "aos", source: "./hosts/claude-code" }] });
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n## 1.2.3 (2026-10-19)\n\n- Fixed a thing.\n\n## 1.2.2\n\n- Older.\n");
  return root;
}

describe("validateConfigs", () => {
  test("passes on this repository", () => {
    expect(validateConfigs(REPO)).toEqual([]);
  });

  test("passes on a minimal valid fixture", () => {
    expect(validateConfigs(fixture())).toEqual([]);
  });

  test("names every manifest when versions disagree", () => {
    const root = fixture();
    writeJson(root, "cli/package.json", { name: "x", version: "1.2.4" });
    const problems = validateConfigs(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("versions disagree");
    expect(problems[0]).toContain("cli/package.json=1.2.4");
  });

  test("reports a manifest without a version", () => {
    const root = fixture();
    writeJson(root, "kernel/package.json", { name: "x" });
    expect(validateConfigs(root)).toEqual(["kernel/package.json: no version field"]);
  });

  test("reports a pack that is not data only", () => {
    const root = fixture();
    writeFileSync(join(root, "hosts/claude-code/pack/run.sh"), "#!/bin/sh\necho hi\n");
    const problems = validateConfigs(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith("hosts/claude-code/pack: ");
  });

  test("reports a missing bundled pack", () => {
    const root = fixture();
    rmSync(join(root, "hosts/claude-code/pack"), { recursive: true });
    expect(validateConfigs(root)).toEqual(["hosts/claude-code/pack: missing; run bun run build:plugin"]);
  });

  test("rejects a marketplace source outside the repository", () => {
    const root = fixture();
    writeJson(root, ".claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "aos", source: "../elsewhere" }] });
    expect(validateConfigs(root)[0]).toContain("must be a ./ path inside the repository");
  });

  test("requires a CHANGELOG section for the version", () => {
    const root = fixture();
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## 1.2.2\n\n- Older.\n");
    expect(validateConfigs(root)).toEqual(['CHANGELOG.md: no "## 1.2.3" section, which the release workflow publishes as the notes']);
  });

  test("rejects an empty CHANGELOG section", () => {
    const root = fixture();
    writeFileSync(join(root, "CHANGELOG.md"), "## 1.2.3\n\n## 1.2.2\n\n- Older.\n");
    expect(validateConfigs(root)).toEqual(['CHANGELOG.md: the "## 1.2.3" section is empty']);
  });

  test("reads a section the way the release workflow does", () => {
    const log = "## 1.2.30\n\nwrong\n\n## 1.2.3 (date)\n\nright\n\n## 1.2.2\n\nolder\n";
    expect(changelogSection(log, "1.2.3")).toBe("\nright\n");
    expect(changelogSection(log, "1.2")).toBeNull();
    expect(changelogSection("## 1.2.3\nlast", "1.2.3")).toBe("last");
  });

  test("rejects a marketplace entry whose plugin has another name", () => {
    const root = fixture();
    writeJson(root, ".claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "other", source: "./hosts/claude-code" }] });
    expect(validateConfigs(root)[0]).toContain('declares name "aos"');
  });
});
