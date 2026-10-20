import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { git, tmpGitRepo, writeFile } from "./helpers.ts";

const made: string[] = [];
const repo = () => {
  const r = tmpGitRepo();
  made.push(r);
  return r;
};
const saved = { GIT_DIR: process.env.GIT_DIR, GIT_CONFIG_PARAMETERS: process.env.GIT_CONFIG_PARAMETERS };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});
afterAll(() => {
  for (const r of made) rmSync(r, { recursive: true, force: true });
});

test("tmpGitRepo has one commit and a clean tree", () => {
  const r = repo();
  expect(git(r, "rev-list", "--count", "HEAD").trim()).toBe("1");
  expect(git(r, "status", "--porcelain")).toBe("");
});

test("writeFile creates parent directories", () => {
  const r = repo();
  writeFile(r, "a/b/c.txt", "x");
  expect(existsSync(join(r, "a/b/c.txt"))).toBe(true);
});

// Tests often run inside git hooks, which export GIT_DIR; inheriting it would point git at the real repo.
test("an inherited GIT_DIR cannot redirect the helper's git", () => {
  process.env.GIT_DIR = "/nonexistent-aos-git-dir";
  expect(git(repo(), "rev-list", "--count", "HEAD").trim()).toBe("1");
});

test("the default branch is main whatever the developer's config says", () => {
  process.env.GIT_CONFIG_PARAMETERS = "'init.defaultBranch'='trunk'";
  expect(git(repo(), "branch", "--show-current").trim()).toBe("main");
});

test("commits in a temp repo never run the developer's hooks", () => {
  const hooks = git(repo(), "config", "core.hooksPath").trim();
  expect(hooks).toContain("aos-repo-");
});
