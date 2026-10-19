import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch } from "../src/dispatch.ts";
import type { CliIO, CommandFn } from "../src/io.ts";

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

function fakeIO(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = { argv, cwd: process.cwd(), env: {}, isTTY: false, out: (s) => void out.push(s), err: (s) => void err.push(s), prompt: async () => "" };
  return { io, out, err };
}

const only = (fn: CommandFn) => ({ only: { help: "only", importCommand: async () => fn } });

test("a command that throws prints one line and exits 1", async () => {
  const f = fakeIO(["only"]);
  expect(await dispatch(f.io, only(async () => { throw new Error("kaput"); }))).toBe(1);
  expect(f.err).toEqual(["aos: kaput"]);
});

test("dispatch returns the command's own exit code", async () => {
  expect(await dispatch(fakeIO(["only"]).io, only(async () => 3))).toBe(3);
});

// process.exit() kills commands that keep serving after they resolve (aos mcp) and truncates piped stdout.
test("the entry point sets process.exitCode instead of calling process.exit", () => {
  const code = readFileSync(ENTRY, "utf8").replace(/\/\/.*$/gm, ""); // comments may name the call they forbid
  expect(code).not.toMatch(/process\.exit\(/);
  expect(code).toMatch(/process\.exitCode = /);
});
