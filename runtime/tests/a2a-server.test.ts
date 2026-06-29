import { test, expect, describe } from "bun:test";
import { A2aServer, type AgentExecutor } from "../src/a2a-server";
import { IngressGuard, type IngressLimiter } from "../src/ingress-guard";

function makeServer(executor: AgentExecutor): A2aServer {
  return new A2aServer({
    card: { name: "aos", description: "test", skills: [{ id: "s", name: "Skill", tags: ["t"] }] },
    endpointUrl: "https://aos.example.com/a2a",
    executor,
  });
}
const echo: AgentExecutor = async (i) => ({
  artifacts: [{ artifactId: "a", parts: [{ kind: "text", text: `echo: ${i.text}` }] }],
});
const msg = (text: string, taskId?: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "message/send",
  params: { message: { role: "user", parts: [{ kind: "text", text }], ...(taskId ? { taskId } : {}) } },
});

describe("A2aServer", () => {
  test("agentCard advertises the endpoint, protocol, and skills", () => {
    const card = makeServer(echo).agentCard();
    expect(card.url).toBe("https://aos.example.com/a2a");
    expect(card.protocolVersion).toBe("1.0");
    expect(card.skills!.length).toBe(1);
  });

  test("message/send runs the executor → completed task with artifact", async () => {
    const res: any = await makeServer(echo).handle(msg("hi"));
    expect(res.result.status.state).toBe("completed");
    expect(res.result.artifacts[0].parts[0].text).toBe("echo: hi");
  });

  test("tasks/get returns the stored task", async () => {
    const s = makeServer(echo);
    const sent: any = await s.handle(msg("x"));
    const got: any = await s.handle({ id: 2, method: "tasks/get", params: { id: sent.result.id } });
    expect(got.result.id).toBe(sent.result.id);
  });

  test("tasks/cancel on a completed task leaves it completed", async () => {
    const s = makeServer(echo);
    const sent: any = await s.handle(msg("x"));
    const cancelled: any = await s.handle({ id: 2, method: "tasks/cancel", params: { id: sent.result.id } });
    expect(cancelled.result.status.state).toBe("completed");
  });

  test("executor failure becomes a failed task; detail goes to onError, not the peer", async () => {
    const boom: AgentExecutor = async () => {
      throw new Error("kaboom");
    };
    const seen: unknown[] = [];
    const s = new A2aServer({
      card: { name: "aos", skills: [] },
      endpointUrl: "https://x/a2a",
      executor: boom,
      onError: (e) => seen.push(e),
    });
    const res: any = await s.handle(msg("x"));
    expect(res.result.status.state).toBe("failed");
    // Peer gets a generic message — no internal exception text leaks (CWE-209).
    expect(res.result.status.message.parts[0].text).toBe("execution failed");
    expect(res.result.status.message.parts[0].text).not.toContain("kaboom");
    // But the real detail is delivered server-side via onError.
    expect((seen[0] as Error).message).toBe("kaboom");
  });

  test("tasks/get and tasks/cancel are owner-scoped (IDOR / AUTH-001)", async () => {
    const s = makeServer(echo);
    // Caller A creates a task.
    const sent: any = await s.handle(msg("x"), { callerKey: "alice" });
    const taskId = sent.result.id;

    // Caller B cannot read it — resolves to "not found" (-32602), indistinguishable.
    const bGet: any = await s.handle({ id: 2, method: "tasks/get", params: { id: taskId } }, { callerKey: "mallory" });
    expect(bGet.error.code).toBe(-32602);
    expect(bGet.result).toBeUndefined();

    // Caller B cannot cancel it either, and the task is NOT canceled.
    const bCancel: any = await s.handle({ id: 3, method: "tasks/cancel", params: { id: taskId } }, { callerKey: "mallory" });
    expect(bCancel.error.code).toBe(-32602);
    const aStill: any = await s.handle({ id: 4, method: "tasks/get", params: { id: taskId } }, { callerKey: "alice" });
    expect(aStill.result.id).toBe(taskId);
    expect(aStill.result.status.state).not.toBe("canceled");
  });

  test("a caller cannot continue another caller's task (continuation starts fresh)", async () => {
    const s = makeServer(echo);
    const sent: any = await s.handle(msg("x"), { callerKey: "alice" });
    const aId = sent.result.id;
    // Mallory references Alice's taskId — gets a brand-new task, not Alice's.
    const cont: any = await s.handle(msg("y", aId), { callerKey: "mallory" });
    expect(cont.result.id).not.toBe(aId);
  });

  test("tasks with no caller identity stay accessible (back-compat, not owner-scoped)", async () => {
    const s = makeServer(echo);
    const sent: any = await s.handle(msg("x")); // no callerKey
    const got: any = await s.handle({ id: 2, method: "tasks/get", params: { id: sent.result.id } });
    expect(got.result.id).toBe(sent.result.id);
  });

  test("unknown method → JSON-RPC -32601", async () => {
    const res: any = await makeServer(echo).handle({ id: 1, method: "frobnicate" });
    expect(res.error.code).toBe(-32601);
  });

  test("invalid message params → JSON-RPC error", async () => {
    const res: any = await makeServer(echo).handle({ id: 1, method: "message/send", params: {} });
    expect(res.error).toBeDefined();
  });

  test("the ingress guard limits message/send; cheap reads are not gated", async () => {
    const guard = new IngressGuard({ requestsPerWindow: 1, windowMs: 60_000, now: () => 0 });
    const s = new A2aServer({
      card: { name: "aos", skills: [] },
      endpointUrl: "https://x/a2a",
      executor: echo,
      guard,
    });
    const first: any = await s.handle(msg("a"));
    expect(first.result.status.state).toBe("completed");

    const second: any = await s.handle(msg("b")); // over the rate limit
    expect(second.error.code).toBe(-32000);
    expect(second.error.data.reason).toBe("rate");
    expect(second.error.data.retryAfterMs).toBeGreaterThan(0);

    // a cheap read is NOT gated by the guard
    const got: any = await s.handle({ id: 9, method: "tasks/get", params: { id: first.result.id } });
    expect(got.result.id).toBe(first.result.id);
  });

  test("message/send forwards the caller key to the guard (per-caller limits)", async () => {
    const seen: Array<string | undefined> = [];
    const guard: IngressLimiter = {
      tryAcquire: (callerKey) => {
        seen.push(callerKey);
        return { ok: true, lease: { complete() {} } };
      },
      stats: () => ({ inFlight: 0, requestsInWindow: 0, spentInWindow: 0 }),
    };
    const s = new A2aServer({ card: { name: "aos", skills: [] }, endpointUrl: "https://x/a2a", executor: echo, guard });
    await s.handle(msg("a"), { callerKey: "tenant-7" });
    expect(seen).toEqual(["tenant-7"]);
  });

  test("the guard concurrency slot is released even when the executor throws", async () => {
    const guard = new IngressGuard({ maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100, now: () => 0 });
    const boom: AgentExecutor = async () => {
      throw new Error("kaboom");
    };
    const s = new A2aServer({ card: { name: "aos", skills: [] }, endpointUrl: "https://x/a2a", executor: boom, guard });
    const first: any = await s.handle(msg("a"));
    expect(first.result.status.state).toBe("failed"); // executor threw → failed task
    expect(guard.stats().inFlight).toBe(0); // slot freed despite the throw
    const second: any = await s.handle(msg("b")); // not blocked by a leaked slot
    expect(second.result).toBeDefined();
  });

  test("executor timeout aborts input.signal so a honoring executor can cancel", async () => {
    let aborted = false;
    const honoring: AgentExecutor = (input) =>
      new Promise((resolve) => {
        input.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({ artifacts: [] });
        });
      });
    const s = new A2aServer({
      card: { name: "aos", skills: [] },
      endpointUrl: "https://x/a2a",
      executor: honoring,
      executorTimeoutMs: 20,
    });
    const res: any = await s.handle(msg("a"));
    expect(res.result.status.state).toBe("failed"); // deadline → failed task
    expect(aborted).toBe(true); // the executor's input.signal fired, enabling cancellation
  });

  test("a hung executor times out: task fails and the concurrency slot is freed", async () => {
    const guard = new IngressGuard({ maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100, now: () => 0 });
    const hung: AgentExecutor = () => new Promise(() => {}); // never settles
    const s = new A2aServer({
      card: { name: "aos", skills: [] },
      endpointUrl: "https://x/a2a",
      executor: hung,
      guard,
      executorTimeoutMs: 30,
    });
    const res: any = await s.handle(msg("a"));
    expect(res.result.status.state).toBe("failed");
    // Generic peer message (the timeout detail does not leak to the caller).
    expect(res.result.status.message.parts[0].text).toBe("execution failed");
    expect(guard.stats().inFlight).toBe(0); // slot freed despite the hang
    const second: any = await s.handle(msg("b")); // pool not permanently exhausted
    expect(second.result).toBeDefined();
  });
});
