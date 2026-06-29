import { describe, expect, test } from "bun:test";
import { runBriefPromptLoop, type LineReader } from "../../cli/src/brief/prompts";

function fakeReader(lines: string[]): LineReader {
  let i = 0;
  return {
    async readLine() {
      return lines[i++] ?? "";
    },
  };
}

describe("runBriefPromptLoop", () => {
  test("collects deliberation answers via successive prompts", async () => {
    const result = await runBriefPromptLoop({
      reader: fakeReader(["test-slug", "1", "Test Title", "S body", "", "Stakes body", "", "Constraints body", "", "Key Q?", ""]),
      seedText: undefined,
      kind: undefined,
      log: () => {},
    });
    expect(result.slug).toBe("test-slug");
    expect(result.kind).toBe("deliberation");
    expect(result.title).toBe("Test Title");
    expect(result.sections.situation).toBe("S body");
    expect(result.sections.keyQuestion).toBe("Key Q?");
  });

  test("respects pre-seeded kind (skips kind prompt)", async () => {
    const result = await runBriefPromptLoop({
      reader: fakeReader(["slug", "Title", "F body", "", "C body", "", "Constraints", "", "Done", ""]),
      kind: "execution",
      log: () => {},
    });
    expect(result.kind).toBe("execution");
    expect(result.sections.featureVision).toBe("F body");
    expect(result.sections.successCriteria).toBe("Done");
  });
});
