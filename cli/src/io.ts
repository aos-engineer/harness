import { createInterface } from "node:readline/promises";

/** Everything a command touches, injected so tests can drive commands without a real terminal. */
export interface CliIO {
  argv: string[]; // arguments after the binary, starting with the command name
  cwd: string;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  out(s: string): void; // writes s and a newline to stdout
  err(s: string): void; // writes s and a newline to stderr
  prompt(question: string): Promise<string>;
}

/**
 * Resolves to the process exit code once the command's work is done. A long-lived command (aos mcp)
 * resolves only when it stops serving; the entry point never forces an exit.
 */
export type CommandFn = (io: CliIO) => Promise<number>;

export function processIO(): CliIO {
  return {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    // Human-only commands key off this: an agent's shell tool has no TTY.
    isTTY: process.stdin.isTTY === true,
    out: (s) => void process.stdout.write(s + "\n"),
    err: (s) => void process.stderr.write(s + "\n"),
    prompt: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}
