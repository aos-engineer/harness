import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

describe("aos init integration", () => {
  const safePath = `${dirname(process.execPath)}:/usr/bin:/bin`;

  test("--non-interactive without selection writes scan.json and exits 0", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-init-"));
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} init --non-interactive`
      .cwd(root)
      .env({ ...process.env, CI: "1", PATH: safePath, AOS_NPM_GLOBAL_DIR: join(root, "no-npm"), AOS_BUN_GLOBAL_DIR: join(root, "no-bun") })
      .nothrow()
      .quiet();

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, ".aos", "scan.json"), "utf-8")).toContain('"packageManager"');
  }, 60_000);

  test("--from-yaml writes v2 config", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-init-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    const wizardPath = join(root, "wizard.yaml");
    writeFileSync(
      wizardPath,
      `enabledAdapters:
  - pi
  - codex
defaultAdapter: codex
memory:
  provider: expertise
models:
  economy: anthropic/claude-haiku-4-5
  standard: anthropic/claude-sonnet-4-6
  premium: anthropic/claude-opus-4-6
editor: code
actions: []
`,
    );

    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} init --from-yaml ${wizardPath}`
      .cwd(root)
      .env({ ...process.env, CI: "1", PATH: safePath, AOS_NPM_GLOBAL_DIR: join(root, "no-npm"), AOS_BUN_GLOBAL_DIR: join(root, "no-bun") })
      .nothrow()
      .quiet();

    expect(result.exitCode).toBe(0);
    const config = readFileSync(join(root, ".aos", "config.yaml"), "utf-8");
    expect(config).toContain("api_version: aos/config/v2");
    expect(config).toContain("default: codex");
    expect(readFileSync(join(root, ".pi", "extensions", "aos-harness.ts"), "utf-8")).toContain(
      'export { default } from "@aos-harness/pi-adapter";',
    );
    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toContain(".pi/extensions/");
  }, 60_000);

  test("--non-interactive --adapter exits 3 when selected adapter is not ready", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-init-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(join(root, ".aos", "adapter.yaml"), "platform: pi\n");

    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} init --non-interactive --adapter pi`
      .cwd(root)
      .env({
        ...process.env,
        CI: "1",
        PATH: safePath,
        AOS_NPM_GLOBAL_DIR: join(root, "no-npm"),
        AOS_BUN_GLOBAL_DIR: join(root, "no-bun"),
      })
      .nothrow()
      .quiet();

    expect(result.exitCode).toBe(3);
    expect(result.stderr.toString()).toContain("Selected adapters are not ready");
  }, 60_000);

  test("--force backs up a corrupt config before rewriting it", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-init-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(join(root, ".aos", "config.yaml"), "adapter: [broken\n");

    const wizardPath = join(root, "wizard.yaml");
    writeFileSync(
      wizardPath,
      `enabledAdapters:
  - pi
defaultAdapter: pi
memory:
  provider: expertise
models:
  economy: anthropic/claude-haiku-4-5
  standard: anthropic/claude-sonnet-4-6
  premium: anthropic/claude-opus-4-6
editor: code
actions: []
`,
    );

    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} init --force --from-yaml ${wizardPath}`
      .cwd(root)
      .env({ ...process.env, CI: "1", PATH: safePath, AOS_NPM_GLOBAL_DIR: join(root, "no-npm"), AOS_BUN_GLOBAL_DIR: join(root, "no-bun") })
      .nothrow()
      .quiet();

    expect(result.exitCode).toBe(0);
    const backups = readdirSync(join(root, ".aos")).filter((file) => file.startsWith("config.yaml.backup."));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(root, ".aos", "config.yaml"), "utf-8")).toContain("api_version: aos/config/v2");
  }, 60_000);
});
