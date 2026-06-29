# Publish Pipeline Hardening Design

**Date:** 2026-04-14
**Status:** Draft — awaiting review
**Scope:** Move npm publish from a developer laptop to a tag-triggered GitHub Actions release workflow with provenance, required approval, and signed-tag verification. Replace the bypassable YAML-safety grep with an AST check. Harden surrounding publish-script operations. Close one CI hygiene gap.
**Related report:** `docs/security-scan-report-2026-04-14.md` (SUPPLY-001/002/003/004/005/006/007, SECRET-001).
**Partner spec:** `2026-04-14-adapter-trust-model-design.md` (runtime trust boundaries).

## Goal

Every version of `aos-harness` and the six adapter packages that hits npm after this ships must be:

1. Built and published by **GitHub Actions**, not a developer laptop.
2. **Attested with npm provenance** — the package.json's `dist.provenance` block binds the tarball to a specific commit, workflow run, and public attestation.
3. Gated on **lint + typecheck + tests all green**, a **clean worktree**, and the **tag matches the package version**.
4. Approved by a **second human** via a protected GitHub environment.

And the developer-side `scripts/publish.ts` becomes a local **dry-run / pack** tool, not a publish tool.

## Why

- SUPPLY-002/003: No `--provenance`. Anyone with the npm token can publish any local state, including uncommitted changes, from any machine. There is no cryptographic attestation binding a published tarball to a source commit.
- SUPPLY-001: The `prerelease` script (`lint && test`) is only auto-invoked for npm's built-in `publish` lifecycle, not for `publish:all`. Typecheck and the YAML-safety lint can silently be skipped on release.
- SUPPLY-006: The YAML-safety lint itself is a grep chain that misses destructured imports (`const { load } = yaml; load(x)`), whitespace variants, any file path containing the literal substring `test` (including `latest-config.ts`), and any `JSON_SCHEMA` occurrence on the same line (including comments). It scans `runtime/src/` and `adapters/` only — not `cli/` or `core/`. It is security theater.
- SUPPLY-005/007: `copy-core.ts` does `rmSync(..., { recursive: true })` with no symlink check. `publish.ts` mutates workspace package.json files in place and relies on `try/finally` for restoration — SIGKILL leaves pinned versions checked out.
- SECRET-001: `.github/workflows/ci.yml` lacks a top-level `permissions:` block. Mitigated by `pull_request` (not `pull_request_target`), but it's free hygiene.

Timing: we just shipped 0.5.0 → 0.5.1 → 0.5.2 → 0.6.0 in rapid succession from local machines. The next release (0.7.0, carrying the adapter-trust-model changes) is the right moment to switch — before the package has enough consumer gravity that a provenance-less tarball becomes hard to reason about.

## Non-Goals

- Publishing to registries other than npm.
- Sigstore / cosign outside of what npm's built-in provenance already uses.
- Removing `scripts/publish.ts` — we retain it as a local dry-run (produces tarballs, never calls `npm publish`).
- Automating version bumps / changelogs. Authors still hand-write `CHANGELOG.md` and run `npm version`. The release workflow only reacts to pushed tags.
- Lockfile verification beyond what `bun install --frozen-lockfile` already provides.

## Decisions

### D1 — Tag-triggered release workflow (`.github/workflows/release.yml`)

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  id-token: write           # required for npm provenance

jobs:
  release:
    runs-on: ubuntu-latest
    environment: npm-publish   # GitHub environment with required reviewers + NPM_TOKEN secret
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # git history needed for tag verification
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Verify tag matches package version
        run: bun run scripts/verify-release-tag.ts

      - name: Install (frozen)
        run: bun install --frozen-lockfile

      - name: Lint + typecheck
        run: bun run lint

      - name: Unit tests
        run: bun test

      - name: Integration
        run: bun run test:integration

      - name: Publish all packages with provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: bun run scripts/publish.ts --ci
```

Key properties:

- **`permissions: { contents: read, id-token: write }`** — principle of least privilege; `id-token` is mandatory for provenance and nothing else.
- **`environment: npm-publish`** — GitHub environment configured in repo settings with 1 required reviewer and the `NPM_TOKEN` secret scoped to this environment only. This is the approval gate.
- **`actions/setup-node` + `registry-url`** sets up `.npmrc` with the auth-token variable name; `NODE_AUTH_TOKEN` (not `NPM_TOKEN`) is the value the token gets exported as. This is the standard npm publish flow in CI and avoids token-echoing.
- **Tag verification step** before anything expensive runs — fast fail.
- **`bun install --frozen-lockfile`** — cannot drift during CI.
- **Single `bun run lint`** runs the `lint:yaml-safety` + `typecheck` chain (after D3 rewrites `lint:yaml-safety`).

### D2 — `scripts/verify-release-tag.ts`

New file. ~40 lines. Validates:

1. `git rev-parse --verify --quiet HEAD` equals `git rev-list -n 1 $GITHUB_REF_NAME` (tag points at HEAD).
2. Tag name matches `v<version>` where `<version>` is the version in **all** seven published workspace `package.json` files (lockstep check).
3. `git status --porcelain` is empty (clean worktree — redundant in fresh CI checkout but cheap insurance and documents the invariant).
4. Tag is annotated, not lightweight: `git cat-file -t <tag>` returns `tag`, not `commit`. We do not require GPG signing (tolerant to contributors without signing keys), but annotated-tag is free and provides author+date metadata.

Exits `0` on pass, `1` on fail with a clear message. Locally runnable too — `bun run scripts/verify-release-tag.ts v0.7.0`.

### D3 — Replace `scripts/check-yaml-safety.sh` with an AST-based lint

Drop the shell script. New file `scripts/check-yaml-safety.ts` that uses the TypeScript compiler API (already a Bun-runtime dependency) — no new dependencies — to walk every `.ts` file under `cli/`, `runtime/`, `adapters/`, and `core/` (if it has `.ts`) and find `CallExpression`s whose callee matches `load(` or `<identifier>.load(` by **syntactic shape**. For each, assert the second argument is an `ObjectLiteralExpression` with a `schema` property whose value is either `yaml.JSON_SCHEMA` or `yaml.FAILSAFE_SCHEMA`.

```ts
// High-level algorithm
1. Glob **/*.ts in cli/, runtime/, adapters/, core/. Exclude node_modules, **/*.test.ts, **/tests/**.
2. For each file, ts.createSourceFile(fileContent).
3. Walk the AST. For each CallExpression whose callee is:
   - an Identifier named `load`, OR
   - a PropertyAccessExpression whose name is `load`
   check args[1]: must be an object literal with `schema: <Identifier "JSON_SCHEMA" | "FAILSAFE_SCHEMA">` or
   `schema: <PropertyAccessExpression ending in JSON_SCHEMA | FAILSAFE_SCHEMA>`.
4. Permit an inline escape hatch: a leading comment `// yaml-safety-ignore` on the same or immediately-preceding
   line suppresses the finding. Comment must explain why (enforced: comment text after the marker must be ≥ 10 chars).
5. Collect violations. If any, print `file:line: yaml.load missing safe schema: <snippet>` and exit 1.
```

**Design choice — accept false positives over false negatives.** This is a **syntactic**, not semantic, check. We deliberately do NOT use `ts.createProgram` with a compiler host to resolve import bindings back to `js-yaml`. Two reasons:

1. **For a security lint, false positives are strictly better than false negatives.** A call to `load()` from a local module named `my-local-loader` that happens not to need a schema arg is a tiny amount of developer friction; a missed `yaml.load(untrusted)` from `js-yaml` is an RCE on every CI run. We always err on the over-flagging side.
2. **Bindings-resolution is disproportionate cost.** `createProgram` requires a full TS program with resolved `tsconfig.json` per workspace, which is 10–50× slower and adds failure modes (what if a workspace's tsconfig is momentarily broken?). The syntactic check runs in <1s across the whole repo.

The `// yaml-safety-ignore <reason>` escape hatch handles the "local `load()` function that doesn't take a schema" case. Reason text is mandatory and enforced. Expected use is rare (a handful of call sites at most) and every use is reviewable in PR diffs.

Exclusions are path-scoped (`**/tests/**`, `**/*.test.ts`), not substring-based. No file with "test" in its name is automatically exempt.

The new lint is a direct replacement in `package.json`:
```diff
- "lint:yaml-safety": "bash scripts/check-yaml-safety.sh",
+ "lint:yaml-safety": "bun run scripts/check-yaml-safety.ts",
```

### D4 — `scripts/publish.ts --ci` vs local modes

The script grows a `--ci` flag:

- **`--ci`** (used only in the release workflow):
  - Assumes pre-validated environment (tag, lint, tests already ran).
  - Pins workspace deps, runs `bun publish --access public --provenance`, unpins, exits.
  - No `prompts`, no interactive confirmations, no `sleep`.
  - **Provenance is passed both via `publishConfig.provenance: true` (D6) and as an explicit CLI flag.** Bun 1.3.11 delegates `bun publish` through its own implementation, not to `npm`. Empirical behavior as of 2026-04-14: Bun honors `publishConfig.provenance`, but this has drifted in minor releases. The plan's Step 0 is a one-shot verification (publish a `@aos-harness/_provenance-probe` scratch package from a fork, confirm the provenance statement lands on the registry). **If Bun silently drops the flag, the plan halts and we switch to invoking `npm publish --provenance` directly** via `npx npm@latest publish --access public --provenance`. The explicit `--provenance` CLI arg is belt-and-suspenders — Bun's flag parser logs on unknown flags, which doubles as a detection signal for the silent-drop case.
- **`--dry-run`** (default for local):
  - Pins workspace deps into a `.tmp-publish/` directory tree **instead of mutating the source**.
  - Runs `bun publish --dry-run --pack-destination .tmp-publish/tarballs/` per package.
  - Verifies the resulting tarballs have the expected `files` set, no stray `.env`, etc.
  - Cleans up `.tmp-publish/` on success and on failure (via `try/finally` on the directory, which is safe because deleting a tempdir does not corrupt source).
- Without either flag: print usage and exit.

The `--dry-run` temp-directory approach retires the in-place pin/restore dance (SUPPLY-007). A `SIGKILL` cannot leave the workspace with pinned versions because the pins were never applied to the workspace — they're applied in a copy. `--ci` keeps the in-place approach because the CI workspace is disposable.

### D5 — Harden `scripts/copy-core.ts`

Two small changes:

1. Before `rmSync(target, { recursive: true })`, `lstatSync(target)` and refuse if `isSymbolicLink()`. Symlink handling in `rmSync(..., { recursive: true })` *follows* the link on some Node/Bun versions; the `lstat` guard eliminates that surface entirely.
2. Assert `target` is under `cli/core` (startsWith check against an absolute `resolve(root, "cli", "core")`). Defense-in-depth against a future refactor that parameterizes the target.

Both are 4-line additions. No behavior change in the happy path.

**Known limitation — symlinks inside the tree.** The `lstat` guard only checks the *top-level* target. If an attacker with repo write access could place `cli/core/agents/evil → /etc`, `rmSync({ recursive: true })` may follow it depending on runtime. Full protection would require walking the tree and refusing on any descendant symlink, which is a ~30-line recursive walk for a script that runs during local/CI builds only. **We accept this risk** because: (a) the directory is created fresh by `cpSync` in the same script, seconds earlier — the window for tampering is zero during normal CI runs; (b) the threat model requires push access to the repo, at which point the attacker has much more direct paths to code execution; (c) CI runs in a disposable VM where even a full-tree `rm` off the target would be bounded. Revisit only if `copy-core.ts` ever runs against a persistent, shared, or pre-existing directory.

### D6 — Per-package `publishConfig`

Every published package (`cli`, `runtime`, `adapters/shared`, `adapters/claude-code`, `adapters/codex`, `adapters/gemini`, `adapters/pi`) gets:

```json
"publishConfig": {
  "access": "public",
  "provenance": true
}
```

With `provenance: true` set per-package, `--provenance` on the CLI is redundant but harmless. Belt and suspenders; if someone runs `bun publish` from a workspace directly in CI without the flag, it still produces provenance.

Root `package.json` stays `private: true` — unchanged.

### D7 — CI workflow hygiene (`.github/workflows/ci.yml`)

Add one block at the top:

```yaml
permissions:
  contents: read
```

That's the whole fix for SECRET-001. One line.

### D8 — Registry-side controls

Not code changes, but part of the rollout checklist (documented in a new `docs/security/npm-release-runbook.md`):

- Enable **npm 2FA required for publish** on the `@aos-harness` scope (npm settings → packages → require 2FA).
- Rotate the existing `NPM_TOKEN`: revoke the current one, generate a new **automation token** (not a classic publish token — automation tokens bypass 2FA only from CI, which is what we want), scope it to the `@aos-harness` org, store it in the `npm-publish` GitHub environment.
- Add `aos-engineer` org members as required reviewers on the `npm-publish` environment. Minimum two members added; approval requires one.

## Architecture

```
Developer                         GitHub                          npm
---------                         ------                          ---
local dev                                                         
  bun run publish:dry-run  ──────────────────────────────────→  (nothing; verifies tarballs locally)
                                                                   
local release cut                                                 
  git tag -a v0.7.0                                               
  git push --tags          ─→  tag push event                     
                                  │                               
                                  ↓                               
                               release.yml:                       
                                 1. checkout                      
                                 2. verify-release-tag.ts         
                                 3. bun install --frozen          
                                 4. bun run lint                  
                                    ├── yaml-safety AST           
                                    └── typecheck                 
                                 5. tests                         
                                 6. (environment gate — human)    
                                 7. publish.ts --ci  ──────→  npm publish
                                                             (7 packages
                                                              with provenance)
```

No new services. No new secrets beyond the rotated `NPM_TOKEN`. No cross-repo integrations.

## Data Flow (tag → tarball)

1. Developer runs `bun run publish:dry-run` locally, inspects `.tmp-publish/tarballs/*.tgz`, edits CHANGELOG.
2. Developer runs `bun version <patch|minor|major>` → updates root package version only (manual lockstep across workspaces is already handled by the existing `publish.ts` pin logic, but for version-bump we either script it or do it by hand for seven files — spec is silent here, inherited from current workflow).
3. `git commit -am "chore(release): 0.7.0"`, `git tag -a v0.7.0 -m "…"`, `git push && git push --tags`.
4. `release.yml` fires on the tag push. Verifies tag-HEAD-version-lockstep consistency. Runs lint/tests.
5. Environment gate: one of the configured reviewers approves in the GitHub UI.
6. `publish.ts --ci` pins workspace deps, runs `bun publish --access public --provenance` per package in the existing `PUBLISH_ORDER`, unpins on success. Retry logic for "already published" (idempotency) stays.
7. Each tarball gets an npm provenance statement visible at `https://www.npmjs.com/package/<name>` and verifiable via `npm audit signatures`.

## Error Handling

- **Tag mismatch / dirty tree** → `verify-release-tag.ts` exits 1; workflow fails before any publish.
- **Lint or test failure** → standard CI failure.
- **YAML-safety violation** → `check-yaml-safety.ts` prints `file:line` list, exits 1.
- **No environment approval within 24h** → GitHub auto-cancels the waiting job. This **will** happen on weekend-tag pushes; document the re-trigger procedure prominently in the runbook so the Monday-morning operator doesn't panic. Recovery: `git tag -d v0.7.0 && git push --delete origin v0.7.0 && git tag -a v0.7.0 -m "…" && git push --tags`. Or cut a fresh `v0.7.0-rc.2` and let that go through the flow; the original tag becomes a dated annotated tag that never published. **Operational recommendation**: post tag-push announcement to the team channel with a @mention of the environment reviewers so approvals happen promptly.
- **`bun publish` fails mid-lockstep** (say, #3 of 7) → existing idempotent retry logic in `publish.ts` handles the "version already exists" case on re-run. Operator's fix: re-push the tag (fast-forward, no code change).
- **Provenance generation fails** (missing `id-token: write`) → `bun publish --provenance` errors loudly; fail-closed, never publishes without provenance.

## Testing

- **`scripts/verify-release-tag.ts`** unit-tested against a temp git repo fixture. Cases: tag at HEAD, tag not at HEAD, lightweight tag, dirty tree, version mismatch.
- **`scripts/check-yaml-safety.ts`** unit-tested with a fixture directory of `.ts` snippets covering: safe call, missing schema, destructured `load`, aliased import, value in a comment that contains `JSON_SCHEMA` (must still fail — no bypass via comment), test-directory exclusion (must pass — no scan).
- **`scripts/publish.ts --dry-run`** integration test asserts that after running it the workspace `package.json` files are bit-for-bit unchanged (diff against git HEAD).
- **CI workflow** itself: first tag push after merge is `v0.7.0-rc.1` (release candidate) → publish to the `next` dist-tag. Verify provenance shows up on npm and `npm audit signatures @aos-harness/pi-adapter@0.7.0-rc.1` passes. If the rc is clean, cut `v0.7.0`.

Existing tests unaffected.

## Migration & Rollout

Single release (0.7.0-rc.1 → 0.7.0). No user-visible behavior change. Consumers who run `npm audit signatures` start getting green checkmarks instead of yellow warnings on the `@aos-harness/*` packages.

Operator actions (one-time, in the order they must happen):

1. Merge D3 + D5 + D6 + D7 on a feature branch (they're pure local changes; no release-workflow involvement). Existing CI stays green.
2. Create GitHub environment `npm-publish`. Add required reviewers. Set the **new** environment-scoped `NPM_TOKEN` secret (value generated in Step 3).
3. Rotate npm token:
   a. Generate a new **automation token** scoped to the `@aos-harness` npm org.
   b. Store it in the `npm-publish` GitHub environment (Step 2).
   c. Enable 2FA-required for publish on the `@aos-harness` scope (npm settings → packages).
   d. **Delete any repo-level (non-environment-scoped) `NPM_TOKEN` secret from GitHub repo settings.** This is critical: a repo-level token is readable by every workflow on every branch, bypassing the environment approval we just set up. Verify no other workflow depends on it (only `release.yml` should reference `NPM_TOKEN`).
   e. Revoke the **old** automation token on npm (the one currently on developer laptops) last, so steps a–d complete before losing publish capability.
4. Merge D1 + D2 + D4 (release workflow + verify script + publish.ts --ci flag). CI doesn't fire on this (no tag).
5. Cut `v0.7.0-rc.1` → release workflow runs → approval → provenance verified via `npm audit signatures @aos-harness/pi-adapter@0.7.0-rc.1`.
6. Cut `v0.7.0` (real release).
7. Delete or comment out `publish:all` from root `package.json` scripts (or rename to `publish:dry-run`) to remove the "run locally" muscle memory.

## D8 — Settled follow-ons (previously "open questions")

### D8.1 Runbook lives in-repo

`docs/security/npm-release-runbook.md` is committed alongside the rest of the documentation. Contains no secrets — only the process: who has publish rights, how to cut a release, how to approve one, what to do when a tag gets stuck in the 24h auto-cancel window, how to verify provenance as a consumer. Transparency about the release process builds trust with external contributors and consumers.

### D8.2 Defer signed tags to 1.0

`verify-release-tag.ts` requires an annotated tag but does **not** require `git verify-tag`. The marginal security of signed tags on top of provenance + environment approval + automation-token rotation + 2FA is thin; the friction of onboarding contributor signing keys is real. Revisit at 1.0.0 as part of a broader "pre-GA security hardening" pass.

### D8.3 `rc` tags auto-publish to `next` dist-tag

The release workflow has one conditional:

```yaml
- name: Publish all packages with provenance
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
    DIST_TAG: ${{ contains(github.ref_name, '-rc.') && 'next' || 'latest' }}
  run: bun run scripts/publish.ts --ci --dist-tag=$DIST_TAG
```

`publish.ts --ci --dist-tag=<tag>` threads the value into every `bun publish --tag=<tag>` call. Pre-release consumers opt in with `npm i @aos-harness/pi-adapter@next`; the `latest` tag stays pinned to the last real release. One-line change with real testing leverage.

### D8.4 No laptop fallback; break-glass requires two people

If CI is genuinely unavailable for a publish that must happen, the break-glass procedure (documented in the runbook, not built into the codebase) requires:

1. **Person A**: generates a temporary, short-lived automation token (≤24h expiry where supported; otherwise manual revocation reminder in the runbook) and hands it to Person B via a secure channel (1Password shared item, Signal, etc.).
2. **Person B**: runs the publish from a clean checkout at the signed tag, using the temporary token.
3. **Person A**: revokes the temporary token immediately after Person B confirms publish success.
4. **Both**: file a post-incident issue documenting why CI was unavailable, what was published, and what fix is needed to prevent recurrence.

This mirrors the CI approval gate (two humans involved) and forces the incident to be visible. We do not build tooling for it — the friction is the point. If someone finds themselves break-glassing more than once a year, that's a signal to invest in CI reliability, not in better break-glass tooling.
