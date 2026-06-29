// ── McpToolsetManager (Phase 1 — MCP-inside) ─────────────────────
//
// One source of truth for external MCP toolsets declared as `aos/mcp/v1`.
// Models the proven memory-provider-factory `{ start, shutdown }` lifecycle.
// Spawns/connects each declared server through McpClientV2 (real handshake),
// gates http/sse URLs through MeshEgressPolicy, discovers tools (honoring an
// optional per-server allowlist), and exposes callTool() to the two inside
// consumers: the skill mcp_binding path (base-workflow.invokeSkill) and the
// pi in-process registerTool path. (CLI vendor adapters instead read the raw
// server specs via getServerConfig() and let the vendor CLI own the MCP link.)
//
// Failures are non-fatal by default: an unavailable server is logged and
// skipped so the session still runs; an agent that needs it fails at call time.

import {
  McpClientV2,
  type McpClientV2Options,
  type McpTool,
  type McpToolCallResult,
} from "./mcp-client-v2";
import { MeshEgressPolicy, assertResolvedHostSafe } from "./egress-policy";
import type { McpServerConfig, McpRegistryConfig, VendorMcpServerSpec } from "./types";

export type McpEventType =
  | "mcp_server_started"
  | "mcp_server_unavailable"
  | "mcp_tool_call"
  | "mcp_tool_result"
  | "mcp_tool_error";

export interface ManagedServer {
  config: McpServerConfig;
  client: McpClientV2;
  tools: McpTool[];
}

export interface McpToolsetManagerOptions {
  /** Outbound URL gate for http/sse servers. Defaults to a strict policy. */
  egress?: MeshEgressPolicy;
  /** Observability hook — wired to the engine transcript sink by the caller. */
  onEvent?: (type: McpEventType, detail: Record<string, unknown>) => void;
  /** If true, a server that fails to start aborts start(). Default false. */
  requireAll?: boolean;
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
  clientInfo?: { name: string; version: string };
  /** Env source for ${VAR} and auth_ref resolution. Defaults to process.env. */
  env?: Record<string, string | undefined>;
}

function resolveEnvTemplate(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => env[name] ?? "");
}

/** Flatten registries into a unique-by-id server list. Throws on duplicate ids. */
export function flattenRegistries(registries: McpRegistryConfig[]): McpServerConfig[] {
  const byId = new Map<string, McpServerConfig>();
  for (const reg of registries) {
    for (const server of reg.servers ?? []) {
      if (byId.has(server.id)) {
        throw new Error(
          `Duplicate MCP server id "${server.id}" (registry "${reg.id}" conflicts with an earlier declaration)`,
        );
      }
      byId.set(server.id, server);
    }
  }
  return [...byId.values()];
}

export class McpToolsetManager {
  private readonly servers: McpServerConfig[];
  private readonly managed = new Map<string, ManagedServer>();
  private readonly egress: MeshEgressPolicy;
  private readonly env: Record<string, string | undefined>;
  private readonly opts: McpToolsetManagerOptions;
  private started = false;

  constructor(servers: McpServerConfig[], opts: McpToolsetManagerOptions = {}) {
    this.servers = servers;
    this.opts = opts;
    this.egress = opts.egress ?? new MeshEgressPolicy();
    this.env = opts.env ?? process.env;
  }

  static fromRegistries(
    registries: McpRegistryConfig[],
    opts: McpToolsetManagerOptions = {},
  ): McpToolsetManager {
    return new McpToolsetManager(flattenRegistries(registries), opts);
  }

  private emit(type: McpEventType, detail: Record<string, unknown>): void {
    this.opts.onEvent?.(type, detail);
  }

  private buildClientOptions(s: McpServerConfig): McpClientV2Options {
    if (s.transport === "stdio") {
      if (!s.command) {
        throw new Error(`MCP server "${s.id}": stdio transport requires "command"`);
      }
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.env ?? {})) {
        env[k] = resolveEnvTemplate(v, this.env);
      }
      return {
        kind: "stdio",
        command: s.command,
        args: s.args ?? [],
        env,
        startTimeoutMs: this.opts.startTimeoutMs,
        requestTimeoutMs: this.opts.requestTimeoutMs,
      };
    }
    // http / sse → Streamable HTTP transport, gated by egress policy.
    if (!s.url) {
      throw new Error(`MCP server "${s.id}": ${s.transport} transport requires "url"`);
    }
    const url = this.egress.check(s.url).toString();
    const headers: Record<string, string> = {};
    if (s.auth_ref) {
      const token = this.env[s.auth_ref];
      if (token) headers["authorization"] = `Bearer ${token}`;
    }
    return {
      kind: "http",
      url,
      headers,
      requestTimeoutMs: this.opts.requestTimeoutMs,
      // Re-validate redirect targets with the SAME egress policy (incl. allowlist),
      // so a 3xx cannot pivot the request to a blocked internal host.
      validateRedirect: (target: string) => {
        this.egress.check(target);
      },
      // Resolve-time DNS-rebinding guard on the initial request AND every hop
      // (the static policy.check above only blocks IP-literals / known names).
      revalidate: (target: string) => assertResolvedHostSafe(target, this.egress),
    };
  }

  /** Connect every declared server and discover its tools. */
  async start(): Promise<void> {
    for (const s of this.servers) {
      try {
        const client = new McpClientV2(this.buildClientOptions(s));
        await client.start(this.opts.clientInfo);
        let tools = await client.listTools();
        if (s.tool_allowlist?.length) {
          const allow = new Set(s.tool_allowlist);
          tools = tools.filter((t) => allow.has(t.name));
        }
        this.managed.set(s.id, { config: s, client, tools });
        this.emit("mcp_server_started", {
          server: s.id,
          transport: s.transport,
          tools: tools.map((t) => t.name),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("mcp_server_unavailable", { server: s.id, error: message });
        if (this.opts.requireAll) {
          await this.shutdown();
          throw new Error(`MCP server "${s.id}" failed to start: ${message}`);
        }
      }
    }
    this.started = true;
  }

  hasServer(id: string): boolean {
    return this.managed.has(id);
  }

  listServers(): string[] {
    return [...this.managed.keys()];
  }

  listTools(serverId?: string): McpTool[] {
    if (serverId) return this.managed.get(serverId)?.tools ?? [];
    return [...this.managed.values()].flatMap((m) => m.tools);
  }

  /** Original (unresolved) config — used by CLI adapters to wire vendor MCP. */
  getServerConfig(id: string): McpServerConfig | undefined {
    return this.servers.find((s) => s.id === id);
  }

  /**
   * Fully-resolved specs for handing to a vendor CLI's MCP config (Tier 2):
   * env/headers are resolved and http urls pass the egress gate. A server whose
   * http url is blocked is omitted (and surfaced as mcp_server_unavailable).
   */
  getVendorServerSpecs(): VendorMcpServerSpec[] {
    const specs: VendorMcpServerSpec[] = [];
    for (const s of this.servers) {
      try {
        const spec: VendorMcpServerSpec = {
          id: s.id,
          transport: s.transport,
          tools: this.managed.get(s.id)?.tools.map((t) => t.name),
        };
        if (s.transport === "stdio") {
          spec.command = s.command;
          spec.args = s.args ?? [];
          if (s.env) {
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(s.env)) env[k] = resolveEnvTemplate(v, this.env);
            spec.env = env;
          }
        } else {
          spec.url = this.egress.check(s.url ?? "").toString();
          if (s.auth_ref) {
            const token = this.env[s.auth_ref];
            if (token) spec.headers = { authorization: `Bearer ${token}` };
          }
        }
        specs.push(spec);
      } catch (err) {
        this.emit("mcp_server_unavailable", {
          server: s.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return specs;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<McpToolCallResult> {
    const m = this.managed.get(serverId);
    if (!m) {
      throw new Error(
        `MCP server "${serverId}" is not available${this.started ? "" : " (manager not started)"}`,
      );
    }
    if (m.config.tool_allowlist?.length && !m.config.tool_allowlist.includes(toolName)) {
      throw new Error(`Tool "${toolName}" is not allowlisted for MCP server "${serverId}"`);
    }
    this.emit("mcp_tool_call", { server: serverId, tool: toolName });
    try {
      const result = await m.client.callTool(toolName, args, signal);
      this.emit("mcp_tool_result", { server: serverId, tool: toolName, isError: !!result.isError });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("mcp_tool_error", { server: serverId, tool: toolName, error: message });
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.managed.values()].map((m) => m.client.stop().catch(() => {})));
    this.managed.clear();
    this.started = false;
  }
}
