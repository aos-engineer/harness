import { describe, test, expect } from "bun:test";
import { ADAPTER_ALLOWLIST, isValidAdapter } from "../../cli/src/utils";

describe("ADAPTER_ALLOWLIST (spec D2)", () => {
  test("exports the four allowed adapters", () => {
    expect(ADAPTER_ALLOWLIST).toEqual(["pi", "claude-code", "codex", "gemini"]);
  });

  test("isValidAdapter accepts only allowlisted names", () => {
    expect(isValidAdapter("pi")).toBe(true);
    expect(isValidAdapter("claude-code")).toBe(true);
    expect(isValidAdapter("codex")).toBe(true);
    expect(isValidAdapter("gemini")).toBe(true);
  });

  test("isValidAdapter rejects traversal and unknown values", () => {
    expect(isValidAdapter("../evil")).toBe(false);
    expect(isValidAdapter("banana")).toBe(false);
    expect(isValidAdapter("")).toBe(false);
    expect(isValidAdapter("pi/foo")).toBe(false);
    expect(isValidAdapter("PI")).toBe(false); // case-sensitive
  });
});

import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Minimal valid profile so the test exercises actual command resolution even
// if the order of validation steps in run.ts changes (e.g. profile lookup
// moved before --adapter validation). Today the --adapter check happens
// first, but seeding the profile defends the test against that refactor.
const MINIMAL_PROFILE_YAML = `schema: aos/profile/v1
id: default
name: Default
version: 0.0.1
assembly:
  orchestrator: arbiter
  perspectives: []
delegation:
  default: broadcast
  opening_rounds: 1
  tension_pairs: []
  bias_limit: 1
constraints:
  time:
    min_minutes: 1
    max_minutes: 1
  budget:
    min: 0.01
    max: 0.01
    currency: USD
  rounds:
    min: 1
    max: 1
input:
  format: brief
  required_sections: []
output:
  format: memo
  path_template: "out/{{session_id}}/memo.md"
  sections: []
`;

describe("run.ts adapter allowlist enforcement", () => {
  test("--adapter banana exits 2 with allowlist hint", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-bad-adapter-"));
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    mkdirSync(join(tmp, "core", "profiles", "default"), { recursive: true });
    writeFileSync(
      join(tmp, "core", "profiles", "default", "profile.yaml"),
      MINIMAL_PROFILE_YAML,
    );
    writeFileSync(join(tmp, "brief.md"), "# test\n");
    try {
      const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")} --adapter banana`
        .cwd(tmp).nothrow().quiet();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("Unknown adapter: banana");
      expect(result.stderr.toString()).toContain("pi, claude-code, codex, gemini");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
