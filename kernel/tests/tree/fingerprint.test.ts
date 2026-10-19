import { beforeEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoot, treeFingerprint } from "../../src/tree/fingerprint.ts";
import { TreeError } from "../../src/util/errors.ts";
import { git, tmpDir, tmpGitRepo, writeFile } from "../helpers.ts";
import { fakeGitDir, withPath } from "./fake-git.ts";

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

// Most repositories gitignore .aos/, and git refuses any pathspec, even an exclude, that names an ignored path.
test.each([[".gitignore", ".aos/\n"], [".gitignore", ".aos\n"], [".git/info/exclude", ".aos/\n"]])(
  "works when .aos is ignored through %s (%j) and is unchanged by a log append",
  (file, pattern) => {
    writeFile(repo, file, pattern);
    writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n");
    const a = fp(repo);
    expect(a).toMatch(/^git:[0-9a-f]{40}$/);
    writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n{}\n");
    expect(fp(repo)).toBe(a);
  },
);

test("works when .aos is ignored, even after .aos content was committed earlier", () => {
  writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "commit run data by mistake");
  writeFile(repo, ".gitignore", ".aos/\n");
  const a = fp(repo);
  writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n{}\n");
  expect(fp(repo)).toBe(a);
});

test("ignores .aos even when .aos is not gitignored", () => {
  const a = fp(repo);
  writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n");
  expect(fp(repo)).toBe(a);
});

test("ignores .aos even after .aos content was committed", () => {
  writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n");
  const a = fp(repo);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "with log");
  expect(fp(repo)).toBe(a);
  writeFile(repo, ".aos/runs/R/log.jsonl", "{}\n{}\n");
  expect(fp(repo)).toBe(a);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "append");
  expect(fp(repo)).toBe(a);
});

test("covers the whole repository when called from a subdirectory", () => {
  mkdirSync(join(repo, "sub"));
  writeFile(repo, "top.ts", "x");
  expect(fp(join(repo, "sub"))).toBe(fp(repo));
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

test("removes its temporary index and lock when git fails part way", () => {
  // This git answers rev-parse, then leaves a lock beside the temporary index and fails, as a killed git would.
  const bin = fakeGitDir('case "$1" in\n  rev-parse) echo /nonexistent/index ;;\n  *) : > "$GIT_INDEX_FILE.lock"; exit 1 ;;\nesac\n');
  expect(() => withPath(bin, () => fp(repo))).toThrow(TreeError);
  expect(readdirSync(tmpdir()).filter((f) => f.startsWith(`aos-index-${process.pid}-`))).toEqual([]);
});

test("a file with mixed line endings does not make staging fail", () => {
  git(repo, "config", "core.autocrlf", "true");
  git(repo, "config", "core.safecrlf", "true");
  writeFile(repo, "m.txt", "a\nb\r\n");
  expect(fp(repo)).toMatch(/^git:[0-9a-f]{40}$/);
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
