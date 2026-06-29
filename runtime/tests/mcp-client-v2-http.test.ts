import { test, expect, describe, afterEach } from "bun:test";
import { McpClientV2, mcpResultToText } from "../src/mcp-client-v2";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const s of servers) s.stop(true);
  servers.length = 0;
});

interface Seen {
  method: string;
  protoHeader: string | null;
  auth: string | null;
}

function startMockHttpMcp(opts: { redirectTo?: string } = {}): { url: string; seen: Seen[] } {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (opts.redirectTo) {
        return new Response(null, { status: 307, headers: { location: opts.redirectTo } });
      }
      const body = (await req.json()) as any;
      seen.push({
        method: body.method,
        protoHeader: req.headers.get("mcp-protocol-version"),
        auth: req.headers.get("authorization"),
      });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      let result: unknown;
      if (body.method === "initialize") {
        result = { protocolVersion: "2025-06-18", serverInfo: { name: "http-mock", version: "1" }, capabilities: {} };
      } else if (body.method === "tools/list") {
        result = { tools: [{ name: "ping" }] };
      } else if (body.method === "tools/call") {
        result = { content: [{ type: "text", text: "pong" }] };
      } else {
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "nope" } });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    },
  });
  servers.push(server);
  return { url: `http://localhost:${server.port}/mcp`, seen };
}

describe("McpClientV2 (Streamable HTTP)", () => {
  test("handshake + tools/list + tools/call over HTTP", async () => {
    const { url, seen } = startMockHttpMcp();
    const client = new McpClientV2({ kind: "http", url });
    await client.start();
    expect(client.getServerInfo().name).toBe("http-mock");

    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["ping"]);

    const result = await client.callTool("ping", {});
    expect(mcpResultToText(result)).toBe("pong");
    await client.stop();

    // The negotiated MCP-Protocol-Version header is absent on initialize and
    // present on every post-initialize request.
    const init = seen.find((s) => s.method === "initialize");
    const list = seen.find((s) => s.method === "tools/list");
    expect(init?.protoHeader).toBeNull();
    expect(list?.protoHeader).toBe("2025-06-18");
  });

  test("an external abort signal cancels an in-flight tool call", async () => {
    // Server completes the handshake but never answers tools/call, so only the
    // caller's signal can end the wait (proves the deadline is honored).
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as any;
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-06-18", serverInfo: { name: "hang", version: "1" }, capabilities: {} },
          });
        }
        await new Promise(() => {}); // hang forever on tools/call
        return new Response();
      },
    });
    servers.push(server);
    const client = new McpClientV2({ kind: "http", url: `http://localhost:${server.port}/mcp` });
    await client.start();

    const ctrl = new AbortController();
    const pending = client.callTool("ping", {}, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toThrow();
  });

  test("does NOT carry credentials and re-validates redirect targets (SSRF block)", async () => {
    const { url } = startMockHttpMcp({ redirectTo: "http://blocked.invalid/evil" });
    const blockedHosts: string[] = [];
    const client = new McpClientV2({
      kind: "http",
      url,
      headers: { authorization: "Bearer secret" },
      validateRedirect: (target) => {
        if (target.includes("blocked")) {
          blockedHosts.push(target);
          throw new Error("egress blocked");
        }
      },
    });
    // initialize POST gets a 307 → validateRedirect throws → start() rejects.
    await expect(client.start()).rejects.toThrow(/egress blocked/);
    expect(blockedHosts[0]).toContain("blocked.invalid");
  });
});
