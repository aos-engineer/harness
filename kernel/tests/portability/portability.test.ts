import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUN_ONLY } from "./bun-only.ts";

const SRC = join(import.meta.dirname, "../../src");

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listTs(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

// The Pi host imports the kernel in-process under Node, so kernel source must avoid Bun-only APIs.
test("kernel/src uses no Bun-only APIs", () => {
  const files = listTs(SRC);
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(BUN_ONLY);
});

test("kernel barrel loads under Node", () => {
  const r = spawnSync("node", [join(import.meta.dirname, "node-import.mjs")], { encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(r.stdout.trim()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test.each([
  ['import { Database } from "bun:sqlite";', true],
  ['import "bun:test";', true],
  ['const ffi = require("bun:ffi");', true],
  ['const jsc = await import("bun:jsc");', true],
  ["const f = Bun.file(path);", true],
  ["const here = import.meta.dir;", true],
  ["const self = import.meta.path;", true],
  ["const file = import.meta.file;", true],
  ["if (import.meta.main) run();", true],
  ["const dir = import.meta.dirname;", false],
  ["const bunny = 1;", false],
])("BUN_ONLY flags %j: %p", (src, flagged) => expect(BUN_ONLY.test(src)).toBe(flagged));
