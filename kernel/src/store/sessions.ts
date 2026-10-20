// Session bindings tie a host session to its active run, so a hook that knows only its session id and
// cwd can find the run. findBinding runs on every hook call, so it uses stat and one read, never git.
import { randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Binding } from "../types.ts";
import { OpError } from "../util/errors.ts";
import { sha256Hex } from "../util/hash.ts";
import { aosDir } from "./paths.ts";
import { errCode, refuseSymlinks } from "./fs-internal.ts";

function sessionsDir(root: string): string {
  return join(aosDir(root), "sessions");
}

// Session ids come from host payloads, so nothing in them may steer the path. The readable part is capped to
// keep the name under filesystem limits.
function safe(part: string, max: number): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, max);
}

/**
 * `<host>-<session>-<hash>.json`. The readable part is lossy ("a"/"b-c" and "a-b"/"c" read the same), so a
 * hash of the exact pair keeps two sessions from sharing a file and overwriting each other's binding.
 */
export function sessionFileName(host: string, session: string): string {
  return `${safe(host, 40)}-${safe(session, 80)}-${sha256Hex(host + "\0" + session).slice(0, 12)}.json`;
}

/** Throws OpError("invalid") when `raw` is not a binding, keeping the parse failure as its cause. */
function parseBinding(raw: string, file: string): Binding {
  let b: Partial<Binding> | null;
  try {
    b = JSON.parse(raw) as Partial<Binding> | null;
  } catch (e) {
    throw new OpError("invalid", `unreadable session binding at ${file}; delete it to unbind the session`, { cause: e });
  }
  if (b && typeof b.host === "string" && typeof b.session === "string" && typeof b.run === "string"
    && typeof b.root === "string" && typeof b.boundAt === "string") {
    return { host: b.host, session: b.session, run: b.run, root: b.root, boundAt: b.boundAt };
  }
  throw new OpError("invalid", `${file} is not a session binding; delete it to unbind the session`);
}

/** The binding in `file`, or null when it is gone or unreadable. */
function tryRead(file: string): Binding | null {
  try {
    return parseBinding(readFileSync(file, "utf8"), file);
  } catch (e) {
    if (e instanceof OpError || errCode(e) === "ENOENT") return null;
    throw e;
  }
}

export function bindSession(root: string, host: string, session: string, run: string): Binding {
  const binding: Binding = { host, session, run, root: resolve(root), boundAt: new Date().toISOString() };
  const dir = sessionsDir(binding.root);
  const file = join(dir, sessionFileName(host, session));
  refuseSymlinks(binding.root, file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(binding), { flag: "wx" });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return binding;
}

/**
 * Walks from `cwd` up to the filesystem root and returns the first binding for this host session. A file
 * whose recorded host or session differs (a hash collision) is another session's, so it is skipped. An
 * unreadable binding throws: reporting "no run" would silently switch enforcement off.
 */
export function findBinding(cwd: string, host: string, session: string): Binding | null {
  const name = sessionFileName(host, session);
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const file = join(sessionsDir(dir), name);
    if (existsSync(file)) {
      let raw: string | null = null;
      try {
        raw = readFileSync(file, "utf8");
      } catch (e) {
        // Unbound between the stat and the read: the same as never bound.
        if (errCode(e) !== "ENOENT") throw e;
      }
      if (raw !== null) {
        const b = parseBinding(raw, file);
        if (b.host === host && b.session === session) return b;
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

// bindings removed
export function unbindRun(root: string, run: string): number {
  const dir = sessionsDir(resolve(root));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (errCode(e) === "ENOENT") return 0;
    throw e;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    if (tryRead(file)?.run !== run) continue;
    // The session may be rebinding to a new run right now. Claim the file by renaming it, so the copy that is
    // compared is the copy that is deleted; a re-read before unlinking would still delete a rebind landing in
    // between. A rebound binding is put back, unless an even newer one has already taken its place.
    const claimed = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.unbind`;
    try {
      renameSync(file, claimed);
    } catch (e) {
      if (errCode(e) === "ENOENT") continue;
      throw e;
    }
    try {
      if (tryRead(claimed)?.run === run) {
        removed++; // the claimed file is deleted by the finally below
        continue;
      }
      try {
        linkSync(claimed, file);
      } catch (e) {
        if (errCode(e) !== "EEXIST") renameSync(claimed, file);
      }
    } finally {
      rmSync(claimed, { force: true });
    }
  }
  return removed;
}
