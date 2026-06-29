import { describe, expect, test } from "bun:test";
import { parseTitle, parseSections, isBodyEmpty, findSection } from "../../cli/src/brief/parse";

describe("parseTitle", () => {
  test("returns text after `# Brief: `", () => {
    expect(parseTitle("# Brief: API Platform Decision\n\nbody")).toBe("API Platform Decision");
  });

  test("preserves further colons in the title", () => {
    expect(parseTitle("# Brief: API Platform: Phase 2")).toBe("API Platform: Phase 2");
  });

  test("returns null when no Brief: H1", () => {
    expect(parseTitle("# Title\n\n## Situation")).toBeNull();
  });
});

describe("parseSections", () => {
  test("captures H2 headings and bodies", () => {
    const md = "# Brief: T\n\n## Situation\n\nStuff happens.\n\n## Stakes\n\nHigh.";
    const s = parseSections(md);
    expect(s).toHaveLength(2);
    expect(s[0].heading).toBe("Situation");
    expect(s[0].level).toBe(2);
    expect(s[0].body.trim()).toBe("Stuff happens.");
    expect(s[1].heading).toBe("Stakes");
  });

  test("accepts H3 as section heading", () => {
    const s = parseSections("### Situation\n\nbody");
    expect(s).toHaveLength(1);
    expect(s[0].level).toBe(3);
  });

  test("treats H4+ as in-section content, not new section", () => {
    const s = parseSections("## Situation\n\n#### Subhead\n\nbody");
    expect(s).toHaveLength(1);
    expect(s[0].body).toContain("#### Subhead");
  });

  test("ignores H1 lines (those are titles)", () => {
    const s = parseSections("# Brief: T\n\n## Situation\n\nbody");
    expect(s).toHaveLength(1);
  });
});

describe("isBodyEmpty", () => {
  test("returns true for whitespace only", () => {
    expect(isBodyEmpty("   \n\n  ")).toBe(true);
  });

  test("returns true when only HTML comments are present", () => {
    expect(isBodyEmpty("<!-- TODO: write -->\n\n")).toBe(true);
  });

  test("returns false when real content is present", () => {
    expect(isBodyEmpty("Stuff <!-- aside --> matters.")).toBe(false);
  });
});

describe("findSection", () => {
  const sections = [
    { heading: "Situation", level: 2 as const, body: "x", startLine: 0 },
    { heading: "VISION", level: 2 as const, body: "y", startLine: 5 },
  ];

  test("matches case-insensitively by canonical name", () => {
    expect(findSection(sections, "situation")?.body).toBe("x");
  });

  test("matches by alias", () => {
    expect(findSection(sections, "Feature / Vision", ["Vision"])?.body).toBe("y");
  });

  test("returns null when neither canonical nor alias matches", () => {
    expect(findSection(sections, "Stakes")).toBeNull();
  });
});
