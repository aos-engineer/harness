// A cross-process lock built on an exclusive-create lockfile. Node and Bun expose no flock, and the
// writers of one run log are separate short-lived processes (hooks, the MCP server, the CLI), so the
// lock has to live on disk.
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { LockTimeoutError } from "../util/errors.ts";

// Claude Code gives each hook 15 s, and a hook can take the lock twice, so two full waits and the hook's
// own work still fit. Contending writers on a slow CI runner needed more than the earlier 3 s.
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 30_000;

interface LockBody { pid: number; host: string; ts: number; nonce: string }

/** What a waiter sees at the lock path. `raw` and `ino` identify this exact lock file. */
interface Holder { body: LockBody | null; raw: string; ino: number; ageMs: number }

const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms: number): void {
  Atomics.wait(sleeper, 0, 0, ms);
}

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code;
}

function parseBody(raw: string): LockBody | null {
  try {
    const b = JSON.parse(raw) as Partial<LockBody> | null;
    if (b && typeof b.pid === "number" && typeof b.host === "string" && typeof b.ts === "number" && typeof b.nonce === "string") {
      return { pid: b.pid, host: b.host, ts: b.ts, nonce: b.nonce };
    }
  } catch {
    // An empty or partial body: the holder is between create and write, or crashed there.
  }
  return null;
}

/** Null when the lock vanished between our failed create and this read. */
function inspect(lockPath: string): Holder | null {
  try {
    const st = statSync(lockPath);
    const raw = readFileSync(lockPath, "utf8");
    const body = parseBody(raw);
    // Without a readable body the file's mtime is the only age signal.
    const ts = body ? body.ts : st.mtimeMs;
    return { body, raw, ino: st.ino, ageMs: Date.now() - ts };
  } catch (e) {
    if (errCode(e) === "ENOENT") return null;
    throw e;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return errCode(e) !== "ESRCH";
  }
}

function isStale(h: Holder, staleMs: number): boolean {
  if (h.ageMs > staleMs) return true;
  // A pid only means something on the host that wrote it, and "the same host" is judged by hostname alone.
  // Containers that share a hostname but not a pid namespace must not share a repo: each would see the
  // other's live holders as dead and break their locks.
  return h.body !== null && h.body.host === hostname() && !pidAlive(h.body.pid);
}

function newBody(): LockBody {
  return { pid: process.pid, host: hostname(), ts: Date.now(), nonce: randomBytes(8).toString("hex") };
}

function sameFile(a: Holder, b: Holder): boolean {
  return a.ino === b.ino && a.raw === b.raw;
}

/**
 * Removes the lock only if it is still the exact file judged stale. A bare unlink or rename by path could
 * remove a lock that another waiter broke and re-acquired a moment earlier, so breakers serialize on a
 * short-lived marker and re-judge the lock under it. Returns true when the stale lock is gone.
 */
function breakStale(lockPath: string, judged: Holder, staleMs: number): boolean {
  const marker = `${lockPath}.break`;
  const mine = newBody();
  if (!tryCreate(marker, mine)) {
    // A breaker that died inside its brief window leaves its marker behind. It is judged by the same rules as
    // a lock and removed only if it is still that marker, not one a newer breaker created since. A newer
    // marker created between the final identity check and the removal is the residual race.
    const other = inspect(marker);
    if (other !== null && isStale(other, staleMs)) {
      const again = inspect(marker);
      if (again !== null && sameFile(again, other)) rmSync(marker, { force: true });
    }
    return false;
  }
  try {
    const now = inspect(lockPath);
    if (now === null) return true;
    // Identity alone is not enough: an empty body on a reused inode looks the same as the stale lock, so the
    // staleness verdict is re-run here too.
    if (!sameFile(now, judged) || !isStale(now, staleMs)) return false;
    try {
      unlinkSync(lockPath);
    } catch (e) {
      if (errCode(e) !== "ENOENT") throw e;
    }
    return true;
  } finally {
    release(marker, mine.nonce);
  }
}

function tryCreate(lockPath: string, body: LockBody): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (e) {
    if (errCode(e) === "EEXIST") return false;
    throw e;
  }
  try {
    const buf = Buffer.from(JSON.stringify(body));
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
  } catch (e) {
    closeSync(fd);
    rmSync(lockPath, { force: true });
    throw e;
  }
  closeSync(fd);
  return true;
}

function release(lockPath: string, nonce: string): void {
  try {
    if (parseBody(readFileSync(lockPath, "utf8"))?.nonce === nonce) unlinkSync(lockPath);
  } catch (e) {
    if (errCode(e) !== "ENOENT") throw e;
  }
}

/**
 * Runs `fn` while holding an exclusive lock at `lockPath`. `fn` must be synchronous: the lock is released
 * as soon as it returns. `fn` receives `stillHeld`, which re-reads the lock file: a holder suspended past
 * the stale age (laptop sleep, SIGSTOP) can wake to find its lock broken, and must check before it writes.
 *
 * A lock is stale when its pid is dead on this host or it is older than `staleMs`. Residual race: a holder
 * judged stale by age while still alive loses its lock. That is acceptable because the default 30 s age is
 * orders of magnitude longer than an append, which holds the lock for milliseconds.
 */
export function withLock<T>(lockPath: string, fn: (stillHeld: () => boolean) => T, opts?: { timeoutMs?: number; staleMs?: number }): T {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const body = newBody();
  const deadline = Date.now() + timeoutMs;
  let last: Holder | null = null;

  for (;;) {
    body.ts = Date.now();
    if (tryCreate(lockPath, body)) break;
    const holder = inspect(lockPath);
    if (holder === null) continue;
    last = holder;
    if (isStale(holder, staleMs) && breakStale(lockPath, holder, staleMs)) continue;
    if (Date.now() >= deadline) {
      const who = last.body ? `pid ${last.body.pid} on ${last.body.host}` : "an unknown holder";
      throw new LockTimeoutError(`timed out after ${timeoutMs} ms waiting for ${lockPath}, held by ${who}`);
    }
    // Jitter keeps waiting processes from retrying in lockstep.
    sleepMs(5 + Math.floor(Math.random() * 21));
  }

  const stillHeld = (): boolean => {
    try {
      return parseBody(readFileSync(lockPath, "utf8"))?.nonce === body.nonce;
    } catch (e) {
      if (errCode(e) === "ENOENT") return false;
      throw e;
    }
  };
  try {
    return fn(stillHeld);
  } finally {
    release(lockPath, body.nonce);
  }
}
