import { readFileSync } from "node:fs";
import type { CliIO, CommandFn } from "./io.ts";

export interface CommandEntry { help: string; importCommand: () => Promise<CommandFn> }

// Commands load lazily so each invocation imports only what it runs.
export const COMMANDS: Record<string, CommandEntry> = {
  approve: { help: "approve <run> [stage]   Approve or deny a pending human gate (needs a terminal)", importCommand: async () => (await import("./commands/approve.ts")).approveCommand },
  status: { help: "status [run]            List runs, or summarize one run's stage and gate", importCommand: async () => (await import("./commands/status.ts")).statusCommand },
  doctor: { help: "doctor                  Check the toolchain, the pack, and run log integrity", importCommand: async () => (await import("./commands/doctor.ts")).doctorCommand },
  run: { help: "run cancel <run>        End a run (needs a terminal)", importCommand: async () => (await import("./commands/run.ts")).runCommand },
  mcp: { help: "mcp                     Serve the AOS MCP tools on stdio", importCommand: async () => (await import("./commands/mcp.ts")).mcpCommand },
};

function version(): string {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
}

/** Routes argv to a command and returns its exit code. A thrown error becomes one line on stderr and exit 1. */
export async function dispatch(io: CliIO, commands: Record<string, CommandEntry> = COMMANDS): Promise<number> {
  const [cmd] = io.argv;
  if (cmd === "--version" || cmd === "-v") {
    io.out(`aos ${version()}`);
    return 0;
  }
  if (!cmd || cmd === "--help" || cmd === "-h") {
    io.out(`aos ${version()}\n\nUsage: aos <command> [options]\n\n` + Object.values(commands).map((c) => "  " + c.help).join("\n"));
    return 0;
  }
  const entry = commands[cmd];
  if (!entry) {
    io.err(`aos: unknown command "${cmd}". Run aos --help for the list.`);
    return 2;
  }
  try {
    return await (await entry.importCommand())(io);
  } catch (e) {
    io.err(`aos: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
