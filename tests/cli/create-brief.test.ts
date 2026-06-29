import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

function runCli(args: string[], cwd?: string) {
  const res = spawnSync("bun", [CLI, ...args], { encoding: "utf-8", cwd });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status ?? 0 };
}

describe("aos create brief --non-interactive", () => {
  test("writes a deliberation brief to ./briefs/<slug>/brief.md in CWD", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const r = runCli([
      "create", "brief", "test-slug",
      "--kind", "deliberation",
      "--title", "Test",
      "--situation", "S body",
      "--stakes", "T body",
      "--constraints", "C body",
      "--key-question", "Q?",
      "--non-interactive",
    ], cwd);
    expect(r.status).toBe(0);
    const path = join(cwd, "briefs", "test-slug", "brief.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("# Brief: Test");
    expect(content).toContain("## Key Question");
    expect(content).toContain("Q?");
  });

  test("writes execution brief with required flags", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const r = runCli([
      "create", "brief", "exec-slug",
      "--kind", "execution",
      "--title", "X",
      "--feature", "F body",
      "--context", "Ctx",
      "--constraints", "C",
      "--success-criteria", "SC",
      "--non-interactive",
    ], cwd);
    expect(r.status).toBe(0);
    expect(existsSync(join(cwd, "briefs", "exec-slug", "brief.md"))).toBe(true);
  });

  test("errors when required flag missing in --non-interactive", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const r = runCli([
      "create", "brief", "x",
      "--kind", "deliberation",
      "--title", "T",
      "--situation", "s",
      "--non-interactive",
    ], cwd);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Stakes|Constraints|Key Question/);
  });

  test("--out overrides default path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const out = join(cwd, "elsewhere", "x.md");
    const r = runCli([
      "create", "brief", "ignored-slug",
      "--kind", "deliberation",
      "--title", "T",
      "--situation", "s",
      "--stakes", "x",
      "--constraints", "c",
      "--key-question", "q?",
      "--out", out,
      "--non-interactive",
    ], cwd);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  test("refuses overwrite without --force", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const args = [
      "create", "brief", "dup",
      "--kind", "deliberation",
      "--title", "T",
      "--situation", "s",
      "--stakes", "x",
      "--constraints", "c",
      "--key-question", "q?",
      "--non-interactive",
    ];
    expect(runCli(args, cwd).status).toBe(0);
    const second = runCli(args, cwd);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("already exists");
  });
});
