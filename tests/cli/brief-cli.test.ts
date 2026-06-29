import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

function runCli(args: string[], stdin?: string) {
  const res = spawnSync("bun", [CLI, ...args], {
    input: stdin,
    encoding: "utf-8",
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status ?? 0 };
}

function tmpFile(content: string, name = "brief.md"): string {
  const dir = mkdtempSync(join(tmpdir(), "aos-brief-cli-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("aos brief command dispatch", () => {
  test("`aos brief --help` prints subcommand list", () => {
    const r = runCli(["brief", "--help"]);
    expect(r.stdout + r.stderr).toContain("brief");
    expect(r.stdout + r.stderr).toContain("template");
    expect(r.stdout + r.stderr).toContain("validate");
    expect(r.stdout + r.stderr).toContain("save");
  });
});

describe("aos brief template", () => {
  test("prints execution template with required sections to stdout", () => {
    const r = runCli(["brief", "template", "--kind", "execution"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("# Brief:");
    expect(r.stdout).toContain("## Feature / Vision");
    expect(r.stdout).toContain("## Success Criteria");
  });

  test("requires --kind", () => {
    const r = runCli(["brief", "template"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--kind");
  });

  test("rejects unknown kind", () => {
    const r = runCli(["brief", "template", "--kind", "bogus"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("kind must be");
  });
});

describe("aos brief validate", () => {
  const goodDelib = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n## Key Question\nQ?\n`;
  const missingKQ = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n`;
  const emptySection = `# Brief: T\n## Situation\n\n## Stakes\nx\n## Constraints\nc\n## Key Question\nQ?\n`;

  test("exits 0 with no stderr on a clean brief", () => {
    const r = runCli(["brief", "validate", tmpFile(goodDelib), "--kind", "deliberation"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("exits 1 with section name in stderr on missing required", () => {
    const r = runCli(["brief", "validate", tmpFile(missingKQ), "--kind", "deliberation"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Key Question");
  });

  test("exits 0 by default on empty section (warning)", () => {
    const r = runCli(["brief", "validate", tmpFile(emptySection), "--kind", "deliberation"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("empty");
  });

  test("exits 1 with --strict on empty section", () => {
    const r = runCli(["brief", "validate", tmpFile(emptySection), "--kind", "deliberation", "--strict"]);
    expect(r.status).toBe(1);
  });
});

describe("aos brief save", () => {
  const goodExec = `# Brief: T\n## Feature / Vision\nv\n## Context\nc\n## Constraints\nc\n## Success Criteria\ns\n`;
  const missingSC = `# Brief: T\n## Feature / Vision\nv\n## Context\nc\n## Constraints\nc\n`;

  test("save accepts --from-file and writes to target", () => {
    const src = tmpFile(goodExec, "src.md");
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    expect(r.status).toBe(0);
    expect(readFileSync(dest, "utf-8")).toContain("Feature / Vision");
  });

  test("save rejects bad brief, exits non-zero, names the missing section", () => {
    const src = tmpFile(missingSC, "src.md");
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Success Criteria");
    expect(existsSync(dest)).toBe(false);
  });

  test("save accepts --from-stdin", () => {
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-stdin"], goodExec);
    expect(r.status).toBe(0);
  });

  test("save without --force on existing file errors", () => {
    const src = tmpFile(goodExec, "src.md");
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    expect(runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]).status).toBe(0);
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("already exists");
  });
});

describe("aos-create-brief skill", () => {
  test("SKILL.md exists and includes both schemas + --from-file guidance", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", "skills", "aos-create-brief", "SKILL.md");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("name: aos-create-brief");
    expect(content).toContain("Situation");
    expect(content).toContain("Stakes");
    expect(content).toContain("Key Question");
    expect(content).toContain("Feature / Vision");
    expect(content).toContain("Success Criteria");
    expect(content).toContain("--from-file");
  });
});

function rootPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8"));
  return pkg.version;
}

describe("Gemini packaging", () => {
  test(".gemini/extension.json exists, parses, and matches root package version", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", ".gemini", "extension.json");
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.name).toBe("aos-harness");
    expect(parsed.version).toBe(rootPackageVersion());
    expect(parsed.skills).toBe("../skills/");
  });

  test("install.sh is executable", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", "gemini", "install.sh");
    expect(statSync(path).mode & 0o100).toBe(0o100);
  });
});

describe("Codex plugin metadata", () => {
  test("plugin.json version matches root package version", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", ".codex-plugin", "plugin.json");
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.version).toBe(rootPackageVersion());
    expect(parsed.interface.defaultPrompt).toContain("Author a new AOS brief from an idea.");
  });

  test("aos-create SKILL.md references aos-create-brief", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", "skills", "aos-create", "SKILL.md");
    expect(readFileSync(path, "utf-8")).toContain("aos-create-brief");
  });
});
