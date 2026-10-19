import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { git, tmpGitRepo, writeFile } from "./helpers.ts";

test("tmpGitRepo has one commit and a clean tree", () => {
  const repo = tmpGitRepo();
  expect(git(repo, "rev-list", "--count", "HEAD").trim()).toBe("1");
  expect(git(repo, "status", "--porcelain")).toBe("");
});

test("writeFile creates parent directories", () => {
  const repo = tmpGitRepo();
  writeFile(repo, "a/b/c.txt", "x");
  expect(existsSync(join(repo, "a/b/c.txt"))).toBe(true);
});
