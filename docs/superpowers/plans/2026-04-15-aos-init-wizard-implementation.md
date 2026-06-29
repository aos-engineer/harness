# AOS Init Wizard Implementation Plan

**Date:** 2026-04-15
**Status:** Ready for implementation
**Spec:** `docs/superpowers/specs/2026-04-15-aos-init-wizard-design.md`

This plan assumes the revised init-wizard spec is the source of truth: vendor CLIs (`codex`, `claude`, `pi`, `gemini`) are user-owned prerequisites, AOS adapter packages are separate integration packages, readiness is derived from both signals, and non-interactive mode has explicit adapter-selection precedence.

---

## Step 1 — Shared schema and precedence helpers

**Files:**
- `runtime/src/scan-schema.ts` (new)
- `cli/src/adapter-config.ts`
- `cli/src/utils.ts`
- `cli/src/commands/run.ts`

Changes:
- Add typed shapes for:
  - `AdapterStatus`
  - `VendorCliReadiness`
  - `AosAdapterReadiness`
  - `AdapterReadiness`
  - `ScanReport`
  - `WizardResult`
- Add helpers to read:
  - `.aos/config.yaml` v2 (`adapters.enabled/default`)
  - legacy `.aos/config.yaml` v1 (`adapter`)
  - legacy `.aos/adapter.yaml` (`platform`, `model_overrides`, etc.)
- Define one adapter-precedence helper used by both `run.ts` and `init.ts`:
  1. `--adapter`
  2. `.aos/config.yaml` v2 default
  3. `.aos/config.yaml` v1 adapter
  4. `.aos/adapter.yaml` platform
  5. fallback `"pi"`

Verification:
- `run.ts` accepts both config shapes and still honors `--adapter`.
- Existing `.aos/adapter.yaml` model overrides continue to load unchanged.

---

## Step 2 — Environment scanner

**Files:**
- `cli/src/env-scanner.ts` (new)
- `cli/src/utils.ts`
- `runtime/src/scan-schema.ts`

Changes:
- Implement `scanEnvironment()` with:
  - package-manager detection for the CLI install
  - vendor CLI probe per adapter family
  - adapter package presence check in supported bun/npm global stores
  - adapter package loadability check through the same resolver/runtime path `aos run` uses
  - MemPalace socket detection
- Derive per-adapter `status`:
  - `ready`
  - `needs-adapter`
  - `needs-cli`
  - `needs-login`
  - `broken`
- Surface actionable human hints for each status.

Verification:
- Scanner classifies all five status paths correctly under mocks.
- Unsupported/project-local-only adapter installs are labeled informational/broken, not ready.

---

## Step 3 — Optional adapter enrichment contract

**Files:**
- `adapters/shared/src/adapter-contract.ts` (new)
- `adapters/shared/src/index.ts`
- `adapters/pi/src/index.ts`
- `adapters/claude-code/src/index.ts`
- `adapters/codex/src/index.ts`
- `adapters/gemini/src/index.ts`

Changes:
- Add `probeAdapterInfo()` contract for optional adapter-specific metadata.
- Keep enrichment best-effort only; scanner must never depend on it for base readiness.
- Re-export the enrichment function from adapter entrypoints where implemented.

Verification:
- Missing or failing enrichment never changes base readiness classification.

---

## Step 4 — Config writer and migration logic

**Files:**
- `cli/src/init-config-writer.ts` (new)
- `cli/package.json`

Changes:
- Add `yaml` dependency for `parseDocument`.
- Preserve comments/order where possible.
- Write v2 `.aos/config.yaml` with:
  - `api_version`
  - `adapters.enabled`
  - `adapters.default`
  - `package_manager`
  - `models`
  - `editor`
- Preserve `.aos/adapter.yaml` as adapter-specific override storage.
- Add migration path from v1 to v2 without discarding legacy adapter settings.

Verification:
- Empty config writes canonical v2.
- Existing commented config rewrites without destructive loss.
- Legacy v1 + `.aos/adapter.yaml` migrates predictably.

---

## Step 5 — Init command rewrite

**Files:**
- `cli/src/commands/init.ts`
- `cli/src/init-wizard.ts` (new)
- `cli/src/init-applier.ts` (new)
- `cli/src/prompts.ts` (new)

Changes:
- Replace the current static writer with orchestration:
  - scan
  - choose interactive vs non-interactive path
  - derive/write config
  - optionally apply adapter installs
- Implement non-interactive behavior:
  - `--non-interactive` pure scan/report when no selection exists
  - exit 3 only when explicit/derived selection exists and selected adapters are not ready
  - `--from-yaml` path for CI replay
- Keep `core/` copy and `memory.yaml` generation behavior.

Verification:
- `aos init` still bootstraps a fresh project.
- `aos init --non-interactive` can run scan-only without writing config.
- `aos init --non-interactive --adapter=<name>` validates selected adapters and exits correctly.

---

## Step 6 — Tests

**Files:**
- `tests/cli/env-scanner.test.ts` (new)
- `tests/cli/init-config-writer.test.ts` (new)
- `tests/cli/init-integration.test.ts` (new)
- `tests/adapter-config.test.ts`
- `tests/cli/platform-url-validation.test.ts` (touch only if needed by new helpers)

Changes:
- Add scanner status-matrix coverage.
- Add migration coverage for v1/v2/adapter.yaml precedence.
- Add non-interactive exit-code coverage.
- Keep existing run-path tests passing.

Verification:
- Targeted Bun test runs pass for the new and touched suites.

---

## Step 7 — Final verification

Commands:
- Run targeted test files for init/config/runtime behavior.
- Manually smoke:
  - fresh tempdir init
  - legacy config migration
  - non-interactive scan/report

Exit criteria:
- `run.ts` and `init.ts` agree on adapter selection precedence.
- The scanner never marks an adapter ready unless both vendor CLI and AOS adapter package are actually usable.
- Legacy projects continue to run without manual intervention.
