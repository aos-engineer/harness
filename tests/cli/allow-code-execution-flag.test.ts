import { describe, test, expect } from "bun:test";
import { parseAllowCodeExecutionFlag } from "../../cli/src/utils";

describe("--allow-code-execution flag parsing (spec D3.2)", () => {
  test("undefined → undefined", () => {
    expect(parseAllowCodeExecutionFlag(undefined)).toBeUndefined();
  });
  test("bare (true) → 'all'", () => {
    expect(parseAllowCodeExecutionFlag(true)).toBe("all");
  });
  test("'none' → 'none'", () => {
    expect(parseAllowCodeExecutionFlag("none")).toBe("none");
  });
  test("'python,bash' → ['python','bash']", () => {
    expect(parseAllowCodeExecutionFlag("python,bash")).toEqual(["python", "bash"]);
  });
  test("'python' → ['python']", () => {
    expect(parseAllowCodeExecutionFlag("python")).toEqual(["python"]);
  });
});
