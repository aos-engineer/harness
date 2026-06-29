import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backfillAdapterDefaults } from "../../cli/src/config-migration";

describe("config-migration", () => {
  test("backfills adapter_defaults for existing v2 configs", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-migrate-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `api_version: aos/config/v2
adapters:
  enabled: [pi, codex, claude-code]
  default: codex
models:
  economy: anthropic/claude-haiku-4-5
  standard: anthropic/claude-sonnet-4-6
  premium: anthropic/claude-opus-4-7
`,
    );

    const result = backfillAdapterDefaults(root);
    expect(result.changed).toBe(true);

    const updated = readFileSync(join(root, ".aos", "config.yaml"), "utf-8");
    expect(updated).toContain("adapter_defaults:");
    expect(updated).toContain("codex:");
    expect(updated).toContain("use_vendor_default_model: true");
    expect(updated).toContain("pi:");
    expect(updated).toContain("premium: anthropic/claude-opus-4-7");
  });

  test("does not rewrite when adapter_defaults already covers enabled adapters", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-migrate-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `api_version: aos/config/v2
adapters:
  enabled: [codex]
  default: codex
adapter_defaults:
  codex:
    use_vendor_default_model: true
`,
    );

    const result = backfillAdapterDefaults(root);
    expect(result.changed).toBe(false);
  });
});
