// A CliIO that records output and answers prompts from a queue, so command tests never touch a real
// terminal, the developer's git config, or their Claude Code install.
import { join } from "node:path";
import type { CliIO } from "../src/io.ts";
import { tmpDir } from "../../kernel/tests/helpers.ts";

/** A queued answer, or a function that runs when the prompt is asked (to simulate a race) and returns one. */
export type Answer = string | ((question: string) => string);

export interface FakeIO extends CliIO {
  readonly stdout: string;
  readonly stderr: string;
  prompts: string[];
}

export interface FakeIOOptions {
  argv: string[];
  cwd?: string;
  isTTY?: boolean;
  answers?: Answer[];
  env?: Record<string, string | undefined>;
}

/**
 * The default environment keeps tests hermetic: no GIT_* variables or global git config (a global
 * excludesFile could ignore .aos/ on one machine and not another), a canned `claude --version` so doctor
 * never spawns claude, and a plugin cache that does not exist so doctor never reads ~/.claude.
 */
export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_") && !k.startsWith("AOS_")) env[k] = v;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.AOS_DOCTOR_CLAUDE_VERSION = "2.1.295 (Claude Code)";
  env.AOS_DOCTOR_PLUGIN_CACHE = join(tmpDir("aos-no-plugins-"), "cache");
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export function fakeIO(o: FakeIOOptions): FakeIO {
  const out: string[] = [];
  const err: string[] = [];
  const answers = [...(o.answers ?? [])];
  const prompts: string[] = [];
  return {
    argv: o.argv,
    // Never the real checkout: a command that walks up to a git root must not find this repository's .aos/.
    cwd: o.cwd ?? tmpDir("aos-cwd-"),
    env: testEnv(o.env),
    isTTY: o.isTTY ?? false,
    out: (s) => void out.push(s + "\n"),
    err: (s) => void err.push(s + "\n"),
    prompt: async (question) => {
      prompts.push(question);
      const next = answers.shift();
      // A prompt nobody expected is a test failure, not an empty answer that happens to be refused.
      if (next === undefined) throw new Error(`fakeIO: no answer queued for prompt ${JSON.stringify(question)}`);
      return typeof next === "function" ? next(question) : next;
    },
    get stdout() {
      return out.join("");
    },
    get stderr() {
      return err.join("");
    },
    prompts,
  };
}
