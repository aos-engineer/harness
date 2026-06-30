// ── McpClientV2 (Phase 1 — MCP-inside) ───────────────────────────
//
// A standards-correct MCP client to sit beside the existing mcp-client.ts.
// The original (kept byte-identical for the mempalace path) jumps straight to
// `tools/list` with no `initialize` handshake and is stdio-only. V2 adds:
//   1. the real lifecycle: initialize -> notifications/initialized -> tools/list
//   2. a pluggable transport: stdio (subprocess) OR Streamable HTTP
//   3. tools/call with structured results
//
// We keep V1 untouched so mempalace stays unchanged; new external toolsets use V2.

import { spawn, type ChildProcess } from "node:child_process";
import { readBoundedText } from "./egress-policy";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpClientError";
  }
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
  protocolVersion?: string;
}

// ── Transport abstraction ────────────────────────────────────────

interface Transport {
  start(): Promise<void>;
  /** Send a request and await its result. Throws on JSON-RPC error. The
   *  optional signal cancels the wait (and the in-flight HTTP fetch) so a
   *  caller deadline — e.g. the A2A ingress executor timeout — can abort a
   *  slow tool call instead of orphaning it. */
  request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  /** Fire-and-forget notification (no id, no response). */
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  /** Record the negotiated protocol version (HTTP sends it as a header). */
  setProtocolVersion(version: string): void;
}

export interface StdioTransportOptions {
  kind: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface HttpTransportOptions {
  kind: "http";
  url: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  /**
   * Re-validate a redirect target before following it (the egress gate). Throws
   * to block. Without this, fetch's default redirect:"follow" would let an
   * allowlisted server 3xx-pivot the request to an internal host (SSRF).
   */
  validateRedirect?: (url: string) => void;
  /**
   * Resolve-time SSRF guard run BEFORE every fetch — the initial request AND
   * each redirect hop — so the check is intrinsic to the transport rather than
   * depending on the caller validating the initial URL. Resolves the host and
   * throws if it maps to a private/internal address (DNS-rebinding guard).
   */
  revalidate?: (url: string) => Promise<void> | void;
  /** Max redirects to follow (each re-validated). Default 5. */
  maxRedirects?: number;
  /** Hard cap on a response body in bytes (DoS guard). Default 8 MiB. */
  maxResponseBytes?: number;
}

export type McpClientV2Options = StdioTransportOptions | HttpTransportOptions;

// ── stdio transport (newline-delimited JSON-RPC over stdin/stdout) ──

class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly requestTimeoutMs: number;

  constructor(private readonly opts: StdioTransportOptions) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }

  setProtocolVersion(): void {
    /* stdio framing carries no per-request protocol header */
  }

  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.process = spawn(this.opts.command, this.opts.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: this.opts.env ? { ...process.env, ...this.opts.env } : process.env,
        });
      } catch (e) {
        reject(new McpClientError(`Failed to spawn "${this.opts.command}": ${e}`));
        return;
      }

      this.process.on("error", (err) => reject(new McpClientError(`Process error: ${err.message}`)));
      this.process.on("exit", (code) => {
        for (const [, p] of this.pending) p.reject(new McpClientError(`Process exited with code ${code}`));
        this.pending.clear();
        this.process = null;
      });
      this.process.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString();
        this.drain();
      });

      setTimeout(() => {
        if (this.isRunning()) resolve();
        else reject(new McpClientError("Process exited immediately"));
      }, this.opts.startTimeoutMs ?? 500);
    });
  }

  private drain(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        continue; // non-JSON log line — ignore
      }
      if (typeof msg.id !== "number") continue; // notifications/unknown
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new McpClientError(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.isRunning()) return Promise.reject(new McpClientError("MCP server is not running"));
    if (signal?.aborted) return Promise.reject(new McpClientError(`Request (${method}) aborted`));
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n";
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new McpClientError(`Request ${id} (${method}) timed out`));
      }, this.requestTimeoutMs);
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new McpClientError(`Request ${id} (${method}) aborted`));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(v); },
        reject: (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(e); },
      });
      try {
        this.process!.stdin!.write(body);
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(new McpClientError(`Failed to write to stdin: ${e}`));
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.isRunning()) return Promise.reject(new McpClientError("MCP server is not running"));
    const body = JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n";
    this.process!.stdin!.write(body);
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
    for (const [, p] of this.pending) p.reject(new McpClientError("client stopped"));
    this.pending.clear();
    this.buffer = "";
  }
}

// ── Streamable HTTP transport ────────────────────────────────────

class HttpTransport implements Transport {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private running = false;
  private readonly requestTimeoutMs: number;
  private readonly initialOrigin: string;

  constructor(private readonly opts: HttpTransportOptions) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
    let origin = "";
    try {
      origin = new URL(opts.url).origin;
    } catch {
      /* the URL is egress-validated upstream before we get here */
    }
    this.initialOrigin = origin;
  }

  isRunning(): boolean {
    return this.running;
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  start(): Promise<void> {
    this.running = true;
    return Promise.resolve();
  }

  private headers(targetUrl: string): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.opts.headers ?? {}),
    };
    if (this.sessionId) h["mcp-session-id"] = this.sessionId;
    // 2025-06-18 Streamable HTTP: send the negotiated version on every
    // post-initialize request (unset during the initialize call itself).
    if (this.protocolVersion) h["mcp-protocol-version"] = this.protocolVersion;
    // Never carry credentials across an origin boundary (a redirect pivot).
    try {
      if (new URL(targetUrl).origin !== this.initialOrigin) {
        delete h["authorization"];
        delete h["Authorization"];
      }
    } catch {
      /* unparseable target — the redirect re-validation below will reject it */
    }
    return h;
  }

  private async post(payload: unknown, signal?: AbortSignal): Promise<Response> {
    const body = JSON.stringify(payload);
    const maxRedirects = this.opts.maxRedirects ?? 5;
    let url = this.opts.url;
    for (let hop = 0; ; hop++) {
      if (signal?.aborted) throw new McpClientError("request aborted");
      // Resolve-time SSRF guard on the initial request and every redirect hop
      // (intrinsic to the transport — does not rely on the caller validating
      // the initial URL). Throws to block a private/internal-resolving host.
      await this.opts.revalidate?.(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.requestTimeoutMs);
      // Cancel the fetch on EITHER our per-request timeout OR the caller's
      // signal (e.g. the A2A executor deadline), without losing the timeout.
      const fetchSignal = signal ? AbortSignal.any([ctrl.signal, signal]) : ctrl.signal;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: this.headers(url),
          body,
          signal: fetchSignal,
          redirect: "manual", // re-validate each hop through the egress gate
        });
      } finally {
        clearTimeout(timer);
      }
      const location =
        res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return res;
      if (hop >= maxRedirects) {
        throw new McpClientError(`MCP server exceeded ${maxRedirects} redirects`);
      }
      const next = new URL(location, url).toString();
      // Re-apply the same egress policy to the redirect target (SSRF guard).
      this.opts.validateRedirect?.(next);
      url = next;
    }
  }

  /** Extract the JSON-RPC response for `id` from a JSON body or an SSE stream. */
  private async parse(res: Response, id: number): Promise<JsonRpcResponse> {
    const ct = res.headers.get("content-type") ?? "";
    // Bounded read: a hostile/compromised MCP HTTP server must not be able to
    // OOM the process with an unbounded body (matches the A2A egress cap).
    const text = await readBoundedText(res, this.opts.maxResponseBytes ?? 8 * 1024 * 1024);
    if (ct.includes("text/event-stream")) {
      for (const block of text.split(/\n\n/)) {
        const dataLines = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (!dataLines.length) continue;
        try {
          const msg = JSON.parse(dataLines.join("")) as JsonRpcResponse;
          if (msg.id === id) return msg;
        } catch {
          /* keep scanning */
        }
      }
      throw new McpClientError(`No SSE response found for request ${id}`);
    }
    if (!text.trim()) {
      throw new McpClientError(`Empty body from MCP server for request ${id} (HTTP ${res.status})`);
    }
    try {
      return JSON.parse(text) as JsonRpcResponse;
    } catch {
      throw new McpClientError(`Invalid JSON from MCP server for request ${id} (HTTP ${res.status})`);
    }
  }

  async request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, signal);
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok && res.status !== 200) {
      throw new McpClientError(`HTTP ${res.status} from MCP server for ${method}`);
    }
    const msg = await this.parse(res, id);
    if (msg.error) throw new McpClientError(msg.error.message);
    return msg.result;
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.sessionId = null;
  }
}

// ── McpClientV2 ──────────────────────────────────────────────────

export class McpClientV2 {
  private readonly transport: Transport;
  private initialized = false;
  private serverInfo: McpServerInfo = {};

  constructor(opts: McpClientV2Options) {
    this.transport =
      opts.kind === "stdio" ? new StdioTransport(opts) : new HttpTransport(opts);
  }

  isRunning(): boolean {
    return this.transport.isRunning();
  }

  getServerInfo(): McpServerInfo {
    return this.serverInfo;
  }

  /** Start the transport and perform the MCP initialize handshake. */
  async start(clientInfo: { name: string; version: string } = { name: "aos", version: "0.1.0" }): Promise<void> {
    await this.transport.start();
    const result = (await this.transport.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    })) as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | undefined;
    this.serverInfo = {
      name: result?.serverInfo?.name,
      version: result?.serverInfo?.version,
      protocolVersion: result?.protocolVersion,
    };
    // Record the negotiated version so the HTTP transport sends it on every
    // post-initialize request (stdio ignores it).
    this.transport.setProtocolVersion(result?.protocolVersion ?? MCP_PROTOCOL_VERSION);
    // Per spec the client MUST send `initialized` before any other request.
    await this.transport.notify("notifications/initialized");
    this.initialized = true;
  }

  private ensureReady(): void {
    if (!this.initialized) throw new McpClientError("client not initialized — call start() first");
  }

  async listTools(): Promise<McpTool[]> {
    this.ensureReady();
    const result = (await this.transport.request("tools/list")) as { tools?: McpTool[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<McpToolCallResult> {
    this.ensureReady();
    const result = (await this.transport.request("tools/call", {
      name,
      arguments: args,
    }, signal)) as McpToolCallResult;
    return result;
  }

  async stop(): Promise<void> {
    this.initialized = false;
    await this.transport.stop();
  }
}

/** Flatten an MCP tool result's content blocks into a single text string. */
export function mcpResultToText(result: McpToolCallResult): string {
  if (result.structuredContent !== undefined) {
    return typeof result.structuredContent === "string"
      ? result.structuredContent
      : JSON.stringify(result.structuredContent);
  }
  return (result.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
    .join("\n");
}
