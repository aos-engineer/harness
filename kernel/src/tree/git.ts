// Runs git for the tree fingerprint with a deadline, so a hung git (a stuck lock, a slow network
// filesystem) fails with a TreeError instead of blocking a hook until the host kills it.
// Not exported from the package barrel: fingerprint.ts is the public surface.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { TreeError } from "../util/errors.ts";

const GIT_TIMEOUT_MS = 10_000;

/** Spawn git, throwing a TreeError only when it outlives the deadline; any other outcome is the caller's to judge. */
export function spawnGit(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = GIT_TIMEOUT_MS,
): SpawnSyncReturns<string> {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: timeoutMs });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new TreeError(`git ${args.join(" ")} timed out after ${timeoutMs} ms in ${cwd}`, { cause: r.error });
  }
  return r;
}

/** Run git and return its trimmed stdout; a spawn failure or non-zero exit throws a TreeError. */
export function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env, timeoutMs = GIT_TIMEOUT_MS): string {
  const r = spawnGit(cwd, args, env, timeoutMs);
  if (r.error !== undefined) throw new TreeError(`git ${args.join(" ")} could not run in ${cwd}`, { cause: r.error });
  if (r.status !== 0) throw new TreeError(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
