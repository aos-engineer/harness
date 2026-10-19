import { integrityOf, walkPack } from "./files.ts";

/**
 * "sha256:<hex>" over every file in the pack, keyed by relative path, so any added, removed, renamed, or
 * edited file changes it while the pack's location on disk does not. Throws PackError if the directory
 * cannot be read.
 */
export function packIntegrity(dir: string): string {
  return integrityOf(walkPack(dir));
}
