# aos validate: Drop Cross-Product Brief×Profile Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 21 false-positive failures in `aos validate` by replacing the brief×profile cross-product loop with a single well-formedness check per brief using the new kind-aware lint validator.

**Architecture:** One change in `cli/src/commands/validate.ts:248-270`. The brief-discovery loop stays; the inner per-profile loop is replaced with one `validateBrief(content)` call (auto-detect kind). Errors fail the check; warnings are reported but don't fail (matches run-time lint semantics). Profile-specific required-section enforcement still happens at `aos run` time via the new brief lint summary and the existing runtime config-loader. The legacy `validateBrief` from `runtime/src/config-loader.ts` is no longer called from the CLI command but is still used by `runtime` itself and `tests/integration/validate-config.ts` (both untouched).

**Tech Stack:** TypeScript on Bun. `bun:test` for the verification test.

**Background:** The previous loop produced labels like `Brief "sample-cto-execution" for profile "incident-response": Missing sections: ## Incident Description, ## Impact, ## Timeline, ## Key Question`. Each brief is authored for ONE profile, so checking every brief against every profile is nonsensical — `incident-response` requires `## Incident Description`; `strategic-council` requires `## Situation`; the two profiles are not interchangeable. Replacing the cross-product with a kind-aware lint preserves the useful well-formedness check while removing the noise.

---

## File structure

```
cli/src/commands/validate.ts                # MODIFY — lines ~32 and ~248-270
tests/cli/aos-validate-brief.test.ts        # NEW — verify cross-product is gone
```

---

### Task 1: Replace cross-product loop with single lint check per brief

**Files:**
- Modify: `cli/src/commands/validate.ts`
- Create: `tests/cli/aos-validate-brief.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/aos-validate-brief.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const CLI = join(REPO, "cli", "src", "index.ts");

describe("aos validate brief checks", () => {
  test("does not produce per-profile cross-product failures", () => {
    const r = spawnSync("bun", [CLI, "validate"], {
      cwd: REPO,
      encoding: "utf-8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).not.toMatch(/Brief ".+" for profile ".+":/);
  });

  test("each committed brief produces at most one validation check", () => {
    const r = spawnSync("bun", [CLI, "validate"], {
      cwd: REPO,
      encoding: "utf-8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const briefChecks = combined.match(/(?:PASS|FAIL)\s+Brief "/g) ?? [];
    // 3 committed briefs => ≤5 checks (not 21)
    expect(briefChecks.length).toBeLessThanOrEqual(5);
  });

  test("committed briefs all pass well-formedness check", () => {
    const r = spawnSync("bun", [CLI, "validate"], {
      cwd: REPO,
      encoding: "utf-8",
    });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const briefFailures = combined.match(/FAIL\s+Brief ".+"/g) ?? [];
    expect(briefFailures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/cli/aos-validate-brief.test.ts
```

Expected: FAIL — current cross-product produces "Brief X for profile Y" failure lines.

- [ ] **Step 3: Replace the brief-validation block in `cli/src/commands/validate.ts`**

Open `cli/src/commands/validate.ts`. Find this block (currently lines ~248-270):

```typescript
  // ── 5. Validate briefs ────────────────────────────────────────

  console.log(`${c.bold("Validating briefs...")}`);

  const briefsDir = join(coreDir, "briefs");
  if (existsSync(briefsDir)) {
    for (const entry of readdirSync(briefsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const briefPath = join(briefsDir, entry.name, "brief.md");
      if (!existsSync(briefPath)) continue;

      // Validate against each profile's required sections
      for (const profile of profiles) {
        check(`Brief "${entry.name}" for profile "${profile.id}"`, () => {
          const result = validateBrief(briefPath, profile.input.required_sections);
          if (!result.valid) {
            const missingNames = result.missing.map((s: any) => s.heading).join(", ");
            throw new Error(`Missing sections: ${missingNames}. Add them to your brief.md and try again.`);
          }
        });
      }
    }
  }
```

Replace with:

```typescript
  // ── 5. Validate briefs ────────────────────────────────────────
  //
  // Briefs are authored per-profile; checking every brief against every
  // profile's required_sections (a cross-product) produces noise — `incident-
  // response` and `strategic-council` have different required sections by
  // design. We only check each brief is well-formed (matches one of the
  // canonical kinds: deliberation or execution). Run-time enforcement of
  // profile-specific required sections happens in `aos run` — both via the
  // new brief lint summary and via the runtime config-loader's validateBrief
  // against the chosen profile.

  console.log(`${c.bold("Validating briefs...")}`);

  const briefsDir = join(coreDir, "briefs");
  if (existsSync(briefsDir)) {
    const { readFileSync } = await import("node:fs");
    const { validateBrief: lintBrief } = await import("../brief/validate");

    for (const entry of readdirSync(briefsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const briefPath = join(briefsDir, entry.name, "brief.md");
      if (!existsSync(briefPath)) continue;

      check(`Brief "${entry.name}" is well-formed`, () => {
        const content = readFileSync(briefPath, "utf-8");
        const result = lintBrief(content);
        if (result.errors.length > 0) {
          throw new Error(result.errors.map((e) => e.message).join(" "));
        }
        if (result.warnings.length > 0) {
          console.log(c.dim(`    ${result.warnings.length} warning(s) — run \`aos brief validate ${briefPath}\` for details.`));
        }
      });
    }
  }
```

- [ ] **Step 4: Clean up the now-unused legacy import**

At the top of `cli/src/commands/validate.ts`, search for `validateBrief` in the import statements. If the runtime's `validateBrief` is imported only for the block we just replaced, remove it from the import. If it's still used elsewhere in this file, leave it. Verify with:

```bash
grep -n "validateBrief" cli/src/commands/validate.ts
```

If no matches outside the import line, remove that named import. If matches remain, leave the import.

- [ ] **Step 5: Update the help text**

Around line 32 of `cli/src/commands/validate.ts`, change:

```
  - Briefs pass section requirements
```

to:

```
  - Briefs are well-formed (deliberation or execution shape)
```

- [ ] **Step 6: Run the new test to verify it passes**

```bash
bun test tests/cli/aos-validate-brief.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 7: Run `aos validate` end-to-end to confirm 21 failures → 0**

```bash
bun run cli/src/index.ts validate 2>&1 | tail -3
```

Expected: final summary line shows `0 failed`. Pass count drops by 18 (21 cross-product checks become 3 well-formedness checks).

- [ ] **Step 8: Run the full brief test suite to confirm no regression**

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
         tests/cli/existing-briefs.test.ts \
         tests/cli/aos-validate-brief.test.ts
```

Expected: 74 prior + 3 new = 77 tests, 0 fail.

- [ ] **Step 9: Commit**

```bash
git add cli/src/commands/validate.ts tests/cli/aos-validate-brief.test.ts
git commit -m "$(cat <<'EOF'
fix(validate): drop cross-product brief×profile check, lint per-brief instead

The previous loop checked every brief against every profile's required_sections,
producing 21 false failures because each brief is authored for one specific
profile (e.g. sample-cto-execution targets cto-execution; checking it against
incident-response's `## Incident Description` requirement was nonsensical).

Replace with a single well-formedness check per brief using the new kind-aware
lint validator. Profile-specific required-section enforcement still happens at
`aos run` time via the brief lint summary and the runtime config-loader's
validateBrief.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

- **Coverage:** Implements approach A from the brainstorming discussion exactly — drop cross-product, replace with kind-aware lint. ✓
- **Placeholder scan:** Every code block is concrete and complete. ✓
- **Type consistency:** `lintBrief(content)` returns `{ errors, warnings, ... }` matching the `BriefValidation` interface from `cli/src/brief/types.ts` already used in `run.ts` and elsewhere. ✓
- **Risk — unused import:** Step 4 explicitly handles the case where `validateBrief` from `runtime/src/config-loader` becomes unused in this file.
- **Out of scope:** `tests/integration/validate-config.ts` does its own brief check (one brief, one profile — not the cross-product bug). Leave untouched.
- **Out of scope:** No data migration. Briefs stay as-is.
