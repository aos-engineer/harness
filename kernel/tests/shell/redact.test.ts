import { expect, test } from "bun:test";
import { captureOutput, redact } from "../../src/shell/redact.ts";
import { sha256Tag } from "../../src/util/hash.ts";

test.each([
  ["key sk-abcdefghijklmnop1234 end", "key [REDACTED] end"],
  ["AKIAABCDEFGHIJKLMNOP", "[REDACTED]"],
  ["password=hunter2hunter2", "[REDACTED]"],
  ["token Bearer abc.def123", "token [REDACTED]"],
  ["mail me at a@b.co", "mail me at [REDACTED]"],
  ["12 passed, 0 failed", "12 passed, 0 failed"],
  // Every match is replaced, not just the first
  ["sk-aaaaaaaaaaaaaaaa1 and AKIAABCDEFGHIJKLMNOP", "[REDACTED] and [REDACTED]"],
  // Key names match in any case
  ["API_KEY: abcdef123", "[REDACTED]"],
  ["-----BEGIN RSA PRIVATE KEY-----", "[REDACTED]"],
  ["ssn 123-45-6789", "ssn [REDACTED]"],
  ["card 4111 1111 1111 1111", "card [REDACTED]"],
  ["x first.last+tag@sub.example.org y", "x [REDACTED] y"],
  ["postgres://user:hunter2pass@db.example.com/x", "postgres://user:[REDACTED]/x"],
])("redact(%j)", (input, want) => expect(redact(input)).toBe(want));

test("redaction stays linear on a long run of letters and dots", () => {
  const start = performance.now();
  redact("a.".repeat(50_000));
  expect(performance.now() - start).toBeLessThan(200);
});

test("tail is capped at 4096 bytes and digest is over raw output", () => {
  const out = "x".repeat(10_000) + " sk-abcdefghijklmnop1234";
  const c = captureOutput(out);
  expect(Buffer.byteLength(c.tail)).toBeLessThanOrEqual(4096);
  expect(c.tail).toEndWith("[REDACTED]");
  expect(c.outputSha256).toBe(sha256Tag(out));
});

test("tail keeps the full 4096 bytes when the cut lands on a character boundary", () => {
  expect(Buffer.byteLength(captureOutput("y".repeat(10_000)).tail)).toBe(4096);
});

test("short output is kept whole", () => expect(captureOutput("12 passed").tail).toBe("12 passed"));

test("a secret straddling the cut is redacted whole, not half-leaked", () => {
  const c = captureOutput("x".repeat(10) + " sk-" + "a".repeat(5_000) + " end");
  expect(c.tail).toBe("x".repeat(10) + " [REDACTED] end");
});

test("tail never splits a multibyte char", () => expect(captureOutput("aé".repeat(3000)).tail).not.toContain(String.fromCharCode(0xfffd)));

test("a cut inside a 4-byte char drops the whole partial char", () => {
  // 1500 four-byte emoji then "x" puts the 4096-byte cut on an emoji's second byte, leaving three
  // continuation bytes in front of the tail.
  expect(captureOutput("😀".repeat(1500) + "x").tail).toBe("😀".repeat(1023) + "x");
});
