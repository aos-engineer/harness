// Reduces a command line to the simple commands that actually run, so classification sees `git push`
// whether it was typed bare, behind `FOO=1`, after `cd`, inside `(...)` or `if ...; then`, behind a
// wrapper such as `sudo` or `timeout 60`, inside `bash -c '...'`, inside a script a shell reads from a
// heredoc, herestring, or pipe, behind a `git -c alias.x=...` alias, or inside a `$(...)` substitution.
// Not exported from the package barrel: split.ts and match.ts are the public surface.
import { lex, type Lexed, type Segment, type Word } from "./lexer.ts";

export interface Leaf {
  text: string; // as written, from the command word through its last argument
  words: string[]; // word values from the command word on
  command: string; // the words with the command word reduced to its basename, joined by single spaces
  // True when something other than this command can decide the exit status: an operator at its own
  // level or in any script it was unwrapped from, a leading `!`, or running inside a substitution.
  masked: boolean;
  // True when bash rewrites the command word, or git's subcommand, before running it (a variable, a
  // substitution, a glob, or a brace list), so the words as written say nothing reliable about what runs.
  expanded: boolean;
}

export interface Walk {
  leaves: Leaf[];
  segments: Segment[]; // every segment visited at every depth, before stripping
}

// Deep enough for any honest command; past it the wrapper itself is the leaf.
const MAX_DEPTH = 3;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Shells that run a -c argument, or their stdin when given no script file.
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "mksh", "ash", "fish", "csh", "tcsh"]);
// Script operands that are the shell's own stdin.
const STDIN_PATHS = new Set(["/dev/stdin", "/dev/fd/0", "/proc/self/fd/0"]);
// Long options that take the next word as their value: bash's startup files and fish's init command.
const SHELL_VALUE_OPTIONS = new Set(["--rcfile", "--init-file", "--init-command"]);
// A redirection operator at the start of a word, after an optional fd number.
const REDIRECT = /^(?:\d+)?(<<<|<<-?|<>|<&|>&|>>|>\||&>>?|<|>)/;
// A command word bash would rewrite before running it. `[` alone is the test builtin, not a glob.
const EXPANDED = /[$`*?]|\[.*\]|\{[^}]*(?:,|\.\.)[^}]*\}/;
// Git global options that take the next word as their value.
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--list-cmds"]);
const GIT_ALIAS = /^alias\.([^=]+)=(.*)$/is;
// Aliases may name other aliases; git stops a loop itself, and this bound stops ours.
const MAX_ALIAS_HOPS = 5;
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
  lexed.segments.forEach((seg, s) => {
    out.segments.push(seg);
    const { k, e, negated } = commandSpan(seg.words);
    // A wrapper's script is re-lexed below, which finds the substitutions inside it; skip that word here
    // so each one is visited once.
    let skip: { from: number; to: number } | null = null;
    if (k < e && basename(seg.words[k].value) !== "cd") {
      const span = seg.words.slice(k, e);
      const upstream = seg.piped && s > 0 ? lexed.segments[s - 1] : null;
      const wrapped = depth < MAX_DEPTH ? wrappedScripts(span, upstream) : null;
      if (wrapped !== null) {
        for (const script of wrapped.scripts) visit(lex(script), depth + 1, masked || negated, out);
        if (wrapped.from !== null) skip = { from: k + wrapped.from, to: k + wrapped.from + 1 };
      } else {
        const last = seg.words[e - 1];
        const text = seg.text.slice(seg.words[k].at, last.at + last.raw.length);
        addLeaf(span.map((w) => w.value), text, masked || negated, depth, out);
      }
    }
    if (depth >= MAX_DEPTH) return;
    seg.words.forEach((word, i) => {
      if (skip !== null && i >= skip.from && i < skip.to) return;
      for (const body of word.subs) visit(lex(body), depth + 1, true, out);
    });
  });
}

// A word that quoting kept whole, shown with this in place of its whitespace so patterns still see one word.
const SPACE_IN_WORD = "\u2423";

/**
 * The form commands are matched in. The command word is reduced to its basename and lowercased, because
 * the default macOS filesystem runs `Git push` and `AOS approve` as git and aos. Whitespace inside a word
 * becomes ␣, so `git -C "my dir" push` reads as `git -C my␣dir push` and `-C <value>` stays one value.
 */
function normalForm(values: string[]): string {
  return [basename(values[0]).toLowerCase(), ...values.slice(1)].map((w) => w.replace(/\s/g, SPACE_IN_WORD)).join(" ");
}

/** Records a leaf, then the command a `git -c alias.NAME=...` alias it invokes would run. */
function addLeaf(values: string[], text: string, masked: boolean, depth: number, out: Walk, hops = 0): void {
  const git = gitSubcommand(values);
  out.leaves.push({
    text,
    words: values,
    command: normalForm(values),
    masked,
    expanded: EXPANDED.test(values[0]) || (git !== null && git.at < values.length && EXPANDED.test(values[git.at])),
  });
  // The leaf as written stays too: git runs a builtin over an alias of the same name, so
  // `git -c alias.push=status push` still pushes.
  const alias = git !== null && hops < MAX_ALIAS_HOPS ? gitAlias(values, git) : null;
  if (alias === null) return;
  if (alias.shell !== null) {
    if (depth < MAX_DEPTH) visit(lex(alias.shell), depth + 1, masked, out);
  } else {
    addLeaf(alias.words, text, masked, depth, out, hops + 1);
  }
}

/**
 * The command a git invocation runs when its subcommand is an alias defined on the same command line with
 * `-c alias.NAME=VALUE`. Git splits a plain value into arguments placed where the alias name was; a value
 * starting with `!` runs as a shell command with the remaining arguments appended. Alias names are
 * config keys, so they match without regard to case.
 */
function gitAlias(values: string[], git: GitSubcommand): { shell: string; words: null } | { shell: null; words: string[] } | null {
  const j = git.at;
  const value = j < values.length ? git.aliases.get(values[j].toLowerCase()) : undefined;
  if (value === undefined) return null;
  const rest = values.slice(j + 1);
  if (value.startsWith("!")) return { shell: [value.slice(1), ...rest].join(" "), words: null };
  const expansion = lex(value).segments.flatMap((seg) => seg.words.map((w) => w.value));
  return { shell: null, words: [...values.slice(0, j), ...expansion, ...rest] };
}

interface GitSubcommand {
  at: number; // index of the subcommand word, or the word count when there is none
  aliases: Map<string, string>; // lowercased alias name to value, from `-c alias.NAME=VALUE`
}

/** Where a git invocation's subcommand sits, past its global options, and the aliases those options define. */
function gitSubcommand(values: string[]): GitSubcommand | null {
  if (basename(values[0]).toLowerCase() !== "git") return null;
  const aliases = new Map<string, string>();
  let j = 1;
  while (j < values.length) {
    const v = values[j];
    if (v === "-c") {
      const def = GIT_ALIAS.exec(values[j + 1] ?? "");
      if (def !== null) aliases.set(def[1].toLowerCase(), def[2]);
      j += 2;
    } else if (GIT_VALUE_OPTIONS.has(v)) {
      j += 2;
    } else if (v.startsWith("-")) {
      j++;
    } else {
      break;
    }
  }
  return { at: j, aliases };
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

interface Wrapped {
  scripts: string[]; // the code this command runs, each lexed on its own
  from: number | null; // the word the script came from, whose substitutions the re-lex finds
}

/**
 * The scripts an `eval`, or a shell given `-c`, a heredoc, a herestring, or a pipe on stdin, runs. A shell
 * with a script file operand reads its stdin as data, so only a shell with no operand, with `-s`, or
 * reading `/dev/stdin` runs what arrives there.
 */
function wrappedScripts(span: Word[], upstream: Segment | null): Wrapped | null {
  const name = basename(span[0].value);
  if (name === "eval") {
    return span.length > 1 ? { scripts: [span.slice(1).map((w) => w.value).join(" ")], from: null } : null;
  }
  if (!SHELLS.has(name)) return null;
  const { args, stdin } = redirections(span);
  const input = shellInput(args.map((a) => a.value));
  if (input === null) return null;
  if (input !== "stdin") return { scripts: [input.script], from: args[input.at].index };
  if (stdin !== null) return stdin.text === null ? null : { scripts: [stdin.text], from: null };
  return upstream === null ? null : { scripts: pipedScripts(upstream), from: null };
}

/**
 * Where a shell's script comes from, given its words: an argument (`-c` and its operand, or fish's
 * `--command=...`), its stdin, or (null) a script file.
 */
function shellInput(values: string[]): { script: string; at: number } | "stdin" | null {
  let j = 1;
  let hasC = false;
  let readsStdin = false;
  while (j < values.length) {
    const v = values[j];
    if (v === "--" || v === "-") {
      j++;
      break;
    }
    if (v.startsWith("--command=")) return { script: v.slice("--command=".length), at: j };
    if (v === "--command") {
      hasC = true;
      j++;
    } else if (v === "-o" || v === "+o" || SHELL_VALUE_OPTIONS.has(v)) {
      j += 2;
    } else if (LONG_OPTION.test(v)) {
      j++;
    } else if (SHORT_OPTIONS.test(v)) {
      if (v[0] === "-" && v.includes("c")) hasC = true;
      if (v[0] === "-" && v.includes("s")) readsStdin = true;
      j += v.endsWith("o") ? 2 : 1; // `-eo pipefail`: a cluster ending in o takes the option name next
    } else {
      break;
    }
  }
  if (hasC) return j < values.length ? { script: values[j], at: j } : null;
  return j >= values.length || readsStdin || STDIN_PATHS.has(values[j]) ? "stdin" : null;
}

/**
 * Splits a command's words into its arguments and its redirections, and says what its stdin is: the text
 * of a heredoc or herestring, unknown text (a file), or nothing redirected (null). The last stdin
 * redirection wins, as in bash.
 */
function redirections(span: Word[]): { args: { value: string; index: number }[]; stdin: { text: string | null } | null } {
  const args: { value: string; index: number }[] = [];
  let stdin: { text: string | null } | null = null;
  for (let i = 0; i < span.length; i++) {
    const word = span[i];
    const m = i === 0 ? null : REDIRECT.exec(word.raw);
    if (m === null) {
      args.push({ value: word.value, index: i });
      continue;
    }
    // A bare operator takes the next word as its target; otherwise the target is glued on.
    const glued = word.raw.length > m[0].length;
    const target = glued ? word : span[i + 1];
    if (!glued) i++;
    const op = m[1];
    const fd = m[0].slice(0, m[0].length - op.length);
    if (!op.startsWith("<") || (fd !== "" && fd !== "0")) continue;
    if (op === "<<<") stdin = { text: target === undefined ? "" : glued ? word.value.slice(m[0].length) : target.value };
    else if (op.startsWith("<<")) stdin = { text: word.heredoc?.body ?? target?.heredoc?.body ?? "" };
    else stdin = { text: null };
  }
  return { args, stdin };
}

/**
 * The scripts a shell could be reading from the command piped into it. The upstream command's own
 * output is unknowable in general, but `echo`, `printf`, and `cat <<EOF` print their arguments or body,
 * so each argument, all of them joined, and any heredoc or herestring text are each read as a script.
 */
function pipedScripts(upstream: Segment): string[] {
  const { k, e } = commandSpan(upstream.words);
  if (k >= e) return [];
  const { args, stdin } = redirections(upstream.words.slice(k, e));
  // printf, and echo in zsh or with -e, turn `\n` and `\t` into the characters, which then split commands.
  const values = args.slice(1).map((a) => a.value.replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
  const scripts = [values.join(" "), ...values];
  if (stdin !== null && stdin.text !== null) scripts.push(stdin.text);
  return [...new Set(scripts)].filter((s) => s.trim() !== "");
}
