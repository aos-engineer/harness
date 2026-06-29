/**
 * aos serve — Expose this AOS project as an A2A agent (skill-routed ingress).
 *
 * Serves the project's core/skills as an A2A agent on the Paperclip Bun.serve
 * seam (Agent Card at /.well-known/agent-card.json + a JSON-RPC endpoint at
 * /a2a). Each inbound request is routed to ONE skill and run on a warm worker;
 * a skill bound via mcp_binding resolves to a native MCP tool call.
 */

import { c, type ParsedArgs } from "../colors";
import { detectProject } from "../utils";

const HELP = `
${c.bold("aos serve")} — Serve this AOS project as an A2A agent (skill-routed)

${c.bold("USAGE")}
  aos serve --a2a [--port <n>] [--public-url <url>] [--auth-token <tok>] [--worker <agent>] [--adapter <platform>]

${c.bold("DESCRIPTION")}
  Exposes core/skills as an A2A agent. Skill selection: an explicit
  metadata.skillId (fast path) else a default skill — so generic A2A clients
  (incl. ADK RemoteA2aAgent) work without knowing the convention.

${c.bold("OPTIONS")}
  --a2a                  Required. Start the A2A ingress server.
  --port <n>             Listen port (default 8080).
  --public-url <url>     Public base URL advertised in the Agent Card.
  --auth-token <tok>     Out-of-band bearer token required on /a2a.
  --worker <agent>       Worker agent id used to run skills (default "arbiter").
  --adapter <platform>   Vendor adapter for the worker (default "claude-code").

${c.bold("ENV")} (flags override)
  AOS_A2A_PORT  AOS_A2A_PUBLIC_URL  AOS_A2A_AUTH_TOKEN  AOS_A2A_WORKER_AGENT
  AOS_A2A_ADAPTER  AOS_A2A_EGRESS_ALLOWLIST  AOS_A2A_ALLOW_PRIVATE
`;

const FLAG_TO_ENV: Record<string, string> = {
  port: "AOS_A2A_PORT",
  "public-url": "AOS_A2A_PUBLIC_URL",
  "auth-token": "AOS_A2A_AUTH_TOKEN",
  worker: "AOS_A2A_WORKER_AGENT",
  adapter: "AOS_A2A_ADAPTER",
};

export async function serveCommand(parsed: ParsedArgs): Promise<void> {
  if (parsed.flags.help) {
    console.log(HELP);
    return;
  }
  if (!parsed.flags.a2a) {
    console.error(`aos serve: pass --a2a to start the A2A ingress server (see 'aos serve --help').`);
    process.exit(2);
  }

  const projectRoot = detectProject(process.cwd());
  if (!projectRoot) {
    console.error("aos serve: no AOS project detected in this directory.");
    process.exit(2);
  }

  // CLI flags override env, which the serve bootstrap reads.
  for (const [flag, envKey] of Object.entries(FLAG_TO_ENV)) {
    const value = parsed.flags[flag];
    if (typeof value === "string") process.env[envKey] = value;
  }

  const { runA2aServe } = await import("../serve/a2a-serve");
  await runA2aServe(projectRoot);
}
