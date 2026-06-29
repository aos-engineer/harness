import { test, expect, describe } from "bun:test";
import { IngressGuard, PerCallerGuard, type IngressGuardOptions } from "../src/ingress-guard";

function clockGuard(opts: Omit<IngressGuardOptions, "now">) {
  let t = 0;
  const g = new IngressGuard({ ...opts, now: () => t });
  return { g, advance: (ms: number) => { t += ms; } };
}

describe("IngressGuard", () => {
  test("concurrency: admits up to maxConcurrent, rejects beyond, frees on complete", () => {
    const { g } = clockGuard({ maxConcurrent: 2, requestsPerWindow: 100, budgetPerWindow: 100 });
    const a = g.tryAcquire();
    const b = g.tryAcquire();
    expect(a.ok && b.ok).toBe(true);

    const c = g.tryAcquire();
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("concurrency");

    if (a.ok) a.lease.complete();
    expect(g.tryAcquire().ok).toBe(true);
  });

  test("rate: rejects past requestsPerWindow, recovers after the window slides", () => {
    const { g, advance } = clockGuard({ maxConcurrent: 100, requestsPerWindow: 3, budgetPerWindow: 100, windowMs: 1000 });
    for (let i = 0; i < 3; i++) {
      const r = g.tryAcquire();
      expect(r.ok).toBe(true);
      if (r.ok) r.lease.complete();
    }
    const over = g.tryAcquire();
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.reason).toBe("rate");
      expect(over.retryAfterMs).toBeGreaterThan(0);
    }
    advance(1001);
    expect(g.tryAcquire().ok).toBe(true);
  });

  test("budget: rejects once cumulative (executor-reported) cost reaches the cap", () => {
    const { g } = clockGuard({ maxConcurrent: 100, requestsPerWindow: 100, budgetPerWindow: 10, windowMs: 1000 });
    const a = g.tryAcquire();
    if (a.ok) a.lease.complete(7);
    const b = g.tryAcquire();
    if (b.ok) b.lease.complete(5); // total now 12 ≥ 10
    const c = g.tryAcquire();
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("budget");
  });

  test("default cost 1: budget acts as a per-window execution cap", () => {
    const { g } = clockGuard({ maxConcurrent: 100, requestsPerWindow: 100, budgetPerWindow: 2, windowMs: 1000 });
    for (let i = 0; i < 2; i++) {
      const r = g.tryAcquire();
      if (r.ok) r.lease.complete();
    }
    const c = g.tryAcquire();
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("budget");
  });

  test("lease.complete is idempotent (double release does not over-free concurrency)", () => {
    const { g } = clockGuard({ maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100 });
    const a = g.tryAcquire();
    if (a.ok) {
      a.lease.complete();
      a.lease.complete(); // double-release is a no-op
    }
    expect(g.stats().inFlight).toBe(0);
    expect(g.tryAcquire().ok).toBe(true); // still only 1 slot
    expect(g.tryAcquire().ok).toBe(false);
  });

  test("stats reflects in-flight, window count, and spend", () => {
    const { g } = clockGuard({ maxConcurrent: 5, requestsPerWindow: 10, budgetPerWindow: 10 });
    const a = g.tryAcquire();
    expect(g.stats().inFlight).toBe(1);
    expect(g.stats().requestsInWindow).toBe(1);
    if (a.ok) a.lease.complete(3);
    expect(g.stats().inFlight).toBe(0);
    expect(g.stats().spentInWindow).toBe(3);
  });

  test("an in-flight request is retained past the window so its cost is not lost", () => {
    const { g, advance } = clockGuard({ maxConcurrent: 5, requestsPerWindow: 100, budgetPerWindow: 100, windowMs: 1000 });
    const a = g.tryAcquire(); // t=0, in-flight (not completed)
    advance(5000); // far past the window
    expect(g.stats().requestsInWindow).toBe(0); // excluded from the rate window (by acquire time)
    expect(g.stats().spentInWindow).toBe(1); // but in-flight cost still counts (not pruned/detached)
    if (a.ok) a.lease.complete(); // now done → pruned on the next sweep
    expect(g.stats().spentInWindow).toBe(0);
  });

  test("concurrency is checked before rate/budget (transient vs windowed)", () => {
    const { g } = clockGuard({ maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100 });
    const a = g.tryAcquire(); // holds the only slot, not completed
    expect(a.ok).toBe(true);
    const b = g.tryAcquire();
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("concurrency");
  });
});

describe("PerCallerGuard", () => {
  test("each caller gets an independent rate bucket (one noisy caller can't starve others)", () => {
    const g = new PerCallerGuard({
      perCaller: { requestsPerWindow: 1, budgetPerWindow: 100, windowMs: 1000 },
      now: () => 0,
    });
    const a1 = g.tryAcquire("alice");
    expect(a1.ok).toBe(true);
    if (a1.ok) a1.lease.complete();

    const a2 = g.tryAcquire("alice"); // alice over her own rate
    expect(a2.ok).toBe(false);
    if (!a2.ok) expect(a2.reason).toBe("rate");

    const b1 = g.tryAcquire("bob"); // bob has his own bucket — unaffected
    expect(b1.ok).toBe(true);
  });

  test("the global backstop caps aggregate load even when each caller has room", () => {
    const g = new PerCallerGuard({
      perCaller: { requestsPerWindow: 5, budgetPerWindow: 100, windowMs: 1000 },
      global: { requestsPerWindow: 2, budgetPerWindow: 100, windowMs: 1000 },
      now: () => 0,
    });
    const a = g.tryAcquire("alice");
    if (a.ok) a.lease.complete();
    const b = g.tryAcquire("bob");
    if (b.ok) b.lease.complete();
    expect(a.ok && b.ok).toBe(true);

    // carol is within her own bucket, but the global rate (2) is used up.
    const c = g.tryAcquire("carol");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("rate");
  });

  test("a global-backstop rejection rolls back the caller reservation (no stuck slot)", () => {
    const g = new PerCallerGuard({
      perCaller: { maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100, windowMs: 1000 },
      global: { maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100, windowMs: 1000 },
      now: () => 0,
    });
    const a = g.tryAcquire("alice"); // holds the single global concurrency slot
    expect(a.ok).toBe(true);

    const b = g.tryAcquire("bob"); // bob's bucket admits, but global concurrency is full
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("concurrency");

    // Free the global slot. If bob's bucket had NOT been rolled back it would
    // still show 1/1 in-flight and reject; a success proves the rollback.
    if (a.ok) a.lease.complete();
    const b2 = g.tryAcquire("bob");
    expect(b2.ok).toBe(true);
  });

  test("missing caller key shares one anonymous bucket", () => {
    const g = new PerCallerGuard({
      perCaller: { requestsPerWindow: 1, budgetPerWindow: 100, windowMs: 1000 },
      now: () => 0,
    });
    const a = g.tryAcquire();
    if (a.ok) a.lease.complete();
    const b = g.tryAcquire(); // same anonymous bucket → over rate
    expect(b.ok).toBe(false);
  });

  test("a flood of distinct caller keys stays memory-bounded (overflow shares a bucket)", () => {
    const g = new PerCallerGuard({
      perCaller: { requestsPerWindow: 100, budgetPerWindow: 100, windowMs: 1000 },
      maxCallers: 4,
      now: () => 0,
    });
    // Many distinct keys, each leaving a window event (so they're non-idle and
    // can't be evicted) — the map must not grow without bound.
    for (let i = 0; i < 50; i++) {
      const r = g.tryAcquire(`caller-${i}`);
      if (r.ok) r.lease.complete();
    }
    expect(g.trackedCallers()).toBeLessThanOrEqual(5); // maxCallers + the shared overflow bucket
  });

  test("the lease releases both the caller and global buckets", () => {
    const g = new PerCallerGuard({
      perCaller: { maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100 },
      global: { maxConcurrent: 1, requestsPerWindow: 100, budgetPerWindow: 100 },
      now: () => 0,
    });
    const a = g.tryAcquire("alice");
    expect(a.ok).toBe(true);
    if (a.ok) a.lease.complete();
    // both buckets freed → alice (and the global) admit again
    expect(g.tryAcquire("alice").ok).toBe(true);
  });
});
