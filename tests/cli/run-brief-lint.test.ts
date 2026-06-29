import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

function setupProject(briefContent: string): { briefPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), "aos-run-lint-"));
  const briefPath = join(cwd, "brief.md");
  writeFileSync(briefPath, briefContent, "utf-8");
  return { briefPath };
}

describe("aos run brief lint", () => {
  test("prints clean summary on a valid deliberation brief (with --dry-run)", () => {
    const goodDelib = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n## Key Question\nq?\n`;
    const { briefPath } = setupProject(goodDelib);
    const r = spawnSync("bun", [CLI, "run", "strategic-council", "--brief", briefPath, "--dry-run"], {
      encoding: "utf-8",
      cwd: join(import.meta.dir, "..", ".."),
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("Brief lint:");
    expect(combined).toMatch(/looks good|0 errors/);
  });

  test("prints error count when brief missing required sections", () => {
    const badDelib = `# Brief: T\n## Situation\ns\n`;
    const { briefPath } = setupProject(badDelib);
    const r = spawnSync("bun", [CLI, "run", "strategic-council", "--brief", briefPath, "--dry-run"], {
      encoding: "utf-8",
      cwd: join(import.meta.dir, "..", ".."),
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("Brief lint:");
    expect(combined).toMatch(/error/);
    expect(combined).toContain("aos brief validate");
  });
});
