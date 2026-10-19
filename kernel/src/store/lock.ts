// Stub: real implementation lands later; signatures are the agreed contract.
import { notImplemented } from "../util/errors.ts";

export function withLock<T>(lockPath: string, fn: () => T, opts?: { timeoutMs?: number; staleMs?: number }): T {
  return notImplemented("A");
}
