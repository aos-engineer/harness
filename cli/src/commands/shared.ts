// Flag parsing, root resolution, and output helpers shared by the human-facing commands.
import { resolve } from "node:path";
import { gitRoot } from "@aos-harness/kernel";
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

// C0 and C1 controls (except newline and tab) and the bidirectional overrides that can make text display
// in a different order than it is stored.
const UNPRINTABLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * Text written by an agent, made safe to show a human. Escape sequences and carriage returns could repaint
 * the terminal and hide what is really being approved, so each one is shown as a visible \uXXXX escape.
 */
export function printable(s: string): string {
  return s.replace(UNPRINTABLE, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** The first `max` characters of `s`, with a note saying how much was left out. */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n... (${s.length - max} more characters not shown)`;
}
