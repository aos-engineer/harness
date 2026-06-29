// ── a2a-session.ts ────────────────────────────────────────────────
// Builds the session-scoped A2A egress connector from a project's
// aos/remote-agent/v1 records (core/remote-agents/). Registered into the
// CompositeRuntime so a member with a remote_ref is driven over A2A.
//
// Non-fatal (consistent with mcp-session): a malformed record logs and disables
// A2A egress; a peer that is unreachable fails when that member is spawned.
//
// Egress: card URLs + endpoints + every redirect hop pass MeshEgressPolicy.
// Private/loopback targets are blocked unless opted in:
//   AOS_A2A_EGRESS_ALLOWLIST=host[:port],host2   AOS_A2A_ALLOW_PRIVATE=1

import { discoverRemoteAgents } from "@aos-harness/runtime/config-loader";
import { A2aConnector } from "@aos-harness/runtime/a2a-connector";
import { MeshEgressPolicy } from "@aos-harness/runtime/egress-policy";
import type { TranscriptEntry } from "@aos-harness/runtime/types";

export function createSessionA2aConnector(
  projectDir: string,
  log: (message: string) => void,
  onTranscript?: (entry: TranscriptEntry) => void,
): A2aConnector | null {
  try {
    const remotes = discoverRemoteAgents(projectDir);
    if (remotes.length === 0) return null;

    const allowlist = (process.env.AOS_A2A_EGRESS_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const connector = new A2aConnector(remotes, {
      egress: new MeshEgressPolicy({
        allowlist,
        allowPrivate: process.env.AOS_A2A_ALLOW_PRIVATE === "1",
      }),
      onEvent: (type, detail) => {
        log(`[a2a] ${type} ${JSON.stringify(detail)}`);
        onTranscript?.({ type, timestamp: new Date().toISOString(), ...detail });
      },
    });

    log(`[a2a] ${remotes.length} remote agent(s): ${remotes.map((r) => r.id).join(", ")}`);
    return connector;
  } catch (err) {
    log(`[a2a] disabled — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
