// Minimal A2A v1.0 JSON-RPC agent for tests. Serves an Agent Card at the
// well-known path and a /rpc endpoint handling message/send, tasks/get,
// tasks/cancel. Not a test file (no *.test.ts suffix).

export interface MockA2aOptions {
  /** completed (default) | slow (working→poll→completed) | fail | ask | unknown | huge */
  mode?: "complete" | "slow" | "fail" | "ask" | "unknown" | "huge";
  /** If set, every request 307-redirects here (for SSRF tests). */
  redirectTo?: string;
  /** Bytes for the "huge" mode body (DoS-cap test). */
  hugeBytes?: number;
}

function rpc(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function taskObj(id: string, state: string, o: { artifact?: string; msg?: string } = {}): any {
  const t: any = { id, contextId: "c1", kind: "task", status: { state } };
  if (o.msg) t.status.message = { role: "agent", parts: [{ kind: "text", text: o.msg }] };
  if (o.artifact) t.artifacts = [{ artifactId: "a1", parts: [{ kind: "text", text: o.artifact }] }];
  return t;
}

export function startMockA2aAgent(opts: MockA2aOptions = {}) {
  const mode = opts.mode ?? "complete";
  const seen: any[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req, srv) {
      if (opts.redirectTo) {
        return new Response(null, { status: 307, headers: { location: opts.redirectTo } });
      }
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/agent-card.json") {
        return Response.json({
          name: "mock-peer",
          description: "test peer",
          url: `http://localhost:${srv.port}/rpc`,
          version: "1.0.0",
          protocolVersion: "1.0",
          capabilities: {},
        });
      }
      if (url.pathname === "/rpc") {
        const body = (await req.json()) as any;
        seen.push(body);
        const id = body.id;
        if (body.method === "message/send") {
          if (mode === "fail") return rpc(id, taskObj("t1", "failed", { msg: "boom" }));
          if (mode === "ask") return rpc(id, taskObj("t1", "input-required", { msg: "what is your name?" }));
          if (mode === "slow") return rpc(id, taskObj("t1", "working"));
          if (mode === "unknown") return rpc(id, taskObj("t1", "unknown", { artifact: "indeterminate" }));
          if (mode === "huge") {
            const big = "x".repeat(opts.hugeBytes ?? 2_000_000);
            return rpc(id, taskObj("t1", "completed", { artifact: big }));
          }
          return rpc(id, taskObj("t1", "completed", { artifact: "the answer is 42" }));
        }
        if (body.method === "tasks/get") {
          return rpc(id, taskObj("t1", "completed", { artifact: "the answer is 42" }));
        }
        if (body.method === "tasks/cancel") {
          return rpc(id, { id: "t1", status: { state: "canceled" } });
        }
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    server,
    cardUrl: `http://localhost:${server.port}`,
    seen,
    stop: () => server.stop(true),
  };
}
