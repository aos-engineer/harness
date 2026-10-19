import { expect, test } from "bun:test";
import { ulid } from "../src/util/ulid.ts";
import { sha256Hex, sha256Tag } from "../src/util/hash.ts";
import { ChainError, notImplemented, NotImplementedError, OpError, PackError } from "../src/util/errors.ts";

test("ulid is 26 Crockford chars and sorts by time", () => {
  const a = ulid(1_000), b = ulid(2_000);
  expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(a < b).toBe(true);
});

test("ulid randomness differs within the same millisecond", () => {
  expect(ulid(5_000)).not.toBe(ulid(5_000));
});

test("sha256Tag prefixes hex", () => {
  expect(sha256Tag("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256Hex(new TextEncoder().encode(""))).toBe(sha256Tag("").slice(7));
});

test("error classes carry their name and extra fields", () => {
  expect(new PackError("bad pack", ["a", "b"]).issues).toEqual(["a", "b"]);
  expect(new OpError("refused", "no").code).toBe("refused");
  expect(new ChainError("broken", 3).badSeq).toBe(3);
  expect(new OpError("invalid", "x").name).toBe("OpError");
  expect(() => notImplemented("X")).toThrow(NotImplementedError);
});
