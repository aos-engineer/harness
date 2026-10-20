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
  ["postgres://user:hunter2pass@db.example.com/x", "postgres://[REDACTED]@db.example.com/x"],
  // Names around the key word, and an auth scheme before the value
  ["GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED]"],
  ["NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED]"],
  ["export AWS_SECRET_ACCESS_KEY=abcd1234abcd1234", "export [REDACTED]"],
  ["AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP", "[REDACTED]"],
  ["private_key: abcdef123456", "[REDACTED]"],
  ["Authorization: Basic dXNlcjpwYXNz", "[REDACTED]"],
  // Well-known token prefixes, on their own
  ["ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked", "[REDACTED] leaked"],
  ["pat github_pat_11ABCDEFG0123456789_abcdefghijkl", "pat [REDACTED]"],
  ["npm_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED]"],
  ["slack xoxb-123456789012-abcdefghijkl", "slack [REDACTED]"],
  // Whole private-key blocks, including one cut off before its END line
  ["-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx1234567890abcdef\nZZZZbodyline2==\n-----END RSA PRIVATE KEY-----\nok", "[REDACTED]\nok"],
  ["key:\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n", "key:\n[REDACTED]"],
  // Lookalikes that are not secrets
  ["Unexpected token } in JSON at position 12", "Unexpected token } in JSON at position 12"],
  ["tokens: 1234", "tokens: 1234"],
])("redact(%j)", (input, want) => expect(redact(input)).toBe(want));

// Built at run time so the source never holds a literal that a secret scanner would flag.
const k = (...parts: string[]) => parts.join("");
const JWT = k("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
test.each([
  // Stripe secret, restricted, and webhook keys
  [k("STRIPE_KEY is ", "sk_", "live_", "a1b2c3d4e5f6g7h8i9j0k1l2"), "STRIPE_KEY is [REDACTED]"],
  [k("rk_", "test_", "a1b2c3d4e5f6g7h8i9j0k1l2", " ok"), "[REDACTED] ok"],
  [k("hook ", "whsec_", "a1b2c3d4e5f6g7h8i9j0k1l2"), "hook [REDACTED]"],
  // Google API keys, including one that ends in a dash
  [k("key=", "AI", "za", "SyA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q", " next"), "key=[REDACTED] next"],
  [k("maps ", "AI", "za", "SyA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6-", " next"), "maps [REDACTED] next"],
  // JWTs, signed and unsigned
  [`got ${JWT} back`, "got [REDACTED] back"],
  [k("unsigned ", "eyJhbGciOiJub25lIn0", ".", "eyJzdWIiOiJ4In0", ". done"), "unsigned [REDACTED] done"],
  // GitLab and SendGrid tokens
  [k("glpat", "-", "a1b2c3d4e5f6g7h8i9j0"), "[REDACTED]"],
  [k("SG", ".", "a1b2c3d4e5f6g7h8i9j0kk", ".", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v"), "[REDACTED]"],
  // Credentials in a URL, as git remotes print them; the host stays readable
  ["fetch https://x-access-token:abc123def456@github.com/o/r.git", "fetch https://[REDACTED]@github.com/o/r.git"],
  // Lookalikes that are not secrets
  ["sk_live_short", "sk_live_short"], ["https://github.com/o/r", "https://github.com/o/r"],
  ["eyJ is how base64 JSON starts", "eyJ is how base64 JSON starts"], ["see http://host:8080/path", "see http://host:8080/path"],
])("redact recognizes more credential formats(%j)", (input, want) => expect(redact(input)).toBe(want));

test("credential formats stay linear on long lookalike runs", () => {
  const start = performance.now();
  redact(`${"eyJ".repeat(30_000)} ${"https://".repeat(10_000)} ${"a:".repeat(30_000)}@`);
  expect(performance.now() - start).toBeLessThan(200);
});

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
