// Pure HTTP request handler for the wake server. Kept free of heavy imports
// (no engine, no adapters) so it can be unit-tested in isolation.
//
// Routes:
//   GET  /healthz            -> 200 { status: "ok" }
//   POST /paperclip/wake     -> 202 (authorized) | 401 (not) | 400 (bad json)
//   *                        -> 404
//
// The wake is fire-and-forget: we authenticate, ack 202, and hand the work to
// `dispatch` without awaiting it (Paperclip's contract is "ack the wake; do the
// work, then call back").

import { createHash, timingSafeEqual } from "node:crypto";
import type { WakeRequest } from "./types";

/** Cap inbound bodies (untrusted external callers) — applies to /wake and /a2a. */
const MAX_BODY = 1024 * 1024;

/**
 * Constant-time token comparison. Hashes both sides to a fixed 32-byte digest
 * before `timingSafeEqual`, so neither the secret's bytes nor its length leak
 * through a timing side-channel (CWE-208) — unlike `===`, which short-circuits
 * on the first differing byte.
 */
function tokensEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Read a request body with a hard byte cap on BOTH Content-Length and the
 *  actual decoded bytes (a lying/absent Content-Length is caught too). */
async function readCappedBody(req: Request): Promise<{ text: string } | { tooLarge: true }> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return { tooLarge: true };
  const text = await req.text();
  if (Buffer.byteLength(text, "utf-8") > MAX_BODY) return { tooLarge: true };
  return { text };
}

export interface ServerDeps {
  /** Bearer token (or X-Paperclip-Wake-Token) required on /paperclip/wake. */
  wakeToken: string;
  /** Fire-and-forget dispatch of the heartbeat for a wake. */
  dispatch: (wake: WakeRequest) => void;
  /**
   * Phase 4 (A2A ingress): optional. Structural (not the A2aServer class) so
   * this module stays engine/adapter-free and unit-testable in isolation.
   */
  a2a?: {
    /** Bearer token required on the JSON-RPC endpoint (out-of-band auth). */
    authToken?: string;
    /** JSON-RPC endpoint path. Default "/a2a". */
    path?: string;
    /**
     * Request header carrying the caller identity for per-caller ingress
     * limits (e.g. "x-aos-caller", set by a trusted upstream gateway). When
     * unset, all requests share one bucket (the global-limit behavior).
     */
    callerKeyHeader?: string;
    /** The Agent Card object served at /.well-known/agent-card.json. */
    agentCard: () => unknown;
    /** Optional JWKS ({keys:[…]}) served at /.well-known/jwks.json for `jku`
     *  key discovery — lets clients verify signed cards by published key. */
    jwks?: () => unknown;
    /** Handle one A2A JSON-RPC request body; returns the response object. */
    handleRpc: (body: unknown, ctx?: { callerKey?: string }) => Promise<unknown>;
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
}

export function isAuthorized(req: Request, token: string): boolean {
  if (!token) return false;
  const xToken = req.headers.get("x-paperclip-wake-token") ?? "";
  return tokensEqual(bearerToken(req), token) || tokensEqual(xToken, token);
}

export async function handleRequest(req: Request, deps: ServerDeps): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
    return json(200, { status: "ok" });
  }

  if (url.pathname === "/paperclip/wake") {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!isAuthorized(req, deps.wakeToken)) return json(401, { error: "unauthorized" });

    const read = await readCappedBody(req);
    if ("tooLarge" in read) return json(413, { error: "payload_too_large" });
    let body: WakeRequest = {};
    try {
      body = read.text ? (JSON.parse(read.text) as WakeRequest) : {};
    } catch {
      return json(400, { error: "invalid_json" });
    }

    deps.dispatch(body);
    return json(202, { status: "accepted" });
  }

  // ── A2A ingress (Phase 4) ────────────────────────────────────
  if (deps.a2a) {
    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      return json(200, deps.a2a.agentCard());
    }
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json" && deps.a2a.jwks) {
      return json(200, deps.a2a.jwks());
    }
    if (url.pathname === (deps.a2a.path ?? "/a2a")) {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      if (deps.a2a.authToken && !tokensEqual(bearerToken(req), deps.a2a.authToken)) {
        return json(401, { error: "unauthorized" });
      }
      // Cap inbound bodies (untrusted external callers) on Content-Length AND
      // actual bytes — matches bridge-server's 1 MiB.
      const read = await readCappedBody(req);
      if ("tooLarge" in read) return json(413, { error: "payload_too_large" });
      let body: unknown = {};
      try {
        body = read.text ? JSON.parse(read.text) : {};
      } catch {
        return json(400, { error: "invalid_json" });
      }
      const callerKey = deps.a2a.callerKeyHeader
        ? req.headers.get(deps.a2a.callerKeyHeader) ?? undefined
        : undefined;
      return json(200, await deps.a2a.handleRpc(body, { callerKey }));
    }
  }

  return json(404, { error: "not_found" });
}
