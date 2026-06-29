// ── A2aTaskStore (Phase 4 — A2A ingress) ─────────────────────────
//
// Holds the A2A Task lifecycle for inbound requests (the stateful piece the
// fire-and-forget wake server lacks) so an external caller can message/send,
// then tasks/get and tasks/cancel by id. In-memory by design for Phase 4;
// durable resubscribe-across-restart is a documented follow-up.
//
// Object-level authorization: each task records the `owner` (caller identity)
// that created it. get()/cancel() can enforce that owner so one caller cannot
// read or cancel another caller's task by guessing its id (IDOR). Tasks created
// without an owner (no caller identity available) are not owner-scoped.

import type { A2aTask, A2aMessage, A2aArtifact, A2aTaskState } from "./a2a-client";
import { A2A_TERMINAL_STATES } from "./a2a-client";

interface TaskMeta {
  owner?: string;
  createdAt: number;
  /** Set when the task first reaches a terminal state (for TTL eviction). */
  terminalAt?: number;
}

export interface A2aTaskStoreOptions {
  /** Hard cap on retained tasks (memory bound). Default 10_000. */
  maxTasks?: number;
  /** Evict terminal tasks older than this many ms. Default 1h. 0 disables TTL. */
  ttlMs?: number;
  /** Injectable clock (ms) for deterministic tests. */
  now?: () => number;
}

export class A2aTaskStore {
  private readonly tasks = new Map<string, A2aTask>();
  private readonly meta = new Map<string, TaskMeta>();
  private readonly maxTasks: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  /** maxTasks bounds memory against a hostile caller spamming message/send. */
  constructor(opts: A2aTaskStoreOptions | number = {}) {
    // Back-compat: a bare number was the old maxTasks positional arg.
    const o = typeof opts === "number" ? { maxTasks: opts } : opts;
    this.maxTasks = o.maxTasks ?? 10_000;
    this.ttlMs = o.ttlMs ?? 3_600_000;
    this.now = o.now ?? (() => Date.now());
  }

  create(opts: { id?: string; contextId?: string; owner?: string } = {}): A2aTask {
    const now = this.now();
    this.evictExpired(now);
    const id = opts.id ?? crypto.randomUUID();
    const task: A2aTask = {
      id,
      contextId: opts.contextId ?? crypto.randomUUID(),
      kind: "task",
      status: { state: "submitted" },
      artifacts: [],
      history: [],
    };
    this.tasks.set(id, task);
    this.meta.set(id, { owner: opts.owner, createdAt: now });
    this.evictOverCap();
    return task;
  }

  /** The owner (caller identity) recorded when the task was created, if any. */
  ownerOf(id: string): string | undefined {
    return this.meta.get(id)?.owner;
  }

  /**
   * Look up a task. When `enforce` is passed, an owner-scoped task is only
   * returned to its owner — a mismatch (or an anonymous requester reaching an
   * owned task) yields undefined, indistinguishable from "not found". Internal
   * callers omit `enforce` to bypass the check.
   */
  get(id: string, enforce?: { owner?: string }): A2aTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (enforce && !this.owns(id, enforce.owner)) return undefined;
    return task;
  }

  list(): A2aTask[] {
    return [...this.tasks.values()];
  }

  setState(id: string, state: A2aTaskState, message?: A2aMessage): A2aTask {
    const task = this.require(id);
    task.status = { state, ...(message ? { message } : {}) };
    if (A2A_TERMINAL_STATES.includes(state)) {
      const m = this.meta.get(id);
      if (m && m.terminalAt === undefined) m.terminalAt = this.now();
    }
    return task;
  }

  addArtifact(id: string, artifact: A2aArtifact): A2aTask {
    const task = this.require(id);
    (task.artifacts ??= []).push(artifact);
    return task;
  }

  /** Cancel a task unless it already reached a terminal state. Owner-enforced
   *  when `enforce` is passed (a mismatch reads as "not found"). */
  cancel(id: string, enforce?: { owner?: string }): A2aTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (enforce && !this.owns(id, enforce.owner)) return undefined;
    if (!A2A_TERMINAL_STATES.includes(task.status.state)) {
      task.status = { state: "canceled" };
      const m = this.meta.get(id);
      if (m && m.terminalAt === undefined) m.terminalAt = this.now();
    }
    return task;
  }

  /** True if the task is not owner-scoped, or `owner` matches its recorded owner. */
  private owns(id: string, owner?: string): boolean {
    const recorded = this.meta.get(id)?.owner;
    if (recorded === undefined) return true; // created without an identity
    return recorded === owner;
  }

  /** TTL sweep: drop terminal tasks whose terminal state is older than ttlMs, so
   *  completed work doesn't occupy a slot indefinitely (and a flood evicts dead
   *  tasks before live ones). */
  private evictExpired(now: number): void {
    if (!this.ttlMs) return;
    const cutoff = now - this.ttlMs;
    for (const [id, m] of this.meta) {
      if (m.terminalAt !== undefined && m.terminalAt < cutoff) this.drop(id);
    }
  }

  /** Count-cap eviction: prefer dropping the oldest TERMINAL task so a flood of
   *  new submissions doesn't evict a caller's still-in-flight work. */
  private evictOverCap(): void {
    while (this.tasks.size > this.maxTasks) {
      let victim: string | undefined;
      for (const [id, m] of this.meta) {
        if (m.terminalAt !== undefined) { victim = id; break; } // oldest terminal
      }
      if (victim === undefined) victim = this.tasks.keys().next().value; // else oldest overall
      if (victim === undefined) break;
      this.drop(victim);
    }
  }

  private drop(id: string): void {
    this.tasks.delete(id);
    this.meta.delete(id);
  }

  private require(id: string): A2aTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`A2A task not found: ${id}`);
    return task;
  }
}
