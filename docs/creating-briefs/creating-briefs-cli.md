# Creating Briefs with `aos create brief`

Since 0.9.0, the AOS harness ships first-class brief authoring. You no longer need to remember the format or hand-edit a sample — the CLI walks you through it and refuses to save anything that won't validate.

## The two brief kinds

Every brief is one of two shapes:

| Kind | Required sections | Used by profiles like |
|---|---|---|
| **deliberation** | `Situation`, `Stakes`, `Constraints`, `Key Question` | `strategic-council`, `product-decision` |
| **execution** | `Feature / Vision`, `Context`, `Constraints`, `Success Criteria` | `cto-execution`, `dev-execution`, `aos-education-series` |

If you're trying to **decide** something, author a deliberation brief. If you're trying to **build** something, author an execution brief.

## Three ways to author a brief

### 1. Interactive CLI (no LLM)

```bash
aos create brief
```

Asks for slug → kind → title → each required section's body, then writes `./briefs/<slug>/brief.md` and prints the next command.

Pre-fill seed text from a one-liner or a notes file (the seed is rendered as an HTML comment at the top of the brief — you copy/paste from it as you answer the prompts):

```bash
aos create brief my-decision --idea "Deciding between API platform and SaaS depth, board wants a call by Q3."
aos create brief my-decision --from-notes ./scratch.md
```

### 2. Non-interactive (CI / scripts)

```bash
aos create brief api-vs-saas \
  --kind deliberation \
  --title "API platform vs SaaS depth" \
  --situation "Three enterprise prospects declined for lack of API." \
  --stakes "Lose 280k ARR if we don't build, lose 6mo velocity if we do." \
  --constraints "8 engineers fixed; Q3 start; data residency requirements." \
  --key-question "Should we invest in a full API platform this cycle?" \
  --non-interactive
```

`--shared` writes to `<harness>/core/briefs/<slug>/brief.md` (for committing samples back to the framework). `--out <path>` overrides the location entirely. `--force` overwrites an existing file.

### 3. Inside a host agent (Claude Code, Codex, Gemini)

If you have the AOS plugin installed in your host agent, run the slash command:

```
/aos-create-brief
```

The agent conducts the conversation in its own voice, drafts polished prose, then calls `aos brief save` to validate and persist. This produces the highest-quality briefs because it uses the host's LLM for prose synthesis. See `plugins/aos-harness/skills/aos-create-brief/SKILL.md` for the full skill spec.

## Validating a brief

```bash
aos brief validate ./briefs/my-decision/brief.md
aos brief validate ./briefs/my-decision/brief.md --kind deliberation       # explicit
aos brief validate ./briefs/my-decision/brief.md --kind deliberation --strict  # empty sections fail
```

By default, missing required sections exit 1; empty (whitespace or HTML-comment-only) sections produce a warning but exit 0. `--strict` upgrades the warning to an error — used internally by `aos brief save` and `aos create brief` to refuse to save an incomplete brief.

When `--kind` is omitted, the validator auto-detects by counting matching required headings. If too few match (best score < 2) or scores tie, you get an error pointing you at `--kind` or `aos create brief`.

## Run-time linting

When you launch `aos run`, the harness now emits a one-line lint summary:

```
✓ Brief lint: deliberation brief looks good (0 errors, 0 warnings).
```

…or:

```
⚠ Brief lint: 1 error, 0 warnings.
  Run `aos brief validate ./briefs/my-decision/brief.md` for details, or `aos create brief` to author from a template.
```

The summary never blocks the run — profile-specific section enforcement still happens inside the runtime config-loader and will fail the run cleanly if the brief truly can't drive the profile.

## Schema details

### Heading conventions

- **Title** is `# Brief: <text>` — exactly one H1, the title text is everything after `Brief: ` (subsequent colons preserved).
- **Sections** use `##` or `###`. H4+ headings are treated as in-section content, not new sections.
- **Heading match** is case-insensitive against the canonical name.
- **Aliases**: `## Vision` is accepted as a synonym for `## Feature / Vision` (execution kind). No other aliases.
- **Placeholders**: HTML comments (`<!-- TODO: ... -->`) count as empty for validation purposes. A freshly-rendered template fails strict validation until you replace the comments with real content.

### Atomic write

`aos create brief` and `aos brief save` write to `<path>.tmp.<pid>` first, then `rename()` into place. Crashes leave no half-written briefs. Parent directories are created with `mkdir -p`. Existing targets are not overwritten without `--force`.

## Authoring a brief that works for a specific profile

Briefs and profiles are paired by intent — a `strategic-council` brief lives or dies on its `## Key Question`; an `incident-response` brief needs `## Incident Description`, `## Impact`, `## Timeline`. The schema in this doc covers the two canonical shapes; profile-specific required sections (declared in each profile's `input.required_sections`) are enforced at `aos run` time.

If you're authoring for a niche profile (`incident-response`, `delivery-ops`, `design-variations`, `architecture-review`, `security-review`), start from `aos create brief --kind execution` and add the profile's extra sections by hand. A future version may add per-profile schemas; for now the two-kind split covers the common case.

## See also

- [brief-generator-prompt.md](./brief-generator-prompt.md) — the legacy AI-prompt approach, useful when authoring outside the AOS plugin.
- `plugins/aos-harness/skills/aos-create-brief/SKILL.md` — the skill that runs inside Claude Code, Codex, and Gemini.
- `docs/superpowers/specs/2026-04-25-aos-brief-authoring-design.md` — the design spec.
