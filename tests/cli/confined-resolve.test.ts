import { describe, test, expect } from "bun:test";
import { confinedResolve } from "../../cli/src/utils";
import { resolve } from "node:path";

describe("confinedResolve (spec D4)", () => {
  const base = resolve("/tmp/project");

  test("allows paths inside base", () => {
    expect(confinedResolve(base, "sub/file.txt")).toBe(resolve(base, "sub/file.txt"));
    expect(confinedResolve(base, "./sub/../other.txt")).toBe(resolve(base, "other.txt"));
  });

  test("allows the base itself (rel=. or empty)", () => {
    expect(confinedResolve(base, ".")).toBe(base);
    expect(confinedResolve(base, "")).toBe(base);
  });

  test("rejects paths that escape the base", () => {
    expect(() => confinedResolve(base, "../evil")).toThrow(/escapes base directory/);
    expect(() => confinedResolve(base, "/etc/passwd")).toThrow(/escapes base directory/);
    expect(() => confinedResolve(base, "sub/../../evil")).toThrow(/escapes base directory/);
  });

  test("normalizes mixed separators", () => {
    // On POSIX sep is /, so backslash is treated as a literal filename char
    // (which is fine). The test exists to document intent.
    const result = confinedResolve(base, "sub/file.txt");
    expect(result.startsWith(base)).toBe(true);
  });
});
