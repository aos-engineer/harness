// One walk serves both the data-only check and the integrity hash, so the two never disagree about which
// files make up a pack. node_modules/ and dotfiles are not pack content: a git checkout of a pack carries
// executable hook samples under .git/, and editors and operating systems drop dotfiles freely.
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { PackError } from "../util/errors.ts";
import { sha256Hex, sha256Tag } from "../util/hash.ts";

export interface PackEntry {
  rel: string; // POSIX path relative to the pack root
  abs: string;
  kind: "file" | "symlink" | "other";
  mode: number;
}

/** Every entry under `dir` except directories, sorted by relative path. Symlinks are listed, never followed. */
export function walkPack(dir: string): PackEntry[] {
  const out: PackEntry[] = [];
  const visit = (absDir: string, relDir: string): void => {
    for (const name of readdirSync(absDir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const st = lstatSync(abs);
      if (st.isDirectory()) visit(abs, rel);
      else out.push({ rel, abs, kind: st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other", mode: st.mode });
    }
  };
  try {
    visit(dir, "");
  } catch (e) {
    throw new PackError(`cannot read pack directory ${dir}`, [`${dir}: cannot read pack directory`], { cause: e });
  }
  // Code-unit order, not localeCompare, so the hash is the same on every machine.
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

export function integrityOf(entries: PackEntry[]): string {
  let manifest = "";
  try {
    for (const e of entries) {
      // Reading a FIFO or socket would block. The loader rejects such entries, so leaving them out costs nothing.
      if (e.kind === "other") continue;
      // A symlink is hashed by its target text, marked so it cannot collide with a file of the same content.
      manifest += e.kind === "file"
        ? `${e.rel}\0${sha256Hex(readFileSync(e.abs))}\n`
        : `${e.rel}\0->${sha256Hex(readlinkSync(e.abs))}\n`;
    }
  } catch (e) {
    throw new PackError("cannot read pack files for the integrity hash", ["cannot read pack files"], { cause: e });
  }
  return sha256Tag(manifest);
}
