// Evidence is fresh only if it was recorded at the current tree, so the kernel needs a cheap, stable name
// for "the working tree right now": tracked and untracked files, minus ignored files and minus `.aos/`,
// whose run log changes on every event.
import { randomBytes } from "node:crypto";
import { copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TreeState } from "../types.ts";
import { TreeError } from "../util/errors.ts";
import { runGit, spawnGit } from "./git.ts";

/**
 * The repository's top-level directory, or null when `cwd` is not inside a work tree. A git that hangs
 * throws a TreeError instead: reporting "not a repository" would quietly weaken freshness to a counter.
 */
export function gitRoot(cwd: string): string | null {
  const r = spawnGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (r.error !== undefined || r.status !== 0) return null;
  return r.stdout.trim() || null;
}

/**
 * The git tree hash of the working tree of the repository containing `root`, or a weak change counter when
 * the run is not in a git repository.
 *
 * It stages everything into a copy of the real index and writes a tree from that copy, so the user's own
 * staging is never touched and unchanged files keep their cached stat data (only changed files rehash).
 * `git add -A` writes blob objects for changed and untracked files into .git/objects, which normal
 * `git gc` cleans up, and it hashes large untracked, non-ignored files. Both costs are accepted for now;
 * the hook latency benchmark measures them.
 */
export function treeFingerprint(root: string, opts: { git: boolean; changes: number }): TreeState {
  if (!opts.git) return { fingerprint: "counter:" + opts.changes, weak: true };

  // --path-format=absolute resolves a linked worktree's own index under the main repository's .git.
  const index = runGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const tmp = join(tmpdir(), `aos-index-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    try {
      copyFileSync(index, tmp);
    } catch (e) {
      // A repository with no commits has no index yet; git creates the temporary one from scratch.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new TreeError(`could not copy the git index at ${index}`, { cause: e });
      }
    }
    const env = { ...process.env, GIT_INDEX_FILE: tmp };
    // .aos/ must never reach the tree, or every log append would change it. Excluding it from `add` is not
    // enough once .aos/ content has been committed: the copied index already carries those entries, so they
    // are dropped first. Both pathspecs are root-relative, so a subdirectory `root` still covers the repository.
    runGit(root, ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ":(top).aos"], env);
    // With autocrlf on, safecrlf would refuse a file with mixed line endings and fail the whole fingerprint.
    runGit(root, ["-c", "core.safecrlf=false", "add", "-A", "--", ":/", ":(top,exclude).aos"], env);
    return { fingerprint: "git:" + runGit(root, ["write-tree"], env), weak: false };
  } finally {
    // git removes its own lock on a clean exit or SIGTERM, but not when killed outright.
    rmSync(tmp, { force: true });
    rmSync(tmp + ".lock", { force: true });
  }
}
