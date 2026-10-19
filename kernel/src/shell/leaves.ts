// Reduces a command line to the simple commands that actually run, so classification sees `git push`
// whether it was typed bare, behind `FOO=1`, after `cd`, or inside `bash -c '...'`.
// Not exported from the package barrel: split.ts and match.ts are the public surface.
import { lex, type Lexed, type Segment, type Word } from "./lexer.ts";

export interface Leaf {
  text: string;
  // True when something other than this command can decide the exit status: an operator at its own
  // level, or in any bash -c or eval script it was unwrapped from.
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
const SHORT_FLAGS = /^-[A-Za-z]+$/;

export function walk(cmd: string): Walk {
  const out: Walk = { leaves: [], segments: [] };
  visit(lex(cmd), 0, false, out);
  return out;
}

function visit(lexed: Lexed, depth: number, outerMasked: boolean, out: Walk): void {
  const masked = outerMasked || masksStatus(lexed);
  for (const seg of lexed.segments) {
    out.segments.push(seg);
    const k = commandStart(seg.words);
    if (k >= seg.words.length) continue; // only assignments
    const values = seg.words.slice(k).map((w) => w.value);
    if (values[0] === "cd") continue;
    const script = wrappedScript(values);
    if (script !== null && depth < MAX_DEPTH) {
      visit(lex(script), depth + 1, masked, out);
      continue;
    }
    out.leaves.push({ text: seg.text.slice(seg.words[k].at), masked });
  }
}

// `a && b` keeps a failure of either, while `|`, `||`, `;`, and `&` let a later command decide. A trailing
// `;` or newline runs nothing after the last command, so it cannot change the status; a trailing `&`
// backgrounds it, so it can.
function masksStatus({ operators, trailing }: Lexed): boolean {
  const firstTrailing = operators.length - trailing;
  return operators.some((op, k) => op !== "&&" && !(k >= firstTrailing && (op === ";" || op === "\n")));
}

/** Index of the first word after leading `NAME=value` assignments, also through an `env` prefix. */
function commandStart(words: Word[]): number {
  let k = 0;
  while (k < words.length && ASSIGNMENT.test(words[k].raw)) k++;
  if (words[k]?.value === "env") {
    let j = k + 1;
    while (j < words.length && ASSIGNMENT.test(words[j].raw)) j++;
    if (j < words.length) k = j; // a bare `env` lists the environment; it stays the command
  }
  return k;
}

/** The script a `bash -c`, `sh -c`, `zsh -c`, or `eval` runs, or null for any other command. */
function wrappedScript(values: string[]): string | null {
  const name = values[0].slice(values[0].lastIndexOf("/") + 1);
  if (name === "eval") return values.length > 1 ? values.slice(1).join(" ") : null;
  if (!SHELLS.has(name)) return null;
  let k = 1;
  let hasC = false;
  while (k < values.length && SHORT_FLAGS.test(values[k])) {
    if (values[k].includes("c")) hasC = true;
    k++;
  }
  return hasC && k < values.length ? values[k] : null;
}
