// Stub: real implementation lands later; signatures are the agreed contract.
import type { ActionDef, ActionName } from "../types.ts";
import { notImplemented } from "../util/errors.ts";

export function matchRole(cmd: string, roles: Record<string, string[]>): { role: string; masked: boolean } | null {
  return notImplemented("D");
}

export function matchAction(cmd: string, actions: Record<ActionName, ActionDef>): ActionName | null {
  return notImplemented("D");
}

// e.g. "approve", "run cancel"
export function matchHumanOnly(cmd: string): string | null {
  return notImplemented("D");
}

export function mentionsAosDir(cmd: string): boolean {
  return notImplemented("D");
}
