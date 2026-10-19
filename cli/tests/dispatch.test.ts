import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = join(import.meta.dirname, "../src/index.ts");
const aos = (...args: string[]) => spawnSync("bun", [ENTRY, ...args], { encoding: "utf8" });

test("--version prints the cli package version", () => {
  const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
  const r = aos("--version");
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(`aos ${version}`);
});

test("no command prints the command list", () => {
  const r = aos();
  expect(r.status).toBe(0);
  for (const cmd of ["approve", "status", "doctor", "run", "mcp"]) expect(r.stdout).toContain(cmd);
});

test("an unknown command exits 2", () => {
  const r = aos("frobnicate");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("unknown command");
});
