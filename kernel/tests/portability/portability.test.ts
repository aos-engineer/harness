import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
  for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/\bBun\.|from ["']bun:|import\.meta\.dir\b/);
});

test("kernel barrel loads under Node", () => {
  const r = spawnSync("node", [join(import.meta.dirname, "node-import.mjs")], { encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(r.stdout.trim()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});
