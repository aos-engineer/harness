# Opt-In Adapters (0.6.0) Design

**Date:** 2026-04-14
**Status:** Approved for implementation
**Scope:** Stop bundling adapters inside the `aos-harness` CLI. Users install only the adapter(s) they actually use. Includes 0.5.2 deprecation step and 0.6.0 breaking removal.

## Goal

Make `aos-harness` adapter-agnostic. On `aos run`, the CLI resolves the requested adapter from the user's `node_modules`. If it's not installed, the CLI prints a clear install command and exits non-zero. No bundled fallback in 0.6.0.

## Why

- In 0.5.1 every CLI install still ships source for all 4 adapters (~100 KB of TS the user may never touch). Small today, unbounded tomorrow — new adapters would grow the CLI by design.
- The hybrid model forces adapter release cadence to track the CLI. Decoupling means an adapter can ship a patch without a CLI release.
- "What version of the claude-code adapter am I running?" is ambiguous today (bundled copy vs. globally installed vs. project-local). Opt-in collapses it to one answer: whatever the user installed.

## Non-Goals

- Changing adapter APIs or the composition layer (`composeAdapter`) — purely distribution.
- Auto-installing adapters. We tell the user what to run, we don't run it for them.
- Plugin discovery (scanning for `@aos-harness/*-adapter` in scope). Deferred.

## Decisions

### Distribution

- **CLI ships no adapter code.** `copyCore` stops copying `adapters/` into `cli/`. The `cli/adapters/` path disappears from the published tarball.
- **Adapters are optional peer dependencies** of the CLI (`peerDependenciesMeta.*.optional = true`), so `npm i -g aos-harness` doesn't error. Users install explicitly: `npm i -g @aos-harness/claude-code-adapter`.
- **`core/` still bundles** — it's the framework's data (agents, profiles, domains, schemas), not pluggable runtime code.

### Resolution and error handling

#### Detecting "not installed" in Bun

Bun 1.3.11 throws a `ResolveMessage` with `code === "ERR_MODULE_NOT_FOUND"` when a dynamic `import()` fails to resolve. Verified empirically (2026-04-14). But Bun's error shape has drifted across versions, so we belt-and-suspenders the check:

```ts
function isModuleNotFound(err: any): boolean {
  if (err?.code === "ERR_MODULE_NOT_FOUND") return true;
  if (err?.code === "MODULE_NOT_FOUND") return true; // older Bun / Node
  if (err?.constructor?.name === "ResolveMessage") return true; // Bun-specific class
  // Fallback: message match. Brittle, last resort.
  const msg = typeof err?.message === "string" ? err.message : "";
  if (/Cannot find (module|package)/i.test(msg)) return true;
  return false;
}
```
Critically: **do not** catch arbitrary errors as "not installed". An adapter that throws during module evaluation (e.g., syntax error, missing dep inside the adapter) must surface its real error. Only the narrow "this package cannot be resolved" case triggers the install-hint path.

#### Global vs. project install

The obvious heuristic ("`process.argv[1].includes('node_modules')` means project install") does not work: both `/Users/me/.bun/install/global/node_modules/aos-harness/...` and `./node_modules/aos-harness/...` contain `node_modules`. Verified on this machine.

Options evaluated:
1. **Pattern-match known global dirs** (`.bun/install/global`, `/usr/local/lib/node_modules`, `.npm/`, `nvm/versions/`, `AppData/Roaming/npm/`, volta, fnm, asdf…). Hits 90%, fails on custom prefixes and non-standard package managers.
2. **Walk up from CLI install path looking for a user `package.json` that isn't aos-harness's own.** Works for most cases, fragile when the user runs the CLI from outside their project root.
3. **Show both commands in the error message.** Zero detection, never wrong, user is informed either way. Slightly noisier error message.

**Decision: option 3.** Two extra lines in the error message is a cheap price for never misleading a user. Example:

```
✗ Adapter not installed: @aos-harness/claude-code-adapter

Install it:
  npm i -g @aos-harness/claude-code-adapter    # if aos-harness is installed globally
  npm i    @aos-harness/claude-code-adapter    # if aos-harness is a project dependency

(or use bun / pnpm / yarn equivalents)

CLI version: aos-harness@<current>. Pin the adapter to the same version.
```

Exit code `2`.

#### Version mismatch warning

On successful adapter load, compare the adapter's version to the CLI's own version. **Warn only when the minor version differs** (or any pre-1.0 difference in the minor slot, since we treat 0.x.y as minor-breaking). Patch-level drift is expected under lockstep and should not produce console noise.

```ts
function versionMismatchSeverity(cliVer: string, adapterVer: string):
  "none" | "warn" {
  const [cliMaj, cliMin] = cliVer.split(".").map(Number);
  const [adaMaj, adaMin] = adapterVer.split(".").map(Number);
  if (cliMaj !== adaMaj) return "warn";
  if (cliMin !== adaMin) return "warn";
  return "none"; // patch-level drift is tolerated silently
}
```

Message when `warn`:
```
⚠ Version mismatch: aos-harness@0.6.0 and @aos-harness/claude-code-adapter@0.7.0
  Adapters are published lockstep with the CLI. Install matching versions:
  npm i -g @aos-harness/claude-code-adapter@0.6.0
```
Print once per session, not per delegation.

### Peer dependency range

Options:
- `"0.6.x"` — tight. Forces a peer-dep bump in the CLI on every minor. Breaks if any adapter lags a version.
- `">=0.6.0 <1.0.0"` — loose. Trusts lockstep publishing and runtime mismatch warning. No CLI republish needed when adapter minors bump pre-1.0.

**Decision: `">=0.6.0 <1.0.0"`** in `peerDependencies`. The runtime mismatch warning (above) catches real misalignment. Tight pinning in peer deps while you also publish lockstep is redundant and creates friction: every minor bump requires a coordinated CLI peer-dep edit. Post-1.0 we revisit.

### Deprecation warning in 0.5.2

This is the most important part of the migration, per review feedback. Without it, `aos run` on 0.6.0 will fail for users who updated the CLI but not the adapters, with no prior signal.

**Rules:**
1. Warning fires only when the **bundled fallback** was used to load the adapter (i.e., the standalone package wasn't installed). Users who already installed `@aos-harness/<name>-adapter` see nothing — they're ready.
2. **Once per session, once per project.** First time the bundled fallback is used in a given project, write `.aos/migration-warned-0.6` (flag file). Subsequent runs check for the flag and stay silent. If the flag exists, never warn again in that project.
3. Session-level dedup: if the flag doesn't exist but we already warned earlier in *this process*, don't re-warn. (Matters for multi-adapter workflows.)
4. Written to stderr in yellow (`\x1b[33m…\x1b[0m`), non-TTY falls back to uncoloured text.
5. Non-blocking — it's a warning, the session proceeds normally.

**Message:**
```
⚠ Deprecation: bundled adapters will be removed in aos-harness@0.6.0.
  This project is using the bundled copy of @aos-harness/claude-code-adapter.
  Install the standalone package to silence this warning and prepare for 0.6.0:

    npm i -g @aos-harness/claude-code-adapter@<cli-version>
    # or:  npm i @aos-harness/claude-code-adapter@<cli-version>

  This warning appears once per project. Delete .aos/migration-warned-0.6 to re-enable.
```

### Dev ergonomics

- In the repo, workspace symlinks mean `@aos-harness/claude-code-adapter` resolves without changes — dev UX unchanged.
- Remove `cli/adapters/` from the 0.6.0 tarball. The fallback path (`join(here, "..", "..", "adapters", platform, "src", "index.ts")`) is removed in 0.6.0 but remains in 0.5.2 (gated by the deprecation warning).
- `scripts/copy-core.ts` in 0.6.0 simplifies to only copying `core/`. In 0.5.2 it still copies adapters (with the filter we added in 0.5.1).

## Changes

### 0.5.2 — deprecation step

#### 1. `cli/src/adapter-session.ts`

In the `catch` branch of `loadAdapterRuntime` (the bundled fallback), after successfully loading the fallback module, call `maybeWarnAdapterDeprecation(entry.package, config.root)`. Implementation:

```ts
let sessionWarned = false;

function maybeWarnAdapterDeprecation(pkg: string, projectRoot: string): void {
  if (sessionWarned) return;
  const flagPath = join(projectRoot, ".aos", "migration-warned-0.6");
  if (existsSync(flagPath)) return;
  sessionWarned = true;
  const useColor = process.stderr.isTTY;
  const y = useColor ? "\x1b[33m" : "";
  const r = useColor ? "\x1b[0m" : "";
  console.error(
    `${y}⚠ Deprecation: bundled adapters will be removed in aos-harness@0.6.0.${r}\n` +
    `  This project is using the bundled copy of ${pkg}.\n` +
    `  Install the standalone package to silence this and prepare for 0.6.0:\n\n` +
    `    npm i -g ${pkg}@${CLI_VERSION}\n` +
    `    # or:  npm i ${pkg}@${CLI_VERSION}\n\n` +
    `  This warning appears once per project. Delete .aos/migration-warned-0.6 to re-enable.`
  );
  try {
    mkdirSync(dirname(flagPath), { recursive: true });
    writeFileSync(flagPath, new Date().toISOString() + "\n");
  } catch {
    // non-fatal — if we can't write the flag, we'll warn again next time,
    // which is fine. don't block the run.
  }
}
```
`CLI_VERSION` is read from `cli/package.json` at module load.

#### 2. CHANGELOG note for 0.5.2

Call out the deprecation timeline prominently.

### 0.6.0 — breaking change

#### 1. `cli/package.json`

```jsonc
{
  "peerDependencies": {
    "@aos-harness/claude-code-adapter": ">=0.6.0 <1.0.0",
    "@aos-harness/codex-adapter": ">=0.6.0 <1.0.0",
    "@aos-harness/gemini-adapter": ">=0.6.0 <1.0.0",
    "@aos-harness/pi-adapter": ">=0.6.0 <1.0.0"
  },
  "peerDependenciesMeta": {
    "@aos-harness/claude-code-adapter": { "optional": true },
    "@aos-harness/codex-adapter": { "optional": true },
    "@aos-harness/gemini-adapter": { "optional": true },
    "@aos-harness/pi-adapter": { "optional": true }
  },
  "files": ["src/", "core/", "README.md"]
}
```
`adapters/` drops from `files`.

#### 2. `scripts/copy-core.ts`

Remove the adapters block. Keep `core/` copy. The adapter filter added in 0.5.1 becomes dead code — delete it in the same commit.

#### 3. `cli/src/adapter-session.ts`

Replace the try/catch in `loadAdapterRuntime` with the install-hint version described above. Delete `maybeWarnAdapterDeprecation` (no longer reachable). Add `isModuleNotFound`, `printMissingAdapterError`, `versionMismatchSeverity`, `maybeWarnVersionMismatch`.

#### 4. `aos init` adapter guidance (fast follow)

At the end of `aos init`, after copying core configs, print:

```
Next step: install an adapter for the AI CLI you'll use.

  Claude Code:   npm i -g @aos-harness/claude-code-adapter@<cli-version>
  Gemini CLI:    npm i -g @aos-harness/gemini-adapter@<cli-version>
  Codex CLI:     npm i -g @aos-harness/codex-adapter@<cli-version>
  Pi (pi-ai):    npm i -g @aos-harness/pi-adapter@<cli-version>

Pick one (or more). Then run `aos run`.
```

Non-interactive — just guidance at the right moment. Can evolve into a prompt later if we add TTY detection.

#### 5. README

New **Getting Started** section walking through: install CLI, install one adapter, `aos init`, `aos run`. Call out the breaking change from 0.5.x prominently.

## Rollout

1. **0.5.2** ships the deprecation warning. No breaking changes. Users who run `aos run` without the standalone adapter see the yellow warning once per project.
2. **Wait** — at least a few weeks, ideally until signal from users (issues, installs of the standalone packages).
3. **0.6.0** ships the breaking change. CHANGELOG and README call it out. Bundled fallback is gone.

## Verification

### 0.5.2

1. `bun run test` passes.
2. Local repro: in a scratch project, run `aos run` with only the CLI installed (no standalone adapter). Yellow warning appears. Check: `.aos/migration-warned-0.6` created. Rerun: no warning.
3. Install `@aos-harness/claude-code-adapter` standalone: warning disappears (because the standalone path is taken, bundled fallback isn't).

### 0.6.0

1. `bun run test` passes.
2. `bun run publish:all` (dry-run) shows CLI tarball excludes `adapters/`.
3. Fresh install:
   - `npm i -g aos-harness@0.6.0` → succeeds, no errors about missing optional peers.
   - `aos run --adapter claude-code ...` → prints the missing-adapter message with both install forms, exits 2.
   - `npm i -g @aos-harness/claude-code-adapter@0.6.0` → rerun → works, no warning.
4. Version mismatch check: CLI 0.6.0 with adapter 0.7.0 (pinned) → warning printed, run continues. CLI 0.6.0 with adapter 0.6.3 → silent.
5. Bun error-shape check: on a Bun version where `ResolveMessage.code` is missing, the message-regex fallback still catches it.

## Open Questions

None blocking implementation. Remaining items are fast-follow or post-1.0:

- **Package manager detection** (npm vs. bun vs. pnpm vs. yarn). Current plan: show npm commands, parenthetical note about alternatives. Could sniff user's package manager via `npm_config_user_agent` env var if present. Low priority.
- **`adapter-shared` bundling.** Current answer: not bundled. Each standalone adapter pulls it transitively, CLI doesn't need it directly. Confirmed.

## Out of Scope / Future Work

- Plugin discovery (auto-find any `@aos-harness/*-adapter` in scope).
- An `aos adapter install <name>` convenience command that shells out to the user's package manager.
- Adapter registry / marketplace.
- Interactive adapter-picker in `aos init`.
