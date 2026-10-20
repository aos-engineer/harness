import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fresh temp directory, realpath'd so it compares equal to what git reports on macOS (/private/var). */
export function tmpDir(prefix = "aos-test-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

// The developer's git setup must not leak into tests: a hook-exported GIT_DIR would aim git at the real
// repo, and global config (default branch, signing, hooksPath) would make results machine-dependent.
function hermeticEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) env[key] = value;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: hermeticEnv() });
}

export function writeFile(root: string, rel: string, content: string): string {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/**
 * A repo on branch main with one commit. Its local config pins identity, turns signing off, and points
 * hooksPath at an empty dir, so even code under test that runs git with the real environment stays hermetic.
 */
export function tmpGitRepo(): string {
  const root = tmpDir("aos-repo-");
  git(root, "init", "-q", "-b", "main");
  const noHooks = join(root, ".git", "aos-no-hooks");
  mkdirSync(noHooks);
  git(root, "config", "core.hooksPath", noHooks);
  git(root, "config", "user.name", "AOS Test");
  git(root, "config", "user.email", "aos-test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  writeFile(root, "README.md", "# test\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}
