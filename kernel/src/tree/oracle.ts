// The oracle is what a run's checks are judged by: acceptance tests, their runner config, and the scripts a
// test role runs through. A repository lists it in a manifest, a tier freezes it at a stage, and from then on
// every gate fails while it differs from the pin. Without this, an agent could pass a gate by editing the tests
// instead of the code. Reading the oracle lives here, apart from gate evaluation, so gates stay pure functions
// of run state and the tree.
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { OracleSnapshot, RunState, TreeState } from "../types.ts";
import { TreeError } from "../util/errors.ts";
import { foldName } from "../util/fold.ts";
import { sha256Tag } from "../util/hash.ts";
import { runGit } from "./git.ts";

/** The hash recorded for an entry that does not exist, so creating it later reads as a change. */
export const ABSENT = "absent";
// Bounds the cost a gate evaluation pays inside a hook. A manifest that names more is naming the wrong thing.
const MAX_FILES = 10_000;
// Outside git there is no ignore list, so the walk skips what is never a test's source.
const WALK_SKIP = new Set([".git", ".aos", "node_modules"]);

export interface OracleFreeze { stage: string; index: number; manifest: string }
export interface ManifestEntries { entries: string[]; invalid: string[] }

/** Where the run's tier freezes its oracle, or null when it does not. Logs from before oracles carry neither field. */
export function oracleFreeze(state: RunState): OracleFreeze | null {
  const manifest = state.pack.oracle?.manifest;
  const stage = state.pack.tiers[state.tier]?.freezeOracleAt;
  if (manifest === undefined || stage === undefined) return null;
  const index = state.stages.indexOf(stage);
  // The loader refuses a first or unknown stage, so this only drops a pack it would never have loaded.
  return index < 1 ? null : { stage, index, manifest };
}

/**
 * One entry per line: a path (a file, or a directory and everything under it) or a JSON value as
 * `file.json#/pointer`. Blank lines and lines starting with `#` are ignored. Entries that could reach outside
 * the repository or into .aos/ and .git/ are reported, not read.
 */
export function parseManifest(text: string): ManifestEntries {
  const entries: string[] = [];
  const invalid: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const problem = entryProblem(line);
    if (problem !== null) invalid.push(`line ${i + 1}: ${problem}`);
    else {
      const entry = normalize(line);
      if (!entries.includes(entry)) entries.push(entry);
    }
  });
  return { entries, invalid };
}

/** The manifest's entries as they are on disk now. A missing manifest declares nothing. */
export function readManifest(root: string, manifest: string): ManifestEntries {
  let text: string;
  try {
    text = readFileSync(join(root, manifest), "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { entries: [], invalid: [] };
    if (code === "EISDIR") return { entries: [], invalid: [`${manifest} is a directory, not a file`] };
    throw new TreeError(`could not read the oracle manifest ${manifest}`, { cause: e });
  }
  return parseManifest(text);
}

/**
 * Hashes the manifest and everything it names. Directories list the files git would put in the tree
 * (tracked, plus untracked files that are not ignored), the same view freshness uses, so test output that
 * .gitignore covers never changes the oracle. Outside git they are walked, and the snapshot is weak.
 */
export function oracleSnapshot(root: string, o: { git: boolean; manifest: string } & ManifestEntries): OracleSnapshot {
  const files = new Map<string, string>([[o.manifest, hashPath(join(root, o.manifest))]]);
  const pointers = new Set<string>();
  const invalid = [...o.invalid];
  for (const entry of o.entries) {
    const at = entry.indexOf("#");
    const kind = at >= 0 ? "pointer" : entryKind(join(root, entry));
    if (kind === "pointer") {
      pointers.add(entry);
      files.set(entry, hashPointer(join(root, entry.slice(0, at)), entry.slice(at + 1)));
    } else if (kind === "directory") {
      const listed = o.git ? gitFiles(root, entry) : walkFiles(root, entry);
      // git matches pathspecs case-sensitively even where the filesystem does not, so a directory entry spelled
      // in the wrong case lists nothing, and an entry whose files are all ignored freezes nothing either.
      if (listed.length === 0) invalid.push(`"${entry}": a directory with no files AOS can see; check its letter case, and that its files are not ignored`);
      for (const rel of listed) files.set(rel, hashPath(join(root, rel)));
    } else {
      // The guard resolves links before it compares paths, and the hash records only the link, so a linked
      // entry would protect neither the link nor its target.
      if (kind === "link") invalid.push(`"${entry}": a symbolic link; list the path it points to instead`);
      files.set(entry, hashPath(join(root, entry)));
    }
    if (files.size > MAX_FILES) {
      throw new TreeError(`the oracle in ${o.manifest} names more than ${MAX_FILES} files; list narrower entries`);
    }
  }
  const keys = [...files.keys()].sort();
  // A pointer pins how tests run, not what they check, so only files count toward an oracle that exists.
  const present = keys.filter((k) => k !== o.manifest && !pointers.has(k) && files.get(k) !== ABSENT).length;
  return {
    entries: o.entries, invalid,
    files: Object.fromEntries(keys.map((k) => [k, files.get(k)!])),
    present,
    digest: sha256Tag(JSON.stringify(keys.map((k) => [k, files.get(k)]))),
    weak: !o.git,
  };
}

/** The oracle as it stands now: the pinned entries once the run has a pin, the manifest's before that. */
export function currentOracle(state: RunState): OracleSnapshot | null {
  const freeze = oracleFreeze(state);
  if (freeze === null) return null;
  const read = state.oracle !== undefined ? { entries: state.oracle.entries, invalid: [] } : readManifest(state.root, freeze.manifest);
  return oracleSnapshot(state.root, { git: state.git, manifest: freeze.manifest, ...read });
}

/** Adds the run's oracle to a tree, computed only if a gate asks for it, because most hook calls never do. */
export function withOracle(state: RunState, tree: TreeState): TreeState {
  if (oracleFreeze(state) === null) return tree;
  let snapshot: OracleSnapshot | undefined;
  return { ...tree, oracle: () => (snapshot ??= currentOracle(state)!) };
}

/**
 * Whether a root-relative path is part of the oracle: "path" for the manifest and path entries, "pointer"
 * when only a JSON value inside the file is. Names are folded, because a case-insensitive filesystem would
 * otherwise let a differently spelled path write the same file.
 */
export function oracleCovers(rel: string, manifest: string, entries: string[]): "path" | "pointer" | null {
  const name = foldName(rel);
  if (name === foldName(manifest)) return "path";
  let pointer = false;
  for (const entry of entries) {
    const at = entry.indexOf("#");
    if (at >= 0) {
      if (name === foldName(entry.slice(0, at))) pointer = true;
      continue;
    }
    const folded = foldName(entry);
    if (name === folded || name.startsWith(folded + "/")) return "path";
  }
  return pointer ? "pointer" : null;
}

/** What differs between a pin and a snapshot, one line per file, sorted. */
export function oracleDiff(pinned: Record<string, string>, current: Record<string, string>): string[] {
  const lines: string[] = [];
  for (const [key, was] of Object.entries(pinned)) {
    const now = Object.hasOwn(current, key) ? current[key]! : ABSENT;
    if (now === was) continue;
    lines.push(`${key} (${now === ABSENT ? "removed" : was === ABSENT ? "added" : "changed"})`);
  }
  for (const [key, now] of Object.entries(current)) {
    if (!Object.hasOwn(pinned, key) && now !== ABSENT) lines.push(`${key} (added)`);
  }
  return lines.sort();
}

function entryProblem(line: string): string | null {
  const at = line.indexOf("#");
  const path = at >= 0 ? line.slice(0, at) : line;
  if (at >= 0 && !line.slice(at + 1).startsWith("/")) return `"${line}": a JSON pointer starts with "/", as in package.json#/scripts/test`;
  if (path === "" || path.startsWith("/") || path.includes("\\")) return `"${line}": use a path relative to the repository root, with / separators`;
  const segments = path.replace(/\/+$/, "").split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return `"${line}": no empty, "." or ".." path segments`;
  const top = foldName(segments[0]!);
  if (top === ".aos" || top === ".git") return `"${line}": .aos/ and .git/ cannot be part of the oracle`;
  return null;
}

// A trailing slash is how people write a directory; the entry means the same with or without it.
function normalize(line: string): string {
  const at = line.indexOf("#");
  return at >= 0 ? line.slice(0, at).replace(/\/+$/, "") + line.slice(at) : line.replace(/\/+$/, "");
}

function entryKind(abs: string): "directory" | "link" | "other" {
  try {
    const stat = lstatSync(abs);
    return stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "link" : "other";
  } catch {
    return "other";
  }
}

function hashPath(abs: string): string {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return ABSENT;
    throw new TreeError(`could not read ${abs} for the oracle`, { cause: e });
  }
  // A link is recorded by its target, never followed, so it cannot pull a file from outside the repository in.
  if (stat.isSymbolicLink()) return "link:" + sha256Tag(readlinkSync(abs));
  if (stat.isDirectory()) return "directory";
  if (!stat.isFile()) return "special";
  return sha256Tag(readFileSync(abs));
}

function hashPointer(abs: string, pointer: string): string {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return ABSENT;
    if (e instanceof SyntaxError) return "invalid-json";
    throw new TreeError(`could not read ${abs} for the oracle`, { cause: e });
  }
  let value = doc;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return ABSENT;
    value = (value as Record<string, unknown>)[key];
  }
  return sha256Tag(JSON.stringify(value));
}

function gitFiles(root: string, entry: string): string[] {
  const out = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `:(literal)${entry}`]);
  return [...new Set(out.split("\0").filter((p) => p !== ""))];
}

function walkFiles(root: string, entry: string): string[] {
  const found: string[] = [];
  const walk = (rel: string) => {
    for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (WALK_SKIP.has(d.name)) continue;
      const child = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(child);
      else found.push(child);
      if (found.length > MAX_FILES) return;
    }
  };
  walk(entry);
  return found;
}
