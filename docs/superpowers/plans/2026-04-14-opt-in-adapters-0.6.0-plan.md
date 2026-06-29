# aos-harness 0.6.0 Implementation Plan

**Date:** 2026-04-14
**Status:** Ready for implementation (after 0.5.2 ships and the signal window closes)
**Spec:** `docs/superpowers/specs/2026-04-14-opt-in-adapters-design.md`

Assumes 0.5.2 (deprecation warning) has shipped and the "wait for signal" window is closed. All work below is on a fresh branch cut from `main` after 0.5.2 ships (or continued on `feat/cli-adapter-integration` if still live). Starting point: every package in the monorepo at 0.5.2.

---

## Step 1 — CLI `package.json`: peer-dep swap and files list

**File:** `cli/package.json`

Changes:
- Remove `adapters/` from the `files` array. After edit: `["src/", "core/", "README.md"]`.
- Add `peerDependencies` block with all four adapters at range `">=0.6.0 <1.0.0"`:
  - `@aos-harness/claude-code-adapter`
  - `@aos-harness/codex-adapter`
  - `@aos-harness/gemini-adapter`
  - `@aos-harness/pi-adapter`
- Add `peerDependenciesMeta` marking all four as `{ "optional": true }`.
- Leave `dependencies` untouched — `@aos-harness/runtime` and `@aos-harness/adapter-shared` stay as direct deps.

**Verify before moving on:**
- `bun install` at repo root succeeds with no unmet-peer errors (workspace symlinks satisfy the peers in-repo).
- `jq .peerDependencies cli/package.json` shows exactly four entries.
- `jq .files cli/package.json` does not contain `"adapters/"`.

---

## Step 2 — Rewrite `loadAdapterRuntime` in `adapter-session.ts`

**File:** `cli/src/adapter-session.ts`

**Imports:** Drop `dirname` and `fileURLToPath` if they become unused after the fallback branch is removed (grep the file — they're also used elsewhere, so keep them). Remove any imports added in 0.5.2 that are only used by `maybeWarnAdapterDeprecation` (e.g. `mkdirSync`, `existsSync`, `writeFileSync` from `node:fs` if not used elsewhere in the file).

Add a module-level constant that reads the CLI version:
- Read `cli/package.json` synchronously at module load, parse, pull `.version` into `CLI_VERSION`. (Already present from 0.5.2 — keep it.)

Add four new helpers (verbatim semantics from spec §Resolution):

1. `isModuleNotFound(err: any): boolean` — checks in order: `err?.code === "ERR_MODULE_NOT_FOUND"`, `err?.code === "MODULE_NOT_FOUND"`, `err?.constructor?.name === "ResolveMessage"`, then regex `/Cannot find (module|package)/i` against `err?.message`. Return true on any hit, false otherwise.

2. `printMissingAdapterError(pkg: string): void` — writes to stderr the exact block from spec §Resolution:
   ```
   ✗ Adapter not installed: <pkg>

   Install it:
     npm i -g <pkg>    # if aos-harness is installed globally
     npm i    <pkg>    # if aos-harness is a project dependency

   (or use bun / pnpm / yarn equivalents)

   CLI version: aos-harness@<CLI_VERSION>. Pin the adapter to the same version.
   ```
   Recommendation: gate ANSI red on `process.stderr.isTTY`, mirroring 0.5.2's yellow-deprecation-warning convention.

3. `versionMismatchSeverity(cliVer, adapterVer): "none" | "warn"` — parse major/minor via `split(".").map(Number)`; return `"warn"` if major differs or minor differs, else `"none"`. Per spec, pre-1.0 minor drift is treated as breaking; the logic above handles that correctly since we always compare minors.

4. `maybeWarnVersionMismatch(pkg: string, adapterVer: string): void` — guarded by a module-level `mismatchWarnedPackages = new Set<string>()` so it fires once per package per session. Calls `versionMismatchSeverity(CLI_VERSION, adapterVer)`; if `"warn"`, writes the spec's message to stderr (yellow when TTY).

Rewrite `loadAdapterRuntime`:
- Keep the `ADAPTER_MAP` lookup and `readAdapterVersion` helper.
- Replace the try/catch body with:
  ```ts
  let mod: any;
  try {
    mod = await import(entry.package);
  } catch (err) {
    if (isModuleNotFound(err)) {
      printMissingAdapterError(entry.package);
      process.exit(2);
    }
    throw err; // real load error — surface it
  }
  const resolved = (import.meta as any).resolve?.(entry.package) ?? entry.package;
  const version = await readAdapterVersion(resolved);
  console.error(`[adapter] loaded ${entry.package}@${version}`);
  maybeWarnVersionMismatch(entry.package, version);
  return mod[entry.className];
  ```
- Delete the entire `catch` fallback that imported from `join(here, "..", "..", "adapters", platform, "src", "index.ts")`.
- Delete `maybeWarnAdapterDeprecation` (added in 0.5.2) and the `deprecationWarnedThisSession` flag it used.

**Verify before moving on:**
- `bun run cli/src/index.ts run ...` with an installed adapter (workspace) still loads correctly and prints `[adapter] loaded <pkg>@<version>`.
- Temporarily rename one adapter's `package.json` `name` field locally and confirm the missing-adapter message prints and exits 2. (Restore afterward.)
- Typecheck clean.

---

## Step 3 — Strip adapter-copy from `copy-core.ts`

**File:** `scripts/copy-core.ts`

- Delete the `adaptersSrc`, `adaptersDest` constants.
- In `copyCore`: remove the entire `if (existsSync(adaptersSrc)) { ... }` block, including the `EXCLUDED_SEGMENTS`/`EXCLUDED_FILES` filter sets.
- In `cleanCore`: remove the `if (existsSync(adaptersDest)) { ... }` block.
- Update the file-header comment (line 3) to say "copying core/ into cli/ before publish" — drop "and adapters/".

**File:** `scripts/publish.ts`

- In `publishWithPinnedDeps`, delete the block that rewrites workspace deps inside `cli/adapters/*/package.json`. With no copied adapters, this loop is dead.

**Verify before moving on:**
- `bun scripts/copy-core.ts copy` produces only `cli/core/`; `cli/adapters/` does not appear.
- `bun scripts/copy-core.ts clean` removes `cli/core/` only.
- `bun scripts/publish.ts` (dry run, no `--confirm`) completes without referencing `cli/adapters/`.

---

## Step 4 — `aos init` adapter guidance

**File:** `cli/src/commands/init.ts`

- At the top, add a helper to read the CLI version from `cli/package.json` the same way Step 2 does (or import a shared constant if you extract one — not required).
- After the existing `console.log` block that ends with "Validate everything", append a new block:
  ```
  Next step: install an adapter for the AI CLI you'll use.

    Claude Code:   npm i -g @aos-harness/claude-code-adapter@<CLI_VERSION>
    Gemini CLI:    npm i -g @aos-harness/gemini-adapter@<CLI_VERSION>
    Codex CLI:     npm i -g @aos-harness/codex-adapter@<CLI_VERSION>
    Pi (pi-ai):    npm i -g @aos-harness/pi-adapter@<CLI_VERSION>

  Pick one (or more). Then run `aos run`.
  ```
  Use the existing `c.bold`/`c.cyan`/`c.dim` helpers for consistency with the rest of the output.
- Do not gate on `--adapter` — the spec says "guidance at the right moment", unconditional.

**Ambiguity flag:** Spec lists four adapters in the init guidance but the current `VALID_ADAPTERS` array omits `codex` and `pi`. The spec does not say to expand `VALID_ADAPTERS`. Keep `VALID_ADAPTERS` as-is (that's an input validator for `--adapter` flag, not the install-hint list). The printed list may mention adapters that `--adapter` won't currently accept — acceptable, because those adapters work via `aos run --adapter <name>` which resolves through `ADAPTER_MAP` in `adapter-session.ts`. Worth a 1-line note in the PR description.

**Verify before moving on:**
- `rm -rf /tmp/aos-init-test && mkdir /tmp/aos-init-test && cd /tmp/aos-init-test && bun <repo>/cli/src/index.ts init` prints the new guidance block with the correct version interpolated.
- Existing `init` behaviour (config.yaml, memory.yaml, core copy) unchanged.

---

## Step 5 — README rewrite

**File:** `cli/README.md` (confirm path; the published README lives via `cli/package.json` `files`). Also check root `README.md` and update consistently.

Add/rewrite **Getting Started** near the top:
1. Install CLI: `npm i -g aos-harness`
2. Install an adapter (show all four with versions pinned to current CLI version):
   ```
   npm i -g @aos-harness/claude-code-adapter
   # or gemini-adapter / codex-adapter / pi-adapter
   ```
3. Initialize: `aos init`
4. Run: `aos run <profile> --brief path/to/brief.md`

Add a **Breaking change in 0.6.0** callout at the top:
- In 0.5.x the CLI shipped all adapters bundled. In 0.6.0 you must install the adapter(s) you want separately.
- Point to CHANGELOG.

**Verify before moving on:**
- Render the README in a previewer; confirm fenced blocks and heading hierarchy are valid.
- Confirm no instructions reference `cli/adapters/` or bundled fallback behaviour.

---

## Step 6 — CHANGELOG entry

**File:** `CHANGELOG.md` (at repo root)

Add a `## [0.6.0] - YYYY-MM-DD` section above 0.5.2's entry:

- **BREAKING:** `aos-harness` no longer bundles adapter code. You must install the adapter(s) you use as separate packages. If you run `aos run` without the corresponding `@aos-harness/<name>-adapter` installed, the CLI exits 2 with an install hint.
- Adapters are declared as optional peer dependencies in the CLI (`peerDependenciesMeta.*.optional = true`); `npm i -g aos-harness` continues to work without errors.
- Peer range: `">=0.6.0 <1.0.0"`. Runtime version-mismatch warning fires when CLI and adapter minors differ.
- `aos init` now prints adapter-install guidance at the end.
- Migration: `npm i -g @aos-harness/<adapter-name>-adapter@0.6.0` for each adapter you had been relying on.

**Verify before moving on:**
- Markdown renders.
- The `BREAKING` callout is visually prominent (bold, top of the 0.6.0 section).

---

## Step 7 — Test updates

Find and update tests that assert bundled-fallback behaviour.

**Commands to run (read-only discovery):**
- `grep -rn "bundled" cli/ tests/ scripts/`
- `grep -rn "adapters/" tests/`
- `grep -rn "loadAdapterRuntime" .`
- `grep -rn "migration-warned-0.6" .`
- `grep -rn "maybeWarnAdapterDeprecation" .`

For each hit:
- Tests that assert the bundled fallback loads an adapter from `cli/adapters/...` — delete.
- Tests that assert the 0.5.2 deprecation warning fires — delete.
- Tests that assert standalone-package loading — keep, update expected `[adapter] loaded` log string (no longer has `(standalone)` suffix per new code; if you prefer to keep the suffix, add it back in Step 2).
- Add new tests (if the test harness supports it):
  - `isModuleNotFound` unit tests covering each of the four branches (`ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`, `ResolveMessage` name, regex fallback), plus a negative case (e.g. `TypeError` must return false).
  - `versionMismatchSeverity` unit tests: same version → `"none"`; minor diff → `"warn"`; patch-only diff → `"none"`; major diff → `"warn"`.

**Ambiguity flag:** Spec says "test updates (anything currently asserting the bundled fallback must be removed or re-pointed)" but CLI doesn't currently have a tests dir. Discovery commands above will reveal the actual surface. If none exist, adding the two unit-test suites above is the minimum useful test work — but if CLI test infrastructure doesn't exist, the marginal value of setting it up for code that replaces the just-deleted 0.5.2 code may not justify the cost. Judgment call at implementation time.

**Verify before moving on:**
- `bun test` passes across the monorepo.
- `bun run tests/integration/validate-config.ts` (per `publish.ts`) passes.

---

## Step 8 — Manual verification against spec §Verification 0.6.0

In a scratch directory outside the monorepo:

1. Dry-run publish from repo root: `bun scripts/publish.ts` (no `--confirm`). Inspect the would-publish tarball content for the CLI entry. Confirm `adapters/` is absent.
2. Simulate fresh install: install the CLI tarball locally with `bun add -g ./aos-harness-0.6.0.tgz` (or npm equivalent) into a clean prefix. Confirm no peer-dep errors.
3. `aos run --adapter claude-code ...` with no adapter installed → expect the missing-adapter block, exit code 2.
4. Install `@aos-harness/claude-code-adapter@0.6.0` in the same scope; rerun → succeeds, no warning.
5. Force a mismatch: install `@aos-harness/claude-code-adapter@0.7.0-test` (publish a scratch tag if needed, or use `npm link` against a locally bumped adapter) → expect the version-mismatch warning, run continues.
6. Bun error-shape check: temporarily edit `node_modules/@aos-harness/claude-code-adapter/package.json` to a bogus `main` → confirm `isModuleNotFound` still classifies correctly (or the real error surfaces, which is the correct behaviour — this is the "don't swallow real errors" guardrail).

**Verify before moving on:**
- All six steps behave as described.

---

## Step 9 — Version bump (lockstep)

Bump `version` from 0.5.2 to `0.6.0` in **all seven** `package.json` files:

- `runtime/package.json`
- `adapters/shared/package.json`
- `adapters/claude-code/package.json`
- `adapters/codex/package.json`
- `adapters/gemini/package.json`
- `adapters/pi/package.json`
- `cli/package.json`

**Verify before moving on:**
- `bun scripts/publish.ts` dry-run passes the lockstep-version check (the script errors if any package is off). This is the authoritative gate.

---

## Step 10 — Commit, tag, publish, push

1. Commit all changes. Suggested message:
   `chore(release): 0.6.0 — remove bundled adapters, require standalone installs`
2. `git tag v0.6.0`
3. `bun scripts/publish.ts --confirm` — publishes all 7 packages in dependency order. Script is idempotent, so a mid-run failure can be resumed.
4. `git push && git push --tags`

**Verify after:**
- `npm view aos-harness@0.6.0 peerDependencies` shows the four adapter entries.
- `npm view aos-harness@0.6.0 dist.tarball` — download, `tar tf`, confirm no `adapters/` inside.
- `npm view @aos-harness/claude-code-adapter@0.6.0` resolves.
- In a clean sandbox: `npm i -g aos-harness@0.6.0 @aos-harness/claude-code-adapter@0.6.0`, run a trivial `aos run`, confirm it loads.

---

## Ambiguities surfaced while planning

1. **Log string format for successful load.** 0.5.2 code logs `[adapter] loaded <pkg>@<ver> (standalone)` to distinguish from the bundled case. With the bundled path gone in 0.6.0, `(standalone)` is redundant. Spec doesn't say. Recommendation: drop the suffix. Low stakes; existing log consumers (if any) would need to adapt.

2. **Missing-adapter message colour.** Spec shows `✗` at the start of the error but doesn't specify ANSI colour. 0.5.2's deprecation helper uses yellow gated on `process.stderr.isTTY`. Recommend mirroring that convention with red for the error.

3. **`VALID_ADAPTERS` in `init.ts`** currently excludes `codex` and `pi`. The new guidance block lists all four. Not a spec deviation — `--adapter` is a config-generator default, not the runtime adapter list — but the inconsistency is worth either fixing (expand `VALID_ADAPTERS`) or noting in the PR. Not required by the spec.

4. **CHANGELOG path.** Lives at repo root (`CHANGELOG.md`) — confirmed.

5. **README path.** The `cli/package.json` `files` field includes `README.md`. Whether that's a symlink/copy of the root README or a CLI-specific one was not confirmed. Implementer should check and update the correct file (or both).
