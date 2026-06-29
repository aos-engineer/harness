import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAdapterConfig } from "../cli/src/adapter-config";

test("readAdapterConfig returns null when missing", () => {
  const root = mkdtempSync(join(tmpdir(), "cfg-"));
  expect(readAdapterConfig(root)).toBeNull();
});

test("readAdapterConfig parses model_overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "cfg-"));
  mkdirSync(join(root, ".aos"));
  writeFileSync(
    join(root, ".aos", "adapter.yaml"),
    "platform: claude-code\nuse_vendor_default_model: true\nmodel_overrides:\n  economy: claude-haiku-4-5\n",
  );
  const cfg = readAdapterConfig(root);
  expect(cfg?.platform).toBe("claude-code");
  expect(cfg?.use_vendor_default_model).toBe(true);
  expect(cfg?.model_overrides?.economy).toBe("claude-haiku-4-5");
});
