import { test, expect, describe } from "bun:test";
import { handleRequest, isAuthorized, type ServerDeps } from "../../cli/src/paperclip/http";
import type { WakeRequest } from "../../cli/src/paperclip/types";

const TOKEN = "wake-secret-token";

function deps(): { d: ServerDeps; dispatched: WakeRequest[] } {
  const dispatched: WakeRequest[] = [];
  return { d: { wakeToken: TOKEN, dispatch: (w) => dispatched.push(w) }, dispatched };
}

function wakeReq(headers: Record<string, string>, body: unknown = {}): Request {
  return new Request("http://h/paperclip/wake", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("isAuthorized", () => {
  test("accepts a matching bearer token", () => {
    expect(isAuthorized(new Request("http://h/x", { headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN)).toBe(true);
  });
  test("accepts the X-Paperclip-Wake-Token header", () => {
    expect(isAuthorized(new Request("http://h/x", { headers: { "x-paperclip-wake-token": TOKEN } }), TOKEN)).toBe(true);
  });
  test("rejects a wrong token", () => {
    expect(isAuthorized(new Request("http://h/x", { headers: { authorization: "Bearer nope" } }), TOKEN)).toBe(false);
  });
  test("rejects when no token is configured", () => {
    expect(isAuthorized(new Request("http://h/x", { headers: { authorization: "Bearer x" } }), "")).toBe(false);
  });
});

describe("handleRequest", () => {
  test("GET /healthz -> 200 ok", async () => {
    const { d } = deps();
    const res = await handleRequest(new Request("http://h/healthz"), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("POST /paperclip/wake without auth -> 401, no dispatch", async () => {
    const { d, dispatched } = deps();
    const res = await handleRequest(wakeReq({}), d);
    expect(res.status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  test("POST /paperclip/wake with auth -> 202 and dispatches the wake", async () => {
    const { d, dispatched } = deps();
    const res = await handleRequest(
      wakeReq({ authorization: `Bearer ${TOKEN}` }, { runId: "R1", issueId: "I1" }),
      d,
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({ runId: "R1", issueId: "I1" });
  });

  test("POST /paperclip/wake with invalid json -> 400, no dispatch", async () => {
    const { d, dispatched } = deps();
    const req = new Request("http://h/paperclip/wake", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{not json",
    });
    const res = await handleRequest(req, d);
    expect(res.status).toBe(400);
    expect(dispatched).toHaveLength(0);
  });

  test("GET /paperclip/wake -> 405", async () => {
    const { d } = deps();
    const res = await handleRequest(new Request("http://h/paperclip/wake"), d);
    expect(res.status).toBe(405);
  });

  test("POST /paperclip/wake with an oversized body -> 413, no dispatch (INFRA-003)", async () => {
    const { d, dispatched } = deps();
    const big = "x".repeat(1024 * 1024 + 10); // > 1 MiB
    const req = new Request("http://h/paperclip/wake", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ note: big }),
    });
    const res = await handleRequest(req, d);
    expect(res.status).toBe(413);
    expect(dispatched).toHaveLength(0);
  });

  test("unknown path -> 404", async () => {
    const { d } = deps();
    const res = await handleRequest(new Request("http://h/nope"), d);
    expect(res.status).toBe(404);
  });
});

describe("handleRequest — A2A caller key", () => {
  function a2aReq(headers: Record<string, string>): Request {
    return new Request("http://h/a2a", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: {} }),
    });
  }

  test("extracts the caller key from the configured header and passes it to handleRpc", async () => {
    const seen: Array<{ callerKey?: string } | undefined> = [];
    const d: ServerDeps = {
      wakeToken: TOKEN,
      dispatch: () => {},
      a2a: {
        callerKeyHeader: "x-aos-caller",
        agentCard: () => ({}),
        handleRpc: async (_body, ctx) => {
          seen.push(ctx);
          return { ok: true };
        },
      },
    };
    await handleRequest(a2aReq({ "x-aos-caller": "tenant-9" }), d);
    expect(seen[0]).toEqual({ callerKey: "tenant-9" });
  });

  test("caller key is undefined when no header is configured", async () => {
    const seen: Array<{ callerKey?: string } | undefined> = [];
    const d: ServerDeps = {
      wakeToken: TOKEN,
      dispatch: () => {},
      a2a: {
        agentCard: () => ({}),
        handleRpc: async (_body, ctx) => {
          seen.push(ctx);
          return { ok: true };
        },
      },
    };
    await handleRequest(a2aReq({ "x-aos-caller": "tenant-9" }), d);
    expect(seen[0]).toEqual({ callerKey: undefined });
  });

  test("GET /.well-known/jwks.json serves the JWKS when configured", async () => {
    const jwks = { keys: [{ kty: "EC", crv: "P-256", x: "a", y: "b", kid: "k1" }] };
    const d: ServerDeps = {
      wakeToken: TOKEN,
      dispatch: () => {},
      a2a: { agentCard: () => ({}), jwks: () => jwks, handleRpc: async () => ({}) },
    };
    const res = await handleRequest(new Request("http://h/.well-known/jwks.json"), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(jwks);
  });

  test("GET /.well-known/jwks.json → 404 when no JWKS is configured", async () => {
    const d: ServerDeps = {
      wakeToken: TOKEN,
      dispatch: () => {},
      a2a: { agentCard: () => ({}), handleRpc: async () => ({}) },
    };
    const res = await handleRequest(new Request("http://h/.well-known/jwks.json"), d);
    expect(res.status).toBe(404);
  });
});
