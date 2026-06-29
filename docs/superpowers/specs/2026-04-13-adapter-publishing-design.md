# Adapter Publishing Design

**Date:** 2026-04-13
**Status:** Approved for implementation
**Scope:** Complete adapter configuration so all workspace packages are publishable to npm.

## Goal

Publish the four AOS adapters (`claude-code`, `codex`, `gemini`, `pi`) as standalone npm packages alongside the existing `@aos-harness/runtime`, `@aos-harness/adapter-shared`, and `aos-harness` CLI — while still bundling adapters inside the CLI for zero-install UX (hybrid distribution).

## Non-Goals

- Converting TypeScript sources to compiled JS (Bun-native distribution is out of scope here).
- Changing the public API of any adapter.
- Independent versioning. This spec establishes lockstep.

## Decisions

### Hybrid distribution

- Adapters publish as standalone `@aos-harness/<name>-adapter` packages AND get copied into `cli/adapters/` via `scripts/copy-core.ts` at publish time.
- Users who `npm i -g aos-harness` get the full experience out of the box; users who prefer lean installs can install specific adapters on top of `@aos-harness/runtime`.

### Lockstep versioning at 0.5.0

All 7 published packages release together at the same version. Rationale:

- Every adapter imports `@aos-harness/runtime` and `@aos-harness/adapter-shared` directly, so runtime breaking changes cascade regardless of independent versions.
- Single-answer support: "what version of aos-harness?" resolves everything.
- Pre-1.0 framework — cheap to keep aligned; can split later.

Release target: **0.5.0** for the hybrid-publish milestone.

## Changes

### 1. Package metadata

Add the following fields to each of:

- `adapters/shared/package.json`
- `adapters/claude-code/package.json`
- `adapters/codex/package.json`
- `adapters/gemini/package.json`
- `adapters/pi/package.json`

```json
{
  "description": "<adapter-specific one-liner>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git",
    "directory": "adapters/<name>"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["aos-harness", "ai-agents", "<adapter>", "adapter"],
  "engines": { "bun": ">=1.0.0" },
  "files": ["src/", "README.md"],
  "publishConfig": { "access": "public" }
}
```

- `engines.bun` is required — adapter packages ship raw TypeScript, so a Node-only install would fail confusingly without it. Matches the CLI/runtime convention.
- `files` must be explicit to avoid publishing dev configs, fixtures, or local scratch files. Existing adapters declare `["src/"]`; add `README.md` (create per-adapter stubs where missing).

Root `package.json` remains `private: true`.

### 2. Version alignment (all → 0.5.0)

| Package | Current | Target |
|---|---|---|
| `@aos-harness/runtime` | 0.4.2 | 0.5.0 |
| `@aos-harness/adapter-shared` | 0.4.2 | 0.5.0 |
| `@aos-harness/claude-code-adapter` | 0.2.0 | 0.5.0 |
| `@aos-harness/gemini-adapter` | 0.2.0 | 0.5.0 |
| `@aos-harness/codex-adapter` | 0.1.0 | 0.5.0 |
| `@aos-harness/pi-adapter` | 0.1.0 | 0.5.0 |
| `aos-harness` (CLI) | 0.4.2 | 0.5.0 |

### 3. `scripts/publish.ts` refactor

- Define `publishedPkgs` array in publish order: `runtime → shared → claude-code → codex → gemini → pi → cli`. Ordering ensures each package's dependencies already exist on the registry when it publishes.
- Extract the try/finally workspace-pinning pattern into a helper:
  ```ts
  async function publishWithPinnedDeps(
    dir: string,
    pkg: Record<string, unknown>,
    pinMap: Record<string, string>,
  ): Promise<void>
  ```
  The helper (a) snapshots the raw `package.json`, (b) replaces **every** `workspace:*` entry per `pinMap`, (c) runs `bun publish` (or dry-run), and (d) always restores the original file in `finally`.
- **`pinMap` must include all cross-workspace deps, not just direct parents.** Concretely:
  - `shared` → `{ "@aos-harness/runtime": releaseVersion }`
  - each adapter → `{ "@aos-harness/runtime": releaseVersion, "@aos-harness/adapter-shared": releaseVersion }`
  - `cli` → `{ "@aos-harness/runtime": releaseVersion, "@aos-harness/adapter-shared": releaseVersion }` (plus bundled `cli/adapters/*/package.json` resolution as today)
- **Lockstep gate:** compute `releaseVersion` from `runtime`, then assert every other package's version equals it. Fail fast with a clear message if not.
- **Idempotent retries.** If `bun publish` fails with "version already exists" for a package, treat it as success and continue to the next. This makes the script safe to re-run after a partial publish (e.g., npm outage mid-run leaves runtime + shared on the registry; re-running should skip them and publish the remaining five). Match on stderr/exit-code pattern from `bun publish`; document the exact match string in code.
- Keep the existing `copy-core` call before CLI publish so bundled adapters stay in sync.
- Continue resolving `workspace:*` inside `cli/adapters/*/package.json` during the CLI publish step (already implemented).

### 4. CLI bundling unchanged

`cli/package.json` already declares `files: ["src/", "core/", "adapters/", "README.md"]`. The hybrid model requires no CLI-side changes beyond the version bump.

**Adapter resolution precedence (hybrid).** The CLI's adapter loader tries `import("@aos-harness/<name>-adapter")` first and falls back to the bundled `cli/adapters/<name>` path. Node/Bun module resolution means a standalone install (global or local) wins over the bundled copy. This is the intended behavior — users who explicitly install a standalone adapter get their chosen version. Document this precedence in the CLI README so users aren't surprised by bundled-vs-standalone version mismatches. Recommended UX: the CLI logs which adapter path resolved at load time (e.g., `loaded @aos-harness/claude-code-adapter@0.5.0 from <path>`).

### 5. Dry-run gate before publish

`bun run publish:all` (without `--confirm`) must report "would publish" for all 7 packages with zero warnings. This is the pre-flight check.

## Verification

1. `bun run lint` passes.
2. `bun run test` passes.
3. `bun run publish:all` (dry-run) reports 7 packages, all with matching versions, no workspace-resolution warnings.
4. Manual spot-check: unpack the dry-run tarballs (or read `files` output) to confirm each adapter package contains `src/`, a `README.md`, and a resolved `package.json` (no `workspace:*` leaks, `engines.bun` present).
5. Idempotency check: re-run `bun run publish:all` (dry-run) after a simulated partial publish (mock the "already exists" response for `runtime`) and confirm the script continues rather than aborting.

## Rollout

1. Implement metadata + version bumps + publish-script changes on a feature branch.
2. Run full verification (lint, test, dry-run).
3. Merge to `main`.
4. Tag `v0.5.0` and run `bun run publish:all --confirm`.
5. Update `CHANGELOG.md` with the adapter publishing entry.

## Out of Scope / Future Work

- Compiling to JS for Node-only consumers.
- Independent adapter versioning.
- Automated changeset tooling (e.g., changesets/release-please).
