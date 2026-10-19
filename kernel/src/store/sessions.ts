// Stub: real implementation lands later; signatures are the agreed contract.
import type { Binding } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function sessionFileName(host: string, session: string): string {
  return notImplemented("A");
}

export function bindSession(root: string, host: string, session: string, run: string): Binding {
  return notImplemented("A");
}

export function findBinding(cwd: string, host: string, session: string): Binding | null {
  return notImplemented("A");
}

// bindings removed
export function unbindRun(root: string, run: string): number {
  return notImplemented("A");
}
