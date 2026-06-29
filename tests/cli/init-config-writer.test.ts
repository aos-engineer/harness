import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeConfig } from "../../cli/src/init-config-writer";
import type { WizardResult } from "../../cli/src/init-types";

const RESULT: WizardResult = {
  enabledAdapters: ["pi", "codex"],
  defaultAdapter: "codex",
  memory: { provider: "expertise" },
  models: {
    economy: "anthropic/claude-haiku-4-5",
    standard: "anthropic/claude-sonnet-4-6",
    premium: "anthropic/claude-opus-4-7",
  },
  adapterDefaults: {
    pi: {
      use_vendor_default_model: false,
      models: {
        economy: "anthropic/claude-haiku-4-5",
        standard: "anthropic/claude-sonnet-4-6",
        premium: "anthropic/claude-opus-4-7",
      },
    },
    codex: {
      use_vendor_default_model: true,
    },
  },
  editor: "code",
  actions: [],
};

describe("init-config-writer", () => {
  test("writes canonical v2 shape", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-writer-"));
    mkdirSync(join(root, ".aos"), { recursive: true });

    const yaml = mergeConfig(root, RESULT, "bun");
    expect(yaml).toContain("api_version: aos/config/v2");
    expect(yaml).toContain("enabled:");
    expect(yaml).toContain("- pi");
    expect(yaml).toContain("- codex");
    expect(yaml).toContain("default: codex");
    expect(yaml).toContain("adapter_defaults:");
    expect(yaml).toContain("use_vendor_default_model: true");
  });

  test("preserves existing comments while migrating v1 adapter key", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-writer-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `# user comment
adapter: pi
models:
  economy: foo
`,
    );

    const yaml = mergeConfig(root, RESULT, "npm");
    expect(yaml).toContain("# user comment");
    expect(yaml).not.toContain("\nadapter: pi");
    expect(yaml).toContain("package_manager: npm");
    expect(yaml).toContain("adapters:");
  });
});
