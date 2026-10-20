// One walk serves both the data-only check and the integrity hash, so the two never disagree about which
// files make up a pack. Hidden files are pack content: stage instructions can point the agent at any file,
// so a dotfile must be checked and hashed like the rest. Only three names are not pack content: .git (a
// checkout's metadata, with executable hook samples), node_modules, and the .DS_Store files macOS writes.
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { PackError } from "../util/errors.ts";
import { sha256Hex, sha256Tag } from "../util/hash.ts";

const NOT_PACK_CONTENT = new Set([".git", "node_modules", ".DS_Store"]);

// A checkout with Windows line endings must pin the same hash as any other checkout of the same pack.
const TEXT_EXTENSIONS = [".yaml", ".md"];

interface EntryBase {
  rel: string; // POSIX path relative to the pack root
  mode: number;
}
export type PackEntry =
  // The bytes, read once, with CRLF normalized to LF in text files. The loader parses these and the
  // integrity hash covers these, so the hash always describes exactly what was loaded.
  | (EntryBase & { kind: "file"; content: Buffer })
  | (EntryBase & { kind: "symlink"; target: string }) // the link text, never followed
  | (EntryBase & { kind: "other" });

/** Every entry under `dir` except directories, sorted by relative path, with file contents read. */
export function readPack(dir: string): PackEntry[] {
  const out: PackEntry[] = [];
  const visit = (absDir: string, relDir: string): void => {
    for (const name of readdirSync(absDir)) {
      if (NOT_PACK_CONTENT.has(name)) continue;
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const st = lstatSync(abs);
      if (st.isDirectory()) visit(abs, rel);
      else if (st.isFile()) out.push({ rel, mode: st.mode, kind: "file", content: normalize(rel, readFileSync(abs)) });
      else if (st.isSymbolicLink()) out.push({ rel, mode: st.mode, kind: "symlink", target: readlinkSync(abs) });
      // Reading a FIFO or socket could block, so special files are listed for the loader to reject, never read.
      else out.push({ rel, mode: st.mode, kind: "other" });
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
  for (const e of entries) {
    // A symlink is hashed by its target text, marked so it cannot collide with a file of the same content.
    if (e.kind === "file") manifest += `${e.rel}\0${sha256Hex(e.content)}\n`;
    else if (e.kind === "symlink") manifest += `${e.rel}\0->${sha256Hex(e.target)}\n`;
  }
  return sha256Tag(manifest);
}

function normalize(rel: string, bytes: Buffer): Buffer {
  const lower = rel.toLowerCase();
  if (!TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || !bytes.includes("\r\n")) return bytes;
  // latin1 maps bytes one to one, and UTF-8 never uses 0x0D or 0x0A inside a multibyte character, so this
  // rewrites line endings and nothing else.
  return Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
}
