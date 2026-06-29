# AOS Docs Site

This directory contains the public Astro site for AOS Harness, including the landing page and the docs pages published at `harness.aos.engineer`.

## Local Development

Run commands from this directory:

```bash
bun install
bun dev
```

The dev server starts on `http://localhost:4321`.

## Key Commands

| Command | Action |
|---|---|
| `bun dev` | Start the local Astro dev server |
| `bun build` | Build the production site into `dist/` |
| `bun preview` | Preview the built site locally |
| `bun run check` | Run Astro's project checks |
| `bun run upgrade:astro` | Upgrade Astro and official integrations to their latest versions |

## Content Areas

| Path | Purpose |
|---|---|
| `src/pages/index.astro` | Marketing homepage |
| `src/pages/docs/` | Public documentation pages |
| `src/layouts/` | Shared page layouts |
| `public/` | Static assets |

## Documentation Expectations

- Keep the install flow aligned with the current CLI behavior: vendor CLI first, matching `@aos-harness/*-adapter` second, then `aos init`.
- Keep model-selection guidance aligned with runtime reality:
  - `pi` pins explicit tier models by default
  - `codex`, `claude-code`, and `gemini` defer to the vendor default model unless pinned
- Keep optional host-native install surfaces aligned with runtime reality:
  - Codex local plugin
  - Claude Code command pack
  - Pi extension package
- Keep Claude auth guidance aligned with the scanner/runtime:
  - readiness uses `claude auth status --json`
  - `ANTHROPIC_API_KEY` can override subscription auth and produce invalid-key failures
- Prefer commands that match the real shipped interface.
- When changing product behavior, update the matching docs page and any homepage snippets in the same change.
- Before adopting new Astro patterns from current docs, upgrade and check the site:

```bash
bun run upgrade:astro
bun run check
```
