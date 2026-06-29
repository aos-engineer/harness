# AOS Init Wizard Design — Environment-Aware Init

**Date:** 2026-04-15
**Status:** Draft — awaiting review
**Scope:** Turn `aos init` from a static config writer into a declarative-first, environment-aware installer/wizard. Detects package manager (bun vs npm), scans vendor CLI readiness and installed AOS adapter packages separately, probes memory backend (MemPalace socket), interactively walks a new user through selections, writes `.aos/config.yaml` via non-destructive merge, and optionally executes missing-adapter installs via `--apply`. Must support non-interactive use for CI/Dockerfiles.
**Closes:** Issue #11 (bun-vs-npm cross-store visibility — the wizard detects and routes installs to the correct store). Partially delivers on the MemPalace integration spec's `Provisioning: AOS offers setup during aos init, detects existing installs` decision.

## Goal

A first-run experience that takes a user with their chosen AI CLI already installed (`codex`, `claude`, `pi`, or `gemini`) to a working `aos run …` in under two minutes, without the user needing to know the difference between bun and npm global stores, which AOS adapter package augments which vendor CLI, or what an MCP socket is. Declarative-first: every wizard interaction produces YAML that can be hand-edited later or generated once and replayed in CI.

## Why

The current `aos init`:
- Writes the same hardcoded config regardless of what the user has installed
- Prints install hints as `npm install -g`, which is wrong when the user installed `aos` via `bun install -g` (issue #11)
- Doesn't detect vendor CLI readiness at all — users discover `claude` isn't on PATH only when `aos run` fails with a cryptic error
- Offers no path to add an adapter after first init short of hand-editing YAML
- Doesn't probe memory backends — the MemPalace integration spec anticipated init-time detection that was never built

Together these mean a new user installing aos-harness from scratch hits three-to-five distinct confusing failures before the first `aos run` succeeds. The wizard collapses that into one or two explicit prompts.

## Non-Goals

- **Touching authentication.** We never run `claude login`, `pi login`, `codex auth`, `gemini auth`, or any vendor auth command. Users authenticate against their chosen vendor using that vendor's own flow (subscription via Max/Advanced/ChatGPT Pro/Pi bundle, or API key — their choice). We only ASK the vendor's CLI "are you ready?" and relay the answer.
- **Running vendor CLIs as pre-flight.** No `pi model list`, no `claude doctor`, no `gemini quota`. Out of scope; vendor tools evolve independently.
- **Autoinstalling vendor CLIs.** The vendor CLI is a prerequisite owned by the user. We can detect that `codex`, `claude`, `pi`, or `gemini` is missing and print the vendor's install/login hint, but we never execute `brew install claude` or similar on the user's behalf. Too many platform variants; install instructions live with the vendor.
- **Replacing YAML with a GUI.** `.aos/config.yaml` remains the source of truth; the wizard is a convenience over it.
- **Probing models or token budgets.** Model selection is a UX concern (defaults are sensible); probing vendor APIs for available models is out of scope for init.

## Decisions

### D1 — Declarative-first with separate apply

The wizard produces a WizardResult (a structured intent object) and writes config files. It does NOT execute installs by default. Running `aos init --apply` separately (or responding `Y` to the wizard's final confirmation) triggers the applier to execute install commands.

Rationale: separation of concerns maps to how CI pipelines work (describe state, apply state). Non-`--apply` runs do not execute installs. Read-only safety is provided only by pure scan/report mode (`--non-interactive` without selection inputs); config-writing paths still require a writable project directory. The interactive wizard IS allowed to auto-execute at the end when TTY detects it, behind the final `[Y/n]` gate.

### D2 — Print-and-confirm, never silent-install

Even with `--apply`, every install command is printed before execution. Users see `Running: bun install -g @aos-harness/claude-code-adapter@0.7.1` before the command fires. Applier never uses `--yes` / `--force` flags or pipes through sudo.

### D3 — Full-scope environment scan (but API keys only informational)

Scanner probes five dimensions:

1. **Package manager for `aos` itself.** Detect via `process.argv[1]` / `import.meta.url`:
   - `~/.bun/bin/` or `~/.bun/install/global/` → `bun`
   - `<npm-prefix>/lib/node_modules/` → `npm`
   - Otherwise → `unknown` (fall back to printing both in hints)

2. **Vendor CLI presence + auth state.** For each allowlisted adapter family, the scanner runs a generic vendor-owned probe even if the AOS adapter package is not yet installed:
   - `which/command -v <binary>` equivalent to discover the CLI on PATH
   - a lightweight auth/readiness command owned by the CLI family (`codex`, `claude`, `pi`, `gemini`) with a 3s timeout
   - report CLI binary path/version when available
   - report auth state as `ready | needs-login | unknown`

   This probe lives in the CLI scanner, not in the adapter package, because the wizard must be able to tell the user "your Codex CLI is already installed and logged in; AOS only needs the Codex adapter package."

3. **Installed adapter packages.** For each of the four allowlisted adapter names, scan:
   - Bun's global store (`~/.bun/install/global/node_modules/@aos-harness/<name>-adapter`)
   - npm's global store (`<npm-prefix>/lib/node_modules/@aos-harness/<name>-adapter`)
   - Report: present/absent + version + store location

   Project-local `node_modules` is deliberately NOT considered "ready to use" for runtime resolution. The CLI's adapter loading policy remains package-manager/global-install based unless a future trust-model spec explicitly changes that policy. If a project-local adapter package is detected for informational purposes, it must be labeled `informational only: not runtime-loadable`.

4. **AOS adapter package loadability.** Detection on disk is not enough. The scanner separately asks "can THIS `aos` install actually resolve and import `@aos-harness/<name>-adapter` right now?" using the same resolver/runtime path that `aos run` will use. Report: `loadable: true | false`, `resolvedFrom?: <path>`.

5. **Memory backend presence.** Check `MEMPALACE_SOCKET` env var → else default `$XDG_RUNTIME_DIR/mempalace.sock` (Linux) / `$TMPDIR/mempalace.sock` (macOS). Fast `stat()` check; if socket exists, probe is "available". If not, "not detected" (no error — expertise fallback is fine).

API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.) are checked ONLY for presence (`process.env.X !== undefined`), never read or logged. Used only as a supplementary signal when a vendor CLI reports "not logged in" AND an API key env var is set — then the scanner notes "vendor CLI not logged in, but $ANTHROPIC_API_KEY is set; your adapter may still work via env-var auth."

### D4 — Per-adapter readiness matrix

The wizard does not collapse readiness into a single bool. For each adapter family (`pi`, `claude-code`, `codex`, `gemini`), the scanner produces four explicit signals plus a derived status:

```ts
export type AuthState = "ready" | "needs-login" | "unknown";
export type AdapterStatus =
  | "ready"
  | "needs-adapter"
  | "needs-cli"
  | "needs-login"
  | "broken";

export interface VendorCliReadiness {
  present: boolean;
  version?: string;
  path?: string;
  auth: {
    state: AuthState;
    hint?: string;
  };
}

export interface AosAdapterReadiness {
  installed: boolean;               // present in a supported global store
  version?: string;
  store?: "bun" | "npm" | "project-local" | "unknown";
  loadable: boolean;                // this aos install can resolve/import it now
  resolvedFrom?: string;
}

export interface AdapterReadiness {
  adapter: string;                  // "pi" | "claude-code" | "codex" | "gemini"
  vendorCli: VendorCliReadiness;
  aosAdapter: AosAdapterReadiness;
  status: AdapterStatus;
  statusHint: string;
  info?: Record<string, string>;
}
```

Derived status rules:

- `ready` → vendor CLI present + auth ready + AOS adapter installed + loadable
- `needs-adapter` → vendor CLI is usable, but AOS adapter is absent or not loadable
- `needs-cli` → AOS adapter may exist, but the vendor CLI binary is missing
- `needs-login` → vendor CLI exists, but reports unauthenticated/not-ready
- `broken` → contradictory or degraded state (for example: adapter installed in an unsupported store, adapter detected on disk but not loadable, or probe command crashes)

The wizard copy should describe the matrix in user language:

- "Codex CLI ready; install AOS Codex adapter"
- "Claude CLI found but needs login"
- "Gemini adapter installed in project-local node_modules only; AOS won't load that location"

### D5 — Optional adapter-owned enrichment probe

Installed adapters MAY export a best-effort enrichment function for adapter-specific details, but the base readiness contract above belongs to the CLI scanner and must not depend on the adapter package being present. Signature:

```ts
// adapters/shared/src/adapter-contract.ts (new file)

export interface AdapterProbeInfo {
  info?: Record<string, string>;
}

export function probeAdapterInfo(opts?: { timeoutMs?: number }): Promise<AdapterProbeInfo>;
```

The scanner imports each installed and loadable adapter (via the exact same resolver path `aos run` will use), calls `probeAdapterInfo({ timeoutMs: 3000 })`, and merges any returned `info`. This is enrichment only. A broken or missing adapter can never prevent the scanner from classifying the vendor CLI itself.

For adapters that AREN'T installed or aren't loadable, the scanner skips the enrichment probe and still returns a full `AdapterReadiness` from its own vendor CLI + package-manager checks.

### D6 — Non-destructive YAML merge on re-entry

When `aos init` runs in an already-initialized project:
- Scanner runs fresh.
- Config writer loads existing `.aos/config.yaml` via `parseDocument` (yaml npm package — better Document API than js-yaml for preserving comments and key order).
- Wizard pre-populates answers from existing config.
- For each wizard decision: if the existing value matches what the scanner now sees as the recommended answer AND the user hasn't changed it, skip the prompt entirely (idempotent re-run).
- For discoveries (adapter installed since last run), surface as a new prompt.
- For removals (adapter gone since last run), surface as a "disable in config?" prompt defaulting to `n` (preserve user intent).
- Writer mutates the Document in place; `toString()` produces YAML with user's original comments and formatting preserved.

A corrupted existing config.yaml aborts with a clear error, suggesting `aos init --force` which backs up the corrupted file to `config.yaml.backup.<unix-ts>` before rewriting.

### D7 — TTY detection chooses mode

- `process.stdin.isTTY && process.stdout.isTTY` → interactive wizard.
- Either is false → non-interactive mode. Required flags: `--from-yaml=<path>` (pre-made WizardResult YAML) OR `--non-interactive`.
- `--non-interactive` without adapter-selection inputs is pure scan/report mode: writes `.aos/scan.json`, performs no config writes, exits 0 unless the scan itself errors.
- Adapter selection precedence in non-interactive apply/validate flows is:
  1. `--adapter=<name>` / repeated `--adapter`
  2. `--from-yaml=<path>` `enabledAdapters`
  3. existing `.aos/config.yaml` `adapters.enabled`
  4. existing legacy `.aos/config.yaml` `adapter`
- Exit 3 for "selected adapter missing-or-not-ready" is valid ONLY when selection exists via the precedence above. Pure scan mode never invents a selection.
- Non-interactive mode without either flag errors with a single-line hint pointing at both options.

### D8 — Prompt library

Use `@clack/prompts` (`^0.7.x`, ~15KB gzipped). Reasons:

- Native multi-select / checkbox UX (D3 table's adapter selection needs this; a readline hand-roll is 100+ lines of cursor/raw-mode code).
- Clean visual language (grouped sections, status icons) matches the envisioned scan-report table.
- Smaller than `@inquirer/prompts` (~30KB) and `prompts` (deprecated).
- No native bindings; pure JS; works in Bun.
- Added to `cli/package.json` dependencies (not root); tarball size impact is tiny compared to the UX gain.

### D9 — Apply-phase action schema

The wizard emits WizardResult with a typed action list. Applier executes only structural action types — no free-form shell strings from the wizard.

```ts
type Action =
  | { type: "install-adapter"; packageName: string; manager: "bun" | "npm"; global: true }
  | { type: "info-login"; adapter: string; vendorCommand: string }   // PRINT ONLY
  | { type: "info-install-vendor-cli"; adapter: string; url: string }; // PRINT ONLY

type WizardResult = {
  enabledAdapters: string[];           // subset of ADAPTER_ALLOWLIST
  defaultAdapter: string;              // one of enabledAdapters
  memory: { provider: "expertise" | "mempalace"; mempalace?: MempalaceConfig };
  models: { economy: string; standard: string; premium: string };
  editor: string;
  actions: Action[];
};
```

The applier's switch covers only `install-adapter` → spawn `<manager> install -g <pkg>`. The two `info-*` types are always print-only, even under `--apply`.

### D10 — Config schema evolution (migration path)

Today's `.aos/config.yaml`:
```yaml
adapter: pi
models: { economy: ..., standard: ..., premium: ... }
editor: code
```

New schema:
```yaml
# .aos/config.yaml
api_version: aos/config/v2
adapters:
  enabled: [pi, claude-code]
  default: pi
package_manager: bun     # the package manager aos itself was installed via
models: { economy: ..., standard: ..., premium: ... }
editor: code
```

Migration: scanner detects old `adapter: <single>` key → wizard proposes migration to new shape → writes v2 on user confirmation. Back-compat read path (`run.ts`) accepts both shapes for one minor version, then v2-only. Small-user-base context (per user input) → aggressive migration acceptable.

Important existing-file reconciliation:

- `.aos/adapter.yaml` still exists today for adapter-specific settings (`platform`, `model_overrides`, etc.). This spec does NOT delete it.
- During the v1 → v2 migration, `platform` in `.aos/adapter.yaml` is treated as an override/input to the default adapter selection only if `.aos/config.yaml` does not already express a clearer choice.
- Multi-adapter support keeps `.aos/adapter.yaml` as the home for adapter-specific overrides, but the selector-of-record moves to `.aos/config.yaml` `adapters.enabled/default`.
- `run.ts` must define an explicit precedence chain across `--adapter`, `.aos/config.yaml` v2, `.aos/config.yaml` v1, and `.aos/adapter.yaml` so current projects do not silently drift.

## Architecture

Five files added, one rewritten:

```
cli/src/
├── env-scanner.ts             ← NEW. scanEnvironment() → ScanReport.
│                                Pure; no I/O to user.
├── init-wizard.ts             ← NEW. runWizard(scan, existingConfig) →
│                                WizardResult. TTY-only path; mock-
│                                friendly via injected PromptContext.
├── init-applier.ts            ← NEW. applyActions(actions) — executes
│                                install-adapter actions only; print-only
│                                for info-*. Honors --dry-run.
├── init-config-writer.ts      ← NEW. mergeConfig(existing, wizardResult)
│                                → YAML string. Preserves comments.
├── commands/init.ts           ← REWRITE. Thin orchestrator:
│                                scan → wizard-or-parse → write → maybe apply
└── prompts.ts                 ← NEW. Thin shim around @clack/prompts so we
                                 can mock in tests; also hosts table-rendering
                                 utility for the scan report.

adapters/shared/src/
├── adapter-contract.ts        ← NEW. Optional adapter enrichment
│                                contract exported from adapter-shared.
└── index.ts                   ← MODIFY. Re-export adapter-contract types.

adapters/pi/src/readiness.ts         ← NEW per adapter. Implements
adapters/claude-code/src/readiness.ts  probeAdapterInfo(). No vendor-CLI
adapters/codex/src/readiness.ts        gating logic here; scanner owns that.
adapters/gemini/src/readiness.ts

adapters/<name>/src/index.ts   ← MODIFY per adapter. Re-export probeAdapterInfo.

runtime/src/
└── scan-schema.ts             ← NEW. TypeScript types for ScanReport,
                                 WizardResult, Action. Zod validation.

tests/cli/env-scanner.test.ts           ← NEW
tests/cli/init-wizard.test.ts           ← NEW
tests/cli/init-applier.test.ts          ← NEW
tests/cli/init-config-writer.test.ts    ← NEW
tests/cli/init-integration.test.ts      ← NEW (end-to-end tempdir)
tests/adapters-shared/readiness.test.ts ← NEW
```

Clean one-direction dependency graph:

```
commands/init.ts
   ├── env-scanner.ts ──────────── adapters/*/readiness.ts (optional enrichment via dynamic import)
   ├── init-wizard.ts ── prompts.ts (@clack/prompts)
   ├── init-config-writer.ts ─── yaml (parseDocument)
   └── init-applier.ts
```

`env-scanner` owns the base vendor CLI and adapter-package scan. It imports adapter packages only for optional enrichment, so it never has build-time dependency on installed adapters.

## Data Flow

```
                      ┌──────────────────────────────────────┐
                      │  aos init [--apply] [--from-yaml=X]  │
                      └───────────────────┬──────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │     env-scanner       │
                              │  scanEnvironment()    │
                              └───────────┬───────────┘
                                          │ ScanReport
                                          ▼
            ┌────────────────┐   TTY?   ┌─────────────────────────┐
            │  existing      │──────────┤  init-wizard.runWizard  │
            │  config.yaml   │   yes    │  (@clack interactive)   │
            └────┬───────────┘          └───────────┬─────────────┘
                 │                                  │ WizardResult
                 │              no TTY              │
                 │     + --from-yaml or selection   │
                 └──────────────────────────────────▼
                                            ┌──────────────────────┐
                                            │ init-config-writer   │
                                            │  mergeConfig()       │
                                            └──────────┬───────────┘
                                                       │ writes .aos/config.yaml
                                                       │       .aos/memory.yaml
                                                       ▼
                                                 --apply?
                                              yes  │   │  no
                                                   ▼   ▼
                               ┌──────────────────────┐ ┌─────────────────┐
                               │  init-applier        │ │ Print hints and │
                               │  (exec install cmds) │ │ exit 0.         │
                               └──────────────────────┘ └─────────────────┘

                      no TTY + pure scan/report mode
                                 │
                                 ▼
                         write `.aos/scan.json`
                                 │
                                 ▼
                               exit 0
```

## Error Handling

| Failure | Behavior | Exit code |
|---|---|---|
| Scanner can't determine package manager | Print both bun+npm hints; `package_manager: unknown` in config | 0 (non-fatal) |
| Vendor CLI readiness probe timeout (>3s) | Report `vendorCli.auth.state: "unknown"`, hint: "probe timed out"; wizard shows `?` marker | 0 |
| Optional adapter enrichment probe fails | Ignore enrichment, keep base readiness classification | 0 |
| Vendor CLI not on PATH | Report `vendorCli.present: false`; wizard warns but allows selection | 0 |
| Adapter package found but not loadable by this `aos` install | Report `status: "broken"` or `needs-adapter` with explicit hint | 0 |
| MemPalace socket not detected | Report memory.mempalace.available: false; wizard offers mempalace anyway with install hint | 0 |
| Corrupt existing config.yaml | Abort with parse error + suggest `aos init --force` (backs up to config.yaml.backup.<ts>) | 2 |
| Wizard interrupted (SIGINT) | No partial writes — writes only happen after final confirmation | 130 (SIGINT) |
| `--apply` install command fails | Log, continue remaining installs, final summary reports failures | 1 if any failed |
| Non-TTY without `--from-yaml` or `--non-interactive` | Single-line hint: "Pass --from-yaml=<path> or --non-interactive" | 2 |
| `--non-interactive` pure scan/report mode | `.aos/scan.json` written; no config writes; no synthetic adapter failures | 0 |
| `--non-interactive` with explicit/derived selected-adapter missing | `.aos/scan.json` written; list the missing adapters on stderr | 3 |
| Malformed `--from-yaml` input | Zod validation error with field path | 2 |

## Testing

**`env-scanner.test.ts`** — fully mocked fs + `which`:
- Vendor CLI present + auth ready + adapter installed/loadable → status = `ready`
- Vendor CLI present + auth ready + adapter absent → status = `needs-adapter`
- Vendor CLI missing + adapter installed → status = `needs-cli`
- Adapter installed in unsupported/project-local location only → status = `broken` with hint
- API key env var mocked present → supplementary note attached; never logs value
- Memory socket present vs absent

**`init-wizard.test.ts`** — inject a PromptContext mock:
- Fresh project + ScanReport with pi ready, claude-code missing → WizardResult picks pi, proposes install claude-code
- Re-entry: existing config has `enabled: [pi]`; scanner reports claude-code just-installed → wizard prompts "enable claude-code?" with default Y
- Re-entry idempotent: same scan + same config → wizard returns identical WizardResult with no prompts actually shown

**`init-config-writer.test.ts`** — fixture-based:
- Merge WizardResult into empty config → produces canonical v2 shape
- Merge into existing config WITH user comments → comments preserved byte-for-byte
- Migrate v1 (`adapter: pi`) → v2 (`adapters: { enabled: [pi], default: pi }`)

**`init-applier.test.ts`** — mock Bun `$`:
- Action list with two install-adapter + one info-login → shell spawn fires TWICE only (never for info-*)
- Mock spawn returns non-zero for one → applier continues; final return value flags partial failure

**`readiness.test.ts`** (adapters-shared) — enrichment contract compliance:
- Stub adapter exports `probeAdapterInfo` conforming to contract
- `probeAdapterInfo` honors timeoutMs → returns no enrichment on timeout/failure
- Real adapter enrichment tests (pi/claude-code/codex/gemini) are optional and skipped by default with `BUN_TEST_REAL_ADAPTERS=1`

**`init-integration.test.ts`** — end-to-end, no network:
- Tempdir + `--from-yaml=<fixture>` + no `--apply` → asserts exact YAML bytes written
- Re-run same inputs → zero-diff
- `--non-interactive` with no selection inputs → exit 0, scan.json contents asserted
- `--non-interactive --adapter=pi` with no matching ready adapter → exit 3
- `--apply` with mocked applier → verified action list handed off; no real spawns

All existing CLI tests (allowlist, confined-resolve, create-name, platform-url, no-project-local-adapters) must continue to pass — we're adding, not rewriting.

## Migration

User-visible break: `.aos/config.yaml` schema changes from v1 (`adapter: <single>`) to v2 (`adapters: { enabled: [...], default: ... }`). Per user input ("lets migrate to easier path, no major user base yet"):

- On first re-run of `aos init` in a v1-formatted project, wizard detects and proposes the migration with a single `Y/n` prompt (default `Y`).
- `run.ts` accepts both shapes through 0.8.x, then v2-only from 0.9.0.
- CHANGELOG entry calls out the new `adapters` block and provides a before/after snippet.
- No migration tool; the wizard IS the migration tool.

For the `api_version` line: absent in v1 → treated as v1. Present and `aos/config/v2` → treated as v2. Present and unknown → error.

## Rollout

Single-release cut. Lands in 0.8.0 (following 0.7.1's small polish). No feature flag — the new `init` subsumes the old entirely, and the dual-format read path in `run.ts` makes existing v1 projects continue to work until they re-run init.

Release workflow + publish infra from 0.7.0 remains unchanged. Tag `v0.8.0`, push, environment-gated release publishes 7 packages with the new surface.

## Out of Scope / Follow-Ups

1. **`aos adapter add <name> [--apply]`** — a one-shot subcommand for the post-init "I just installed claude-code, add it" flow. The wizard's re-entry covers this today, but a direct verb is cleaner for scripts. Open as issue; implement in 0.8.x if user feedback confirms value.

2. **`aos doctor`** — health-check subcommand that runs the same scan and prints a report without prompts. Reuses env-scanner; very cheap to add once the scanner exists. Follow-up ticket.

3. **MemPalace closet update** — user noted the upstream MemPalace project added a "closet" storage primitive (refinement of the wings/halls/rooms/closets/drawers model). The init-wizard just probes for MemPalace's socket; the specifics of closet configuration live in the MemPalace integration spec. File a COMPANION spec update: `docs/superpowers/specs/YYYY-MM-DD-mempalace-closet-update.md` to refresh `2026-04-11-mempalace-memory-integration-design.md` for the new closet primitive. Out of scope for THIS spec.

4. **Interactive "undo" / "dry-run preview"** — show a diff of what WILL change before committing. Nice-to-have; punt.

5. **Tab-completion generation** — shell completion scripts for the wizard (answers-from-history). Future.

6. **Telemetry opt-in** — count wizard completions + most-common adapter choices for roadmap input. Out of scope; also sensitive given the private-source-protecting-IP posture.

## Open Questions Resolved in This Spec

- **YAML merge mechanism** → `yaml` npm package's `parseDocument` API (better comment preservation than js-yaml).
- **Prompt library** → `@clack/prompts` (~15KB, native multi-select, pure JS, Bun-compatible).
- **MemPalace probe** → fast `stat()` on the socket path; false negatives acceptable (user can force-enable in config).
- **Future `aos adapter add`** → confirmed as follow-up, not blocking.
- **Config migration** → hard migrate (dual-read for one minor release, then v2-only); acceptable given small user base.

No open questions remain blocking implementation plan generation.
