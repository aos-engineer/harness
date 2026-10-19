// `aos mcp`: the AOS tools over stdio, for hosts that register the CLI as an MCP server.
import { join } from "node:path";
import { serveStdio } from "@aos-harness/kernel/mcp";
import type { CommandFn } from "../io.ts";

const USAGE = "Usage: aos mcp [--pack <dir>]";

// Resolves only once the host closes the connection: returning earlier would end the process while
// the host is still talking to it.
export const mcpCommand: CommandFn = async (io) => {
  const args = io.argv.slice(1);
  let pack: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--pack" || arg.startsWith("--pack=")) {
      const value = arg === "--pack" ? args[++i] : arg.slice("--pack=".length);
      if (value === undefined || value === "") {
        io.err(`aos mcp: --pack needs a directory. ${USAGE}`);
        return 2;
      }
      pack = value;
    } else {
      io.err(`aos mcp: unknown argument "${arg}". ${USAGE}`);
      return 2;
    }
  }
  await serveStdio({
    cwd: io.cwd,
    packDir: pack ?? (io.env.AOS_PACK || join(import.meta.dirname, "../../../packs/feature-delivery")),
    host: io.env.AOS_HOST || "claude-code",
  });
  return 0;
};
