// Filesystem helpers shared by the store modules, kept out of the package barrel.
import { closeSync, fsyncSync, openSync } from "node:fs";

export function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

/**
 * Makes a new or renamed entry in `dir` durable: syncing a file covers its bytes, not the directory entry
 * that names it. Platforms that cannot open or sync a directory (Windows, some filesystems) skip it.
 */
export function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, "r");
  } catch (e) {
    if (errCode(e) === "EISDIR" || errCode(e) === "EPERM") return;
    throw e;
  }
  try {
    fsyncSync(fd);
  } catch (e) {
    const code = errCode(e);
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF") throw e;
  } finally {
    closeSync(fd);
  }
}
