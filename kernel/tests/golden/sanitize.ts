// Turns the log of a real run into a golden log that is safe to commit: machine paths become /repo, the
// human's account name becomes "owner", and the hash chain is rebuilt over the rewritten lines so the
// golden log still verifies. Regenerate the golden logs with: AOS_GOLDEN_WRITE=1 bun test ./tests/e2e
import { realpathSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { GENESIS_PREV } from "../../src/types.ts";
import type { EventEnvelope } from "../../src/types.ts";
import { sha256Tag } from "../../src/util/hash.ts";

export interface SanitizeOptions {
  /** The run's root as the kernel recorded it. */
  root: string;
  /** Defaults to this machine's home directory. */
  home?: string;
  /** Defaults to this machine's account name. */
  user?: string;
}

/** The same directory under every name it has here: macOS reaches /var and /tmp through /private. */
function aliases(dir: string): string[] {
  const names = new Set([dir]);
  try {
    names.add(realpathSync(dir));
  } catch {
    // A directory that is gone has only the name it was given.
  }
  for (const n of [...names]) if (n.startsWith("/private/")) names.add(n.slice("/private".length));
  // Longest first, so a path is replaced whole before any shorter alias inside it.
  return [...names].sort((a, b) => b.length - a.length);
}

function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

// Account names are replaced only as whole words, so a short name cannot rewrite unrelated text.
function wordPattern(word: string): RegExp {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
}

/** Rebuilds every prev link so the chain verifies over the rewritten lines. */
export function rehash(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const e = JSON.parse(line) as EventEnvelope;
    // Assigning in place keeps the key order, so the line serializes the way the kernel wrote it.
    e.prev = out.length === 0 ? GENESIS_PREV : sha256Tag(out[out.length - 1] ?? "");
    out.push(JSON.stringify(e));
  }
  return out;
}

export function sanitizeLog(lines: string[], o: SanitizeOptions): string[] {
  const home = o.home ?? homedir();
  const user = o.user ?? userInfo().username;
  const roots = aliases(o.root);
  const homes = aliases(home);
  const userWord = user.length >= 3 ? wordPattern(user) : null;

  const rewritten = lines.map((line) => {
    let text = line;
    for (const r of roots) text = replaceAll(text, r, "/repo");
    for (const h of homes) text = replaceAll(text, h, "/home/owner");
    if (userWord !== null) text = text.replace(userWord, "owner");
    const e = JSON.parse(text) as EventEnvelope;
    if (e.actor.kind === "human") e.actor.id = "owner";
    return JSON.stringify(e);
  });

  const out = rehash(rewritten);
  const leaks = [...roots, ...homes, ...aliases(tmpdir())];
  for (const line of out) {
    const leak = leaks.find((l) => line.includes(l)) ?? (userWord !== null && wordPattern(user).test(line) ? user : undefined);
    if (leak !== undefined) throw new Error(`sanitized golden log still contains ${JSON.stringify(leak)}`);
  }
  return out;
}
