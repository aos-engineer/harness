// Command evidence keeps a digest of the full output and a short redacted tail, never the full text, so
// run logs stay small and credentials that a test printed do not end up in them.
import { Buffer } from "node:buffer";
import { sha256Tag } from "../util/hash.ts";

// Both detection patterns start from the 0.x Jev decision service. They are global here so every match is
// replaced rather than only detected, and SECRET is widened to what test and CI output actually prints.
// SENSITIVE's card-number branch also catches long digit runs such as epoch-millisecond timestamps. That is
// acceptable: the redacted text only feeds a display tail.

// A whole key block, body included. A block cut off before its END line is redacted to the end of the text.
const PRIVATE_KEY_BLOCK = String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`;
// Credentials recognizable by their prefix alone: OpenAI-style keys, AWS key ids, GitHub, npm, and Slack
// tokens, Stripe secret, restricted, and webhook keys, GitLab tokens, and SendGrid keys.
const PREFIXED_TOKEN = String.raw`\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b`;
// Formats whose alphabet includes "-", where a closing \b would fail on a trailing dash and miss the whole
// token: Google API keys and JWTs (a JSON header and payload, so both start with eyJ, then a signature).
const GOOGLE_API_KEY = String.raw`\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])`;
const JWT = String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*`;
// The user and password in a URL such as https://user:token@host, which git remotes and CI logs print.
const URL_USERINFO = String.raw`(?<=:\/\/)[^\/\s:@]{1,256}:[^\/\s@]{1,256}(?=@)`;
// `name = value` where the name contains a credential word, so GITHUB_TOKEN and AWS_SECRET_ACCESS_KEY match.
// The affixes are bounded: an unbounded leading \w* would rescan long words from every position.
const KEY_NAME = String.raw`(?:api[_-]?key|access[_-]?token|access[_-]?key|secret[_-]?access[_-]?key|private[_-]?key|password|secret|authorization|token)`;
const KEY_VALUE = String.raw`\w{0,40}${KEY_NAME}\w{0,40}\s*["']?\s*[:=]\s*["']?(?:(?:Basic|Bearer)\s+)?\S{6,}`;
const BEARER = String.raw`\bBearer\s+\S+`;
const SECRET = new RegExp([PRIVATE_KEY_BLOCK, PREFIXED_TOKEN, GOOGLE_API_KEY, JWT, URL_USERINFO, KEY_VALUE, BEARER].join("|"), "gi");
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
