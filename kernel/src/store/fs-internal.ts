// Filesystem helpers shared by the store modules, kept out of the package barrel.
import { closeSync, constants, fsyncSync, lstatSync, openSync, writeSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { UnsafePathError } from "../util/errors.ts";
import { aosDir } from "./paths.ts";

// Makes open fail when the last path component is a symlink; 0 on platforms without it.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
export const APPEND_NOFOLLOW = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | NOFOLLOW;
export const APPEND_READ_NOFOLLOW = constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | NOFOLLOW;

export function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

/**
 * Throws UnsafePathError when `.aos`, or any existing component of `target` below it, is a symlink. The
 * kernel never makes links there, so one was planted by a process the hooks cannot see, and following it
 * would put the kernel's bytes wherever it points (an append to log.jsonl could land in any file the user
 * can write). Components that do not exist yet are created as real directories. A link swapped in between
 * this check and the write is not caught; opening the final file with O_NOFOLLOW narrows that window.
 */
export function refuseSymlinks(root: string, target: string): void {
  const base = aosDir(root);
  const rel = relative(base, target);
  if (rel.startsWith("..")) return;
  let at = base;
  for (const part of ["", ...(rel === "" ? [] : rel.split(sep))]) {
    at = part === "" ? at : join(at, part);
    let link: boolean;
    try {
      link = lstatSync(at).isSymbolicLink();
    } catch (e) {
      if (errCode(e) === "ENOENT") return;
      throw e;
    }
    if (link) throw new UnsafePathError(`AOS refuses to write through the symlink ${relative(root, at)}; remove it and rerun`);
  }
}

/** Appends a line to a file under `.aos` without following symlinks; any failure is swallowed. */
export function appendQuietly(root: string, file: string, line: string): void {
  try {
    refuseSymlinks(root, file);
    const fd = openSync(file, APPEND_NOFOLLOW, 0o644);
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Callers use this for best-effort traces, which have nowhere else to go.
  }
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
