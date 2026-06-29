import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

// Minimal valid profile.yaml — just enough to pass loadProfile + validateBrief
// so the code path reaches adapter resolution. Without this seed, `aos run`
// exits early on "No profiles found" and never exercises the vulnerable code.
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

describe("project-local adapter override (spec D1)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "aos-hostile-"));
    // Minimum shape getHarnessRoot recognizes as a project
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    // Seed a minimal valid profile so `aos run default` proceeds past profile
    // resolution and actually reaches the adapter-resolution code (the site
    // of RCE-001). Without this seed, `aos run` exits early on "No profiles
    // found" and the hostile adapter path is never considered — making the
    // test pass vacuously.
    mkdirSync(join(tmp, "core", "profiles", "default"), { recursive: true });
    writeFileSync(
      join(tmp, "core", "profiles", "default", "profile.yaml"),
      MINIMAL_PROFILE_YAML,
    );
    // Hostile adapter source that exits 99 if run via `pi -e <hostile>`.
    mkdirSync(join(tmp, "adapters", "pi", "src"), { recursive: true });
    writeFileSync(
      join(tmp, "adapters", "pi", "src", "index.ts"),
      "process.exit(99);\n",
    );
    // Minimum brief (profile declares no required_sections).
    writeFileSync(join(tmp, "brief.md"), "# test\n");
    mkdirSync(join(tmp, ".aos"), { recursive: true });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  // NOTE: This test verifies that `cli/src/commands/run.ts` does NOT resolve
  // the adapter entrypoint from `<project>/adapters/<name>/src/index.ts`.
  // If a future change reintroduces that branch, `pi -e <hostile>` will
  // execute and the subprocess will exit 99 — this test will then fail on
  // the `not.toBe(99)` assertion AND on the hostile-path-not-in-output
  // assertions. Do not relax those assertions; instead, remove the
  // project-local resolution branch.
  test("aos run does NOT spawn the project-local adapters/pi/src/index.ts", async () => {
    const hostilePath = join(tmp, "adapters", "pi", "src", "index.ts");

    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")}`
      .cwd(tmp)
      .env({ ...process.env, CI: "1" })
      .nothrow()
      .quiet();

    const stderr = result.stderr.toString();
    const stdout = result.stdout.toString();

    // Must NOT propagate exit 99 (the hostile file's exit code). Pre-fix,
    // `pi -e <hostile>` would run `process.exit(99)` and the CLI would
    // forward that exit code.
    expect(result.exitCode).not.toBe(99);

    // The hostile path must never appear in the CLI's launch log. Pre-fix,
    // the CLI logs `pi -e <resolvedAdapterEntry>` — if the project-local
    // branch were active, that line would contain the hostile path.
    expect(stderr).not.toContain(hostilePath);
    expect(stdout).not.toContain(hostilePath);

    // Confirm we actually reached the adapter-resolution / launch code —
    // this proves the test didn't pass vacuously by exiting early on a
    // config error. We expect either a successful launch (stdout contains
    // "Launching Pi adapter") using the monorepo/installed adapter, or the
    // "Pi adapter not found" diagnostic if the environment has no resolvable
    // adapter package.
    const reachedAdapterCode =
      stdout.includes("Launching Pi adapter") ||
      stderr.includes("Pi adapter not found");
    expect(reachedAdapterCode).toBe(true);
  }, 60_000);
});
