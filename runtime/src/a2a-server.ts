// ── A2aServer (Phase 4 — A2A ingress) ────────────────────────────
//
// Turns an AOS assembly into a first-class A2A agent. A PURE request→response
// JSON-RPC handler (no HTTP, no engine) so it is trivially testable and so the
// HTTP layer (cli/src/paperclip/http.ts) can stay dependency-light: it just
// calls agentCard() and handle(body).
//
//   message/send → create/continue a Task, run the injected AgentExecutor
//                  (which runs the actual AOS execution pass), collapse its
//                  output into Artifacts, return the Task.
//   tasks/get    → return the stored Task by id
//   tasks/cancel → cancel it (unless already terminal)
//
// The executor is injected so the engine wiring lives in the cli/deployment
// layer; here we only own the protocol + task lifecycle.

import type { KeyObject } from "node:crypto";
import type { A2aTask, A2aMessage, A2aArtifact, A2aPart, AgentCard, A2aTaskState } from "./a2a-client";
import { A2aTaskStore } from "./a2a-task-store";
import { signAgentCard } from "./agent-card-signer";
import type { JwsAlg } from "./jws";
import { GuardRejection, type IngressLimiter, type GuardLease } from "./ingress-guard";

export interface AgentExecutorInput {
  text: string;
  message: A2aMessage;
  taskId: string;
  contextId: string;
  /** Aborted when the executor deadline (executorTimeoutMs) elapses, so an
   *  executor that honors it can cancel the underlying AOS/LLM/MCP work. */
  signal?: AbortSignal;
}

export interface AgentExecutorResult {
  artifacts?: A2aArtifact[];
  /** Optional final agent message (e.g. a prompt for input-required). */
  message?: A2aMessage;
  /** Terminal/pause state to set. Default "completed". */
  state?: Extract<A2aTaskState, "completed" | "failed" | "input-required" | "rejected">;
  /** Optional cost charged to the ingress budget guard (default 1 per request). */
  cost?: number;
}

export type AgentExecutor = (input: AgentExecutorInput) => Promise<AgentExecutorResult>;

export interface A2aServerCard {
  name: string;
  description?: string;
  version?: string;
  // AgentSkill: tags is a required field in the A2A spec — always emit it.
  skills?: Array<{ id: string; name: string; description?: string; tags: string[] }>;
}

export interface A2aServerOptions {
  card: A2aServerCard;
  /** Public JSON-RPC endpoint URL advertised in the Agent Card. */
  endpointUrl: string;
  executor: AgentExecutor;
  store?: A2aTaskStore;
  /** When set, the served Agent Card is JWS-signed so clients can verify identity.
   *  `jku` advertises a JWKS URL in the signature header for key discovery. */
  signing?: { privateKey: KeyObject; alg?: JwsAlg; kid?: string; jku?: string };
  /** Optional rate/budget/concurrency guard applied to message/send. May be a
   *  single global IngressGuard or a PerCallerGuard (per-caller fair-share). */
  guard?: IngressLimiter;
  /**
   * Max ms to await the executor before failing the task and releasing the
   * concurrency slot (a hung executor must not leak its slot). The orphaned
   * work may continue unless the executor honors input.signal. 0/undefined =
   * no deadline. The `aos serve` entrypoint sets a default.
   */
  executorTimeoutMs?: number;
  /**
   * Server-side error sink. Internal exception detail is sent here (for operator
   * logs) instead of to the remote caller, who receives only a generic message
   * — avoids leaking filesystem paths / internal detail (CWE-209). Default: drop.
   */
  onError?: (err: unknown, ctx: { method?: string; taskId?: string }) => void;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: any;
}

/** A task id resolved to nothing the caller may access (missing OR owned by
 *  another caller — the two are deliberately indistinguishable, so a caller
 *  can't probe for the existence of another caller's task). */
class NotFoundError extends Error {
  constructor() {
    super("task not found");
    this.name = "NotFoundError";
  }
}

function textOf(parts: A2aPart[] | undefined): string {
  return (parts ?? [])
    .filter((p) => p.kind === "text")
    .map((p) => p.text ?? "")
    .join("\n");
}

export class A2aServer {
  private readonly store: A2aTaskStore;

  constructor(private readonly opts: A2aServerOptions) {
    this.store = opts.store ?? new A2aTaskStore();
  }

  /** The Agent Card served at /.well-known/agent-card.json (JWS-signed if configured). */
  agentCard(): AgentCard {
    const card: AgentCard = {
      name: this.opts.card.name,
      description: this.opts.card.description,
      url: this.opts.endpointUrl,
      version: this.opts.card.version ?? "0.10.0",
      protocolVersion: "1.0",
      capabilities: { streaming: false, pushNotifications: false },
      skills: this.opts.card.skills ?? [],
      preferredTransport: "JSONRPC",
    };
    return this.opts.signing ? signAgentCard(card, this.opts.signing) : card;
  }

  /** Handle one A2A JSON-RPC request body; returns the JSON-RPC response.
   *  `ctx.callerKey` (derived out-of-band, e.g. from a gateway-set header)
   *  attributes the request to a caller for per-caller ingress limits. */
  async handle(body: unknown, ctx?: { callerKey?: string }): Promise<unknown> {
    const req = (body ?? {}) as JsonRpcRequest;
    const id = req.id ?? null;
    try {
      switch (req.method) {
        case "message/send":
          return this.ok(id, await this.onMessageSend(req.params, ctx?.callerKey));
        case "tasks/get":
          return this.ok(id, this.onTasksGet(req.params, ctx?.callerKey));
        case "tasks/cancel":
          return this.ok(id, this.onTasksCancel(req.params, ctx?.callerKey));
        default:
          return this.err(id, -32601, `method not found: ${req.method}`);
      }
    } catch (e) {
      if (e instanceof GuardRejection) {
        // -32000: implementation-defined server error (resource limit). The
        // message is intentional/safe ("ingress <reason> limit exceeded").
        return this.err(id, -32000, e.message, { reason: e.reason, retryAfterMs: e.retryAfterMs });
      }
      if (e instanceof NotFoundError) {
        // Safe, intentional message (no internal detail) — surfaces task-not-found.
        return this.err(id, -32602, e.message);
      }
      // Anything else: log server-side, return a generic message (no leak).
      this.opts.onError?.(e, { method: req.method });
      return this.err(id, -32603, "internal error");
    }
  }

  private ok(id: unknown, result: unknown) {
    return { jsonrpc: "2.0", id, result };
  }
  private err(id: unknown, code: number, message: string, data?: unknown) {
    return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
  }

  /** Run the executor with an optional deadline; on timeout, abort the signal
   *  and reject so the caller fails the task and releases the concurrency slot. */
  private runExecutor(input: AgentExecutorInput): Promise<AgentExecutorResult> {
    const ms = this.opts.executorTimeoutMs;
    if (!ms || ms <= 0) return this.opts.executor(input);
    const ctrl = new AbortController();
    input.signal = ctrl.signal;
    return new Promise<AgentExecutorResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        ctrl.abort();
        reject(new Error(`executor timed out after ${ms}ms`));
      }, ms);
      this.opts.executor(input).then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  private async onMessageSend(params: any, callerKey?: string): Promise<A2aTask> {
    const message: A2aMessage = params?.message;
    if (!message || !Array.isArray(message.parts)) {
      throw new Error("invalid params: message.parts is required");
    }

    // Gate the expensive path BEFORE creating a task. A rejected request
    // produces a JSON-RPC error (no task) — the caller backs off per retryAfterMs.
    let lease: GuardLease | undefined;
    if (this.opts.guard) {
      const decision = this.opts.guard.tryAcquire(callerKey);
      if (!decision.ok) throw new GuardRejection(decision.reason, decision.retryAfterMs);
      lease = decision.lease;
    }

    // Outer try/finally covers task creation too, so the concurrency slot is
    // ALWAYS released once acquired — even if store/setState throws.
    let charged: number | undefined;
    try {
      // Continuation is owner-scoped: a caller can only continue its OWN task.
      // An id that resolves to another caller's task (or none) starts fresh
      // rather than hijacking it.
      const existing = message.taskId
        ? this.store.get(message.taskId, { owner: callerKey })
        : undefined;
      const task = existing ?? this.store.create({ contextId: message.contextId, owner: callerKey });
      this.store.setState(task.id, "working");
      try {
        const result = await this.runExecutor({
          text: textOf(message.parts),
          message,
          taskId: task.id,
          contextId: task.contextId!,
        });
        for (const artifact of result.artifacts ?? []) this.store.addArtifact(task.id, artifact);
        this.store.setState(task.id, result.state ?? "completed", result.message);
        charged = result.cost;
      } catch (e) {
        // Log detail server-side; the peer sees only a generic failure (no leak).
        this.opts.onError?.(e, { method: "message/send", taskId: task.id });
        this.store.setState(task.id, "failed", {
          role: "agent",
          parts: [{ kind: "text", text: "execution failed" }],
        });
      }
      return this.store.get(task.id)!;
    } finally {
      lease?.complete(charged); // release concurrency + record actual cost
    }
  }

  private onTasksGet(params: any, callerKey?: string): A2aTask {
    const task = this.store.get(params?.id, { owner: callerKey });
    if (!task) throw new NotFoundError();
    return task;
  }

  private onTasksCancel(params: any, callerKey?: string): A2aTask {
    const task = this.store.cancel(params?.id, { owner: callerKey });
    if (!task) throw new NotFoundError();
    return task;
  }
}
