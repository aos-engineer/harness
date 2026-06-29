# AOS Brief Authoring + Plugin Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `aos create brief` (interactive + skill-driven), the supporting `aos brief template/validate/save` primitives, run-time brief lint, and Gemini/Codex/Claude-Code plugin parity for the brief-authoring skill.

**Architecture:** Three layers. (1) `cli/src/brief/` — pure functions (types, schema, parse, validate, template, prompts, write). (2) CLI surface in `cli/src/commands/brief.ts` and an updated `create.ts`/`run.ts`/`index.ts`. (3) Plugin packaging at `plugins/aos-harness/` — one shared `aos-create-brief` SKILL.md consumed by Claude Code, Codex, and Gemini, plus the Gemini extension manifest that's missing today.

**Tech Stack:** TypeScript on Bun. Tests use `bun:test` (`describe`, `expect`, `test`). CLI uses the existing `c` (colors) and `parseArgs` helpers from `cli/src/colors.ts`, the `promptSelect` helper in `cli/src/utils.ts`, and the dispatch switch in `cli/src/index.ts`. Skills follow the existing `plugins/aos-harness/skills/<name>/SKILL.md` pattern.

**Spec:** `docs/superpowers/specs/2026-04-25-aos-brief-authoring-design.md` (commits `5ecfb43`, `df8d575`).

---

## File structure (created in this plan)

```
cli/src/brief/
  types.ts          # BriefKind, BriefIssue, BriefValidation, BriefSections, BriefSchemaDef
  schema.ts         # DELIBERATION_SCHEMA, EXECUTION_SCHEMA, briefSchema(), DISCRIMINATING_HEADINGS
  parse.ts          # parseTitle, parseSections, isBodyEmpty, findSection
  validate.ts       # validateBrief(markdown, opts)
  template.ts       # renderBriefTemplate(opts)
  prompts.ts        # runBriefPromptLoop(opts)
  write.ts          # atomicWriteBrief(path, content, { force })

cli/src/commands/
  brief.ts          # aos brief <template|validate|save>
  create.ts         # MODIFY — add `brief` case
  run.ts            # MODIFY — add lint summary after briefPath resolves
  ../index.ts       # MODIFY — register `brief` command

plugins/aos-harness/
  skills/aos-create-brief/SKILL.md           # NEW
  claude-code/commands/aos-create-brief.md   # NEW
  .gemini/extension.json                     # NEW
  gemini/install.sh                          # NEW
  .codex-plugin/plugin.json                  # MODIFY — version bump + defaultPrompt
  skills/aos-create/SKILL.md                 # MODIFY — cross-reference

tests/cli/
  brief-schema.test.ts
  brief-parse.test.ts
  brief-validate.test.ts
  brief-template.test.ts
  brief-write.test.ts
  brief-prompts.test.ts
  brief-cli.test.ts            # template/validate/save subcommand integration
  create-brief.test.ts         # `aos create brief --non-interactive` end-to-end
  run-brief-lint.test.ts       # `aos run` lint summary
  existing-briefs.test.ts      # regression: all committed briefs validate clean

README.md            # MODIFY — quick-start mention
```

Each file has one clear responsibility. The pure-logic module (`cli/src/brief/`) has zero I/O dependencies and is fully unit-testable. The CLI surface module imports from it; the plugin packaging is data files.

---

## Phase 1 — Foundation: types, schema, parse helpers

### Task 1: Types and schema definitions

**Files:**
- Create: `cli/src/brief/types.ts`
- Create: `cli/src/brief/schema.ts`
- Test: `tests/cli/brief-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/brief-schema.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  briefSchema,
  DELIBERATION_SCHEMA,
  EXECUTION_SCHEMA,
  DISCRIMINATING_HEADINGS,
} from "../../cli/src/brief/schema";

describe("briefSchema", () => {
  test("deliberation schema has the four required sections", () => {
    expect(DELIBERATION_SCHEMA.requiredSections).toEqual([
      "Situation",
      "Stakes",
      "Constraints",
      "Key Question",
    ]);
  });

  test("execution schema has the four required sections", () => {
    expect(EXECUTION_SCHEMA.requiredSections).toEqual([
      "Feature / Vision",
      "Context",
      "Constraints",
      "Success Criteria",
    ]);
  });

  test("execution schema declares Vision as alias for Feature / Vision", () => {
    expect(EXECUTION_SCHEMA.aliases["Feature / Vision"]).toEqual(["Vision"]);
  });

  test("deliberation schema has no aliases", () => {
    expect(DELIBERATION_SCHEMA.aliases).toEqual({});
  });

  test("briefSchema() returns the matching schema by kind", () => {
    expect(briefSchema("deliberation")).toBe(DELIBERATION_SCHEMA);
    expect(briefSchema("execution")).toBe(EXECUTION_SCHEMA);
  });

  test("DISCRIMINATING_HEADINGS maps each kind to its unique required heading", () => {
    expect(DISCRIMINATING_HEADINGS.deliberation).toBe("Key Question");
    expect(DISCRIMINATING_HEADINGS.execution).toBe("Success Criteria");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-schema.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `cli/src/brief/types.ts`**

```typescript
export type BriefKind = "deliberation" | "execution";

export type BriefIssueKind =
  | "missing-required"
  | "empty-section"
  | "missing-title"
  | "title-format"
  | "auto-detect-failed"
  | "shape-mismatch-hint";

export interface BriefIssue {
  kind: BriefIssueKind;
  section?: string;
  message: string;
}

export interface BriefValidation {
  ok: boolean;
  detectedKind: BriefKind | null;
  errors: BriefIssue[];
  warnings: BriefIssue[];
}

export interface BriefSchemaDef {
  requiredSections: string[];
  optionalSections: string[];
  aliases: Record<string, string[]>;
}

export interface BriefSections {
  title?: string;
  contextFiles?: string;
  situation?: string;
  stakes?: string;
  background?: string;
  outOfScope?: string;
  keyQuestion?: string;
  featureVision?: string;
  context?: string;
  stakeholders?: string;
  openQuestions?: string;
  successCriteria?: string;
  constraints?: string;
}
```

- [ ] **Step 4: Write `cli/src/brief/schema.ts`**

```typescript
import type { BriefKind, BriefSchemaDef } from "./types";

export const DELIBERATION_SCHEMA: BriefSchemaDef = {
  requiredSections: ["Situation", "Stakes", "Constraints", "Key Question"],
  optionalSections: ["Background", "Out of scope"],
  aliases: {},
};

export const EXECUTION_SCHEMA: BriefSchemaDef = {
  requiredSections: ["Feature / Vision", "Context", "Constraints", "Success Criteria"],
  optionalSections: ["Stakeholders", "Out of scope", "Open Questions"],
  aliases: {
    "Feature / Vision": ["Vision"],
  },
};

export function briefSchema(kind: BriefKind): BriefSchemaDef {
  return kind === "deliberation" ? DELIBERATION_SCHEMA : EXECUTION_SCHEMA;
}

export const DISCRIMINATING_HEADINGS: Record<BriefKind, string> = {
  deliberation: "Key Question",
  execution: "Success Criteria",
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/cli/brief-schema.test.ts`
Expected: PASS (6/6).

- [ ] **Step 6: Commit**

```bash
git add cli/src/brief/types.ts cli/src/brief/schema.ts tests/cli/brief-schema.test.ts
git commit -m "feat(brief): add types and schema for deliberation and execution kinds"
```

---

### Task 2: Parse helpers

**Files:**
- Create: `cli/src/brief/parse.ts`
- Test: `tests/cli/brief-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/brief-parse.test.ts`:

```typescript
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
    expect(s[0].heading).toBe("Situation");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-parse.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `cli/src/brief/parse.ts`**

```typescript
export interface ParsedSection {
  heading: string;
  level: 1 | 2 | 3;
  body: string;
  startLine: number;
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;
const TITLE_RE = /^#\s+Brief:\s+(.+?)\s*$/;

export function parseTitle(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    const m = line.match(TITLE_RE);
    if (m) return m[1];
  }
  return null;
}

export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(HEADING_RE);
    if (m) {
      const level = m[1].length as 1 | 2 | 3;
      if (level === 1) {
        if (current) {
          sections.push(current);
          current = null;
        }
        continue;
      }
      if (current) sections.push(current);
      current = { heading: m[2], level, body: "", startLine: i };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections;
}

export function isBodyEmpty(body: string): boolean {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "");
  return stripped.trim().length === 0;
}

export function findSection(
  sections: ParsedSection[],
  canonical: string,
  aliases: string[] = [],
): ParsedSection | null {
  const candidates = [canonical, ...aliases].map((c) => c.toLowerCase());
  for (const s of sections) {
    if (candidates.includes(s.heading.toLowerCase())) return s;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/brief-parse.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/parse.ts tests/cli/brief-parse.test.ts
git commit -m "feat(brief): add markdown parse helpers (title, sections, alias matching)"
```

---

## Phase 2 — Validator

### Task 3: Validator title check

**Files:**
- Create: `cli/src/brief/validate.ts`
- Test: `tests/cli/brief-validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/brief-validate.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { validateBrief } from "../../cli/src/brief/validate";

const minimalDeliberation = `# Brief: Test
## Situation
S
## Stakes
T
## Constraints
C
## Key Question
Q?`;

describe("validateBrief — title", () => {
  test("errors when title H1 missing", () => {
    const r = validateBrief("## Situation\n\nx", { expectedKind: "deliberation" });
    expect(r.errors.some((e) => e.kind === "missing-title")).toBe(true);
  });
  test("accepts `# Brief: ` H1", () => {
    const r = validateBrief(minimalDeliberation, { expectedKind: "deliberation" });
    expect(r.errors.some((e) => e.kind === "missing-title")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-validate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal `cli/src/brief/validate.ts`** (title-only stub; later tasks extend)

```typescript
import type { BriefKind, BriefIssue, BriefValidation } from "./types";
import { briefSchema, DISCRIMINATING_HEADINGS } from "./schema";
import { parseTitle, parseSections, isBodyEmpty, findSection, type ParsedSection } from "./parse";

export interface ValidateOptions {
  expectedKind?: BriefKind;
  strict?: boolean;
}

export function validateBrief(markdown: string, opts: ValidateOptions = {}): BriefValidation {
  const errors: BriefIssue[] = [];
  const warnings: BriefIssue[] = [];

  if (!parseTitle(markdown)) {
    errors.push({
      kind: "missing-title",
      message: "Title must be a H1 line starting with `Brief: ` (e.g. `# Brief: API Platform Decision`).",
    });
  }

  return {
    ok: errors.length === 0,
    detectedKind: opts.expectedKind ?? null,
    errors,
    warnings,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/brief-validate.test.ts -t "title"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/validate.ts tests/cli/brief-validate.test.ts
git commit -m "feat(brief): validate title H1 with `Brief: ` prefix"
```

---

### Task 4: Validator required-section presence

**Files:**
- Modify: `cli/src/brief/validate.ts`
- Modify: `tests/cli/brief-validate.test.ts`

- [ ] **Step 1: Append failing tests to `tests/cli/brief-validate.test.ts`**

```typescript
describe("validateBrief — required sections", () => {
  test("errors when Key Question missing on deliberation", () => {
    const md = `# Brief: T\n## Situation\nx\n## Stakes\nx\n## Constraints\nx`;
    const r = validateBrief(md, { expectedKind: "deliberation" });
    expect(r.errors.find((e) => e.kind === "missing-required" && e.section === "Key Question"))
      .toBeDefined();
  });

  test("errors when Success Criteria missing on execution", () => {
    const md = `# Brief: T\n## Feature / Vision\nx\n## Context\nx\n## Constraints\nx`;
    const r = validateBrief(md, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.kind === "missing-required" && e.section === "Success Criteria"))
      .toBeDefined();
  });

  test("`## Vision` accepted as alias of `## Feature / Vision`", () => {
    const md = `# Brief: T\n## Vision\nv\n## Context\nx\n## Constraints\nx\n## Success Criteria\nx`;
    const r = validateBrief(md, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.section === "Feature / Vision")).toBeUndefined();
  });

  test("heading match is case-insensitive", () => {
    const md = `# Brief: T\n## SITUATION\nx\n## stakes\nx\n## CONSTRAINTS\nx\n## key question\nx`;
    const r = validateBrief(md, { expectedKind: "deliberation" });
    expect(r.errors.filter((e) => e.kind === "missing-required")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-validate.test.ts -t "required sections"`
Expected: FAIL.

- [ ] **Step 3: Replace `cli/src/brief/validate.ts` with the required-section pass**

```typescript
import type { BriefKind, BriefIssue, BriefValidation } from "./types";
import { briefSchema, DISCRIMINATING_HEADINGS } from "./schema";
import { parseTitle, parseSections, isBodyEmpty, findSection, type ParsedSection } from "./parse";

export interface ValidateOptions {
  expectedKind?: BriefKind;
  strict?: boolean;
}

export function validateBrief(markdown: string, opts: ValidateOptions = {}): BriefValidation {
  const errors: BriefIssue[] = [];
  const warnings: BriefIssue[] = [];

  if (!parseTitle(markdown)) {
    errors.push({
      kind: "missing-title",
      message: "Title must be a H1 line starting with `Brief: ` (e.g. `# Brief: API Platform Decision`).",
    });
  }

  const sections = parseSections(markdown);
  const kind: BriefKind | null = opts.expectedKind ?? null;
  if (!kind) {
    return { ok: errors.length === 0, detectedKind: null, errors, warnings };
  }

  const schema = briefSchema(kind);
  for (const required of schema.requiredSections) {
    const aliases = schema.aliases[required] ?? [];
    const found = findSection(sections, required, aliases);
    if (!found) {
      errors.push({
        kind: "missing-required",
        section: required,
        message: `Missing required section: \`## ${required}\`.`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    detectedKind: kind,
    errors,
    warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/brief-validate.test.ts`
Expected: all "title" + "required sections" tests pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/validate.ts tests/cli/brief-validate.test.ts
git commit -m "feat(brief): validate required sections per kind with alias support"
```

---

### Task 5: Validator empty-body check (strict vs lint)

**Files:**
- Modify: `cli/src/brief/validate.ts`
- Modify: `tests/cli/brief-validate.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe("validateBrief — empty section detection", () => {
  test("section with only whitespace flagged as empty (warning by default)", () => {
    const md = `# Brief: T\n## Situation\n\n   \n\n## Stakes\nS\n## Constraints\nC\n## Key Question\nQ`;
    const r = validateBrief(md, { expectedKind: "deliberation" });
    expect(r.warnings.find((w) => w.kind === "empty-section" && w.section === "Situation"))
      .toBeDefined();
    expect(r.errors.find((e) => e.section === "Situation")).toBeUndefined();
  });

  test("section with only HTML comment flagged as empty", () => {
    const md = `# Brief: T\n## Situation\n<!-- TODO: write -->\n## Stakes\nS\n## Constraints\nC\n## Key Question\nQ`;
    const r = validateBrief(md, { expectedKind: "deliberation" });
    expect(r.warnings.find((w) => w.section === "Situation")).toBeDefined();
  });

  test("strict mode upgrades empty-section warning to error", () => {
    const md = `# Brief: T\n## Situation\n\n## Stakes\nS\n## Constraints\nC\n## Key Question\nQ`;
    const r = validateBrief(md, { expectedKind: "deliberation", strict: true });
    expect(r.errors.find((e) => e.kind === "empty-section" && e.section === "Situation"))
      .toBeDefined();
    expect(r.warnings.find((w) => w.section === "Situation")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-validate.test.ts -t "empty section"`
Expected: FAIL.

- [ ] **Step 3: Modify the required-section loop in `cli/src/brief/validate.ts`**

Replace the body of the `for (const required of schema.requiredSections)` loop with:

```typescript
  for (const required of schema.requiredSections) {
    const aliases = schema.aliases[required] ?? [];
    const found = findSection(sections, required, aliases);
    if (!found) {
      errors.push({
        kind: "missing-required",
        section: required,
        message: `Missing required section: \`## ${required}\`.`,
      });
      continue;
    }
    if (isBodyEmpty(found.body)) {
      const issue: BriefIssue = {
        kind: "empty-section",
        section: required,
        message: `Section \`## ${required}\` is empty.`,
      };
      if (opts.strict) errors.push(issue);
      else warnings.push(issue);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/brief-validate.test.ts`
Expected: all tests so far pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/validate.ts tests/cli/brief-validate.test.ts
git commit -m "feat(brief): detect empty sections (warning default, error in strict mode)"
```

---

### Task 6: Validator "looks shaped for other-kind" hint

**Files:**
- Modify: `cli/src/brief/validate.ts`
- Modify: `tests/cli/brief-validate.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe("validateBrief — shape mismatch hint", () => {
  test("execution profile + brief with Key Question gets a 'looks shaped for deliberation' hint", () => {
    const md = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Key Question\nQ?`;
    const r = validateBrief(md, { expectedKind: "execution" });
    const hint = r.errors.find((e) => e.message.includes("looks shaped for `deliberation`"));
    expect(hint).toBeDefined();
  });

  test("no hint when only one missing-required (genuine partial brief, not wrong shape)", () => {
    const md = `# Brief: T\n## Feature / Vision\nv\n## Context\nc\n## Constraints\nc`;
    const r = validateBrief(md, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.message.includes("looks shaped"))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-validate.test.ts -t "shape mismatch"`
Expected: FAIL.

- [ ] **Step 3: Append shape-mismatch logic to `validate.ts`**

After the required-section loop, before the `return`, add:

```typescript
  if (opts.expectedKind) {
    const missingCount = errors.filter((e) => e.kind === "missing-required").length;
    if (missingCount >= 2) {
      const otherKind: BriefKind = opts.expectedKind === "deliberation" ? "execution" : "deliberation";
      const otherDiscrim = DISCRIMINATING_HEADINGS[otherKind];
      if (findSection(sections, otherDiscrim)) {
        errors.push({
          kind: "shape-mismatch-hint",
          message: `This brief looks shaped for \`${otherKind}\`. Either run a \`${otherKind}\` profile or re-author with \`aos create brief --kind ${opts.expectedKind}\`.`,
        });
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/brief-validate.test.ts`
Expected: all tests so far pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/validate.ts tests/cli/brief-validate.test.ts
git commit -m "feat(brief): append 'looks shaped for other-kind' hint when shape mismatches"
```

---

### Task 7: Validator auto-detect kind (low-confidence threshold)

**Files:**
- Modify: `cli/src/brief/validate.ts`
- Modify: `tests/cli/brief-validate.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe("validateBrief — auto-detect kind", () => {
  test("returns deliberation when 4 deliberation requireds present and 0 execution discriminating", () => {
    const md = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n## Key Question\nQ?`;
    const r = validateBrief(md);
    expect(r.detectedKind).toBe("deliberation");
  });

  test("returns null with auto-detect-failed when fewer than 2 requireds present in either kind", () => {
    const md = `# Brief: T\n## Constraints\nc`;
    const r = validateBrief(md);
    expect(r.detectedKind).toBeNull();
    expect(r.errors.find((e) => e.kind === "auto-detect-failed")).toBeDefined();
  });

  test("returns null on tied scores", () => {
    const md = `# Brief: T\n## Situation\ns\n## Constraints\nc\n## Context\nx`;
    const r = validateBrief(md);
    expect(r.detectedKind).toBeNull();
    expect(r.errors.find((e) => e.kind === "auto-detect-failed")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-validate.test.ts -t "auto-detect"`
Expected: FAIL.

- [ ] **Step 3: Add `autoDetectKind` and wire it in**

In `cli/src/brief/validate.ts`, replace the early `return` for null kind with auto-detection:

```typescript
  let kind: BriefKind | null;
  if (opts.expectedKind) {
    kind = opts.expectedKind;
  } else {
    kind = autoDetectKind(sections, errors);
  }

  if (!kind) {
    return { ok: false, detectedKind: null, errors, warnings };
  }
```

Add at the bottom of the file:

```typescript
function autoDetectKind(
  sections: ParsedSection[],
  errors: BriefIssue[],
): BriefKind | null {
  const delibSchema = briefSchema("deliberation");
  const execSchema = briefSchema("execution");

  let delibScore = 0;
  for (const req of delibSchema.requiredSections) {
    if (findSection(sections, req, delibSchema.aliases[req] ?? [])) delibScore++;
  }
  let execScore = 0;
  for (const req of execSchema.requiredSections) {
    if (findSection(sections, req, execSchema.aliases[req] ?? [])) execScore++;
  }

  const best = Math.max(delibScore, execScore);
  if (best < 2 || delibScore === execScore) {
    errors.push({
      kind: "auto-detect-failed",
      message:
        "Brief is missing too many required sections to determine kind. Specify `--kind deliberation` or `--kind execution`, or author from scratch with `aos create brief`.",
    });
    return null;
  }
  return delibScore > execScore ? "deliberation" : "execution";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/brief-validate.test.ts`
Expected: all tests pass (title, required, empty, shape-mismatch, auto-detect).

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/validate.ts tests/cli/brief-validate.test.ts
git commit -m "feat(brief): auto-detect kind with low-confidence threshold (best < 2 or tie => null)"
```

---

## Phase 3 — Template, prompts, write helper

### Task 8: Template renderer

**Files:**
- Create: `cli/src/brief/template.ts`
- Test: `tests/cli/brief-template.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
    const out = renderBriefTemplate({
      kind: "deliberation",
      title: "T",
      seedText: "raw user idea here",
    });
    expect(out).toContain("<!-- raw idea seed:");
    expect(out).toContain("raw user idea here");
    expect(out).toContain("-->");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-template.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `cli/src/brief/template.ts`**

```typescript
import type { BriefKind, BriefSections } from "./types";
import { briefSchema } from "./schema";

const SECTION_KEY_MAP: Record<BriefKind, Record<string, keyof BriefSections>> = {
  deliberation: {
    "Situation": "situation",
    "Stakes": "stakes",
    "Constraints": "constraints",
    "Background": "background",
    "Out of scope": "outOfScope",
    "Key Question": "keyQuestion",
  },
  execution: {
    "Feature / Vision": "featureVision",
    "Context": "context",
    "Constraints": "constraints",
    "Stakeholders": "stakeholders",
    "Out of scope": "outOfScope",
    "Open Questions": "openQuestions",
    "Success Criteria": "successCriteria",
  },
};

const PLACEHOLDER_TEXT: Record<string, string> = {
  "Situation": "Describe what is happening, who is involved, what triggered the decision.",
  "Stakes": "Spell out upside and downside for each path.",
  "Constraints": "List budget, timeline, technical, and regulatory constraints.",
  "Key Question": "State the single decision question for the council.",
  "Background": "Extended context (optional).",
  "Out of scope": "Things explicitly not on the table (optional).",
  "Feature / Vision": "What you're building and why.",
  "Context": "Environment, prior art, repo state.",
  "Success Criteria": "How will you know this is done?",
  "Stakeholders": "Who consumes this output (optional).",
  "Open Questions": "Known unknowns (optional).",
};

export interface RenderOpts {
  kind: BriefKind;
  title?: string;
  prefilled?: BriefSections;
  seedText?: string;
}

export function renderBriefTemplate(opts: RenderOpts): string {
  const lines: string[] = [];
  lines.push(`# Brief: ${opts.title ?? "TODO"}`);
  lines.push("");

  if (opts.seedText) {
    lines.push("<!-- raw idea seed:");
    for (const line of opts.seedText.split("\n")) lines.push(line);
    lines.push("-->");
    lines.push("");
  }

  const schema = briefSchema(opts.kind);
  const keyMap = SECTION_KEY_MAP[opts.kind];
  const ordered = [...schema.requiredSections];
  for (const opt of schema.optionalSections) if (!ordered.includes(opt)) ordered.push(opt);

  for (const heading of ordered) {
    lines.push(`## ${heading}`);
    lines.push("");
    const key = keyMap[heading];
    const filled = key ? opts.prefilled?.[key] : undefined;
    if (filled && filled.trim()) {
      lines.push(filled.trim());
    } else {
      lines.push(`<!-- TODO: ${PLACEHOLDER_TEXT[heading] ?? `Describe ${heading.toLowerCase()}.`} -->`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/brief-template.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/template.ts tests/cli/brief-template.test.ts
git commit -m "feat(brief): render template with placeholder TODOs and HTML-comment seed"
```

---

### Task 9: Atomic write helper

**Files:**
- Create: `cli/src/brief/write.ts`
- Test: `tests/cli/brief-write.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteBrief } from "../../cli/src/brief/write";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "aos-brief-"));
}

describe("atomicWriteBrief", () => {
  test("creates parent directories and writes content", async () => {
    const root = tmpDir();
    const path = join(root, "briefs", "foo", "brief.md");
    await atomicWriteBrief(path, "# Brief: x\n", { force: false });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("# Brief: x\n");
  });

  test("throws when target exists without --force", async () => {
    const root = tmpDir();
    const path = join(root, "brief.md");
    writeFileSync(path, "old", "utf-8");
    await expect(atomicWriteBrief(path, "new", { force: false })).rejects.toThrow(/already exists/);
  });

  test("overwrites with --force", async () => {
    const root = tmpDir();
    const path = join(root, "brief.md");
    writeFileSync(path, "old", "utf-8");
    await atomicWriteBrief(path, "new", { force: true });
    expect(readFileSync(path, "utf-8")).toBe("new");
  });

  test("does not leave .tmp file when content writes successfully", async () => {
    const root = tmpDir();
    const path = join(root, "brief.md");
    await atomicWriteBrief(path, "x", { force: false });
    const tmpFiles = require("node:fs").readdirSync(root).filter((f: string) => f.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-write.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `cli/src/brief/write.ts`**

```typescript
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export interface WriteOpts {
  force: boolean;
}

export async function atomicWriteBrief(
  targetPath: string,
  content: string,
  opts: WriteOpts,
): Promise<void> {
  if (existsSync(targetPath) && !opts.force) {
    throw new Error(`Brief already exists at ${targetPath}. Pass --force to overwrite.`);
  }

  const parent = dirname(targetPath);
  try {
    mkdirSync(parent, { recursive: true });
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EROFS") {
      throw new Error(
        `Cannot create directory ${parent}: permission denied. Use --out <path> to write somewhere else.`,
      );
    }
    throw err;
  }

  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/brief-write.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/write.ts tests/cli/brief-write.test.ts
git commit -m "feat(brief): atomic write helper with mkdir -p, .tmp cleanup, --force semantics"
```

---

### Task 10: Interactive prompt loop

**Files:**
- Create: `cli/src/brief/prompts.ts`
- Test: `tests/cli/brief-prompts.test.ts`

The prompt loop reads stdin line-by-line. To keep it testable, we accept an injectable reader interface.

- [ ] **Step 1: Write the failing test**

```typescript
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
    const reader = fakeReader([
      "test-slug",        // slug
      "1",                // kind: deliberation
      "Test Title",       // title
      "S body", "",       // situation (multi-line, blank ends)
      "Stakes body", "",
      "Constraints body", "",
      "Key Q?", "",
    ]);
    const result = await runBriefPromptLoop({ reader, seedText: undefined, kind: undefined });
    expect(result.slug).toBe("test-slug");
    expect(result.kind).toBe("deliberation");
    expect(result.title).toBe("Test Title");
    expect(result.sections.situation).toBe("S body");
    expect(result.sections.keyQuestion).toBe("Key Q?");
  });

  test("respects pre-seeded kind (skips kind prompt)", async () => {
    const reader = fakeReader([
      "slug",
      "Title",
      "F body", "",
      "C body", "",
      "Constraints", "",
      "Done", "",
    ]);
    const result = await runBriefPromptLoop({ reader, kind: "execution" });
    expect(result.kind).toBe("execution");
    expect(result.sections.featureVision).toBe("F body");
    expect(result.sections.successCriteria).toBe("Done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `cli/src/brief/prompts.ts`**

```typescript
import type { BriefKind, BriefSections } from "./types";
import { briefSchema } from "./schema";

export interface LineReader {
  readLine(): Promise<string>;
}

export interface PromptLoopOpts {
  reader: LineReader;
  kind?: BriefKind;
  slug?: string;
  title?: string;
  seedText?: string;
  log?: (line: string) => void;
}

export interface PromptLoopResult {
  slug: string;
  kind: BriefKind;
  title: string;
  sections: BriefSections;
}

const SECTION_PROMPTS: Record<BriefKind, Array<{ key: keyof BriefSections; label: string }>> = {
  deliberation: [
    { key: "situation", label: "What's the situation? (multi-line, end with blank line)" },
    { key: "stakes", label: "What's at stake?" },
    { key: "constraints", label: "What constraints apply?" },
    { key: "keyQuestion", label: "What is the single key question for the council?" },
  ],
  execution: [
    { key: "featureVision", label: "What feature or vision are we building?" },
    { key: "context", label: "What context (environment, prior art, repo state)?" },
    { key: "constraints", label: "What constraints apply?" },
    { key: "successCriteria", label: "What success criteria define done?" },
  ],
};

export async function runBriefPromptLoop(opts: PromptLoopOpts): Promise<PromptLoopResult> {
  const log = opts.log ?? ((s: string) => console.log(s));

  if (opts.seedText) log(`\nYour seed: ${opts.seedText}\n`);

  const slug = opts.slug ?? (await ask(opts.reader, log, "Slug for this brief (kebab-case)?"));
  let kind: BriefKind;
  if (opts.kind) {
    kind = opts.kind;
  } else {
    log("\nKind?");
    log("  1. deliberation");
    log("  2. execution");
    const choice = (await ask(opts.reader, log, "Enter number:")).trim();
    kind = choice === "2" ? "execution" : "deliberation";
  }
  const title = opts.title ?? (await ask(opts.reader, log, "One-line title?"));

  const sections: BriefSections = {};
  for (const { key, label } of SECTION_PROMPTS[kind]) {
    const body = await askMultiline(opts.reader, log, label);
    (sections as any)[key] = body;
  }

  return { slug, kind, title, sections };
}

async function ask(reader: LineReader, log: (s: string) => void, label: string): Promise<string> {
  log(`\n${label}`);
  return (await reader.readLine()).trim();
}

async function askMultiline(reader: LineReader, log: (s: string) => void, label: string): Promise<string> {
  log(`\n${label}`);
  const buf: string[] = [];
  while (true) {
    const line = await reader.readLine();
    if (line.trim() === "") break;
    buf.push(line);
  }
  return buf.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/brief-prompts.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add cli/src/brief/prompts.ts tests/cli/brief-prompts.test.ts
git commit -m "feat(brief): interactive prompt loop with injectable line reader"
```

---

## Phase 4 — CLI surface

### Task 11: Register `brief` command and skeleton

**Files:**
- Create: `cli/src/commands/brief.ts`
- Modify: `cli/src/index.ts`

This task gets the dispatch wired so subsequent tasks just add subcommand handlers.

- [ ] **Step 1: Write the failing test**

Append to a new file `tests/cli/brief-cli.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

function runCli(args: string[], stdin?: string) {
  const res = spawnSync("bun", [CLI, ...args], {
    input: stdin,
    encoding: "utf-8",
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status ?? 0 };
}

describe("aos brief command dispatch", () => {
  test("`aos brief --help` prints subcommand list", () => {
    const r = runCli(["brief", "--help"]);
    expect(r.stdout + r.stderr).toContain("brief");
    expect(r.stdout + r.stderr).toContain("template");
    expect(r.stdout + r.stderr).toContain("validate");
    expect(r.stdout + r.stderr).toContain("save");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-cli.test.ts -t "dispatch"`
Expected: FAIL (`brief` is not a recognized command).

- [ ] **Step 3: Write `cli/src/commands/brief.ts`**

```typescript
import { c } from "../colors";
import type { ParsedArgs } from "../colors";

const HELP = `
${c.bold("aos brief")} — Work with brief files

${c.bold("USAGE")}
  aos brief <subcommand> [options]

${c.bold("SUBCOMMANDS")}
  ${c.cyan("template")}    Render a blank brief template to stdout or --out
  ${c.cyan("validate")}    Validate a brief against its schema
  ${c.cyan("save")}        Atomically write a brief (used by skills)

${c.bold("EXAMPLES")}
  aos brief template --kind deliberation
  aos brief validate ./briefs/foo/brief.md --kind deliberation
  aos brief save ./briefs/foo/brief.md --kind execution --from-file draft.md
`;

export async function briefCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help && !args.subcommand) {
    console.log(HELP);
    return;
  }

  switch (args.subcommand) {
    case "template":
    case "validate":
    case "save":
      console.error(c.yellow(`Subcommand "${args.subcommand}" not yet implemented.`));
      process.exit(2);
      return;
    case "":
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(c.red(`Unknown brief subcommand: "${args.subcommand}". Run "aos brief --help".`));
      process.exit(2);
  }
}
```

- [ ] **Step 4: Register in `cli/src/index.ts`**

Find the imports near the top and add:

```typescript
import { briefCommand } from "./commands/brief";
```

Find the `switch (parsed.command)` block and add a case:

```typescript
    case "brief":
      await briefCommand(parsed);
      break;
```

In the help text (the `printHelp` function), add a line under `COMMANDS`:

```typescript
  ${c.cyan("brief")} <sub>                   Work with brief files (template/validate/save)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/cli/brief-cli.test.ts -t "dispatch"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/brief.ts cli/src/index.ts tests/cli/brief-cli.test.ts
git commit -m "feat(cli): register `aos brief` command with subcommand dispatch skeleton"
```

---

### Task 12: `aos brief template` subcommand

**Files:**
- Modify: `cli/src/commands/brief.ts`
- Modify: `tests/cli/brief-cli.test.ts`

- [ ] **Step 1: Append failing test**

```typescript
describe("aos brief template", () => {
  test("prints execution template with required sections to stdout", () => {
    const r = runCli(["brief", "template", "--kind", "execution"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("# Brief:");
    expect(r.stdout).toContain("## Feature / Vision");
    expect(r.stdout).toContain("## Success Criteria");
  });

  test("requires --kind", () => {
    const r = runCli(["brief", "template"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--kind");
  });

  test("rejects unknown kind", () => {
    const r = runCli(["brief", "template", "--kind", "bogus"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("kind must be");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-cli.test.ts -t "template"`
Expected: FAIL.

- [ ] **Step 3: Implement `template` case in `briefCommand`**

Replace the `case "template":` line in the switch with:

```typescript
    case "template": {
      const kind = args.flags["kind"] as string | undefined;
      if (!kind) {
        console.error(c.red("Missing --kind. Use --kind deliberation or --kind execution."));
        process.exit(2);
      }
      if (kind !== "deliberation" && kind !== "execution") {
        console.error(c.red(`--kind must be deliberation or execution (got "${kind}").`));
        process.exit(2);
      }
      const { renderBriefTemplate } = await import("../brief/template");
      const title = (args.flags["title"] as string | undefined) ?? "TODO";
      const seedText = (args.flags["idea"] as string | undefined);
      const out = renderBriefTemplate({ kind, title, seedText });
      const outPath = args.flags["out"] as string | undefined;
      if (outPath) {
        const { atomicWriteBrief } = await import("../brief/write");
        await atomicWriteBrief(outPath, out, { force: Boolean(args.flags["force"]) });
        console.error(c.dim(`Template written to ${outPath}.`));
      } else {
        process.stdout.write(out);
      }
      return;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/brief-cli.test.ts -t "template"`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/brief.ts tests/cli/brief-cli.test.ts
git commit -m "feat(cli): aos brief template renders kind-specific stub to stdout or --out"
```

---

### Task 13: `aos brief validate` subcommand

**Files:**
- Modify: `cli/src/commands/brief.ts`
- Modify: `tests/cli/brief-cli.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function tmpFile(content: string, name = "brief.md"): string {
  const dir = mkdtempSync(join(tmpdir(), "aos-brief-cli-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("aos brief validate", () => {
  const goodDelib = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n## Key Question\nQ?\n`;
  const missingKQ = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n`;
  const emptySection = `# Brief: T\n## Situation\n\n## Stakes\nx\n## Constraints\nc\n## Key Question\nQ?\n`;

  test("exits 0 with no stderr on a clean brief", () => {
    const r = runCli(["brief", "validate", tmpFile(goodDelib), "--kind", "deliberation"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("exits 1 with section name in stderr on missing required", () => {
    const r = runCli(["brief", "validate", tmpFile(missingKQ), "--kind", "deliberation"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Key Question");
  });

  test("exits 0 by default on empty section (warning)", () => {
    const r = runCli(["brief", "validate", tmpFile(emptySection), "--kind", "deliberation"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("empty");
  });

  test("exits 1 with --strict on empty section", () => {
    const r = runCli(["brief", "validate", tmpFile(emptySection), "--kind", "deliberation", "--strict"]);
    expect(r.status).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-cli.test.ts -t "validate"`
Expected: FAIL.

- [ ] **Step 3: Implement `validate` case in `briefCommand`**

Replace the `case "validate":` line with:

```typescript
    case "validate": {
      const path = args.positional[1]; // first positional after subcommand
      if (!path) {
        console.error(c.red("Missing brief path. Usage: aos brief validate <path> [--kind <k>] [--strict]"));
        process.exit(2);
      }
      const { readFileSync, existsSync } = await import("node:fs");
      if (!existsSync(path)) {
        console.error(c.red(`Brief file not found: ${path}`));
        process.exit(2);
      }
      const content = readFileSync(path, "utf-8");
      const kind = args.flags["kind"] as ("deliberation" | "execution" | undefined);
      const strict = Boolean(args.flags["strict"]);
      const { validateBrief } = await import("../brief/validate");
      const r = validateBrief(content, { expectedKind: kind, strict });
      for (const issue of [...r.errors, ...r.warnings]) {
        const sectionLabel = issue.section ? `[${issue.section}] ` : "";
        console.error(c.yellow(`${sectionLabel}${issue.message}`));
      }
      process.exit(r.errors.length > 0 ? 1 : 0);
    }
```

- [ ] **Step 4: Verify `parseArgs` collects positionals correctly**

Open `cli/src/colors.ts` and confirm `parseArgs` exposes `positional[]` including the subcommand. If `args.positional[0]` is the subcommand and `args.positional[1]` is the file path, the code above is correct. If not, adjust the index. (Spot-check by adding `console.log(args)` temporarily.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/brief-cli.test.ts -t "validate"`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/brief.ts tests/cli/brief-cli.test.ts
git commit -m "feat(cli): aos brief validate exits non-zero on errors, --strict on empty sections"
```

---

### Task 14: `aos brief save` subcommand

**Files:**
- Modify: `cli/src/commands/brief.ts`
- Modify: `tests/cli/brief-cli.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe("aos brief save", () => {
  const goodExec = `# Brief: T\n## Feature / Vision\nv\n## Context\nc\n## Constraints\nc\n## Success Criteria\ns\n`;
  const missingSC = `# Brief: T\n## Feature / Vision\nv\n## Context\nc\n## Constraints\nc\n`;

  test("save accepts --from-file and writes to target", () => {
    const src = tmpFile(goodExec, "src.md");
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    expect(r.status).toBe(0);
    expect(require("node:fs").readFileSync(dest, "utf-8")).toContain("Feature / Vision");
  });

  test("save rejects bad brief, exits non-zero, names the missing section", () => {
    const src = tmpFile(missingSC, "src.md");
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Success Criteria");
    expect(require("node:fs").existsSync(dest)).toBe(false);
  });

  test("save accepts --from-stdin", () => {
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-stdin"], goodExec);
    expect(r.status).toBe(0);
  });

  test("save without --force on existing file errors", () => {
    const src = tmpFile(goodExec, "src.md");
    const dest = join(mkdtempSync(join(tmpdir(), "aos-save-")), "out.md");
    runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    const r = runCli(["brief", "save", dest, "--kind", "execution", "--from-file", src]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("already exists");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/brief-cli.test.ts -t "save"`
Expected: FAIL.

- [ ] **Step 3: Implement `save` case in `briefCommand`**

Replace the `case "save":` line with:

```typescript
    case "save": {
      const path = args.positional[1];
      if (!path) {
        console.error(c.red("Missing target path. Usage: aos brief save <path> --kind <k> [--from-file <p> | --from-stdin]"));
        process.exit(2);
      }
      const kind = args.flags["kind"] as ("deliberation" | "execution" | undefined);
      if (kind !== "deliberation" && kind !== "execution") {
        console.error(c.red("--kind required (deliberation or execution)."));
        process.exit(2);
      }

      let content: string;
      const fromFile = args.flags["from-file"] as string | undefined;
      const fromStdin = Boolean(args.flags["from-stdin"]);
      if (fromFile) {
        const { readFileSync, existsSync } = await import("node:fs");
        if (!existsSync(fromFile)) {
          console.error(c.red(`--from-file path not found: ${fromFile}`));
          process.exit(2);
        }
        content = readFileSync(fromFile, "utf-8");
      } else if (fromStdin) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
        content = new TextDecoder().decode(Buffer.concat(chunks));
      } else {
        console.error(c.red("Must pass --from-file <path> or --from-stdin."));
        process.exit(2);
      }

      const { validateBrief } = await import("../brief/validate");
      const r = validateBrief(content, { expectedKind: kind, strict: true });
      if (r.errors.length > 0) {
        console.error(c.red(`Brief validation failed (${r.errors.length} error${r.errors.length === 1 ? "" : "s"}):`));
        for (const err of r.errors) {
          const sectionLabel = err.section ? `[${err.section}] ` : "";
          console.error(c.red(`  ${sectionLabel}${err.message}`));
        }
        process.exit(1);
      }

      const { atomicWriteBrief } = await import("../brief/write");
      try {
        await atomicWriteBrief(path, content, { force: Boolean(args.flags["force"]) });
      } catch (err: any) {
        console.error(c.red(err.message));
        process.exit(1);
      }
      console.log(c.green(`Brief saved to ${path}`));
      return;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/brief-cli.test.ts -t "save"`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/brief.ts tests/cli/brief-cli.test.ts
git commit -m "feat(cli): aos brief save validates strict, writes atomically, --force/--from-file/--from-stdin"
```

---

### Task 15: `aos create brief` (interactive + non-interactive)

**Files:**
- Modify: `cli/src/commands/create.ts`
- Create: `tests/cli/create-brief.test.ts`

The non-interactive flag mode is the testable path; interactive mode is exercised by the prompt-loop unit tests.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/create-brief.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

function runCli(args: string[], cwd?: string) {
  const res = spawnSync("bun", [CLI, ...args], { encoding: "utf-8", cwd });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status ?? 0 };
}

describe("aos create brief --non-interactive", () => {
  test("writes a deliberation brief to ./briefs/<slug>/brief.md in CWD", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const r = runCli([
      "create", "brief", "test-slug",
      "--kind", "deliberation",
      "--title", "Test",
      "--situation", "S body",
      "--stakes", "T body",
      "--constraints", "C body",
      "--key-question", "Q?",
      "--non-interactive",
    ], cwd);
    expect(r.status).toBe(0);
    const path = join(cwd, "briefs", "test-slug", "brief.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("# Brief: Test");
    expect(content).toContain("## Key Question");
    expect(content).toContain("Q?");
  });

  test("writes execution brief with required flags", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const r = runCli([
      "create", "brief", "exec-slug",
      "--kind", "execution",
      "--title", "X",
      "--feature", "F body",
      "--context", "Ctx",
      "--constraints", "C",
      "--success-criteria", "SC",
      "--non-interactive",
    ], cwd);
    expect(r.status).toBe(0);
    expect(existsSync(join(cwd, "briefs", "exec-slug", "brief.md"))).toBe(true);
  });

  test("errors when required flag missing in --non-interactive", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const r = runCli([
      "create", "brief", "x",
      "--kind", "deliberation",
      "--title", "T",
      "--situation", "s",
      "--non-interactive",
      // missing --stakes --constraints --key-question
    ], cwd);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Stakes|Constraints|Key Question/);
  });

  test("--out overrides default path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const out = join(cwd, "elsewhere", "x.md");
    const r = runCli([
      "create", "brief", "ignored-slug",
      "--kind", "deliberation",
      "--title", "T",
      "--situation", "s",
      "--stakes", "x",
      "--constraints", "c",
      "--key-question", "q?",
      "--out", out,
      "--non-interactive",
    ], cwd);
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  test("refuses overwrite without --force", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aos-create-"));
    const args = [
      "create", "brief", "dup",
      "--kind", "deliberation",
      "--title", "T",
      "--situation", "s",
      "--stakes", "x",
      "--constraints", "c",
      "--key-question", "q?",
      "--non-interactive",
    ];
    expect(runCli(args, cwd).status).toBe(0);
    const second = runCli(args, cwd);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("already exists");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/create-brief.test.ts`
Expected: FAIL (`brief` not in create dispatch).

- [ ] **Step 3: Add `brief` case to `cli/src/commands/create.ts`**

In the existing `createCommand` function, find the dispatch (search for `case "agent":`) and add a `brief` case. Then add a `createBrief` helper at the bottom of the file:

```typescript
// Add to the switch in createCommand:
    case "brief":
      await createBrief(args);
      return;
```

```typescript
// New function at the bottom of the file:
async function createBrief(args: ParsedArgs): Promise<void> {
  const { renderBriefTemplate } = await import("../brief/template");
  const { validateBrief } = await import("../brief/validate");
  const { atomicWriteBrief } = await import("../brief/write");
  const { runBriefPromptLoop } = await import("../brief/prompts");

  const slugPositional = args.positional[1]; // [0]=brief, [1]=slug
  const kindFlag = args.flags["kind"] as ("deliberation" | "execution" | undefined);
  const titleFlag = args.flags["title"] as string | undefined;
  const seedText = (args.flags["idea"] as string | undefined) ??
    (args.flags["from-notes"] ? require("node:fs").readFileSync(args.flags["from-notes"], "utf-8") : undefined);
  const nonInteractive = Boolean(args.flags["non-interactive"]);
  const force = Boolean(args.flags["force"]);

  let slug: string;
  let kind: "deliberation" | "execution";
  let title: string;
  let sections: any = {};

  if (nonInteractive) {
    if (!slugPositional) {
      console.error(c.red("--non-interactive requires <slug> positional."));
      process.exit(2);
    }
    if (!kindFlag) {
      console.error(c.red("--non-interactive requires --kind."));
      process.exit(2);
    }
    if (!titleFlag) {
      console.error(c.red("--non-interactive requires --title."));
      process.exit(2);
    }
    slug = slugPositional;
    kind = kindFlag;
    title = titleFlag;
    if (kind === "deliberation") {
      sections = {
        situation: args.flags["situation"] as string | undefined,
        stakes: args.flags["stakes"] as string | undefined,
        constraints: args.flags["constraints"] as string | undefined,
        keyQuestion: args.flags["key-question"] as string | undefined,
      };
    } else {
      sections = {
        featureVision: args.flags["feature"] as string | undefined,
        context: args.flags["context"] as string | undefined,
        constraints: args.flags["constraints"] as string | undefined,
        successCriteria: args.flags["success-criteria"] as string | undefined,
      };
    }
  } else {
    const reader = {
      async readLine(): Promise<string> {
        const r = Bun.stdin.stream().getReader();
        const { value } = await r.read();
        r.releaseLock();
        return value ? new TextDecoder().decode(value) : "";
      },
    };
    const result = await runBriefPromptLoop({
      reader,
      kind: kindFlag,
      slug: slugPositional,
      title: titleFlag,
      seedText,
    });
    slug = result.slug;
    kind = result.kind;
    title = result.title;
    sections = result.sections;
  }

  const rendered = renderBriefTemplate({ kind, title, prefilled: sections, seedText });
  const validation = validateBrief(rendered, { expectedKind: kind, strict: true });
  if (validation.errors.length > 0) {
    console.error(c.red("Brief incomplete:"));
    for (const err of validation.errors) {
      const sectionLabel = err.section ? `[${err.section}] ` : "";
      console.error(c.red(`  ${sectionLabel}${err.message}`));
    }
    process.exit(1);
  }

  const outFlag = args.flags["out"] as string | undefined;
  const shared = Boolean(args.flags["shared"]);
  let targetPath: string;
  if (outFlag) {
    targetPath = require("node:path").resolve(process.cwd(), outFlag);
  } else if (shared) {
    const { getHarnessRoot } = await import("../utils");
    targetPath = require("node:path").join(getHarnessRoot(), "core", "briefs", slug, "brief.md");
  } else {
    targetPath = require("node:path").resolve(process.cwd(), "briefs", slug, "brief.md");
  }

  try {
    await atomicWriteBrief(targetPath, rendered, { force });
  } catch (err: any) {
    console.error(c.red(err.message));
    process.exit(1);
  }

  console.log(c.green(`Brief saved to ${targetPath}`));
  console.log(c.dim(`Run with: aos run <profile> --brief ${targetPath}`));
}
```

Also add `case "brief":` to the help text inside `create.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/create-brief.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/create.ts tests/cli/create-brief.test.ts
git commit -m "feat(cli): aos create brief writes per-kind brief, supports --shared/--out/--non-interactive/--force"
```

---

## Phase 5 — Run-time integration

### Task 16: `aos run` lint summary line

**Files:**
- Modify: `cli/src/commands/run.ts`
- Create: `tests/cli/run-brief-lint.test.ts`

- [ ] **Step 1: Locate the brief-resolution block in `run.ts`**

Around line 199, after the `briefPath = resolve(process.cwd(), briefPath); if (!existsSync(briefPath))` block. The `expectedKind` should be derived from `isExecutionProfile`, which is computed later in the function (~line 439). We need to ensure the validate call happens *after* `isExecutionProfile` is known. Two ways:
1. Move the validate call further down, after profile/workflow resolution.
2. Compute `isExecutionProfile` earlier so the validate can use it.

Choose (1) — validate after profile resolution, just before the deliberation directory is created (around line 433).

- [ ] **Step 2: Write the failing test**

Create `tests/cli/run-brief-lint.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

// Use the existing committed strategic-council profile + a synthesized brief.
function setupProject(briefContent: string): { cwd: string; briefPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), "aos-run-lint-"));
  const briefPath = join(cwd, "brief.md");
  writeFileSync(briefPath, briefContent, "utf-8");
  return { cwd, briefPath };
}

describe("aos run brief lint", () => {
  test("prints clean summary on a valid deliberation brief (with --dry-run)", () => {
    const goodDelib = `# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n## Key Question\nq?\n`;
    const { briefPath } = setupProject(goodDelib);
    const r = spawnSync("bun", [CLI, "run", "strategic-council", "--brief", briefPath, "--dry-run"], {
      encoding: "utf-8",
      cwd: join(import.meta.dir, "..", ".."),
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("Brief lint:");
    expect(combined).toMatch(/looks good|0 errors/);
  });

  test("prints error count when brief missing required sections", () => {
    const badDelib = `# Brief: T\n## Situation\ns\n`;
    const { briefPath } = setupProject(badDelib);
    const r = spawnSync("bun", [CLI, "run", "strategic-council", "--brief", briefPath, "--dry-run"], {
      encoding: "utf-8",
      cwd: join(import.meta.dir, "..", ".."),
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("Brief lint:");
    expect(combined).toMatch(/error/);
    expect(combined).toContain("aos brief validate");
  });
});
```

- [ ] **Step 2 (continued): Run test to verify it fails**

Run: `bun test tests/cli/run-brief-lint.test.ts`
Expected: FAIL (no lint summary printed).

- [ ] **Step 3: Insert the lint block in `run.ts`**

Find the line that creates the deliberation directory:

```typescript
  const sessionId = `${new Date().toISOString().slice(0, 10)}-${profileName}-${Date.now().toString(36)}`;
  const deliberationDir = join(root, ".aos", "sessions", sessionId);
  mkdirSync(deliberationDir, { recursive: true });
```

Insert immediately before that block:

```typescript
  // Brief lint (warnings only, never blocks).
  try {
    const briefContent = readFileSync(briefPath, "utf-8");
    const expectedKind: "deliberation" | "execution" = isExecutionProfile ? "execution" : "deliberation";
    const { validateBrief } = await import("../brief/validate");
    const briefValidation = validateBrief(briefContent, { expectedKind });
    const errCount = briefValidation.errors.length;
    const warnCount = briefValidation.warnings.length;
    if (errCount === 0 && warnCount === 0) {
      console.error(c.dim(`✓ Brief lint: ${expectedKind} brief looks good.`));
    } else {
      console.error(
        c.yellow(
          `⚠ Brief lint: ${errCount} error${errCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"}.`,
        ),
      );
      console.error(
        c.dim(
          `  Run \`aos brief validate ${briefPath}\` for details, or \`aos create brief\` to author from a template.`,
        ),
      );
    }
  } catch (err) {
    // Lint never blocks. If it fails, log dim and proceed.
    console.error(c.dim(`(brief lint skipped: ${(err as Error).message})`));
  }
```

Confirm `readFileSync` is already imported in `run.ts` — if not, add to the existing `node:fs` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/run-brief-lint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/run.ts tests/cli/run-brief-lint.test.ts
git commit -m "feat(run): emit brief lint summary line (clean or error count + hint)"
```

---

## Phase 6 — Plugin packaging

### Task 17: aos-create-brief SKILL.md (shared)

**Files:**
- Create: `plugins/aos-harness/skills/aos-create-brief/SKILL.md`

This file is data, not code, but we still verify it parses and contains the right anchors.

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/brief-cli.test.ts`:

```typescript
describe("aos-create-brief skill", () => {
  test("SKILL.md exists and includes both schemas + --from-file guidance", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", "skills", "aos-create-brief", "SKILL.md");
    const content = require("node:fs").readFileSync(path, "utf-8");
    expect(content).toContain("name: aos-create-brief");
    expect(content).toContain("Situation");
    expect(content).toContain("Stakes");
    expect(content).toContain("Key Question");
    expect(content).toContain("Feature / Vision");
    expect(content).toContain("Success Criteria");
    expect(content).toContain("--from-file");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/brief-cli.test.ts -t "aos-create-brief skill"`
Expected: FAIL (file not found).

- [ ] **Step 3: Write the SKILL.md**

Create `plugins/aos-harness/skills/aos-create-brief/SKILL.md`:

```markdown
---
name: aos-create-brief
description: Author an AOS brief by conducting a guided conversation, then validate and save through the harness CLI.
metadata:
  short-description: Author an AOS brief
---

# AOS Create Brief

Use this skill when the user wants to create a brief for an AOS deliberation
(decision-making) or execution (build/ship) run, especially when they have an
idea but don't know the brief format.

## Prerequisites

- The user is inside a project directory (writes default to ./briefs/<slug>/).
- `bun` is on PATH and the AOS harness wrapper is reachable.

Resolve the wrapper path first (same pattern as other AOS skills):

```bash
if [ -x "$HOME/plugins/aos-harness/scripts/aos_cli.sh" ]; then
  AOS_WRAPPER="$HOME/plugins/aos-harness/scripts/aos_cli.sh"
else
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  export AOS_HARNESS_ROOT="${AOS_HARNESS_ROOT:-$REPO_ROOT}"
  AOS_WRAPPER="$REPO_ROOT/plugins/aos-harness/scripts/aos_cli.sh"
fi
```

## Workflow

1. Ask the user: "Are we building something (execution) or deciding something (deliberation)?"
2. Ask for a one-line title and a kebab-case slug.
3. Conduct a conversation in your own voice gathering content for each required section of the chosen kind. Keep questions specific — don't dump the whole schema on the user; ask one or two at a time.
4. Draft the brief markdown — clear, specific, no filler.
5. Write the draft to a tempfile (use your normal file-write tool), then call `aos brief save`:

```bash
"$AOS_WRAPPER" brief save "./briefs/<slug>/brief.md" \
  --kind <kind> --from-file "<tempfile>"
```

   Use `--from-file`, not `--from-stdin` — markdown often contains backticks,
   dollar signs, and single quotes that break shell piping.

6. If validation fails, the CLI lists each issue with section name. Re-draft only the failing section(s), rewrite the tempfile, re-run `save`. Do not re-draft sections the validator accepted.
7. Report the saved path. Suggest the run command but **leave `<profile>` as a placeholder** — do not guess:

   `Run with: aos run <profile> --brief ./briefs/<slug>/brief.md`

   If the user asks for a profile recommendation, run `"$AOS_WRAPPER" list profiles` and offer based on the kind they chose.

## Schema (must follow)

### Deliberation kind (decision-focused)

Required:
- `# Brief: <title>`
- `## Situation` — what's happening, who's involved, what triggered the decision
- `## Stakes` — upside / downside framing
- `## Constraints` — budget, timeline, technical, regulatory
- `## Key Question` — the single decision question for the council

Optional: `## Background`, `## Out of scope`.

### Execution kind (build-focused)

Required:
- `# Brief: <title>`
- `## Feature / Vision` — what we're building and why (alias `## Vision` accepted)
- `## Context` — environment, prior art, repo state
- `## Constraints` — non-negotiables
- `## Success Criteria` — how we know we're done

Optional: `## Stakeholders`, `## Out of scope`, `## Open Questions`.

## Guardrails

- Default to writing under the user's current working directory (`./briefs/<slug>/`). Use `--shared` only if the user explicitly wants to commit a brief into the harness samples.
- Never overwrite an existing brief without explicit user confirmation (`--force`).
- Don't invent stakes, constraints, or success criteria the user hasn't stated. If a required section is genuinely empty, ask one more question rather than fabricate.
- Don't pick a profile for the user. Suggest with a placeholder; let them choose.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/brief-cli.test.ts -t "aos-create-brief skill"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/aos-harness/skills/aos-create-brief/SKILL.md tests/cli/brief-cli.test.ts
git commit -m "feat(plugins): add aos-create-brief shared SKILL.md (Claude Code/Codex/Gemini)"
```

---

### Task 18: Claude Code slash command file

**Files:**
- Create: `plugins/aos-harness/claude-code/commands/aos-create-brief.md`

- [ ] **Step 1: Inspect the existing pattern**

Read `plugins/aos-harness/claude-code/commands/aos-run-deliberation.md` to copy its front-matter shape.

- [ ] **Step 2: Write the command file**

Create `plugins/aos-harness/claude-code/commands/aos-create-brief.md`:

```markdown
---
description: Author a new AOS brief through a guided conversation
---

# AOS Create Brief

You are running the AOS Create Brief skill. Load and follow the instructions in:
`plugins/aos-harness/skills/aos-create-brief/SKILL.md`.

The user has invoked `/aos-create-brief`. Begin by asking whether they want to
author a deliberation brief (decision-making) or an execution brief (build/ship),
then conduct the workflow described in the skill.

When you call `aos brief save`, prefer `--from-file <tempfile>` over piping via stdin.
```

- [ ] **Step 3: Verify**

Run: `bun test tests/cli/brief-cli.test.ts` — confirm nothing else regresses.

- [ ] **Step 4: Commit**

```bash
git add plugins/aos-harness/claude-code/commands/aos-create-brief.md
git commit -m "feat(plugins): add Claude Code /aos-create-brief slash command"
```

---

### Task 19: Gemini extension manifest + install.sh

**Files:**
- Create: `plugins/aos-harness/.gemini/extension.json`
- Create: `plugins/aos-harness/gemini/install.sh`

- [ ] **Step 1: Look up the current Gemini CLI extension manifest format**

Run: `gemini --help` and `gemini extensions --help` (if available) to confirm the manifest filename and required fields. If the format is documented at https://ai.google.dev/gemini-api/docs/cli/extensions, fetch the page. Adjust field names below if Gemini's current schema differs from this template.

- [ ] **Step 2: Write `plugins/aos-harness/.gemini/extension.json`**

```json
{
  "name": "aos-harness",
  "version": "0.8.5",
  "description": "Run AOS Harness deliberation and execution workflows from Gemini.",
  "author": "AOS Engineer",
  "homepage": "https://github.com/aos-engineer/aos-harness",
  "skills": "../skills/"
}
```

If Gemini's manifest schema requires different field names (e.g. `displayName`, `commands`), match its requirements and keep the `skills: "../skills/"` pointer so the shared directory is reused.

- [ ] **Step 3: Write `plugins/aos-harness/gemini/install.sh`**

Mirror the structure of `plugins/aos-harness/claude-code/install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v gemini >/dev/null 2>&1; then
  echo "Gemini CLI not found on PATH. Install from https://ai.google.dev/gemini-api/docs/cli first." >&2
  exit 1
fi

GEMINI_EXT_DIR="${GEMINI_EXTENSIONS_DIR:-$HOME/.gemini/extensions}"
mkdir -p "$GEMINI_EXT_DIR"

LINK_TARGET="$GEMINI_EXT_DIR/aos-harness"
if [ -e "$LINK_TARGET" ] || [ -L "$LINK_TARGET" ]; then
  rm -rf "$LINK_TARGET"
fi
ln -s "$PLUGIN_ROOT" "$LINK_TARGET"

echo "Installed AOS Harness extension to $LINK_TARGET"
echo "Restart Gemini CLI to pick up the new skills."
```

Make it executable:

```bash
chmod +x plugins/aos-harness/gemini/install.sh
```

- [ ] **Step 4: Add a smoke test**

Append to `tests/cli/brief-cli.test.ts`:

```typescript
describe("Gemini packaging", () => {
  test("extension.json exists and parses", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", ".gemini", "extension.json");
    const raw = require("node:fs").readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("aos-harness");
    expect(parsed.skills).toBe("../skills/");
  });

  test("install.sh is executable", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", "gemini", "install.sh");
    const stat = require("node:fs").statSync(path);
    // Owner-execute bit
    expect(stat.mode & 0o100).toBe(0o100);
  });
});
```

Run: `bun test tests/cli/brief-cli.test.ts -t "Gemini"` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/aos-harness/.gemini/extension.json plugins/aos-harness/gemini/install.sh tests/cli/brief-cli.test.ts
git commit -m "feat(plugins): add Gemini extension manifest and install script"
```

---

### Task 20: Codex plugin.json bump + aos-create cross-reference

**Files:**
- Modify: `plugins/aos-harness/.codex-plugin/plugin.json`
- Modify: `plugins/aos-harness/skills/aos-create/SKILL.md`

- [ ] **Step 1: Read current `plugin.json`**

The current version is `0.8.1`. Bump to `0.8.5` to match the harness CLI.

- [ ] **Step 2: Update `plugin.json`**

Open `plugins/aos-harness/.codex-plugin/plugin.json`. Change `"version": "0.8.1"` to `"version": "0.8.5"`. Add to the `defaultPrompt` array:

```json
"Author a new AOS brief from an idea."
```

- [ ] **Step 3: Add cross-reference to `aos-create/SKILL.md`**

Open `plugins/aos-harness/skills/aos-create/SKILL.md`. Find the "Supported Resource Types" section and add a line below the existing list:

```markdown
For **briefs**, use the `aos-create-brief` skill — it conducts a guided
conversation rather than scaffolding from a template.
```

- [ ] **Step 4: Add a smoke test**

Append to `tests/cli/brief-cli.test.ts`:

```typescript
describe("Codex plugin metadata", () => {
  test("plugin.json version bumped to match harness", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", ".codex-plugin", "plugin.json");
    const parsed = JSON.parse(require("node:fs").readFileSync(path, "utf-8"));
    expect(parsed.version).toBe("0.8.5");
    expect(parsed.interface.defaultPrompt).toContain("Author a new AOS brief from an idea.");
  });

  test("aos-create SKILL.md references aos-create-brief", () => {
    const path = join(import.meta.dir, "..", "..", "plugins", "aos-harness", "skills", "aos-create", "SKILL.md");
    expect(require("node:fs").readFileSync(path, "utf-8")).toContain("aos-create-brief");
  });
});
```

Run: `bun test tests/cli/brief-cli.test.ts -t "Codex plugin"` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/aos-harness/.codex-plugin/plugin.json plugins/aos-harness/skills/aos-create/SKILL.md tests/cli/brief-cli.test.ts
git commit -m "feat(plugins): bump Codex plugin version + add brief authoring to defaultPrompt"
```

---

## Phase 7 — Regression coverage and docs

### Task 21: Regression test — existing committed briefs all validate clean

**Files:**
- Create: `tests/cli/existing-briefs.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/cli/existing-briefs.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateBrief } from "../../cli/src/brief/validate";

const BRIEFS_DIR = join(import.meta.dir, "..", "..", "core", "briefs");

function findBriefs(): Array<{ path: string; expectedKind?: "deliberation" | "execution" }> {
  const out: Array<{ path: string; expectedKind?: "deliberation" | "execution" }> = [];
  if (!existsSync(BRIEFS_DIR)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && (entry.name === "brief.md" || /-brief\.md$/.test(entry.name))) {
        out.push({ path: p });
      }
    }
  };
  walk(BRIEFS_DIR);
  return out;
}

describe("existing committed briefs validate clean", () => {
  for (const { path } of findBriefs()) {
    test(`${path.replace(BRIEFS_DIR + "/", "")} auto-detects and validates without errors`, () => {
      const content = readFileSync(path, "utf-8");
      const r = validateBrief(content);
      expect(r.errors).toEqual([]);
      expect(r.detectedKind).not.toBeNull();
    });
  }
});
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/cli/existing-briefs.test.ts`

Expected: PASS for all committed briefs (`sample-product-decision/brief.md`, `sample-cto-execution/brief.md`, `aos-education-series/brief.md`, etc.). If any fail, the validator has a bug — fix it before continuing. (This is the regression guard mandated by the spec's non-goal: "validator must accept what's already there.")

- [ ] **Step 3: Commit**

```bash
git add tests/cli/existing-briefs.test.ts
git commit -m "test(brief): regression — all committed briefs validate clean"
```

---

### Task 22: README quick-start update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the quick-start / commands section in README**

Search for the section listing CLI commands or the "Getting Started" walkthrough.

- [ ] **Step 2: Add a brief authoring snippet**

Insert near the existing `aos run` example:

```markdown
### Author a brief

If you don't know the brief format, scaffold one interactively:

```bash
aos create brief                            # interactive Q&A
aos create brief my-decision --kind deliberation --idea "We need to decide between X and Y by Q3."
```

Or use the `/aos-create-brief` skill inside Claude Code, Codex, or Gemini —
the host agent will conduct the conversation in its own voice and validate the
result through `aos brief save`.

```bash
aos brief validate ./briefs/my-decision/brief.md   # check shape
aos run strategic-council --brief ./briefs/my-decision/brief.md
```
```

- [ ] **Step 3: Verify the README still parses**

Run: `bunx markdownlint-cli2 README.md` if available, otherwise visually scan. (No test gate here.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add brief authoring quick-start to README"
```

---

### Task 23: Manual smoke test pass

**Files:** none

This task is a manual verification gate; no automated test substitutes.

- [ ] **Step 1: CLI smoke test**

```bash
cd /tmp && mkdir aos-brief-smoke && cd aos-brief-smoke
bun /path/to/repo/cli/src/index.ts create brief my-test \
  --kind deliberation \
  --title "Smoke test" \
  --situation "We are testing the new flow." \
  --stakes "If it works, ship it." \
  --constraints "Must run on Bun 1.0+." \
  --key-question "Does the create command work end-to-end?" \
  --non-interactive
```

Expected: file at `./briefs/my-test/brief.md` containing all four required sections, validates clean.

- [ ] **Step 2: `aos brief validate` smoke test**

```bash
bun /path/to/repo/cli/src/index.ts brief validate ./briefs/my-test/brief.md --kind deliberation
```

Expected: exit 0, no stderr.

- [ ] **Step 3: `aos run --dry-run` lint summary**

```bash
bun /path/to/repo/cli/src/index.ts run strategic-council --brief ./briefs/my-test/brief.md --dry-run
```

Expected: stderr contains `✓ Brief lint: deliberation brief looks good.`

- [ ] **Step 4: Skill verification (Claude Code, Codex, Gemini)**

Install the plugin in each host:
- Claude Code: `bash plugins/aos-harness/claude-code/install.sh`
- Codex: confirm `.codex-plugin/plugin.json` is picked up
- Gemini: `bash plugins/aos-harness/gemini/install.sh`

In each host, invoke the brief-authoring skill (`/aos-create-brief` or equivalent), walk through both kinds, confirm `./briefs/<slug>/brief.md` is valid and runnable with `aos run`. Capture any host-specific issues for follow-up.

- [ ] **Step 5: Final commit (if any cleanup needed during smoke)**

```bash
git add -p
git commit -m "fix(brief): smoke-test followups"   # only if changes were needed
```

---

## Self-review (executor: read this before claiming done)

After completing all tasks, run the full test suite and confirm:

```bash
bun test tests/cli/brief-schema.test.ts \
         tests/cli/brief-parse.test.ts \
         tests/cli/brief-validate.test.ts \
         tests/cli/brief-template.test.ts \
         tests/cli/brief-write.test.ts \
         tests/cli/brief-prompts.test.ts \
         tests/cli/brief-cli.test.ts \
         tests/cli/create-brief.test.ts \
         tests/cli/run-brief-lint.test.ts \
         tests/cli/existing-briefs.test.ts
```

All tests pass. Then verify against the spec's goals:

1. **`aos create brief` works** → Tasks 15, 23.
2. **Skill works in all three hosts** → Tasks 17–19, 23.
3. **Strict on create, lint on run** → Tasks 14, 15, 16.
4. **Plugin parity (Claude Code, Codex, Gemini)** → Tasks 17, 18, 19, 20.
5. **Existing briefs still validate** → Task 21.

If any goal is unmet, return to the corresponding task and fix.
