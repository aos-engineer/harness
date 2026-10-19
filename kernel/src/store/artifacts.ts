import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { RunLocation } from "../types.ts";
import { RunNotFoundError } from "../util/errors.ts";
import { sha256Hex } from "../util/hash.ts";
import { runPaths } from "./paths.ts";

/**
 * Stores content under its own hash and returns "sha256:<hex>". Written to a temp file, synced, then renamed,
 * so a crash can never leave a truncated file under a hash that later writes would trust and skip.
 */
export function writeArtifact(loc: RunLocation, content: string | Uint8Array): string {
  const paths = runPaths(loc);
  if (!existsSync(paths.dir)) throw new RunNotFoundError(`no run ${loc.run} under ${loc.root}`);
  const hex = sha256Hex(content);
  const file = join(paths.artifacts, hex);
  if (existsSync(file)) return "sha256:" + hex;

  mkdirSync(paths.artifacts, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    const fd = openSync(tmp, "wx");
    try {
      const buf = typeof content === "string" ? Buffer.from(content) : content;
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Two writers of the same content race harmlessly: both renames install identical bytes.
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return "sha256:" + hex;
}
