// Command evidence keeps a digest of the full output and a short redacted tail, never the full text, so
// run logs stay small and credentials that a test printed do not end up in them.
import { Buffer } from "node:buffer";
import { sha256Tag } from "../util/hash.ts";

// Both detection patterns come from the 0.x Jev decision service, made global here so every match is
// replaced rather than only detected. SENSITIVE's card-number branch also catches long digit runs such as
// epoch-millisecond timestamps. That is acceptable: the redacted text only feeds a display tail.
const SECRET =
  /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b|(?:api[_-]?key|password|secret|authorization|access[_-]?token)\s*["']?\s*[:=]\s*["']?\S{6,}|\bBearer\s+\S+/gi;
// The email branch starts only where a run of address characters starts. The 0.x form started at every
// word boundary inside the run, so a long `a.a.a...` line rescanned the run from each one, which is
// quadratic. Every address it found is still found, because the match from the run's start covers it.
const SENSITIVE = /\b(?:\d{3}-\d{2}-\d{4}|(?:\d[ -]?){13,19})\b|(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const MASK = "[REDACTED]";
const TAIL_BYTES = 4096;

export function redact(text: string): string {
  return text.replace(SECRET, MASK).replace(SENSITIVE, MASK);
}

/** Digest of the raw output plus its last 4096 bytes after redaction, cut on a UTF-8 character boundary. */
export function captureOutput(output: string): { outputSha256: string; tail: string } {
  // Redact the whole output before cutting: a secret straddling the cut would no longer match its
  // pattern once its prefix was gone, and half of it would leak into the tail.
  const bytes = Buffer.from(redact(output), "utf8");
  let start = Math.max(0, bytes.length - TAIL_BYTES);
  // Skip continuation bytes (10xxxxxx) so the tail starts on a whole character.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return { outputSha256: sha256Tag(output), tail: bytes.subarray(start).toString("utf8") };
}
