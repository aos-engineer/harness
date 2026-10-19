import { beforeEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoot, treeFingerprint } from "../../src/tree/fingerprint.ts";
import { TreeError } from "../../src/util/errors.ts";
import { git, tmpDir, tmpGitRepo, writeFile } from "../helpers.ts";

const fp = (r: string) => treeFingerprint(r, { git: true, changes: 0 }).fingerprint;

let repo: string;
beforeEach(() => {
  repo = tmpGitRepo();
});

test("stable across calls", () => expect(fp(repo)).toBe(fp(repo)));

test("equals the committed tree when the working tree is clean", () => {
  expect(fp(repo)).toBe("git:" + git(repo, "rev-parse", "HEAD^{tree}").trim());
});

test("changes when a tracked file changes", () => {
  const a = fp(repo);
  writeFile(repo, "README.md", "changed");
  expect(fp(repo)).not.toBe(a);
});

test("changes when an untracked, non-ignored file appears", () => {
  const a = fp(repo);
  writeFile(repo, "new.ts", "x");
  expect(fp(repo)).not.toBe(a);
});

test("ignores gitignored files", () => {
  writeFile(repo, ".gitignore", "dist/\n");
  const a = fp(repo);
  writeFile(repo, "dist/x.js", "x");
  expect(fp(repo)).toBe(a);
});

test("ignores .aos even when .aos is not gitignored", () => {
  const a = fp(repo);
  writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n");
  expect(fp(repo)).toBe(a);
});

test("excludes only .aos itself, not names that start with it", () => {
  const a = fp(repo);
  writeFile(repo, ".aosx/a", "x");
  expect(fp(repo)).not.toBe(a);
});

test("unchanged by committing the current tree", () => {
  writeFile(repo, "a.ts", "x");
  const a = fp(repo);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "x");
  expect(fp(repo)).toBe(a);
});

test("does not modify the real index", () => {
  writeFile(repo, "b.ts", "x");
  fp(repo);
  expect(git(repo, "status", "--porcelain")).toContain("?? b.ts");
});

test("removes its temporary index", () => {
  fp(repo);
  expect(readdirSync(tmpdir()).filter((f) => f.startsWith(`aos-index-${process.pid}-`))).toEqual([]);
});

test("works in a repo with no commits", () => {
  const r = tmpDir();
  git(r, "init", "-q");
  writeFile(r, "a", "1");
  expect(fp(r)).toMatch(/^git:[0-9a-f]{40}$/);
});

test("works in a linked worktree", () => {
  const wt = join(tmpDir(), "wt");
  git(repo, "worktree", "add", "-q", wt);
  expect(fp(wt)).toMatch(/^git:/);
});

test("throws TreeError outside a repository", () => {
  expect(() => treeFingerprint(tmpDir(), { git: true, changes: 0 })).toThrow(TreeError);
});

test("counter fallback outside git is weak", () => {
  expect(treeFingerprint(tmpDir(), { git: false, changes: 4 })).toEqual({ fingerprint: "counter:4", weak: true });
});

test("gitRoot finds the top level from a subdirectory", () => {
  mkdirSync(join(repo, "sub"));
  expect(gitRoot(join(repo, "sub"))).toBe(realpathSync(repo));
});

test("gitRoot is null outside a repository and for a missing directory", () => {
  expect(gitRoot(tmpDir())).toBeNull();
  expect(gitRoot(join(tmpDir(), "missing"))).toBeNull();
});
