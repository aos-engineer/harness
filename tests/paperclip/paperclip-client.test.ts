import { test, expect, describe } from "bun:test";
import {
  PaperclipClient,
  PaperclipConflictError,
  PaperclipHttpError,
} from "../../cli/src/paperclip/paperclip-client";
import type { PaperclipApiConfig } from "../../cli/src/paperclip/config";

const cfg: PaperclipApiConfig = {
  apiBase: "https://pc.test",
  apiKey: "SECRET-KEY",
  authHeader: "Authorization",
  authScheme: "Bearer",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function recorder(responder: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = (async (input: any, init: any) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PaperclipClient", () => {
  test("getIdentity GETs /api/agents/me with auth header", async () => {
    const { calls, fetchFn } = recorder(() => res(200, { id: "A1", companyId: "C1", budget: null }));
    const client = new PaperclipClient(cfg, fetchFn);
    const id = await client.getIdentity();
    expect(id.id).toBe("A1");
    expect(calls[0].url).toBe("https://pc.test/api/agents/me");
    expect(calls[0].headers["Authorization"]).toBe("Bearer SECRET-KEY");
  });

  test("checkout POSTs with X-Paperclip-Run-Id and agentId/expectedStatuses", async () => {
    const { calls, fetchFn } = recorder(() => res(200, { ok: true }));
    const client = new PaperclipClient(cfg, fetchFn);
    await client.checkout("ISS-1", "RUN-1", "A1");
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe("https://pc.test/api/issues/ISS-1/checkout");
    expect(c.headers["X-Paperclip-Run-Id"]).toBe("RUN-1");
    expect(c.body.agentId).toBe("A1");
    expect(Array.isArray(c.body.expectedStatuses)).toBe(true);
  });

  test("checkout 409 throws PaperclipConflictError (never retried by client)", async () => {
    let n = 0;
    const { fetchFn } = recorder(() => {
      n++;
      return res(409, { error: "conflict" });
    });
    const client = new PaperclipClient(cfg, fetchFn);
    await expect(client.checkout("ISS-1", "RUN-1", "A1")).rejects.toBeInstanceOf(PaperclipConflictError);
    expect(n).toBe(1);
  });

  test("setStatus PATCHes in_review with comment + run id", async () => {
    const { calls, fetchFn } = recorder(() => res(200, {}));
    const client = new PaperclipClient(cfg, fetchFn);
    await client.setStatus("ISS-1", "RUN-1", "in_review", "ready");
    const c = calls[0];
    expect(c.method).toBe("PATCH");
    expect(c.url).toBe("https://pc.test/api/issues/ISS-1");
    expect(c.body).toEqual({ status: "in_review", comment: "ready" });
    expect(c.headers["X-Paperclip-Run-Id"]).toBe("RUN-1");
  });

  test("postComment POSTs the text to /comments", async () => {
    const { calls, fetchFn } = recorder(() => res(201, {}));
    const client = new PaperclipClient(cfg, fetchFn);
    await client.postComment("ISS-1", "RUN-1", "the package");
    expect(calls[0].url).toBe("https://pc.test/api/issues/ISS-1/comments");
    expect(calls[0].body).toEqual({ text: "the package" });
  });

  test("reportCost converts USD to cost_cents", async () => {
    const { calls, fetchFn } = recorder(() => res(201, {}));
    const client = new PaperclipClient(cfg, fetchFn);
    await client.reportCost({ agentId: "A1", companyId: "C1", runId: "RUN-1", costUsd: 0.0234 });
    expect(calls[0].url).toBe("https://pc.test/api/costs");
    expect(calls[0].body.cost_cents).toBe(2);
    expect(calls[0].body.heartbeatRunId).toBe("RUN-1");
  });

  test("reportLiveness PATCHes the heartbeat run", async () => {
    const { calls, fetchFn } = recorder(() => res(200, {}));
    const client = new PaperclipClient(cfg, fetchFn);
    await client.reportLiveness("RUN-1", "completed", "package_in_review");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe("https://pc.test/api/heartbeat-runs/RUN-1");
    expect(calls[0].body.liveness_state).toBe("completed");
  });

  test("getInbox builds the status query and tolerates array or {issues}", async () => {
    const { calls, fetchFn } = recorder((c) =>
      c.url.includes("wrapped") ? res(200, { issues: [{ id: "X" }] }) : res(200, [{ id: "Y" }]),
    );
    const client = new PaperclipClient(cfg, fetchFn);
    const arr = await client.getInbox("C1", "A1");
    expect(arr[0].id).toBe("Y");
    expect(calls[0].url).toContain("assigneeAgentId=A1");
    expect(calls[0].url).toContain("status=todo%2Cin_progress%2Cin_review%2Cblocked");
  });

  test("non-2xx (non-409) throws PaperclipHttpError", async () => {
    const { fetchFn } = recorder(() => res(500, { error: "boom" }));
    const client = new PaperclipClient(cfg, fetchFn);
    await expect(client.getIdentity()).rejects.toBeInstanceOf(PaperclipHttpError);
  });
});
