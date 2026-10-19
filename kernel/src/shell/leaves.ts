// Reduces a command line to the simple commands that actually run, so classification sees `git push`
// whether it was typed bare, behind `FOO=1`, after `cd`, inside `(...)` or `if ...; then`, behind a
// wrapper such as `sudo` or `timeout 60`, inside `bash -c '...'`, or inside a `$(...)` substitution.
// Not exported from the package barrel: split.ts and match.ts are the public surface.
import { lex, type Lexed, type Segment, type Word } from "./lexer.ts";

export interface Leaf {
  text: string; // as written, from the command word through its last argument
  words: string[]; // word values from the command word on
  command: string; // the words with the command word reduced to its basename, joined by single spaces
  // True when something other than this command can decide the exit status: an operator at its own
  // level or in any script it was unwrapped from, a leading `!`, or running inside a substitution.
  masked: boolean;
}

export interface Walk {
  leaves: Leaf[];
  segments: Segment[]; // every segment visited at every depth, before stripping
}

// Deep enough for any honest command; past it the wrapper itself is the leaf.
const MAX_DEPTH = 3;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["bash", "sh", "zsh"]);
const KEYWORDS = new Set(["if", "then", "do", "else", "elif", "while", "until"]);
const CLOSERS = new Set([")", "}"]);
const LONG_OPTION = /^--[A-Za-z][\w-]*$/;
const SHORT_OPTIONS = /^[-+][A-Za-z]+$/;

// Commands that run the rest of their arguments as a command and return its status. `short` lists the
// single-letter options that take a value and `long` the long ones; `positional` counts the operands that
// come before the command (timeout's duration). xargs and watch are deliberately absent: they run the
// command on their own terms, so what follows them is not a call the agent made directly.
interface WrapperSyntax {
  short: string;
  long: string[];
  positional: number;
}
const WRAPPERS = new Map<string, WrapperSyntax>([
  ["command", { short: "", long: [], positional: 0 }],
  ["exec", { short: "a", long: [], positional: 0 }],
  ["nohup", { short: "", long: [], positional: 0 }],
  ["nice", { short: "n", long: ["adjustment"], positional: 0 }],
  ["sudo", { short: "CDghprTtUu", long: ["chdir", "close-from", "command-timeout", "group", "host", "other-user", "prompt", "role", "type", "user"], positional: 0 }],
  ["timeout", { short: "ks", long: ["kill-after", "signal"], positional: 1 }],
  ["env", { short: "Cu", long: ["chdir", "unset"], positional: 0 }],
]);

const basename = (word: string) => word.slice(word.lastIndexOf("/") + 1);

export function walk(cmd: string): Walk {
  const out: Walk = { leaves: [], segments: [] };
  visit(lex(cmd), 0, false, out);
  return out;
}

function visit(lexed: Lexed, depth: number, outerMasked: boolean, out: Walk): void {
  const masked = outerMasked || masksStatus(lexed);
  for (const seg of lexed.segments) {
    out.segments.push(seg);
    const { k, e, negated } = commandSpan(seg.words);
    // A wrapper's script is re-lexed below, which finds the substitutions inside it; skip that word here
    // so each one is visited once.
    let skip: { from: number; to: number } | null = null;
    if (k < e && basename(seg.words[k].value) !== "cd") {
      const values = seg.words.slice(k, e).map((w) => w.value);
      const wrapped = depth < MAX_DEPTH ? wrappedScript(values) : null;
      if (wrapped !== null) {
        visit(lex(wrapped.script), depth + 1, masked || negated, out);
        skip = { from: k + wrapped.from, to: k + wrapped.to };
      } else {
        const last = seg.words[e - 1];
        out.leaves.push({
          text: seg.text.slice(seg.words[k].at, last.at + last.raw.length),
          words: values,
          command: [basename(values[0]), ...values.slice(1)].join(" "),
          masked: masked || negated,
        });
      }
    }
    if (depth >= MAX_DEPTH) continue;
    seg.words.forEach((word, i) => {
      if (skip !== null && i >= skip.from && i < skip.to) return;
      for (const body of word.subs) visit(lex(body), depth + 1, true, out);
    });
  }
}

// `a && b` keeps a failure of either, while `|`, `||`, `;`, and `&` let a later command decide. A trailing
// `;` or newline runs nothing after the last command, so it cannot change the status; a trailing `&`
// backgrounds it, so it can.
function masksStatus({ operators, trailing }: Lexed): boolean {
  const firstTrailing = operators.length - trailing;
  return operators.some((op, k) => op !== "&&" && !(k >= firstTrailing && (op === ";" || op === "\n")));
}

/**
 * The words [k, e) that form the command itself: past grouping, keywords, `!`, `time`, assignments, and
 * transparent wrappers with their options, and before a closing `)` or `}`.
 */
function commandSpan(words: Word[]): { k: number; e: number; negated: boolean } {
  let e = words.length;
  while (e > 0 && CLOSERS.has(words[e - 1].raw)) e--;
  let k = 0;
  let negated = false;
  while (k < e) {
    const raw = words[k].raw;
    if (raw === "(" || raw === "{" || KEYWORDS.has(raw) || ASSIGNMENT.test(raw)) {
      k++;
    } else if (raw === "!") {
      negated = true;
      k++;
    } else if (raw === "time") {
      k++;
      if (k < e && words[k].raw === "-p") k++;
    } else {
      const next = afterWrapper(words, k, e);
      if (next === null || next >= e) break; // a bare wrapper (`env`, `nohup`) is itself the command
      k = next;
    }
  }
  return { k, e, negated };
}

/** If words[k] is a transparent wrapper, the index of the command it runs; otherwise null. */
function afterWrapper(words: Word[], k: number, e: number): number | null {
  const syntax = WRAPPERS.get(basename(words[k].value));
  if (syntax === undefined) return null;
  let j = k + 1;
  while (j < e) {
    const v = words[j].value;
    if (v === "--") {
      j++;
      break;
    }
    if (v.startsWith("--")) {
      j += !v.includes("=") && syntax.long.includes(v.slice(2)) ? 2 : 1;
    } else if (v.startsWith("-")) {
      // A value-taking flag last in its cluster takes the next word; earlier in the cluster, the rest is its value.
      const flags = v.slice(1);
      const at = [...flags].findIndex((f) => syntax.short.includes(f));
      j += at >= 0 && at === flags.length - 1 ? 2 : 1;
    } else {
      break;
    }
  }
  return j + syntax.positional;
}

/** The script a `bash -c`, `sh -c`, `zsh -c`, or `eval` runs, with the range of words it came from. */
function wrappedScript(values: string[]): { script: string; from: number; to: number } | null {
  const name = basename(values[0]);
  if (name === "eval") return values.length > 1 ? { script: values.slice(1).join(" "), from: 1, to: values.length } : null;
  if (!SHELLS.has(name)) return null;
  let j = 1;
  let hasC = false;
  while (j < values.length) {
    const v = values[j];
    if (v === "-o" || v === "+o") {
      j += 2;
    } else if (LONG_OPTION.test(v)) {
      j++;
    } else if (SHORT_OPTIONS.test(v)) {
      if (v[0] === "-" && v.includes("c")) hasC = true;
      j += v.endsWith("o") ? 2 : 1; // `-eo pipefail`: a cluster ending in o takes the option name next
    } else {
      break;
    }
  }
  return hasC && j < values.length ? { script: values[j], from: j, to: j + 1 } : null;
}
