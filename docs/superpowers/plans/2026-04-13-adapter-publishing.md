# Adapter Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish all four AOS adapters as standalone npm packages alongside runtime/shared/CLI at v0.5.0, while keeping adapters bundled inside the CLI for zero-install UX.

**Architecture:** Hybrid distribution with lockstep versioning. Every `package.json` gets required publish metadata (engines, files, repository, license). `scripts/publish.ts` is refactored to publish 7 packages in dependency order, pinning `workspace:*` deps at publish time, with idempotent retry on "already exists". CLI adapter loader logs which adapter path (standalone vs bundled) was resolved.

**Tech Stack:** Bun workspaces, npm registry, TypeScript, `bun publish`.

**Spec:** `docs/superpowers/specs/2026-04-13-adapter-publishing-design.md`

---

## File Structure

**Versions bumped to 0.5.0:**
- `runtime/package.json`
- `adapters/shared/package.json`
- `adapters/claude-code/package.json`
- `adapters/codex/package.json`
- `adapters/gemini/package.json`
- `adapters/pi/package.json`
- `cli/package.json`

**Metadata added (description, license, repository.directory, homepage, keywords, engines, files, publishConfig):**
- All five `adapters/*/package.json`

**READMEs created (new):**
- `adapters/shared/README.md`
- `adapters/codex/README.md`

**Code changes:**
- `scripts/publish.ts` — refactor to helper-based loop over 7 packages, lockstep gate, idempotent retry
- `cli/src/adapter-session.ts:63-76` — log resolved adapter path + version

**Docs:**
- `CHANGELOG.md` — add 0.5.0 entry

---

## Task 1: Bump runtime, shared, CLI to 0.5.0

**Files:**
- Modify: `runtime/package.json` (`version` field)
- Modify: `adapters/shared/package.json` (`version` field)
- Modify: `cli/package.json` (`version` field)

- [ ] **Step 1: Bump `runtime/package.json` version**

Change `"version": "0.4.2"` to `"version": "0.5.0"`.

- [ ] **Step 2: Bump `adapters/shared/package.json` version**

Change `"version": "0.4.2"` to `"version": "0.5.0"`.

- [ ] **Step 3: Bump `cli/package.json` version**

Change `"version": "0.4.2"` to `"version": "0.5.0"`.

- [ ] **Step 4: Commit**

```bash
git add runtime/package.json adapters/shared/package.json cli/package.json
git commit -m "chore: bump runtime, adapter-shared, cli to 0.5.0"
```

---

## Task 2: Add publish metadata to adapters/shared + README

**Files:**
- Modify: `adapters/shared/package.json`
- Create: `adapters/shared/README.md`

- [ ] **Step 1: Update `adapters/shared/package.json`**

Replace the file with:

```json
{
  "name": "@aos-harness/adapter-shared",
  "version": "0.5.0",
  "description": "Shared base classes and utilities for AOS Harness platform adapters.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git",
    "directory": "adapters/shared"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["aos-harness", "ai-agents", "adapter", "shared"],
  "type": "module",
  "engines": { "bun": ">=1.0.0" },
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "files": ["src/", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `adapters/shared/README.md`**

```markdown
# @aos-harness/adapter-shared

Shared base classes and utilities used by every AOS Harness platform adapter (Claude Code, Codex, Gemini, Pi).

Re-exports common types (`AgentRuntime`, `EventBus`, etc.) and provides composition helpers (`composeAdapter`, `BaseEventBus`, `BaseWorkflow`) so each adapter only needs to implement platform-specific runtime logic.

Part of the [AOS Harness](https://aos.engineer) monorepo. Most users install `aos-harness` (the CLI) instead of consuming this package directly.

## Requirements

- Bun ≥ 1.0.0

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add adapters/shared/package.json adapters/shared/README.md
git commit -m "chore(adapter-shared): add npm publish metadata and README"
```

---

## Task 3: Add publish metadata to claude-code adapter

**Files:**
- Modify: `adapters/claude-code/package.json`

- [ ] **Step 1: Update `adapters/claude-code/package.json`**

Replace the file with:

```json
{
  "name": "@aos-harness/claude-code-adapter",
  "version": "0.5.0",
  "description": "AOS Harness adapter for Anthropic's Claude Code CLI.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git",
    "directory": "adapters/claude-code"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["aos-harness", "ai-agents", "claude-code", "adapter"],
  "type": "module",
  "engines": { "bun": ">=1.0.0" },
  "exports": { ".": "./src/index.ts" },
  "files": ["src/", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add adapters/claude-code/package.json
git commit -m "chore(claude-code-adapter): add npm publish metadata, bump to 0.5.0"
```

---

## Task 4: Add publish metadata to codex adapter + README

**Files:**
- Modify: `adapters/codex/package.json`
- Create: `adapters/codex/README.md`

- [ ] **Step 1: Update `adapters/codex/package.json`**

Replace the file with:

```json
{
  "name": "@aos-harness/codex-adapter",
  "version": "0.5.0",
  "description": "AOS Harness adapter for OpenAI's Codex CLI.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git",
    "directory": "adapters/codex"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["aos-harness", "ai-agents", "codex", "adapter"],
  "type": "module",
  "engines": { "bun": ">=1.0.0" },
  "exports": { ".": "./src/index.ts" },
  "files": ["src/", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `adapters/codex/README.md`**

```markdown
# @aos-harness/codex-adapter

AOS Harness adapter for OpenAI's [Codex CLI](https://github.com/openai/codex). Lets you run AOS deliberation and execution profiles with Codex as the underlying agent runtime.

Part of the [AOS Harness](https://aos.engineer) monorepo. Bundled with the `aos-harness` CLI — install standalone only if you want a lean, Codex-only setup.

## Requirements

- Bun ≥ 1.0.0
- Codex CLI installed and authenticated on the host

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add adapters/codex/package.json adapters/codex/README.md
git commit -m "chore(codex-adapter): add npm publish metadata, README, bump to 0.5.0"
```

---

## Task 5: Add publish metadata to gemini adapter

**Files:**
- Modify: `adapters/gemini/package.json`

- [ ] **Step 1: Update `adapters/gemini/package.json`**

Replace the file with:

```json
{
  "name": "@aos-harness/gemini-adapter",
  "version": "0.5.0",
  "description": "AOS Harness adapter for Google's Gemini CLI.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git",
    "directory": "adapters/gemini"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["aos-harness", "ai-agents", "gemini", "adapter"],
  "type": "module",
  "engines": { "bun": ">=1.0.0" },
  "exports": { ".": "./src/index.ts" },
  "files": ["src/", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "@aos-harness/adapter-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add adapters/gemini/package.json
git commit -m "chore(gemini-adapter): add npm publish metadata, bump to 0.5.0"
```

---

## Task 6: Add publish metadata to pi adapter

**Files:**
- Modify: `adapters/pi/package.json`

- [ ] **Step 1: Update `adapters/pi/package.json`**

Replace the file with:

```json
{
  "name": "@aos-harness/pi-adapter",
  "version": "0.5.0",
  "description": "AOS Harness adapter for the Pi coding agent runtime.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git",
    "directory": "adapters/pi"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["aos-harness", "ai-agents", "pi", "adapter"],
  "type": "module",
  "engines": { "bun": ">=1.0.0" },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "exports": { ".": "./src/index.ts" },
  "files": ["src/", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@aos-harness/adapter-shared": "workspace:*",
    "@aos-harness/runtime": "workspace:*",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add adapters/pi/package.json
git commit -m "chore(pi-adapter): add npm publish metadata, bump to 0.5.0"
```

---

## Task 7: Refactor `scripts/publish.ts` — helper, pinMap, lockstep, idempotency

**Files:**
- Modify: `scripts/publish.ts` (full rewrite of body)

- [ ] **Step 1: Replace `scripts/publish.ts` with refactored version**

Full file contents:

```ts
#!/usr/bin/env bun
/**
 * AOS Harness — Monorepo Publish Script
 *
 * Publishes all workspace packages to npm in dependency order with
 * lockstep version enforcement. Idempotent: if a package version already
 * exists on the registry, that package is skipped and the script continues.
 *
 * Dry-run by default. Pass --confirm to actually publish.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { copyCore, cleanCore } from "./copy-core";

const root = resolve(import.meta.dir, "..");
const confirm = process.argv.includes("--confirm");

type PublishEntry = {
  dir: string;              // workspace dir relative to repo root
  name: string;             // npm package name (for logs/assertions)
  pinDeps: string[];        // names of workspace deps to pin before publish
  postPublish?: () => void; // e.g. cleanCore after CLI
  prePublish?: () => void;  // e.g. copyCore before CLI
};

const PUBLISH_ORDER: PublishEntry[] = [
  { dir: "runtime",                name: "@aos-harness/runtime",             pinDeps: [] },
  { dir: "adapters/shared",        name: "@aos-harness/adapter-shared",      pinDeps: ["@aos-harness/runtime"] },
  { dir: "adapters/claude-code",   name: "@aos-harness/claude-code-adapter", pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  { dir: "adapters/codex",         name: "@aos-harness/codex-adapter",       pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  { dir: "adapters/gemini",        name: "@aos-harness/gemini-adapter",      pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  { dir: "adapters/pi",            name: "@aos-harness/pi-adapter",          pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  {
    dir: "cli",
    name: "aos-harness",
    pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"],
    prePublish: () => copyCore(),
    postPublish: () => cleanCore(),
  },
];

function readPkg(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf-8"));
}

function readPkgRaw(dir: string): string {
  return readFileSync(resolve(root, dir, "package.json"), "utf-8");
}

function writePkg(dir: string, content: string): void {
  writeFileSync(resolve(root, dir, "package.json"), content, "utf-8");
}

function pinWorkspaceDeps(raw: string, pinMap: Record<string, string>): string {
  let out = raw;
  for (const [depName, version] of Object.entries(pinMap)) {
    const pattern = new RegExp(`"${depName.replace(/[/@-]/g, "\\$&")}":\\s*"workspace:\\*"`, "g");
    out = out.replace(pattern, `"${depName}": "${version}"`);
  }
  return out;
}

function isAlreadyPublished(stderr: string): boolean {
  // bun publish / npm publish surface variants of this message when the
  // version already exists on the registry. Match defensively.
  const s = stderr.toLowerCase();
  return (
    s.includes("already exists") ||
    s.includes("cannot publish over") ||
    s.includes("you cannot publish over the previously published versions") ||
    s.includes("403") && s.includes("previously published")
  );
}

async function publishWithPinnedDeps(entry: PublishEntry, pinMap: Record<string, string>): Promise<void> {
  const cwd = resolve(root, entry.dir);
  const originalRaw = readPkgRaw(entry.dir);
  const version = (JSON.parse(originalRaw) as { version: string }).version;

  try {
    if (entry.prePublish) entry.prePublish();

    if (entry.pinDeps.length > 0) {
      const resolved = pinWorkspaceDeps(originalRaw, pinMap);
      writePkg(entry.dir, resolved);
    }

    // For the CLI, also pin workspace:* in bundled cli/adapters/*/package.json
    if (entry.dir === "cli") {
      const bundledAdapters = ["pi", "claude-code", "gemini", "codex", "shared"];
      for (const adapterName of bundledAdapters) {
        const adapterPkgPath = resolve(root, "cli", "adapters", adapterName, "package.json");
        if (existsSync(adapterPkgPath)) {
          const adapterRaw = readFileSync(adapterPkgPath, "utf-8");
          writeFileSync(adapterPkgPath, pinWorkspaceDeps(adapterRaw, pinMap), "utf-8");
        }
      }
    }

    const label = `${entry.name}@${version}`;
    if (!confirm) {
      console.log(`  [dry-run] bun publish --dry-run  (${label})`);
      const result = await $`bun publish --dry-run`.cwd(cwd).quiet().nothrow();
      if (result.exitCode !== 0) {
        console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
      } else {
        console.log(`    ✓ would publish ${label}`);
      }
    } else {
      console.log(`  Publishing ${label}...`);
      const result = await $`bun publish --access public`.cwd(cwd).nothrow();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (isAlreadyPublished(stderr)) {
          console.log(`  ⤳ ${label} already exists on registry — skipping`);
        } else {
          console.error(`  ✗ Failed to publish ${label}\n${stderr}`);
          throw new Error(`Publish failed for ${entry.name}`);
        }
      } else {
        console.log(`  ✓ Published ${label}`);
      }
    }
  } finally {
    writePkg(entry.dir, originalRaw);
    if (entry.postPublish) entry.postPublish();
  }
}

async function main() {
  console.log("=== AOS Harness Publish ===\n");

  // 1. Run unit tests
  console.log("▸ Running unit tests...");
  const testResult = await $`bun test --cwd ${resolve(root, "runtime")}`.quiet().nothrow();
  if (testResult.exitCode !== 0) {
    console.error("✗ Unit tests failed:\n", testResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Unit tests passed\n");

  // 2. Run integration validation
  console.log("▸ Running integration validation...");
  const integrationScript = resolve(root, "tests/integration/validate-config.ts");
  const intResult = await $`bun run ${integrationScript}`.quiet().nothrow();
  if (intResult.exitCode !== 0) {
    console.error("✗ Integration validation failed:\n", intResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Integration validation passed\n");

  // 3. Lockstep version gate
  const versions = new Map<string, string>();
  for (const entry of PUBLISH_ORDER) {
    const pkg = readPkg(entry.dir);
    versions.set(entry.name, pkg.version as string);
  }
  const releaseVersion = versions.get("@aos-harness/runtime")!;
  const mismatches = [...versions.entries()].filter(([, v]) => v !== releaseVersion);
  if (mismatches.length > 0) {
    console.error(`✗ Lockstep violation: expected all packages at ${releaseVersion}`);
    for (const [name, v] of mismatches) console.error(`  ${name}@${v}`);
    process.exit(1);
  }
  console.log(`▸ Release version: ${releaseVersion}\n`);

  // 4. Build the pin map once (all workspace deps map to releaseVersion)
  const pinMap: Record<string, string> = {
    "@aos-harness/runtime": releaseVersion,
    "@aos-harness/adapter-shared": releaseVersion,
  };

  console.log("▸ Packages to publish:\n");
  for (const entry of PUBLISH_ORDER) console.log(`  ${entry.name}@${releaseVersion}  (${entry.dir}/)`);
  console.log();

  // 5. Publish in order
  for (const entry of PUBLISH_ORDER) {
    await publishWithPinnedDeps(entry, pinMap);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run dry-run to verify the refactor works**

Run: `bun run scripts/publish.ts`

Expected output (abbreviated):
```
=== AOS Harness Publish ===
▸ Running unit tests...
✓ Unit tests passed
▸ Running integration validation...
✓ Integration validation passed
▸ Release version: 0.5.0

▸ Packages to publish:
  @aos-harness/runtime@0.5.0  (runtime/)
  @aos-harness/adapter-shared@0.5.0  (adapters/shared/)
  @aos-harness/claude-code-adapter@0.5.0  (adapters/claude-code/)
  @aos-harness/codex-adapter@0.5.0  (adapters/codex/)
  @aos-harness/gemini-adapter@0.5.0  (adapters/gemini/)
  @aos-harness/pi-adapter@0.5.0  (adapters/pi/)
  aos-harness@0.5.0  (cli/)

  [dry-run] bun publish --dry-run  (@aos-harness/runtime@0.5.0)
    ✓ would publish @aos-harness/runtime@0.5.0
  ... (six more successes)
Done.
```

If any line reports `⚠ dry-run issue`, open that package's `package.json` and fix the issue before committing. Typical causes: missing `name`/`version`, unresolved `workspace:*` in a non-pinned dep, or `files` referencing a missing file.

- [ ] **Step 3: Verify the restore-on-failure worked**

Run: `git status`

Expected: working tree clean. The try/finally in `publishWithPinnedDeps` must restore every modified `package.json`. If `git status` shows modifications to any adapter's `package.json`, the restore logic is broken — debug before proceeding.

- [ ] **Step 4: Commit**

```bash
git add scripts/publish.ts
git commit -m "chore(publish): refactor for 7-package lockstep publish with idempotent retry"
```

---

## Task 8: Log resolved adapter path in CLI loader

**Files:**
- Modify: `cli/src/adapter-session.ts:63-76`

- [ ] **Step 1: Update `loadAdapterRuntime` to log resolution source + version**

Replace the function body at `cli/src/adapter-session.ts:63-76`:

```ts
async function loadAdapterRuntime(platform: string): Promise<any> {
  const entry = ADAPTER_MAP[platform];
  if (!entry) throw new Error(`Unknown adapter: ${platform}`);

  async function readAdapterVersion(fromPath: string): Promise<string> {
    try {
      const pkgUrl = new URL("../package.json", fromPath).href;
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(new URL(pkgUrl), "utf-8");
      return (JSON.parse(raw) as { version: string }).version ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  try {
    const mod = await import(entry.package);
    // Resolved from node_modules (standalone install). Log so version mismatches are debuggable.
    const resolved = import.meta.resolve?.(entry.package) ?? entry.package;
    const version = await readAdapterVersion(resolved);
    console.error(`[adapter] loaded ${entry.package}@${version} (standalone)`);
    return mod[entry.className];
  } catch {
    const here = dirname(fileURLToPath(import.meta.url));
    const fallback = join(here, "..", "..", "adapters", platform, "src", "index.ts");
    const mod = await import(fallback);
    const version = await readAdapterVersion(`file://${fallback}`);
    console.error(`[adapter] loaded ${entry.package}@${version} (bundled: ${fallback})`);
    return mod[entry.className];
  }
}
```

- [ ] **Step 2: Manually test adapter resolution logging**

Run: `bun run cli/src/index.ts run --help` (just exercising the CLI entry path is enough to verify the file compiles).

Then run any command that triggers `runAdapterSession`, e.g.:
```
bun run cli/src/index.ts validate
```

Expected: no TypeScript errors on load; when an adapter session runs, stderr shows one of:
- `[adapter] loaded @aos-harness/claude-code-adapter@0.5.0 (standalone)`
- `[adapter] loaded @aos-harness/claude-code-adapter@0.5.0 (bundled: /.../adapters/claude-code/src/index.ts)`

Since tests may not trigger a real session, compiling cleanly (`bun run typecheck` — step below) is the hard gate.

- [ ] **Step 3: Run typecheck to verify the file compiles**

Run: `bun run typecheck`

Expected: exit 0. If TypeScript complains about `import.meta.resolve`, narrow the cast to `(import.meta as any).resolve`.

- [ ] **Step 4: Commit**

```bash
git add cli/src/adapter-session.ts
git commit -m "feat(cli): log resolved adapter path and version at load time"
```

---

## Task 9: Update CHANGELOG and final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add 0.5.0 entry to `CHANGELOG.md`**

Insert at the top of the file, below the `# Changelog` heading:

```markdown
## [0.5.0] - 2026-04-13

### Added

- Standalone npm distribution for all four adapters: `@aos-harness/claude-code-adapter`, `@aos-harness/codex-adapter`, `@aos-harness/gemini-adapter`, `@aos-harness/pi-adapter`. Hybrid model — adapters are still bundled inside the `aos-harness` CLI for zero-install UX.
- `[adapter]` log line at adapter load time showing package name, version, and whether the adapter was resolved standalone or from the CLI's bundled copy.

### Changed

- Lockstep versioning across the seven published packages. `scripts/publish.ts` now enforces a single `releaseVersion` across `runtime`, `adapter-shared`, the four adapters, and the CLI.
- `scripts/publish.ts` refactored to a single loop with a `publishWithPinnedDeps` helper. Idempotent: re-running after a partial publish skips packages already on the registry.
- Every adapter `package.json` now declares `description`, `license`, `repository.directory`, `homepage`, `keywords`, `engines.bun`, `files`, and `publishConfig.access`.
```

- [ ] **Step 2: Run full pre-release pipeline**

Run: `bun run prerelease`

Expected: lint passes, tests pass, exit 0.

- [ ] **Step 3: Run the publish dry-run one more time**

Run: `bun run publish:all`

Expected: all 7 packages report `✓ would publish`. No `⚠` lines. `git status` clean after the run.

- [ ] **Step 4: Spot-check a dry-run tarball for workspace leaks**

Run: `cd adapters/claude-code && bun publish --dry-run 2>&1 | grep -i 'workspace\|version\|files'`

Expected: no `workspace:*` strings in the output (all should be pinned to `0.5.0`). The `files` list should contain only `src/...` entries and `README.md`.

Repeat for one more adapter (`adapters/pi`) as a sanity check for the peerDependencies path.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add 0.5.0 changelog entry for adapter publishing"
```

- [ ] **Step 6: Summarize for review**

Report to the user: all 7 packages at 0.5.0, publish dry-run clean, tarball spot-check shows no workspace leaks. Ready for `bun run publish:all --confirm` and a `v0.5.0` git tag.

---

## Self-Review Checklist (for the plan author, already completed)

- ✅ Spec section 1 (metadata) → Tasks 2–6
- ✅ Spec section 2 (versions → 0.5.0) → Task 1 + each adapter task
- ✅ Spec section 3 (publish script: helper, pinMap with cross-deps, lockstep, idempotency) → Task 7
- ✅ Spec section 4 (CLI bundling unchanged + adapter resolution precedence logging) → Task 8
- ✅ Spec section 5 (dry-run gate) → Task 9, steps 3–4
- ✅ Verification items 1–5 → Task 9
- ✅ No TBDs, TODOs, or "similar to" references
- ✅ Types/function signatures consistent across tasks (`publishWithPinnedDeps`, `pinMap`, `PublishEntry`)
