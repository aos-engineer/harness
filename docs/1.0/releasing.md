# Releasing AOS 1.0

This is the maintainer runbook for cutting a 1.0 release from `main`. One tag ships two things: the `aos-harness` CLI on npm, published by `.github/workflows/release.yml`, and the Claude Code plugin, which users install straight from this repository through `.claude-plugin/marketplace.json`. The workflow refuses to publish unless the tag, the branch, the worktree, and every versioned manifest agree, so most of this runbook is getting those to agree before you push the tag.

The npm `latest` tag stays on the 0.x line until 1.0.0 final. 0.11.x patches release from the `release/0.11` branch, not from `main`; this runbook does not cover that line.

## Before you start

You need push access to the repository (to push the tag), `gh` authenticated, Bun 1.3.11 or later, and Claude Code for the plugin checks. The workflow itself publishes with the `NPM_TOKEN` secret in the `npm-publish` environment; you do not need npm credentials locally to release, only to roll back.

## 1. Pick the version

| Version | npm dist-tag | GitHub release |
|---|---|---|
| Prerelease, with a hyphen, such as `1.0.0-next.1` | `next` | marked as a prerelease |
| Plain semver, such as `1.0.0` | `latest` | a normal release |

The workflow decides this from the tag alone: any tag containing `-` goes to `next`. That is what keeps `latest` from moving by accident while 1.0 is in prerelease.

## 2. Bump every versioned manifest

`scripts/release/verify-tag.ts` fails the release unless each of these files carries exactly the tag's version. The list lives in `scripts/release/versioned.ts`, which `bun run validate:configs` also reads on every pull request, so drift between them fails review before it can fail a release:

- `package.json`
- `cli/package.json`
- `kernel/package.json`
- `hosts/claude-code/package.json`
- `hosts/claude-code/.claude-plugin/plugin.json`
- `packs/feature-delivery/package.json`

The version users see for the plugin comes from `hosts/claude-code/.claude-plugin/plugin.json`. Checking it against the npm package's version is what keeps the CLI and the plugin from drifting apart.

If anything under `hosts/claude-code/bin`, `hosts/claude-code/src`, `kernel/src`, or `packs/feature-delivery` changed since the last build, rebuild the plugin and commit the result. The marketplace installs from git, so the committed bundles are what users get:

```bash
bun run build:plugin
git add hosts/claude-code/dist hosts/claude-code/pack
```

## 3. Add a CHANGELOG section

Add a section to `CHANGELOG.md` headed with the bare version:

```markdown
## 1.0.0-next.1

### Fixed

- ...
```

The workflow builds the GitHub release notes from this section. It extracts every line after a heading that matches `^## <version>( |$)` up to the next `## ` heading, so `## 1.0.0-next.1` and `## 1.0.0-next.1 (2026-10-20)` both work, and `## v1.0.0-next.1` does not.

The release workflow extracts this section right after it verifies the tag, before anything is published, and fails if the section is missing or empty. `bun run validate:configs`, a required check on every pull request, fails the same way for the version the manifests carry, so a missing section is caught in review.

## 4. Run the checks locally

```bash
bun run lint
bun run test
bun run build:plugin:check
AOS_E2E_HOOK=bundle bun test ./tests/e2e
bun run validate:configs
claude plugin validate .
claude plugin validate ./hosts/claude-code
```

`build:plugin:check` exits 1 when the committed bundles or the plugin's pack copy differ from a fresh build. The end-to-end run with `AOS_E2E_HOOK=bundle` sends every hook through the launcher and the committed bundle, which is what a marketplace install runs. `validate:configs` checks that the versioned manifests agree, that every pack (including the plugin's copy) loads, that the marketplace entry points at the plugin, and that `CHANGELOG.md` has a non-empty section for the version. The two `claude plugin validate` calls check the marketplace manifest and the plugin manifest; warnings do not fail them, but read each one.

## 5. Merge to main through a pull request

`main` is protected: changes land only through a pull request, and direct pushes are blocked. Open a PR with the version bump, the rebuilt plugin, and the CHANGELOG section, wait for the two required checks, and merge it:

- **`test`**: lint and typecheck, the test suite, the plugin bundle check, and the end-to-end run through the committed bundle.
- **`validate-configs`**: `bun run validate:configs`.

## 6. Tag the merged commit

Tag the commit on `main`, not your branch. `verify-tag` requires the tag to point at `HEAD`, `HEAD` to be on `origin/main`, and the worktree to be clean.

```bash
git switch main
git pull --ff-only
git tag v1.0.0-next.1
git push origin v1.0.0-next.1
```

The tag must be `v` followed by the version, exactly as in the manifests.

## 7. What the workflow does

Pushing a `v*` tag runs `.github/workflows/release.yml` on Ubuntu in the `npm-publish` environment, with Bun 1.4.0 and Node 24. Its permissions are `contents: write` (to create the release) and `id-token: write` (for npm provenance). In order:

1. **Verify the tag, the branch, and every version.** `bun run scripts/release/verify-tag.ts` reads the tag from `GITHUB_REF_NAME` and fails unless it is `v<semver>`, points at `HEAD`, `HEAD` is an ancestor of `origin/main`, the worktree is clean, and all six manifests carry the version.
2. **Extract the release notes** from the version's `CHANGELOG.md` section (runbook step 3), and fail if there are none. This runs before anything is published, because a published version number can never be reused.
3. **Install** with `bun install --frozen-lockfile`.
4. **Lint and typecheck** with `bun run lint`.
5. **Test** with `bun run test`.
6. **Check the plugin bundles** with `bun run build:plugin:check`.
7. **Run the end-to-end suite through the shipped plugin** with `AOS_E2E_HOOK=bundle bun test ./tests/e2e`: every hook goes through `bin/aos.sh` and the committed `dist/` bundle.
8. **Validate the release configs** with `bun run validate:configs`: versions, packs, the marketplace entry, and the CHANGELOG section.
9. **Pack the CLI.** `scripts/release/pack-cli.ts` bundles the CLI with the kernel and its dependencies into `dist/aos.js`, copies the reference pack to `pack/`, adds the CLI README and the license, and writes a manifest with no runtime dependencies.
10. **Smoke the packed CLI** by running `bun dist/aos.js --version` from the packed directory.
11. **Choose the dist-tag:** `next` if the tag contains a hyphen, otherwise `latest`.
12. **Check the npm token** with `npm whoami`, so a bad or expired `NPM_TOKEN` fails here rather than at publish.
13. **Publish** with `npm publish --access public --tag <dist-tag> --provenance`.
14. **Wait for the registry.** `scripts/release/wait-for-npm.ts` asks npm for `aos-harness@<dist-tag>` up to 30 times, 10 seconds apart, until it resolves to the new version. It then installs that exact version into a scratch directory and runs the installed `dist/aos.js --version` under Bun, so the release is proven installable from the registry, not only uploaded.
15. **Create the GitHub release** with the notes extracted in step 2. If a release for the tag already exists it edits its notes; otherwise it creates one with `--verify-tag`. Prerelease versions are marked `--prerelease`.

The plugin needs no publish step. Once the tag is pushed, it is installable from the tag, and `main` already carries the same version.

## 8. Verify the release

### npm

```bash
npm view aos-harness dist-tags
npm view aos-harness@next version
```

For a prerelease, `next` should name the new version and `latest` should still be the 0.x version. Then install it and run it:

```bash
npm install -g aos-harness@next     # or: bun add -g aos-harness@next
aos --version
aos doctor
```

The CLI is a Bun script, so Bun must be on `PATH` even when npm installed it.

### The marketplace

Install the plugin at the tag you just pushed, preferably in a scratch Claude Code configuration so your own install is untouched:

```bash
claude plugin marketplace add aos-engineer/harness#v1.0.0-next.1
claude plugin install aos@aos-harness
claude plugin list
```

The `#v1.0.0-next.1` suffix pins the marketplace to that git ref: a ref that exists is cloned at that ref, and one that does not fails at clone. If the `aos-harness` marketplace is already added, refresh it instead with `claude plugin marketplace update aos-harness`. `claude plugin list` should show the version from `plugin.json`. Then start Claude Code in a scratch git repository and run a short bounded run (`/aos:run add a --shout flag to greet`) through to its first approval, approving it with the CLI you just installed.

## 9. Recover from a partial failure

Look at which step failed before re-running anything.

- **Before `npm publish`:** nothing reached npm. If the cause was outside the repository (an expired `NPM_TOKEN`, a registry outage), fix it and re-run the workflow for the same tag. If the fix needs a new commit, the tag no longer points at what you want to release, and the pushed tag may already be pinned by someone installing the plugin, so do not move it: bump to the next version and start again from step 2.
- **After `npm publish` succeeded:** re-running the workflow fails at `npm publish`, because that version already exists. Finish the remaining steps by hand. To create the GitHub release, write the notes to a file and run:

```bash
gh release create v1.0.0-next.1 --title v1.0.0-next.1 --prerelease --verify-tag --notes-file notes.md
```

Drop `--prerelease` for a plain semver release. To rebuild the notes the workflow would have used, run the awk command from the workflow's "Extract the release notes" step against `CHANGELOG.md` at the tag.

## 10. Roll back a bad prerelease

Never move or delete a tag that has been published: npm provenance, the GitHub release, and anyone who pinned the plugin to the tag all point at it. Roll forward instead.

1. **Point `next` back at the last good version**, so new installs stop getting the bad one:

   ```bash
   npm dist-tag add aos-harness@1.0.0-next.0 next
   ```

2. **Deprecate the bad version**, so anyone who installs it sees why:

   ```bash
   npm deprecate aos-harness@1.0.0-next.1 "<what is wrong>; use 1.0.0-next.2"
   ```

3. **Ship a fixed prerelease** (`1.0.0-next.2`) through this runbook from step 1.

Do not reach for `npm unpublish`. npm's [unpublish policy](https://docs.npmjs.com/policies/unpublish) restricts when it is allowed, and a version number that has been published can never be used again, even after an unpublish. A deprecation plus a moved dist-tag gets users off a bad version without either cost.

For the plugin, the marketplace entry points at this repository, and a user who added it without a ref follows `main`. Revert the bad change on `main` through a PR (bumping the version as part of the fixed prerelease), and tell users to update with:

```bash
claude plugin update aos@aos-harness
```

Users who added the marketplace pinned to a tag (`aos-engineer/harness#v1.0.0-next.1`) stay on that tag until they add the marketplace again at a newer one. How quickly an unpinned install sees a change on `main` depends on Claude Code refreshing the marketplace; `claude plugin marketplace update aos-harness` forces a refresh.
