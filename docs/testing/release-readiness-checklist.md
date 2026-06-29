# AOS Harness Release Readiness Checklist

Use this checklist before calling a release complete. Local checks can be run by any contributor. Live checks require authenticated vendor CLIs or external services and should be recorded in the release notes.

## Local Automated Checks

- [ ] `bun run validate` passes with zero failures.
- [ ] `bun run test` passes runtime tests.
- [ ] `bun run typecheck` passes.
- [ ] `bun test tests adapters/codex/tests adapters/claude-code/tests adapters/gemini/tests adapters/shared/tests` passes.
- [ ] `bun run --cwd site build` completes.
- [ ] `bun run publish:dry-run` completes before publishing packages.

## Local Manual Smoke Checks

- [ ] `aos init --non-interactive` writes `.aos/config.yaml` and `.aos/scan.json` in a temporary project.
- [ ] `aos run strategic-council --dry-run --brief core/briefs/sample-product-decision/brief.md` prints a clean dry-run summary.
- [ ] `aos brief template --kind deliberation` renders a valid editable template.
- [ ] `aos replay <transcript.jsonl>` renders governance events, including `steer` and `tool-denied`, without raw JSON fallback.
- [ ] The docs site homepage and docs pages render at mobile and desktop widths.

## Live Adapter Checks

These require installed and authenticated vendor CLIs plus matching `@aos-harness/*-adapter` packages.

- [ ] Codex: run `aos run strategic-council --adapter codex --brief core/briefs/sample-product-decision/brief.md` and confirm MCP tools `delegate` and `end` are usable.
- [ ] Claude Code: run the same strategic-council smoke with `--adapter claude-code`.
- [ ] Gemini: run the same strategic-council smoke with `--adapter gemini`.
- [ ] Pi: run the same strategic-council smoke with `--adapter pi`.
- [ ] For each adapter, confirm transcript files are written and final output path is reported.

## Live Memory Checks

These require a reachable MemPalace MCP server. Set `AOS_REQUIRE_MEMPALACE=1` for validation so a configured MemPalace project fails fast instead of silently falling back to expertise memory.

- [ ] `aos init` detects the MemPalace socket or reports the missing server clearly.
- [ ] `.aos/memory.yaml` has `provider: mempalace` and `AOS_REQUIRE_MEMPALACE=1 aos run strategic-council --adapter codex --brief core/briefs/sample-product-decision/brief.md --verbose` reports `memory provider: mempalace`.
- [ ] The same strict `aos run` smoke performs wake, recall, and remember calls against MemPalace.
- [ ] MemPalace restart/fallback behavior is exercised by stopping the server before session-end memory commit.
- [ ] Fallback JSONL is written when restart fails, and the operator gets a clear recovery path.

## Documentation Checks

- [ ] Feature counts in the white paper match `aos validate` output.
- [ ] Docs distinguish implemented behavior from planned platform behavior.
- [ ] README capability table does not claim live-only features are locally complete.
- [ ] Plugin skill docs match current CLI behavior.

## Completion Rule

A release can be marked complete when all local automated checks pass and all live checks are either passed or explicitly recorded as not run with a reason. Do not silently treat skipped live adapter or MemPalace checks as passed.
