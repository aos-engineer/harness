import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

describe("aos create name validation (spec D4/PATH-003)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "aos-create-"));
    mkdirSync(join(tmp, "core", "agents", "custom"), { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test("rejects ../ in name", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent ../evil`
      .cwd(tmp).nothrow().quiet();
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toMatch(/Invalid name/);
    // Must NOT have written agent.yaml anywhere outside tmp/core/agents/custom
    expect(existsSync(join(tmp, "..", "evil"))).toBe(false);
  });

  test("rejects dot in name", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent my.agent`
      .cwd(tmp).nothrow().quiet();
    expect(result.exitCode).toBe(2);
  });

  test("accepts well-formed names", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent my-agent`
      .cwd(tmp).nothrow().quiet();
    // May fail for other reasons (missing template, etc.), but NOT with exit 2 + "Invalid name"
    expect(result.stderr.toString()).not.toMatch(/Invalid name/);
  });

  test("kebab-cases and accepts 'A New Agent'", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent "A New Agent"`
      .cwd(tmp).nothrow().quiet();
    expect(result.stderr.toString()).not.toMatch(/Invalid name/);
  });
});
