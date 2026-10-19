// Evidence is fresh only if it was recorded at the current tree, so the kernel needs a cheap, stable name
// for "the working tree right now": tracked and untracked files, minus ignored files and minus `.aos/`,
// whose run log changes on every event.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TreeState } from "../types.ts";
import { TreeError } from "../util/errors.ts";

function git(root: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
  if (r.error !== undefined) throw new TreeError(`git ${args[0]} could not run in ${root}`, { cause: r.error });
  if (r.status !== 0) throw new TreeError(`git ${args.join(" ")} failed in ${root}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** The repository's top-level directory, or null when `cwd` is not inside a work tree. */
export function gitRoot(cwd: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (r.error !== undefined || r.status !== 0) return null;
  return r.stdout.trim() || null;
}

/**
 * The git tree hash of the working tree at `root` (the repository's top level), or a weak change counter
 * when the run is not in a git repository.
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
  const index = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
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
    // The exclude pathspec holds even when .aos/ is not gitignored, so log appends never change the tree.
    git(root, ["add", "-A", "--", ".", ":(exclude).aos"], env);
    return { fingerprint: "git:" + git(root, ["write-tree"], env), weak: false };
  } finally {
    rmSync(tmp, { force: true });
  }
}
