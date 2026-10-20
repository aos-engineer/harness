import { chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpDir, writeFile } from "../helpers.ts";

/** A directory holding a `git` shell script with the given body, to put first on PATH. */
export function fakeGitDir(body: string): string {
  const dir = tmpDir("aos-fake-git-");
  writeFile(dir, "git", "#!/bin/sh\n" + body);
  chmodSync(join(dir, "git"), 0o755);
  return dir;
}

/** Run `fn` with `dir` first on PATH, restoring PATH afterwards. */
export function withPath<T>(dir: string, fn: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}
