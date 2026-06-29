import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const CLI = join(REPO, "cli", "src", "index.ts");

describe("aos validate brief checks", () => {
  test("does not produce per-profile cross-product failures", () => {
    const r = spawnSync("bun", [CLI, "validate"], {
      cwd: REPO,
      encoding: "utf-8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).not.toMatch(/Brief ".+" for profile ".+":/);
  });

  test("each committed brief produces at most one validation check", () => {
    const r = spawnSync("bun", [CLI, "validate"], {
      cwd: REPO,
      encoding: "utf-8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const briefChecks = combined.match(/(?:PASS|FAIL)\s+Brief "/g) ?? [];
    expect(briefChecks.length).toBeLessThanOrEqual(5);
  });

  test("committed briefs all pass well-formedness check", () => {
    const r = spawnSync("bun", [CLI, "validate"], {
      cwd: REPO,
      encoding: "utf-8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const briefFailures = combined.match(/FAIL\s+Brief ".+"/g) ?? [];
    expect(briefFailures).toEqual([]);
  });
});
