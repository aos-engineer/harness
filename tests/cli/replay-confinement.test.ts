import { describe, test, expect } from "bun:test";
import { confinedResolve } from "../../cli/src/utils";

describe("replay.ts confinement (spec D4 PATH-002)", () => {
  test("confinedResolve rejects traversal against a session dir base", () => {
    expect(() => confinedResolve("/tmp/session", "../escape.jsonl"))
      .toThrow(/escapes base directory/);
  });
});
