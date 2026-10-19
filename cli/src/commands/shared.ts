// Flag parsing, root resolution, and output helpers shared by the human-facing commands.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { aosDir, gitRoot } from "@aos-harness/kernel";
import type { Binding } from "@aos-harness/kernel";
import type { CliIO } from "../io.ts";

export type FlagName = "root" | "reason" | "deny" | "json" | "pack" | "help";

export interface Flags {
  positionals: string[];
  root: string | null;
  reason: string | null;
  deny: boolean;
  json: boolean;
  pack: string | null;
  help: boolean;
}

/** A command-line mistake: the command prints it with its usage and exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const VALUE_FLAGS = new Set<string>(["root", "reason", "pack"]);
const BOOLEAN_FLAGS = new Set<string>(["deny", "json", "help"]);
const ALL_FLAGS: readonly FlagName[] = ["root", "reason", "deny", "json", "pack", "help"];

/**
 * Parses `--root <p>`, `--reason <s>`, `--deny`, `--json`, `--pack <p>`, and `--help` (`-h`), in either
 * `--flag value` or `--flag=value` form; everything else is positional, and `--` ends the flags. Only flags
 * in `allowed` are accepted, so a flag a command ignores is an error instead of a silent no-op.
 */
export function parseFlags(argv: string[], allowed: readonly FlagName[] = ALL_FLAGS): Flags {
  const flags: Flags = { positionals: [], root: null, reason: null, deny: false, json: false, pack: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      flags.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      if (!allowed.includes("help")) throw new UsageError(`unknown flag ${arg}`);
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      flags.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!(allowed as readonly string[]).includes(name)) throw new UsageError(`unknown flag --${name}`);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      if (name === "deny") flags.deny = true;
      else if (name === "json") flags.json = true;
      else flags.help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new UsageError(`unknown flag --${name}`);
    let value: string | undefined;
    if (eq !== -1) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      // `--reason --deny` is almost certainly a missing reason, not a reason that reads "--deny".
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      i++;
    }
    if (name === "root") flags.root = value;
    else if (name === "reason") flags.reason = value;
    else flags.pack = value;
  }
  return flags;
}

/** Where runs live: `--root`, else the git top level of the working directory, else the directory itself. */
export function resolveRoot(io: CliIO, flags: Pick<Flags, "root">): string {
  if (flags.root !== null) return resolve(io.cwd, flags.root);
  return gitRoot(io.cwd) ?? resolve(io.cwd);
}

/**
 * Human-only commands refuse to run without a terminal, because an agent's shell tool has none. This stops
 * an agent from passing its own gate by accident or shortcut. It is not a security boundary: a process
 * that wants to can allocate a pseudo-terminal.
 */
export function requireTty(io: CliIO, cmd: string): boolean {
  if (io.isTTY) return true;
  io.err(`aos ${cmd} needs an interactive terminal (TTY). Run it yourself, not through an agent.`);
  return false;
}

export const TTY_NOTE =
  "It needs an interactive terminal, which an agent's shell tool does not have, so an agent cannot pass\n" +
  "its own gate by accident or shortcut. The check is not a security boundary: a determined process can\n" +
  "allocate a terminal. The run log records who decided and why.";

// Control characters (Cc) and format characters (Cf: bidi overrides and isolates, zero-width characters, the
// byte order mark, the Arabic letter mark), plus the line and paragraph separators, which some terminals
// treat as line breaks. Newline and tab are kept.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * Text read from a run log or written by an agent, made safe to show a human. Escape sequences, carriage
 * returns, and bidi characters could repaint or reorder the terminal and hide what is really being approved,
 * so each one is shown as a visible \uXXXX escape. Escaped text contains none of them, so this is idempotent.
 */
export function printable(s: string): string {
  return s.replace(UNPRINTABLE, (c) => (c === "\n" || c === "\t" ? c : visibleEscape(c)));
}

function visibleEscape(c: string): string {
  const cp = c.codePointAt(0) ?? 0;
  return cp > 0xffff ? `\\u{${cp.toString(16)}}` : "\\u" + cp.toString(16).padStart(4, "0");
}

/** The first `max` characters of `s`, with a note saying how much was left out. */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n... (${s.length - max} more characters not shown)`;
}

export interface BindingFile { name: string; binding: Binding | null; problem: string | null }

/**
 * Every session binding file under <root>/.aos/sessions, parsed. A file that is not a binding comes back with
 * `binding: null` and the problem. No sessions directory means no bindings; any other listing error throws.
 */
export function readBindings(root: string): BindingFile[] {
  const dir = join(aosDir(root), "sessions");
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return names.map((name) => parseBindingFile(join(dir, name), name));
}

function parseBindingFile(path: string, name: string): BindingFile {
  let raw: Record<string, unknown> | null;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> | null;
  } catch (e) {
    return { name, binding: null, problem: e instanceof SyntaxError ? "not JSON" : e instanceof Error ? e.message : String(e) };
  }
  const fields = ["host", "session", "run", "root", "boundAt"] as const;
  const missing = fields.filter((k) => typeof raw?.[k] !== "string");
  if (missing.length > 0) return { name, binding: null, problem: `missing ${missing.join(", ")}` };
  const b = raw as Record<(typeof fields)[number], string>;
  return { name, binding: { host: b.host, session: b.session, run: b.run, root: b.root, boundAt: b.boundAt }, problem: null };
}
