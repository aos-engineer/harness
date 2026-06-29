import { describe, expect, test } from "bun:test";
import { renderBriefTemplate } from "../../cli/src/brief/template";
import { validateBrief } from "../../cli/src/brief/validate";

describe("renderBriefTemplate", () => {
  test("deliberation template includes all four required sections", () => {
    const out = renderBriefTemplate({ kind: "deliberation", title: "Test" });
    expect(out).toContain("# Brief: Test");
    expect(out).toContain("## Situation");
    expect(out).toContain("## Stakes");
    expect(out).toContain("## Constraints");
    expect(out).toContain("## Key Question");
  });

  test("execution template includes all four required sections", () => {
    const out = renderBriefTemplate({ kind: "execution", title: "Test" });
    expect(out).toContain("## Feature / Vision");
    expect(out).toContain("## Context");
    expect(out).toContain("## Success Criteria");
  });

  test("empty template fails strict validation (TODO comments are empty)", () => {
    const out = renderBriefTemplate({ kind: "deliberation", title: "T" });
    const r = validateBrief(out, { expectedKind: "deliberation", strict: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.kind === "empty-section")).toBe(true);
  });

  test("prefilled section appears under its heading and validates clean", () => {
    const out = renderBriefTemplate({
      kind: "deliberation",
      title: "T",
      prefilled: {
        situation: "S body",
        stakes: "T body",
        constraints: "C body",
        keyQuestion: "Q?",
      },
    });
    const r = validateBrief(out, { expectedKind: "deliberation", strict: true });
    expect(r.ok).toBe(true);
  });

  test("seed text rendered as HTML comment block at top", () => {
    const out = renderBriefTemplate({ kind: "deliberation", title: "T", seedText: "raw user idea here" });
    expect(out).toContain("<!-- raw idea seed:");
    expect(out).toContain("raw user idea here");
    expect(out).toContain("-->");
  });
});
