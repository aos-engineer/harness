// ── mcp-session.ts ────────────────────────────────────────────────
// Builds and starts the session-scoped MCP toolset manager from a project's
// aos/mcp/v1 registries (core/mcp/). Wired into adapter-session so a skill's
// `mcp_binding` resolves to a native MCP tool call during a live run.
//
// Non-fatal by design (consistent with the memory-provider fallback): a
// malformed registry, a duplicate server id, or an unreachable server is
// logged and skipped so the session still runs — an agent that needs the
// missing toolset fails at call time, not at startup.
//
// Egress: http/sse server URLs are gated by MeshEgressPolicy. By default,
// private/loopback targets are blocked; operators opt in via
//   AOS_MCP_EGRESS_ALLOWLIST=host[:port],host2   (allow specific private hosts)
//   AOS_MCP_ALLOW_PRIVATE=1                       (allow all private — dev only)

import { discoverMcpRegistries } from "@aos-harness/runtime/config-loader";
import { McpToolsetManager } from "@aos-harness/runtime/mcp-toolset-manager";
import { MeshEgressPolicy } from "@aos-harness/runtime/egress-policy";
import type { TranscriptEntry } from "@aos-harness/runtime/types";

export async function createSessionMcpManager(
  projectDir: string,
  log: (message: string) => void,
  onTranscript?: (entry: TranscriptEntry) => void,
): Promise<McpToolsetManager | null> {
  try {
    const registries = discoverMcpRegistries(projectDir);
    if (registries.length === 0) return null;

    const allowlist = (process.env.AOS_MCP_EGRESS_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const manager = McpToolsetManager.fromRegistries(registries, {
      egress: new MeshEgressPolicy({
        allowlist,
        allowPrivate: process.env.AOS_MCP_ALLOW_PRIVATE === "1",
      }),
      onEvent: (type, detail) => {
        log(`[mcp] ${type} ${JSON.stringify(detail)}`);
        onTranscript?.({ type, timestamp: new Date().toISOString(), ...detail });
      },
    });

    await manager.start();
    const ready = manager.listServers();
    log(`[mcp] ${ready.length} server(s) ready${ready.length ? ": " + ready.join(", ") : ""}`);
    return manager;
  } catch (err) {
    log(`[mcp] disabled — registry error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
