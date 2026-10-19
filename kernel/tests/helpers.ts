import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fresh temp directory, realpath'd so it compares equal to what git reports on macOS (/private/var). */
export function tmpDir(prefix = "aos-test-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function writeFile(root: string, rel: string, content: string): string {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** A repo with one commit. Signing is off locally so a developer's global gpg config cannot break tests. */
export function tmpGitRepo(): string {
  const root = tmpDir("aos-repo-");
  git(root, "init", "-q");
  git(root, "config", "user.name", "AOS Test");
  git(root, "config", "user.email", "aos-test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  writeFile(root, "README.md", "# test\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}
