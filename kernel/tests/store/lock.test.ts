import { beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { withLock } from "../../src/store/lock.ts";
import { LockTimeoutError } from "../../src/util/errors.ts";
import { tmpDir } from "../helpers.ts";

let dir: string;
let p: string;

beforeEach(() => {
  dir = tmpDir("aos-lock-");
  p = join(dir, "log.lock");
});

// Writes a lock body as another holder would, so each test controls pid and age.
function writeLock(path: string, body: { pid: number; ts?: number; host?: string }): void {
  const full = { pid: body.pid, host: body.host ?? hostname(), ts: body.ts ?? Date.now(), nonce: "test-holder" };
  writeFileSync(path, JSON.stringify(full));
}

test("runs fn and removes the lock file", () => {
  expect(withLock(p, () => 1)).toBe(1);
  expect(existsSync(p)).toBe(false);
});

test("breaks a lock held by a dead pid", () => {
  writeLock(p, { pid: 2 ** 22 + 7 });
  expect(withLock(p, () => "ok")).toBe("ok");
});

test("breaks a lock older than staleMs", () => {
  writeLock(p, { pid: process.pid, ts: Date.now() - 60_000 });
  expect(withLock(p, () => 1, { staleMs: 30_000 })).toBe(1);
});

test("times out on a live, fresh holder", () => {
  writeLock(p, { pid: process.pid, ts: Date.now() });
  expect(() => withLock(p, () => 1, { timeoutMs: 100 })).toThrow(LockTimeoutError);
  expect(existsSync(p)).toBe(true);
});

test("releases the lock when fn throws", () => {
  expect(() => withLock(p, () => { throw new Error("x"); })).toThrow("x");
  expect(existsSync(p)).toBe(false);
});

test("a dead pid on another host is not trusted; only age breaks it", () => {
  writeLock(p, { pid: 2 ** 22 + 7, host: "some-other-host" });
  expect(() => withLock(p, () => 1, { timeoutMs: 100 })).toThrow(LockTimeoutError);
});

test("an empty lock body counts as a fresh holder until it ages out", () => {
  writeFileSync(p, "");
  expect(() => withLock(p, () => 1, { timeoutMs: 100 })).toThrow(LockTimeoutError);
});

test("does not remove a lock another holder took over", () => {
  withLock(p, () => writeLock(p, { pid: process.pid }));
  expect(existsSync(p)).toBe(true);
});

test("breaking a stale lock leaves no stray files behind", () => {
  writeLock(p, { pid: 2 ** 22 + 7 });
  withLock(p, () => 1);
  expect(readdirSync(dir)).toEqual([]);
});

test("stillHeld is true while the lock carries our nonce and false once another holder takes it", () => {
  const seen = withLock(p, (stillHeld) => {
    const before = stillHeld();
    writeLock(p, { pid: process.pid });
    return [before, stillHeld()];
  });
  expect(seen).toEqual([true, false]);
});

test("stillHeld is false once the lock file is gone", () => {
  expect(withLock(p, (stillHeld) => { rmSync(p); return stillHeld(); })).toBe(false);
});

test("a marker left by a breaker that died is cleared at once, and the stale lock still breaks", () => {
  writeLock(`${p}.break`, { pid: 2 ** 22 + 7 });
  writeLock(p, { pid: 2 ** 22 + 7 });
  expect(withLock(p, () => "ok", { timeoutMs: 500 })).toBe("ok");
  expect(readdirSync(dir)).toEqual([]);
});

test("a live breaker's marker is left alone", () => {
  writeLock(`${p}.break`, { pid: process.pid });
  const marker = readFileSync(`${p}.break`, "utf8");
  writeLock(p, { pid: 2 ** 22 + 7 });
  expect(() => withLock(p, () => 1, { timeoutMs: 100 })).toThrow(LockTimeoutError);
  expect(readFileSync(`${p}.break`, "utf8")).toBe(marker);
});

test("an empty lock body older than staleMs is broken", () => {
  writeFileSync(p, "");
  const old = new Date(Date.now() - 60_000);
  utimesSync(p, old, old);
  expect(withLock(p, () => 1, { staleMs: 30_000, timeoutMs: 500 })).toBe(1);
});
