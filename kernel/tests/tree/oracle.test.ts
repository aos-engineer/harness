import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ABSENT, oracleCovers, oracleDiff, oracleSnapshot, parseManifest, readManifest } from "../../src/tree/oracle.ts";
import { git, ORACLE_MANIFEST, ORACLE_TEST, tmpDir, tmpGitRepo, writeFile } from "../helpers.ts";

const snap = (root: string, text: string, inGit = true) => oracleSnapshot(root, { git: inGit, manifest: ORACLE_MANIFEST, ...parseManifest(text) });

describe("parseManifest", () => {
  test("reads one entry per line, skipping blanks and comments, and drops a trailing slash", () => {
    expect(parseManifest("# acceptance\n\ntests/acceptance/\nplaywright.config.ts\r\n  e2e  \ntests/acceptance\npackage.json#/scripts/test\n"))
      .toEqual({ entries: ["tests/acceptance", "playwright.config.ts", "e2e", "package.json#/scripts/test"], invalid: [] });
  });

  test("refuses entries that leave the repository or reach kernel and git state", () => {
    const { entries, invalid } = parseManifest(["/etc/passwd", "../up", "a/../b", ".aos/runs", ".GIT/config", "a\\b", "package.json#scripts", "ok.ts"].join("\n"));
    expect(entries).toEqual(["ok.ts"]);
    expect(invalid).toHaveLength(7);
    expect(invalid[0]).toStartWith("line 1: ");
    expect(invalid[3]).toContain(".aos/ and .git/ cannot be part of the oracle");
    expect(invalid[6]).toContain('a JSON pointer starts with "/"');
  });
});

describe("readManifest", () => {
  test("a missing manifest declares nothing", () => {
    expect(readManifest(tmpDir(), ORACLE_MANIFEST)).toEqual({ entries: [], invalid: [] });
  });

  test("a directory in its place is reported", () => {
    const root = tmpDir();
    mkdirSync(join(root, ORACLE_MANIFEST));
    expect(readManifest(root, ORACLE_MANIFEST).invalid).toEqual([`${ORACLE_MANIFEST} is a directory, not a file`]);
  });
});

describe("oracleSnapshot in git", () => {
  test("lists tracked and untracked files under a directory, but not ignored test output", () => {
    const root = tmpGitRepo();
    writeFile(root, "tests/acceptance/new.test.ts", "x");
    writeFile(root, ".gitignore", "tests/acceptance/.auth/\n");
    writeFile(root, "tests/acceptance/.auth/user.json", "{}");
    const before = snap(root, "tests/acceptance/\n");
    expect(Object.keys(before.files)).toEqual([ORACLE_MANIFEST, "tests/acceptance/new.test.ts", ORACLE_TEST]);
    expect(before).toMatchObject({ entries: ["tests/acceptance"], present: 2, weak: false });
    writeFile(root, "tests/acceptance/.auth/user.json", '{"token":"rotated"}');
    expect(snap(root, "tests/acceptance/\n").digest).toBe(before.digest);
  });

  test("an edit, a deletion, or an untracking changes the oracle", () => {
    const root = tmpGitRepo();
    const base = snap(root, "tests/acceptance\n");
    writeFile(root, ORACLE_TEST, "// weakened\n");
    const edited = snap(root, "tests/acceptance\n");
    expect(edited.digest).not.toBe(base.digest);
    expect(oracleDiff(base.files, edited.files)).toEqual([`${ORACLE_TEST} (changed)`]);
    rmSync(join(root, ORACLE_TEST));
    expect(snap(root, "tests/acceptance\n").files[ORACLE_TEST]).toBe(ABSENT);
    git(root, "rm", "-q", "--cached", ORACLE_TEST);
    expect(oracleDiff(base.files, snap(root, "tests/acceptance\n").files)).toEqual([`${ORACLE_TEST} (removed)`]);
  });

  test("a pointer pins one JSON value, not the rest of the file", () => {
    const root = tmpGitRepo();
    const entry = "package.json#/scripts/test";
    writeFile(root, "package.json", JSON.stringify({ scripts: { test: "bun test" }, dependencies: {} }));
    const base = snap(root, entry);
    writeFile(root, "package.json", JSON.stringify({ scripts: { test: "bun test" }, dependencies: { zod: "^4" } }));
    expect(snap(root, entry).digest).toBe(base.digest);
    writeFile(root, "package.json", JSON.stringify({ scripts: { test: "true" } }));
    expect(oracleDiff(base.files, snap(root, entry).files)).toEqual([`${entry} (changed)`]);
    writeFile(root, "package.json", JSON.stringify({ scripts: {} }));
    expect(snap(root, entry).files[entry]).toBe(ABSENT);
    writeFile(root, "package.json", "{ not json");
    expect(snap(root, entry).files[entry]).toBe("invalid-json");
  });

  test("a pointer unescapes ~1 and ~0", () => {
    const root = tmpGitRepo();
    writeFile(root, "x.json", JSON.stringify({ "a/b": { "c~d": 1 } }));
    expect(snap(root, "x.json#/a~1b/c~0d").files["x.json#/a~1b/c~0d"]).toStartWith("sha256:");
  });

  test("a symlink is recorded by its target and never followed", () => {
    const root = tmpGitRepo();
    const outside = tmpDir();
    writeFile(outside, "fixture.txt", "a");
    symlinkSync(join(outside, "fixture.txt"), join(root, "tests/acceptance/link.ts"));
    const base = snap(root, "tests/acceptance\n");
    expect(base.files["tests/acceptance/link.ts"]).toStartWith("link:sha256:");
    writeFile(outside, "fixture.txt", "b");
    expect(snap(root, "tests/acceptance\n").digest).toBe(base.digest);
  });

  test("an entry that does not exist is absent and does not count as present", () => {
    const s = snap(tmpGitRepo(), "e2e\n");
    expect(s.files.e2e).toBe(ABSENT);
    expect(s.present).toBe(0);
  });
});

describe("oracleSnapshot outside git", () => {
  test("walks directories, skips node_modules, and is weak", () => {
    const root = tmpDir();
    writeFile(root, ORACLE_MANIFEST, "e2e\n");
    writeFile(root, "e2e/login.spec.ts", "x");
    writeFile(root, "e2e/node_modules/dep/index.js", "x");
    const s = snap(root, "e2e\n", false);
    expect(Object.keys(s.files)).toEqual([ORACLE_MANIFEST, "e2e/login.spec.ts"]);
    expect(s).toMatchObject({ present: 1, weak: true });
  });
});

describe("oracleCovers", () => {
  const entries = ["tests/acceptance", "playwright.config.ts", "package.json#/scripts/test"];
  const covers = (rel: string) => oracleCovers(rel, ORACLE_MANIFEST, entries);

  test("covers the manifest, file entries, and everything under a directory", () => {
    expect(covers(ORACLE_MANIFEST)).toBe("path");
    expect(covers("tests/acceptance")).toBe("path");
    expect(covers("tests/acceptance/a/b.ts")).toBe("path");
    expect(covers("playwright.config.ts")).toBe("path");
  });

  test("a name that only starts the same is not covered", () => {
    expect(covers("tests/acceptance-old/a.ts")).toBeNull();
    expect(covers("playwright.config.ts.bak")).toBeNull();
    expect(covers("src/app.ts")).toBeNull();
  });

  test("folds case, as a case-insensitive filesystem does", () => {
    expect(covers("Tests/Acceptance/a.ts")).toBe("path");
    expect(covers("AOS-ORACLE.TXT")).toBe("path");
  });

  test("a pointer entry covers its file only as a pointer", () => {
    expect(covers("package.json")).toBe("pointer");
  });
});

describe("oracleDiff", () => {
  test("names each changed, added, and removed file, sorted", () => {
    expect(oracleDiff({ a: "1", b: "2", c: ABSENT }, { a: "1", b: "3", c: "5", d: "4" })).toEqual(["b (changed)", "c (added)", "d (added)"]);
    expect(oracleDiff({ a: "1" }, {})).toEqual(["a (removed)"]);
    expect(oracleDiff({ a: ABSENT }, {})).toEqual([]);
  });
});

describe("entries AOS cannot freeze", () => {
  test("a symbolic link is reported: the guard checks the target, and the hash records only the link", () => {
    const root = tmpGitRepo();
    writeFile(root, "real/a.test.ts", "x");
    symlinkSync("real", join(root, "linked"));
    expect(snap(root, "linked\n").invalid).toEqual(['"linked": a symbolic link; list the path it points to instead']);
  });

  test("a directory whose files are all ignored lists nothing, and is reported", () => {
    const root = tmpGitRepo();
    writeFile(root, ".gitignore", "out/\n");
    writeFile(root, "out/report.json", "{}");
    expect(snap(root, "out/\n").invalid).toEqual(['"out": a directory with no files AOS can see; check its letter case, and that its files are not ignored']);
  });

  // git matches pathspecs case-sensitively even where the filesystem does not.
  test("a directory spelled in another case is reported where the filesystem ignores case", () => {
    const root = tmpGitRepo();
    if (!existsSync(join(root, "Tests/Acceptance"))) return;
    expect(snap(root, "Tests/Acceptance/\n").invalid).toEqual([
      '"Tests/Acceptance": a directory with no files AOS can see; check its letter case, and that its files are not ignored',
    ]);
  });

  test("only files count toward an oracle that exists, not pointer entries", () => {
    const root = tmpGitRepo();
    writeFile(root, "package.json", JSON.stringify({ scripts: { test: "bun test" } }));
    expect(snap(root, "package.json#/scripts/test\n").present).toBe(0);
    expect(snap(root, `package.json#/scripts/test\n${ORACLE_TEST}\n`).present).toBe(1);
  });
});
