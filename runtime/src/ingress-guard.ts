// ── IngressGuard (Phase 4 — A2A ingress protection) ──────────────
//
// Gates the EXPENSIVE inbound operation (message/send → AgentExecutor, which
// runs a real AOS pass) on three independent limits so a remote caller can't
// flood, bankrupt, or exhaust an A2A-serving deployment:
//   • concurrency — max in-flight executions at once
//   • rate        — max ACCEPTED requests per rolling window
//   • budget      — max cumulative cost per rolling window (the executor may
//                   report an actual cost; otherwise each request costs 1)
//
// Global (per-deployment), deterministic via an injectable clock, and lease-
// based: tryAcquire() reserves a slot and returns a one-shot complete() that
// releases concurrency and records the actual cost. Cheap reads (tasks/get,
// tasks/cancel) are NOT gated.
//
// PerCallerGuard (below) composes this primitive into per-caller fair-share
// limits behind a global backstop, so one noisy caller can't starve the rest.

export type GuardReason = "concurrency" | "rate" | "budget";

export interface GuardStats {
  inFlight: number;
  requestsInWindow: number;
  spentInWindow: number;
}

/** The surface A2aServer depends on — satisfied by both IngressGuard (single
 *  global bucket) and PerCallerGuard (per-caller buckets + global backstop). */
export interface IngressLimiter {
  /** Admit one expensive request, optionally attributed to a caller. */
  tryAcquire(callerKey?: string): GuardDecision;
  stats(): GuardStats;
}

export interface IngressGuardOptions {
  /** Max concurrent in-flight executions. Default 4. */
  maxConcurrent?: number;
  /** Max accepted requests per window. Default 60. */
  requestsPerWindow?: number;
  /** Rolling window length in ms. Default 60_000. */
  windowMs?: number;
  /** Max cumulative cost per window. Default = requestsPerWindow. */
  budgetPerWindow?: number;
  /** Cost charged per request unless the executor reports one. Default 1. */
  defaultCost?: number;
  /** Injectable clock (ms) for deterministic tests. */
  now?: () => number;
}

export interface GuardLease {
  /** Release the concurrency slot and record the actual cost (idempotent). */
  complete(actualCost?: number): void;
}

export type GuardDecision =
  | { ok: true; lease: GuardLease }
  | { ok: false; reason: GuardReason; retryAfterMs: number };

export class GuardRejection extends Error {
  constructor(
    public readonly reason: GuardReason,
    public readonly retryAfterMs: number,
  ) {
    super(`ingress ${reason} limit exceeded`);
    this.name = "GuardRejection";
  }
}

export class IngressGuard implements IngressLimiter {
  private inFlight = 0;
  private readonly events: Array<{ t: number; cost: number; done: boolean }> = [];
  private readonly maxConcurrent: number;
  private readonly requestsPerWindow: number;
  private readonly windowMs: number;
  private readonly budgetPerWindow: number;
  private readonly defaultCost: number;
  private readonly now: () => number;

  constructor(opts: IngressGuardOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 4;
    this.requestsPerWindow = opts.requestsPerWindow ?? 60;
    this.windowMs = opts.windowMs ?? 60_000;
    this.budgetPerWindow = opts.budgetPerWindow ?? this.requestsPerWindow;
    this.defaultCost = opts.defaultCost ?? 1;
    // Monotonic by default so a wall-clock step can't momentarily flush the
    // window or skew retry hints; tests still inject `now`.
    this.now = opts.now ?? (() => performance.now());
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // Drop only events that are BOTH expired AND completed. An in-flight
    // request's event survives until complete() records its real cost on the
    // still-referenced element (never a detached object), and in-flight work
    // keeps counting toward budget. In-flight events are bounded by
    // maxConcurrent (and the executor timeout), so the array stays bounded.
    let i = 0;
    for (const e of this.events) {
      if (e.t > cutoff || !e.done) this.events[i++] = e;
    }
    this.events.length = i;
  }

  private retryAfter(now: number): number {
    const oldest = this.events[0];
    // +1 so the hint points at the first instant the slot is actually free.
    return oldest ? Math.max(1, this.windowMs - (now - oldest.t) + 1) : this.windowMs;
  }

  /** Attempt to admit one expensive request. Concurrency is checked first
   *  (transient), then rate, then budget. A single global bucket ignores the
   *  caller key (it exists only to satisfy the IngressLimiter contract). */
  tryAcquire(_callerKey?: string): GuardDecision {
    const now = this.now();
    this.prune(now);
    const cutoff = now - this.windowMs;

    if (this.inFlight >= this.maxConcurrent) {
      return { ok: false, reason: "concurrency", retryAfterMs: 1000 };
    }
    // Rate counts requests ACCEPTED within the window (by acquire time); an
    // expired-but-still-in-flight event is retained for budget but excluded here.
    const inWindow = this.events.reduce((n, e) => (e.t > cutoff ? n + 1 : n), 0);
    if (inWindow >= this.requestsPerWindow) {
      return { ok: false, reason: "rate", retryAfterMs: this.retryAfter(now) };
    }
    // Budget sums in-window + in-flight cost (in-flight work is actively spending).
    const spent = this.events.reduce((sum, e) => sum + e.cost, 0);
    if (spent >= this.budgetPerWindow) {
      return { ok: false, reason: "budget", retryAfterMs: this.retryAfter(now) };
    }

    const event = { t: now, cost: this.defaultCost, done: false };
    this.events.push(event);
    this.inFlight++;

    let released = false;
    const lease: GuardLease = {
      complete: (actualCost?: number) => {
        if (released) return; // idempotent — double-release is a no-op
        released = true;
        this.inFlight--;
        event.done = true;
        if (typeof actualCost === "number" && actualCost >= 0) event.cost = actualCost;
      },
    };
    return { ok: true, lease };
  }

  /** Snapshot for observability. */
  stats(): GuardStats {
    const now = this.now();
    this.prune(now);
    const cutoff = now - this.windowMs;
    return {
      inFlight: this.inFlight,
      requestsInWindow: this.events.reduce((n, e) => (e.t > cutoff ? n + 1 : n), 0),
      spentInWindow: this.events.reduce((s, e) => s + e.cost, 0),
    };
  }
}

/** Reserved bucket keys: keyless requests share __anon__; overflow (past
 *  maxCallers) shares __overflow__ so a distinct-key flood can't grow memory. */
const OVERFLOW_KEY = "__overflow__";

export interface PerCallerGuardOptions {
  /** Limits applied to EACH caller's own bucket. */
  perCaller: IngressGuardOptions;
  /** Optional aggregate backstop across ALL callers (caps total load so N
   *  callers can't each spend their full per-caller budget at once). */
  global?: IngressGuardOptions;
  /** Hard cap on tracked caller buckets (idle ones are evicted first). Default 4096. */
  maxCallers?: number;
  /** Injectable clock shared by every bucket (deterministic tests). */
  now?: () => number;
}

/**
 * Per-caller fair-share ingress limits. Each distinct caller key gets its own
 * IngressGuard bucket, optionally behind a shared global backstop. A request is
 * admitted only if BOTH the caller's bucket and the global bucket admit it; the
 * returned lease completes both. This stops one noisy caller from exhausting
 * the rate/budget shared by everyone else while still capping aggregate load.
 *
 * Memory is bounded: idle buckets (no in-flight work, empty window) are evicted
 * opportunistically, so the live bucket count tracks ACTIVE callers — itself
 * bounded by the global concurrency/rate limits.
 */
export class PerCallerGuard implements IngressLimiter {
  private readonly buckets = new Map<string, IngressGuard>();
  private readonly global?: IngressGuard;
  private readonly perCaller: IngressGuardOptions;
  private readonly maxCallers: number;
  private readonly now: () => number;
  private lastEvictAt = -Infinity;
  /** Min interval between full idle sweeps — bounds the O(n) eviction cost under
   *  a sustained distinct-key flood (CWE-407). */
  private readonly evictThrottleMs = 1000;

  constructor(opts: PerCallerGuardOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.perCaller = { ...opts.perCaller, now: this.now };
    this.global = opts.global ? new IngressGuard({ ...opts.global, now: this.now }) : undefined;
    this.maxCallers = opts.maxCallers ?? 4096;
  }

  private evictIdle(): void {
    const now = this.now();
    // Throttle: at most one full sweep per evictThrottleMs. Between sweeps an
    // at-capacity guard routes new keys to the overflow bucket (memory stays
    // bounded by maxCallers), so skipping a sweep costs fairness, not safety.
    if (now - this.lastEvictAt < this.evictThrottleMs) return;
    this.lastEvictAt = now;
    for (const [key, g] of this.buckets) {
      const s = g.stats();
      if (s.inFlight === 0 && s.requestsInWindow === 0 && s.spentInWindow === 0) {
        this.buckets.delete(key);
      }
    }
  }

  private bucketFor(key: string): IngressGuard {
    const existing = this.buckets.get(key);
    if (existing) return existing;
    if (this.buckets.size >= this.maxCallers) {
      this.evictIdle();
      if (this.buckets.size >= this.maxCallers) {
        // At capacity with all buckets still active (e.g. a flood of DISTINCT
        // keys, possibly a spoofed caller header). Route the overflow to one
        // shared bucket so memory stays bounded by maxCallers rather than
        // growing per distinct key. Overflow callers lose fairness from each
        // other, but the global backstop still caps aggregate load.
        return this.buckets.get(OVERFLOW_KEY) ?? this.create(OVERFLOW_KEY);
      }
    }
    return this.create(key);
  }

  private create(key: string): IngressGuard {
    const g = new IngressGuard(this.perCaller);
    this.buckets.set(key, g);
    return g;
  }

  /** Number of tracked caller buckets (observability; never exceeds maxCallers + 1). */
  trackedCallers(): number {
    return this.buckets.size;
  }

  /** Missing caller key → a shared "anonymous" bucket (still globally capped). */
  tryAcquire(callerKey?: string): GuardDecision {
    const key = callerKey && callerKey.length ? callerKey : "__anon__";
    const bucket = this.bucketFor(key);

    // Caller bucket first (the tighter, per-tenant limit) — if it rejects we
    // never touch the global bucket, so no rollback is needed.
    const callerDecision = bucket.tryAcquire();
    if (!callerDecision.ok) return callerDecision;
    if (!this.global) return callerDecision;

    const globalDecision = this.global.tryAcquire();
    if (!globalDecision.ok) {
      // Roll back the caller reservation (charge 0); the backstop is the reason.
      callerDecision.lease.complete(0);
      return globalDecision;
    }

    // Admitted by both — the lease must release both (each complete is idempotent).
    return {
      ok: true,
      lease: {
        complete: (actualCost?: number) => {
          callerDecision.lease.complete(actualCost);
          globalDecision.lease.complete(actualCost);
        },
      },
    };
  }

  /** Aggregate snapshot: the global backstop if present, else summed buckets. */
  stats(): GuardStats {
    if (this.global) return this.global.stats();
    const acc: GuardStats = { inFlight: 0, requestsInWindow: 0, spentInWindow: 0 };
    for (const g of this.buckets.values()) {
      const s = g.stats();
      acc.inFlight += s.inFlight;
      acc.requestsInWindow += s.requestsInWindow;
      acc.spentInWindow += s.spentInWindow;
    }
    return acc;
  }
}
