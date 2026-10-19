// Stub: real implementation lands later; signatures are the agreed contract.
import { notImplemented } from "../util/errors.ts";

export function splitCommand(cmd: string): { segments: string[]; operators: string[] } {
  return notImplemented("D");
}

// quotes removed, escapes applied
export function shellWords(segment: string): string[] {
  return notImplemented("D");
}

// env-stripped, cd-free, bash -c unwrapped
export function leafSegments(cmd: string): string[] {
  return notImplemented("D");
}
