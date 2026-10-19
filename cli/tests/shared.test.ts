import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { printable } from "../src/commands/shared.ts";

// Every character below is written as an escape: a literal bidi or invisible character in a public repo is
// itself the hidden-text problem this helper exists to prevent.
describe("printable", () => {
  const cases: Array<[string, string, string]> = [
    ["an ANSI escape", "a\u001b[2Jb", "a\\u001b[2Jb"],
    ["a carriage return", "a\rb", "a\\u000db"],
    ["DEL and a C1 control", "a\u007f\u009bb", "a\\u007f\\u009bb"],
    ["the Arabic letter mark", "a\u061cb", "a\\u061cb"],
    ["the line separator", "a\u2028b", "a\\u2028b"],
    ["the paragraph separator", "a\u2029b", "a\\u2029b"],
    ["a zero-width space", "a\u200bb", "a\\u200bb"],
    ["a byte order mark", "a\ufeffb", "a\\ufeffb"],
    ["a right-to-left override", "a\u202eb", "a\\u202eb"],
    ["a right-to-left isolate", "a\u2067b", "a\\u2067b"],
    ["an astral format character (a language tag)", "a\u{e0001}b", "a\\u{e0001}b"],
  ];
  for (const [name, input, shown] of cases) {
    test(`shows ${name} as a visible escape`, () => {
      expect(printable(input)).toBe(shown);
    });
  }

  test("keeps newlines, tabs, and ordinary text, including non-Latin scripts", () => {
    const text = "line one\n\tindented \u00e9t\u00e9 \u0645\u0631\u062d\u0628\u0627 \u4f60\u597d";
    expect(printable(text)).toBe(text);
  });

  test("is idempotent, so text shown twice is not escaped twice", () => {
    const once = printable("a\u202eb\u001b");
    expect(printable(once)).toBe(once);
  });
});

// Format characters (category Cf) and controls other than tab, newline, and carriage return.
const INVISIBLE = /[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u;

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f));
}

test("the cli and human-operation sources and tests contain no literal invisible or bidi characters", () => {
  const kernel = join(import.meta.dirname, "../../kernel");
  const files = [
    ...sources(join(import.meta.dirname, "../src")), ...sources(import.meta.dirname),
    join(kernel, "src/ops/human.ts"), ...sources(join(kernel, "tests/ops-human")),
  ];
  const offenders = files.filter((f) => INVISIBLE.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
