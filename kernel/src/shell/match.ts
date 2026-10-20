// Classifies a Bash command for the hooks: is it a test run whose exit status can be trusted, a guarded
// action (commit, push, PR, deploy), a human-only command, or a touch of `.aos/`. Every check runs on the
// simple commands that actually execute (see leaves.ts), so a quoted mention never counts as a call. Matching
// uses each command in normal form: quotes removed, the command word reduced to its basename, single spaces.
import { ACTION_PRIORITY, type ActionDef, type ActionName } from "../types.ts";
import { foldName } from "../util/fold.ts";
import { type Leaf, walk } from "./leaves.ts";

/** The first role (in pack order) one of whose prefixes starts a leaf command, and whether its exit status is masked. */
export function matchRole(cmd: string, roles: Record<string, string[]>): { role: string; masked: boolean } | null {
  const leaves = walk(cmd).leaves;
  for (const [role, prefixes] of Object.entries(roles)) {
    for (const prefix of prefixes) {
      for (const leaf of leaves) {
        if (leaf.command === prefix || leaf.command.startsWith(prefix + " ")) {
          return { role, masked: leaf.masked };
        }
      }
    }
  }
  return null;
}

// Pack patterns are fixed for a process's lifetime, so each compiles once.
const compiled = new Map<string, RegExp>();
function pattern(source: string): RegExp {
  let re = compiled.get(source);
  if (re === undefined) {
    re = new RegExp(source);
    compiled.set(source, re);
  }
  return re;
}

/** The highest-priority action any leaf command matches, or null. */
export function matchAction(cmd: string, actions: Record<ActionName, ActionDef>): ActionName | null {
  const leaves = walk(cmd).leaves;
  const unknown = leaves.filter((leaf) => leaf.expanded).map(expandedActions);
  for (const name of ACTION_PRIORITY) {
    const def = actions[name];
    if (def === undefined) continue;
    if (unknown.some((could) => could.has(name))) return name;
    for (const source of def.patterns) {
      const re = pattern(source);
      if (leaves.some((leaf) => re.test(leaf.command))) return name;
    }
  }
  return null;
}

// Words that, in an unclassifiable command, name a deploying subcommand of the tools the reference pack
// guards. Install and upgrade are left out: `"$VENV/bin/pip" install` is far more common than a helm call
// through a variable.
const DEPLOY_WORDS = new Set(["deploy", "redeploy", "upsert-compose", "compose.deploy", "compose.redeploy", "compose.stop", "rollout", "apply"]);

/**
 * The actions a leaf whose command word comes from an expansion could be. Nobody can say which program
 * runs, so the words around it decide: a guard that let `G=git; $G push` through would be trivial to
 * bypass. The command word's own text counts too, since `$(echo git push)` may print the whole command.
 */
function expandedActions(leaf: Leaf): Set<ActionName> {
  const words = [...leaf.words[0].split(/[^\w.-]+/), ...leaf.words.slice(1).flatMap((w) => w.split(/\s+/))];
  const after = (first: string, then: (w: string) => boolean) => {
    const at = words.indexOf(first);
    return at >= 0 && words.slice(at + 1).some(then);
  };
  const could = new Set<ActionName>();
  // `S=push; git $S`: git itself runs, but its subcommand could be any of them.
  if (leaf.command.split(" ")[0] === "git") could.add("push").add("commit");
  if (words.some((w) => DEPLOY_WORDS.has(w)) || after("workflow", (w) => w === "run")) could.add("deploy");
  if (after("pr", (w) => w === "create" || w === "new") || after("api", (w) => /\bpulls\b|createPullRequest/.test(w))) could.add("pr_create");
  if (words.includes("push")) could.add("push");
  if (words.includes("commit")) could.add("commit");
  return could;
}

// Every way to reach the CLI: the installed binary (already reduced to its basename), the published package
// through a package runner with its own flags and an optional pinned version, or the source entry point
// through bun, node, or tsx, or run directly through its shebang.
const RUNNER_FLAGS = String.raw`(?:\s+-\S+)*`;
const PACKAGE = String.raw`aos-harness(?:@\S+)?`;
const SOURCE = String.raw`\S*cli/src/index\.ts`;
const INVOCATION = [
  "aos",
  String.raw`(?:bunx|npx|pnpx|bun\s+x|npm\s+exec|pnpm\s+(?:dlx|exec)|yarn\s+dlx)${RUNNER_FLAGS}\s+${PACKAGE}`,
  String.raw`(?:bun(?:\s+run)?|node|tsx)${RUNNER_FLAGS}\s+${SOURCE}`,
  SOURCE,
].join("|");
const HUMAN_ONLY = new RegExp(
  String.raw`^(?:${INVOCATION})(?:\s+--)?\s+(approve|waive|tier\s+lower|budget\s+extend|run\s+(?:pause|cancel))\b`,
);

/** The human-only subcommand a leaf command invokes (for example "approve" or "run cancel"), or null. */
export function matchHumanOnly(cmd: string): string | null {
  for (const leaf of walk(cmd).leaves) {
    // The full form keeps a path such as cli/src/index.ts that the basename would drop.
    const m = HUMAN_ONLY.exec(leaf.command) ?? HUMAN_ONLY.exec(leaf.words.join(" "));
    if (m !== null) return m[1].replace(/\s+/g, " ");
  }
  return null;
}

// Case-insensitive: default macOS filesystems fold case, so `.AOS/runs` reaches the same kernel files.
// Matched against folded text (see foldName), so `.AOS` and other spellings of the same name count.
const AOS_DIR = /(^|\/|>)\.aos(\/|$)/;
const GLOB = /[*?[]/;
// Options under which a glob's leading `*` or `?` also matches names that start with a dot.
const DOTGLOB = /\bdotglob\b|\bGLOBIGNORE\b|\bglob_?dots\b/i;
// More alternatives than this from brace expansion are not enumerated; the word is assumed to reach `.aos`.
const MAX_BRACE_WORDS = 256;
// A `{x..y}` character sequence longer than this is checked as a `?` wildcard rather than enumerated.
const MAX_SEQUENCE = 128;

/** True when any word of any segment, including `cd` targets, assignments, and redirect targets, names `.aos`. */
export function mentionsAosDir(cmd: string): boolean {
  const dotglob = DOTGLOB.test(cmd);
  // Every segment, not just leaves: `cd .aos` and `DIR=.aos/runs` are dropped from leaves but still reach it.
  // Substitution and bash -c bodies are segments of their own, so they are checked as commands too.
  for (const seg of walk(cmd).segments) {
    for (const word of seg.words) {
      // A word with whitespace in it is prose, such as a commit message, not a path. Whitespace inside a
      // substitution does not count: `"$(git rev-parse --show-toplevel)/.aos"` is still a path.
      let path = word.value;
      for (const body of word.subs) path = path.split(body).join("");
      if (/\s/.test(path)) continue;
      // Splitting at `<`, `>`, and `=` exposes redirect targets and assigned values glued to other text.
      if (path.split(/[<>=]/).some((part) => reachesAosDir(part, dotglob))) return true;
    }
  }
  return false;
}

/**
 * Whether a path could name `.aos` once bash expands it: literally, through brace expansion (`.{aos,git}`,
 * `.ao{r..t}`), or through a glob (`.a*`, `.ao?`, `.[a]os`, `.*`). Quotes were already removed, so a quoted
 * glob counts too; over-matching is the safe side for a guard.
 */
function reachesAosDir(part: string, dotglob: boolean): boolean {
  const words = expandBraces(foldName(part));
  if (words === null) return true;
  return words.some((w) => AOS_DIR.test(w) || w.split("/").some((c) => GLOB.test(c) && globMatches(c, ".aos", dotglob)));
}

/** Whether a glob component matches a name, as bash matches file names. */
function globMatches(glob: string, name: string, dotglob: boolean): boolean {
  // Without dotglob, a leading dot must be matched by a literal dot: `*` and `[.]aos` never match `.aos`.
  if (!dotglob && name.startsWith(".") && !glob.startsWith(".")) return false;
  // POSIX classes, equivalence classes, and collating symbols (`[[:alpha:]]`) are not translated.
  if (/\[[:=.]/.test(glob)) return true;
  try {
    return globRegex(glob).test(name);
  } catch {
    return true; // a bracket expression this reader cannot translate: assume it matches
  }
}

function globRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      re += ".*";
    } else if (c === "?") {
      re += ".";
    } else if (c === "[") {
      // `]` right after `[` or `[!` is a member, not the end of the bracket expression.
      let j = i + 1;
      if (glob[j] === "!" || glob[j] === "^") j++;
      if (glob[j] === "]") j++;
      const close = glob.indexOf("]", j);
      if (close < 0) {
        re += "\\[";
        continue;
      }
      let body = glob.slice(i + 1, close);
      const negate = body[0] === "!" || body[0] === "^";
      if (negate) body = body.slice(1);
      re += `[${negate ? "^" : ""}${body.replace(/[\\\]\[^]/g, "\\$&")}]`;
      i = close;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "u");
}

/** Every word brace expansion produces from one word, or null when there are too many to check. */
function expandBraces(word: string): string[] | null {
  const done: string[] = [];
  const pending = [word];
  while (pending.length > 0) {
    const w = pending.pop()!;
    const group = firstBraceGroup(w);
    if (group === null) {
      done.push(w);
    } else {
      for (const alt of group.alternatives) pending.push(w.slice(0, group.start) + alt + w.slice(group.end));
    }
    if (done.length + pending.length > MAX_BRACE_WORDS) return null;
  }
  return done;
}

/** The first `{a,b}` list or `{x..y}` sequence in a word and what it expands to, or null when it has none. */
function firstBraceGroup(w: string): { start: number; end: number; alternatives: string[] } | null {
  for (let i = 0; i < w.length; i++) {
    // `${...}` is a parameter expansion, not a brace list.
    if (w[i] !== "{" || w[i - 1] === "$") continue;
    let depth = 0;
    const commas: number[] = [];
    for (let j = i; j < w.length; j++) {
      const c = w[j];
      if (c === "{") depth++;
      else if (c === "," && depth === 1) commas.push(j);
      else if (c === "}" && --depth === 0) {
        const body = w.slice(i + 1, j);
        const alternatives = commas.length > 0
          ? [i, ...commas].map((at, n) => w.slice(at + 1, n < commas.length ? commas[n] : j))
          : sequence(body);
        if (alternatives !== null) return { start: i, end: j + 1, alternatives };
        break;
      }
    }
  }
  return null;
}

/** What a `{x..y}` or `{x..y..step}` sequence body expands to, or null when the body is not one. */
function sequence(body: string): string[] | null {
  // Numbers never spell a name, so one stands in for all of them.
  if (/^[+-]?\d+\.\.[+-]?\d+(?:\.\.[+-]?\d+)?$/.test(body)) return ["0"];
  const m = /^(.)\.\.(.)(?:\.\.[+-]?\d+)?$/u.exec(body);
  if (m === null) return null;
  const [a, b] = [m[1].codePointAt(0)!, m[2].codePointAt(0)!];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (hi - lo + 1 > MAX_SEQUENCE) return ["?"];
  return Array.from({ length: hi - lo + 1 }, (_, k) => String.fromCodePoint(lo + k));
}
