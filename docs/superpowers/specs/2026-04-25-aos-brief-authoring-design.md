# AOS Brief Authoring & Plugin Parity — Design

**Date:** 2026-04-25
**Status:** Draft for review
**Owner:** Segun

## Summary

Add a first-class brief-authoring flow so users can produce well-shaped `brief.md` files from a one-line idea, and complete plugin/skill packaging so the flow is available inside Claude Code, Codex, and Gemini as well as the plain terminal.

Today, `aos run` requires a `brief.md` whose shape determines whether the deliberation council debates the right question or whether the execution workflow has a clear definition of done. The format is undocumented at the schema level — only learnable by reading the two committed samples — and the create surface (`aos create`) does not include `brief` as a resource type. Plugins exist for Claude Code and Codex but skip Gemini, and none of them know how to author briefs.

## Goals

1. Users can run a single command (`aos create brief`) and end up with a validated `brief.md` they can pass to `aos run`.
2. Inside a host agent (Claude Code, Codex, Gemini), users can run an equivalent slash command / skill that produces a higher-quality brief by leveraging the host's LLM.
3. Brief quality is enforced at authoring time (strict) but does not block existing or hand-authored briefs at run time (lint).
4. Plugin/skill coverage matches the runtime adapter list for interactive hosts: Claude Code, Codex, Gemini.

## Non-goals

- Pi adapter packaging (Pi is a metered API runtime, not an interactive host where `/aos create brief` makes sense).
- Per-profile custom brief schemas. Two kinds (deliberation, execution) are sufficient for current profiles; per-profile schemas are a future extension if a profile demands a unique shape.
- Migrating existing committed briefs in `core/briefs/` to a different format. The validator must accept what's already there.
- Brief editing UX after first authoring. `aos create brief` produces a file; further edits are plain text edits or another `aos create brief` invocation overwriting the slug.

## Decisions and rationale

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Hybrid CLI primitives + LLM-driven skill** | Validator and template logic shared by both flows; CLI alone gives a working terminal UX; skill gets to use the host's LLM for prose synthesis. |
| 2 | **Two brief kinds: `deliberation`, `execution`** | Mirrors the existing profile-type split; matches the two committed samples; no per-profile authoring tax. |
| 3 | **Plugin coverage: Claude Code, Codex, Gemini** | All three are interactive LLM hosts where the brief-authoring conversation makes sense. Pi is excluded as a runtime-only target. |
| 4 | **Default write location: user's CWD (`./briefs/<slug>/brief.md`)** | Briefs are per-engagement artifacts owned by the user, not framework samples. Harness samples opt in via `--shared`. |
| 5 | **Validation: strict on `create`, lint on `run`** | Enforce quality where users are learning the format; never break existing briefs or block running sessions. |
| 6 | **Three entry shapes: empty, `--idea`, `--from-notes`** | Same authoring loop, three pre-fill paths. Skill agents pass collected context via `--from-notes` to avoid re-asking the user. |

## Architecture

Three layers, each with one responsibility.

### Layer 1 — `cli/src/brief/` (new module, no LLM)

Pure functions, no I/O beyond what callers explicitly pass in.

- **`schema.ts`** — exports `briefSchema(kind: BriefKind)` returning `{ requiredSections: string[]; optionalSections: string[]; titlePattern: RegExp }`. Defines the two shapes (see Schema section below). Single source of truth.
- **`validate.ts`** — exports `validateBrief(markdown: string, expectedKind?: BriefKind)` returning `{ ok: boolean; detectedKind: BriefKind | null; errors: BriefIssue[]; warnings: BriefIssue[] }`. Heading-based parser; case-insensitive; accepts `##` and `###`; auto-detects kind when `expectedKind` omitted.
- **`template.ts`** — exports `renderBriefTemplate(kind: BriefKind, prefilled?: Partial<BriefSections>)` returning markdown string with section headers and `<!-- TODO: ... -->` placeholders for any unfilled section. Used by `aos brief template`.
- **`prompts.ts`** — exports `runBriefPromptLoop(opts)` for the deterministic CLI Q&A. Asks one question per required section; supports `--idea` and `--from-notes` as pre-fill seeds. No LLM calls.

### Layer 2 — `cli/src/commands/brief.ts` and updated `create.ts` (CLI surface)

- **`aos create brief [<slug>]`** — interactive flow. Calls `runBriefPromptLoop` then `renderBriefTemplate` then strict `validateBrief`, writes the file. Default path: `./briefs/<slug>/brief.md` in CWD; `--shared` redirects to `<harness>/core/briefs/<slug>/brief.md`. Flags: `--kind`, `--title`, `--idea <text>`, `--from-notes <file>`, `--non-interactive`, `--shared`, `--out <path>` (overrides default location entirely).
- **`aos brief template --kind <k> [--out <path>] [--prefill <json>]`** — non-interactive scaffold; prints to stdout if no `--out`. Used by skills to bootstrap.
- **`aos brief validate <path> [--kind <k>] [--strict]`** — runs validator, prints issues to stderr. Default behavior: exit 1 if any errors, exit 0 if only warnings or clean. `--strict` upgrades empty-body warnings to errors (used by `aos brief save`'s internal call).
- **`aos brief save <path> --kind <k> [--from-stdin | --from-file <p>]`** — reads brief content, runs strict validation, writes the file atomically (write to temp, rename). Refuses to overwrite without `--force`. Used by skill mode.

`create.ts` adds `brief` to its dispatch alongside the existing `agent | profile | domain | skill` cases. The new command file (`brief.ts`) hosts `template/validate/save` subcommands and is registered in `cli.ts`.

### Layer 3 — Plugin/skill packaging

- **`plugins/aos-harness/skills/aos-create-brief/SKILL.md`** — shared skill consumed by all three hosts. Documents the LLM-driven authoring flow: ask the user for purpose, context, and constraints; choose kind; draft prose for each required section; call `aos brief template --kind <k> --prefill <json>` to bootstrap; pipe finished markdown to `aos brief save`. Inlines the schema for both kinds so the agent has the rules even before invoking the CLI.
- **`plugins/aos-harness/claude-code/commands/aos-create-brief.md`** — Claude Code slash command surface; thin wrapper that loads the shared skill.
- **`plugins/aos-harness/.gemini/extension.json`** — Gemini extension manifest pointing at `../skills/`. Same skills directory as Codex/Claude Code (no fork).
- **`plugins/aos-harness/gemini/install.sh`** — install helper symmetrical to `claude-code/install.sh`.
- **Updated `.codex-plugin/plugin.json`** — bump version to match harness CLI; append "Author a new AOS brief from an idea." to `defaultPrompt`.
- **Updated `aos-create/SKILL.md`** — add a one-line "for briefs, use `aos-create-brief`" cross-reference.

## Brief schema

### Heading conventions

- **Title** is the H1 line, matching `^# Brief: (.+)$`. The title text is everything after the literal `Brief: ` (including any further colons, e.g. `# Brief: API Platform: Phase 2` is title "API Platform: Phase 2"). One title H1 per file; subsequent H1 headings are ignored.
- **Heading match** is exact-string against the canonical name, case-insensitive, leading/trailing whitespace trimmed. `## ` and `### ` are both accepted as section headers; deeper levels (H4+) are treated as in-section content. Sub-headings (e.g. `### Sub-section` under `## Situation`) belong to the parent section and do not start a new top-level section.
- **Aliases** are declared in a fixed map, not derived heuristically. The full alias table for v1:
  - `## Feature / Vision` ⇔ `## Vision` (execution kind)
  - No other aliases. New aliases require a code change and a test.
- **Placeholders.** The validator treats HTML comments (`<!-- ... -->`) as whitespace when checking section emptiness. A section containing only `<!-- TODO: describe the situation -->` is empty for both strict and lint validation; this means a freshly-rendered template fails strict validation (correct — the user hasn't filled it in) and trips lint warnings if run unfilled (correct — the user should be told).

### Deliberation kind

| Section | Required | Notes |
|---------|----------|-------|
| `# Brief: <title>` | yes | Top-level H1 starting with `Brief: `. |
| `**Context files:**` line | no | Optional reference list under title. |
| `## Situation` | yes | What's happening, who is involved, what triggered the decision. |
| `## Stakes` | yes | Upside / downside framing. |
| `## Constraints` | yes | Budget, timeline, technical, regulatory. |
| `## Background` | no | Extended context. |
| `## Out of scope` | no | Decisions explicitly not on the table. |
| `## Key Question` | yes | Single clear decision question for the council. |

### Execution kind

| Section | Required | Notes |
|---------|----------|-------|
| `# Brief: <title>` | yes | Top-level H1 starting with `Brief: `. |
| `## Feature / Vision` | yes | What we're building and why. `## Vision` accepted as alias (see Heading conventions above). |
| `## Context` | yes | Environment, prior art, repo state. |
| `## Constraints` | yes | Non-negotiables. |
| `## Stakeholders` | no | Who consumes this output. |
| `## Out of scope` | no | What this initiative will not do. |
| `## Open Questions` | no | Known unknowns. |
| `## Success Criteria` | yes | How we know we're done. |

### Kind selection

`expectedKind` short-circuits any heuristics. The two paths:

**1. `expectedKind` supplied (the common case — `aos run`, `aos brief save`, `aos brief validate --kind`).** Validate directly against that kind. Missing required sections produce specific errors ("Missing required section: `## Key Question`"). When the document is missing all of `expectedKind`'s requireds AND contains both kind-discriminating headings of the *other* kind (`Key Question` for deliberation, `Success Criteria` for execution), append a hint to the error: "This brief looks shaped for `<other-kind>`. Either run a `<other-kind>` profile or re-author with `aos create brief --kind <expectedKind>`." This is just a more actionable variant of missing-required, not a separate "kind mismatch" warning.

**2. `expectedKind` not supplied (only `aos brief validate <path>` with no `--kind`).** Run heuristic auto-detection: score each kind by the count of its required headings present in the document (overlapping headings like `## Constraints` count for both). Then:

- **High-confidence match** (one kind scores ≥ 2 required headings AND outscores the other kind): return that kind, then validate against it.
- **Low-confidence** (best score < 2, OR scores tied): return `detectedKind: null` and an error that names what's missing instead of pretending the kind is the issue: "Brief is missing too many required sections to determine kind. Specify `--kind deliberation` or `--kind execution`, or author from scratch with `aos create brief`."

Auto-detection is never run when `expectedKind` is supplied — there is no parallel "what does this brief look like" signal at run time.

### Validator behavior

- **Required missing → error.** "Missing required section: `## Key Question`".
- **Required present but body empty (no non-whitespace content before next heading) → error in strict mode, warning in lint mode.** "Section `## Situation` is empty."
- **Optional sections → no message either way.**
- **Title H1 missing or doesn't match `^# Brief: .+$` → error.** "Title must be a H1 starting with `Brief: `."
- **Unknown headings → no message.** Don't punish users for adding extra structure.

## Authoring flow detail

### CLI deterministic mode

1. If `slug` not provided as positional, prompt: "Slug for this brief (kebab-case)?"
2. If `--kind` not provided, prompt: "Kind? (1) deliberation (2) execution"
3. If `--title` not provided, prompt: "One-line title?"
4. For each required section in the chosen schema (excluding title):
   - If pre-fill from `--idea` / `--from-notes` produced a candidate, show it: "Draft for `## Situation` (Enter to accept, or type replacement, end with blank line):" and accept either Enter (keep) or new multi-line text (replace).
   - Otherwise prompt: "What's the situation? (multi-line, end with blank line)"
5. Render template with collected answers via `renderBriefTemplate`.
6. Run `validateBrief(rendered, kind)` in strict mode. If validation fails (which is unexpected given step 4 collected all required sections, but possible if the user submitted only whitespace), re-prompt for the offending section.
7. Resolve target path: `./briefs/<slug>/brief.md` in CWD by default; `--shared` switches to `<harnessRoot>/core/briefs/<slug>/brief.md`; `--out` overrides both.
8. Write file (atomic: write to `<path>.tmp` then rename). Refuse to overwrite without `--force`.
9. Print: green "Brief created at `<path>`" + dim "Run with: `aos run <profile> --brief <path>`".

`--idea "<text>"` and `--from-notes <file>` do **not** pre-fill specific sections. Section-specific pre-fill via heuristic regex was rejected during design review: the failure mode isn't "rough output the user can fix," it's "misleading output the user accepts because it looks confident" (a constraint sentence pre-filled into Situation reads plausibly enough that users miss the error). Instead:

- The seed text is rendered as an HTML comment block at the top of the template: `<!-- raw idea seed: ... -->`. The validator treats HTML comments as whitespace, so the comment doesn't affect emptiness checks.
- During the prompt loop, the seed text is also displayed once above the first prompt as context: `Your seed: <text>` (dim). The user can copy/paste from it into individual section answers as they go.
- This makes the seed text useful (always in scroll-back as the user types) without making it lie about which content belongs in which section.

Skill mode uses `--from-notes` for the same reason: the host agent passes user notes to the CLI as raw text, not as section-mapped content. The agent does the actual section drafting itself (where it can do it well) before calling `aos brief save`.

`--non-interactive` requires all required sections to be supplied via flags (`--situation`, `--stakes`, `--constraints`, `--key-question` for deliberation; `--feature`, `--context`, `--constraints`, `--success-criteria` for execution). Errors out if anything is missing. Used by skills that have already collected everything.

### Skill mode

`SKILL.md` instructs the host agent:

1. Greet the user and ask: "Are we building something (execution) or deciding something (deliberation)?"
2. Conduct a conversation in the host agent's natural style, gathering content for each required section. The schema (inlined in SKILL.md) tells the agent what every section must convey.
3. When the agent has enough material, draft polished markdown for the full brief.
4. Write the drafted markdown to a tempfile (e.g. via the agent's normal file-write tool to `<harness-tmp>/aos-brief-draft.md`), then call:

   `aos brief save ./briefs/<slug>/brief.md --kind <kind> --from-file <tempfile>`

   `--from-file` is the documented happy path; it avoids shell-quoting issues with multi-line markdown that can contain backticks, dollar signs, or single quotes. `--from-stdin` exists as an alternate but is not the default skill flow.
5. The CLI runs strict validation. On failure, stderr lists each issue with section name (e.g. `Section "## Stakes" is empty`). The agent re-drafts only the failing sections, rewrites the tempfile, and re-runs `aos brief save`. (See open questions on structured-error output.)
6. On success, the CLI prints the absolute path. The agent reports the path AND a generic next command, leaving the profile choice to the user: `Run with: aos run <profile-name> --brief <path>`. The agent should NOT guess a profile — list the available profiles via `aos list profiles` if the user asks for a recommendation.

The skill does **not** call `aos brief template` first in the common path — drafting straight to `aos brief save` is one fewer round-trip. `aos brief template` exists for cases where the agent wants to show the user the structure before drafting (a teaching mode the user can opt into).

## Run-time integration

In `cli/src/commands/run.ts`, after `briefPath` is resolved (around line 199, before the workflow-dir resolution). The output is a single summary line — never a stream of per-issue warnings — so a clean brief gives positive confirmation and a noisy one points the user at the diagnostic command:

```ts
const briefContent = readFileSync(briefPath, "utf-8");
const expectedKind = isExecutionProfile ? "execution" : "deliberation";
const briefValidation = validateBrief(briefContent, expectedKind);

const errCount = briefValidation.errors.length;
const warnCount = briefValidation.warnings.length;

if (errCount === 0 && warnCount === 0) {
  console.error(c.dim(`✓ Brief lint: ${expectedKind} brief looks good.`));
} else {
  console.error(c.yellow(
    `⚠ Brief lint: ${errCount} error${errCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"}.`
  ));
  console.error(c.dim(
    `  Run \`aos brief validate ${briefPath}\` for details, or \`aos create brief\` to author from a template.`
  ));
}
```

Always one line out, regardless of state — users can confirm linting ran and quickly see "is this brief OK?" Detail surfaces only when explicitly requested via `aos brief validate`.

Lint mode never calls `process.exit`. The summary line is yellow when there are errors or warnings, dim when clean (visible enough to confirm linting ran, quiet enough not to clutter the preflight). The hint command is suppressed when the brief is clean.

The `expectedKind` determination uses the same `isExecutionProfile` boolean already computed in `run.ts` for session display (line ~439). No new profile inspection needed. Auto-detection is never invoked here — `expectedKind` is always known at this point, per the kind-selection rules above.

## Write semantics (shared across all create paths)

Every command that writes a brief file (`aos create brief`, `aos brief save`) shares the same I/O contract:

- **Atomic write.** Writes go to `<path>.tmp.<pid>` first, then `rename()` to `<path>`. The `.tmp.<pid>` extension scopes leftover temps per-process so concurrent runs don't stomp each other.
- **Cleanup on failure.** A `try/finally` (or equivalent in Bun) deletes the `.tmp.<pid>` file if the rename never happens (process killed, validator failure caught after write, disk full, permission flip). Leftover temps from prior crashed runs are also cleaned opportunistically when the same path is targeted again.
- **Directory creation.** The parent directory (`./briefs/<slug>/`) is created with `mkdir -p` semantics if missing. Permission errors on directory creation surface as a clean error: "Cannot create directory `<path>`: permission denied. Use `--out <path>` to write somewhere else."
- **Read-only filesystems.** `aos create brief` detects `EROFS` / `EACCES` on the chosen target and prints a one-line error pointing at `--out`. Never produces a stack trace.
- **`--force`.** Both `aos create brief` and `aos brief save` accept `--force` to overwrite an existing brief. Without `--force`, an existing target is an error: "Brief already exists at `<path>`. Pass `--force` to overwrite." The `--force` semantics are identical across both commands; there is exactly one write path internally.

## Plugin packaging detail

### Shared skill: `aos-create-brief/SKILL.md`

```markdown
---
name: aos-create-brief
description: Author an AOS brief by conducting a guided conversation with the user, then validate and save through the harness CLI.
metadata:
  short-description: Author an AOS brief
---

# AOS Create Brief

Use this skill when the user wants to create a brief for an AOS deliberation or
execution run, especially when they have an idea but don't know the format.

## Prerequisites

(same wrapper resolution as aos-create — checks $HOME plugin install, falls back
to repo-local AOS_HARNESS_ROOT)

## Workflow

1. Ask whether the brief is for **deliberation** (decision-making) or **execution** (build/ship).
2. Ask for a one-line title and a kebab-case slug.
3. Conduct a conversation gathering the required sections for the chosen kind:
   - Deliberation: Situation, Stakes, Constraints, Key Question
   - Execution: Feature/Vision, Context, Constraints, Success Criteria
4. Draft the brief markdown in your own voice — clear, specific, no filler.
5. Write the draft to a tempfile (use your normal file-write tool), then save:

   "$AOS_WRAPPER" brief save "./briefs/<slug>/brief.md" \
     --kind <kind> --from-file "<tempfile>"

   Use --from-file (not --from-stdin) — markdown often contains backticks,
   dollar signs, and single quotes that break shell piping.

6. If validation fails, the CLI tells you which section is missing or empty.
   Re-draft only that section, rewrite the tempfile, re-run save.
7. Report the saved path. Suggest `aos run <profile> --brief <path>` but
   leave <profile> as a placeholder — don't guess. If the user asks for a
   profile recommendation, run `aos list profiles` and offer based on kind.

## Schema (must follow)

(inline both schemas as in this design doc)

## Guardrails

- Default to writing under the user's current working directory (./briefs/<slug>/).
- Never overwrite an existing brief without explicit user confirmation (--force).
- Don't invent stakes, constraints, or success criteria the user hasn't stated.
  If a required section is genuinely empty, ask one more question rather than fabricate.
```

### Claude Code command: `claude-code/commands/aos-create-brief.md`

Symmetric to the existing `aos-run-deliberation.md` — front-matter declares the slash command, body delegates to `aos-create-brief` skill.

### Gemini extension: `.gemini/extension.json`

```json
{
  "name": "aos-harness",
  "version": "<matched to .codex-plugin>",
  "description": "Run AOS Harness deliberation and execution workflows from Gemini.",
  "skills": "../skills/",
  "homepage": "https://github.com/aos-engineer/aos-harness"
}
```

Gemini's extension format follows the same skills-directory convention as Codex; we point at the shared `../skills/` directory rather than forking. (Verify exact field names against current Gemini CLI extension docs during implementation.)

### Codex plugin update: `.codex-plugin/plugin.json`

Bump `version` to current harness CLI version. Append to `defaultPrompt`:

```json
"Author a new AOS brief from an idea."
```

### Existing skill cross-reference: `aos-create/SKILL.md`

Add to the "Supported Resource Types" section:

> For **briefs**, use the `aos-create-brief` skill — it conducts a guided conversation rather than scaffolding from a template.

## Testing

### Unit tests

- **`tests/cli/brief-schema.test.ts`** — covers `briefSchema(kind)` returns the expected required/optional lists; the two kinds are non-overlapping where intended (Key Question only deliberation; Success Criteria only execution).
- **`tests/cli/brief-validate.test.ts`** — required-section permutations (each missing in turn produces the right error); empty-body detection (strict vs lint); case-insensitive heading match; H3 acceptance; H4+ treated as in-section content; HTML-comment-only sections detected as empty; `## Vision` alias accepts as `## Feature / Vision`; auto-detection high-confidence (one kind ≥ 2); auto-detection low-confidence returns `null` with "missing too many sections" message; missing-requireds-with-other-kind-discriminating-headings adds the "looks shaped for `<other-kind>`" hint; existing committed briefs in `core/briefs/` all validate clean against their expected kinds (regression guard).
- **`tests/cli/brief-template.test.ts`** — snapshot per kind; prefill merging puts user content under the right header and leaves placeholders for unfilled sections; placeholder format is consistent.

### Integration tests

- **`tests/cli/create-brief.test.ts`** — runs `aos create brief --non-interactive --kind deliberation --slug foo --title "Test" --situation "x" --stakes "y" --constraints "z" --key-question "?"` against a tmpdir; asserts file exists at `./briefs/foo/brief.md`, content passes strict validation, exit 0. Same with execution kind. `--shared` writes under harness root. `--force` overwrites; without it, second invocation fails.
- **`tests/cli/brief-cli.test.ts`** — `aos brief template --kind execution` prints expected markdown; `aos brief validate <good>` exits 0 with no stderr; `aos brief validate <missing-required>` exits 1 with the missing section name in stderr; `aos brief validate <empty-section>` exits 0 by default (warning only) and 1 with `--strict`; `echo "<bad>" | aos brief save /tmp/x.md --kind deliberation --from-stdin` refuses save and exits non-zero with the failing section name in stderr.
- **`tests/cli/run-brief-lint.test.ts`** — `aos run` against a deliberation profile with a brief missing `## Key Question`: assert yellow warning in stderr containing "Missing required section: Key Question", assert process did not exit non-zero from validation alone (it may still exit for other preflight reasons; we mock those to ready).

### Manual / smoke

- Install plugin in Claude Code, run `/aos-create-brief`, walk through both kinds, confirm `./briefs/<slug>/brief.md` is valid and runnable with `aos run`.
- Repeat in Codex.
- Repeat in Gemini.

## File layout

### New

```
cli/src/brief/
  schema.ts
  validate.ts
  template.ts
  prompts.ts
cli/src/commands/
  brief.ts
plugins/aos-harness/
  skills/aos-create-brief/SKILL.md
  claude-code/commands/aos-create-brief.md
  .gemini/extension.json
  gemini/install.sh
tests/cli/
  brief-schema.test.ts
  brief-validate.test.ts
  brief-template.test.ts
  create-brief.test.ts
  brief-cli.test.ts
  run-brief-lint.test.ts
```

### Modified

```
cli/src/cli.ts                                # register `brief` command
cli/src/commands/create.ts                    # add `brief` case to dispatch
cli/src/commands/run.ts                       # add validateBrief call after briefPath resolved
plugins/aos-harness/.codex-plugin/plugin.json # bump version, append defaultPrompt entry
plugins/aos-harness/skills/aos-create/SKILL.md # cross-reference new skill
README.md                                     # mention `aos create brief` in quick-start
```

## Risks and open questions

- **Gemini extension schema.** The exact manifest format may have changed since the existing `.codex-plugin/plugin.json` was written. Implementation step 1 verifies the current Gemini CLI extension schema and adjusts `extension.json` shape accordingly. Not a design risk — just a docs lookup during implementation.
- **Heading parsing edge cases.** Briefs with mixed heading levels (e.g., `## Situation` and later `### Sub-section`) — the validator must not treat sub-headings as new top-level sections. Mitigation: parse only `^#{1,3} ` lines and track depth (H4+ counts as in-section content per the heading conventions section).
- **`--from-stdin` on Windows.** Bun's stdin handling on Windows can be flaky for long inputs. Mitigation: skills use `--from-file` as the documented happy path; `--from-stdin` is the alternate.
- **Slug collisions across CWD and `--shared`.** A user might author `./briefs/foo` and then `aos create brief foo --shared`, ending up with two `foo` briefs in different roots. Acceptable: the path is explicit in `aos run --brief <path>`, and the create command prints the resolved path.
- **Open question — structured save errors.** Today `aos brief save` prints human-readable issues to stderr. When the skill flow has multiple errors at once, the agent has to re-draft the full brief and re-save, which can introduce regressions in already-good sections. v1 ships text errors; if skill iterations show regression issues in practice, add a `--json` output flag to `aos brief save` so agents can see structured issues `[{section, kind, message}]` and patch surgically. A future `--patch` mode (`aos brief save <path> --patch <section>=<file>`) would let agents fix one section at a time without re-sending the whole file.

## Rollout

The plugin lives in this repo and is installed by users via `aos init project --with-plugins` or by copying the plugin directory into their host's plugin path. There is no central registry pushing updates.

- **Version field bump.** `.codex-plugin/plugin.json` and `.gemini/extension.json` versions advance to match the harness CLI minor version. Existing users who pulled the plugin before this change will continue to work — the new skill is additive (no breaking changes to existing skill names or commands).
- **Re-install path.** `claude-code/install.sh` and the new `gemini/install.sh` are idempotent: re-running them picks up new skills without breaking existing ones. The `aos init project` flow detects an existing plugin install and offers to update.
- **Migration impact:** none. Existing briefs continue to run (the validator is lint-only at run time), existing skills continue to work, and the new `aos-create-brief` skill is opt-in. No flag day.

## Success metrics (post-ship)

This feature succeeds if users learn the brief format. Out of scope for v1 instrumentation, but the natural signals to watch over the first ~6 weeks:

1. **Authoring path adoption.** Briefs created via `aos create brief` (CLI or skill) become a meaningful share of new briefs versus hand-edited samples. Measurable by adding a `<!-- generated by: aos create brief vX.Y -->` HTML comment to rendered templates and grepping committed briefs over time.
2. **Run-time lint trend.** The yellow `Brief lint: N errors, M warnings` line at `aos run` start trends toward zero across new briefs. Measurable from session logs once telemetry exists.
3. **Skill use ratio.** Among plugin-installed users, `aos-create-brief` invocations exceed direct hand-editing of `core/briefs/`. Measurable from skill invocation logs in each host.

If after 6 weeks (1) is below ~30% or (2) is flat, the brief format is still not learnable from the create flow — likely signal to improve the schema docs or add the structured-error work to a v2.

## Out-of-scope follow-ups

- Per-profile custom brief schemas (pickup if a profile demands a unique shape).
- `aos brief edit <slug>` for re-running only the missing/empty sections of an existing brief.
- `aos brief list` to show all briefs across CWD and `--shared` locations.
- Auto-suggest the brief kind from the chosen profile when `aos create brief --profile <name>` is invoked.
- Structured-error and `--patch` modes for `aos brief save` (see open questions).
