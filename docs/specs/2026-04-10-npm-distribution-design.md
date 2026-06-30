# AOS Harness npm Distribution Design

**Date:** 2026-04-10
**Status:** Draft
**Scope:** CLI and runtime packaging for npm distribution

## Overview

Make AOS Harness installable via `bun add -g aos-harness` and runnable via `bunx aos-harness`. Bun is a hard requirement — no Node.js compatibility layer. TypeScript source is the distribution — no build pipeline.

Two packages published to npm:

| Package | npm name | Purpose |
|---|---|---|
| CLI | `aos-harness` (unscoped) | CLI commands + bundled core configs (agents, profiles, domains, workflows, skills) |
| Runtime | `@aos-harness/runtime` (scoped) | Engine, types, modules for programmatic use |

## Install Experience

```bash
# Global install (package name: aos-harness, binary name: aos)
bun add -g aos-harness
aos init

# One-shot via bunx (uses package name to install, binary name to execute)
bunx aos-harness init    # installs aos-harness, runs the "aos" binary with "init" arg

# Programmatic use (adapter/plugin developers)
bun add @aos-harness/runtime
```

**Naming convention:** The npm package name is `aos-harness`. The binary name is `aos` (defined by `"bin": { "aos": "./src/index.ts" }`). Users install `aos-harness` but run `aos`. `bunx aos-harness <args>` works because bunx installs the package and invokes its bin entry.

**Binary name collision check:** Verify that `aos` is not already claimed as a bin name on npm by another package before publishing. Bin name collisions cause install warnings on global install.

## Runtime Requirement

Bun 1.0+ is the only supported runtime. The CLI shebang remains `#!/usr/bin/env bun`. TypeScript source files are shipped as-is — Bun runs `.ts` natively, so no compilation step is needed.

**Enforcement:** `"engines": { "bun": ">=1.0.0" }` is set in both packages, but this is advisory only — neither npm nor bun blocks installation when engines don't match. A Node.js user can `npm install -g aos-harness`, get raw `.ts` files, and hit a confusing failure.

**Runtime guard:** The first lines of `cli/src/index.ts` (after the shebang) must check for the `Bun` global. If absent, print a clear message and exit:

```typescript
#!/usr/bin/env bun
if (typeof Bun === "undefined") {
  console.error("AOS Harness requires Bun 1.0+. Install at https://bun.sh");
  process.exit(1);
}
```

This catches Node.js users immediately with an actionable error instead of a cryptic TypeScript parse failure.

## Package Contents

### aos-harness (CLI)

```
aos-harness/
├── src/                    # CLI commands (TypeScript)
│   ├── index.ts            # Entry point (#!/usr/bin/env bun)
│   ├── commands/           # init, run, create, validate, list, replay
│   ├── colors.ts
│   └── utils.ts
├── core/                   # Bundled core configs (copied on prepublish)
│   ├── agents/             # 13 agent definitions
│   ├── profiles/           # 6 orchestration profiles
│   ├── domains/            # 5 domain packs
│   ├── workflows/          # 7 workflow definitions
│   ├── skills/             # 3 skill definitions
│   ├── schema/             # JSON schema for validation
│   └── briefs/             # Sample briefs
├── package.json
└── README.md               # npm page README
```

### @aos-harness/runtime

```
@aos-harness/runtime/
├── src/                    # Engine and modules (TypeScript)
│   ├── engine.ts
│   ├── types.ts
│   ├── config-loader.ts
│   ├── constraint-engine.ts
│   ├── delegation-router.ts
│   ├── domain-merger.ts
│   ├── domain-enforcer.ts
│   ├── child-agent-manager.ts
│   ├── expertise-manager.ts
│   ├── event-summarizer.ts
│   ├── session-checkpoint.ts
│   ├── template-resolver.ts
│   ├── workflow-runner.ts
│   ├── artifact-manager.ts
│   └── output-renderer.ts
├── package.json
└── README.md
```

## Monorepo → Publishable Package Changes

### CLI package.json changes

```json
{
  "name": "aos-harness",
  "version": "0.1.0",
  "description": "Agentic Orchestration System — assemble AI agents into deliberation and execution teams",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/harness.git"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["ai", "agents", "orchestration", "multi-agent", "deliberation", "execution", "llm", "bun"],
  "type": "module",
  "bin": { "aos": "./src/index.ts" },
  "engines": { "bun": ">=1.0.0" },
  "files": ["src/", "core/", "README.md"],
  "dependencies": {
    "@aos-harness/runtime": "0.1.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.8.0"
  }
}
```

Key changes from current state:
- `name`: `@aos-harness/cli` → `aos-harness` (unscoped for easy install)
- `engines`: added `{ "bun": ">=1.0.0" }`
- `files`: added `core/` (bundled configs)
- `dependencies`: `workspace:*` → pinned version `"0.1.0"`

### Runtime package.json changes

```json
{
  "name": "@aos-harness/runtime",
  "version": "0.1.0",
  "engines": { "bun": ">=1.0.0" },
  "files": ["src/", "package.json", "README.md"]
}
```

Additions: `engines` field and explicit `files` array. The `files` field ensures only source and metadata are published — test files (`tests/`), fixtures (`fixtures/`), and dev configs (`tsconfig.json`) are excluded from the npm tarball.

### Root package.json

Stays `"private": true`. Never published.

## Core Config Bundling

**Problem:** The `core/` directory lives at the monorepo root. The CLI package needs it included when published to npm.

**Solution:** The publish script (`scripts/publish.ts`) handles copying `core/` into `cli/core/` before publish and cleaning it up after. No shell commands in package.json — all file operations use a cross-platform TypeScript helper (`scripts/copy-core.ts`) that uses Node.js `fs` APIs (which Bun supports), ensuring Windows contributors and CI environments work correctly.

**`scripts/copy-core.ts`** — Recursively copies `core/` into `cli/core/` using `fs.cpSync` (Node 16.7+ / Bun 1.0+). Also provides a `clean()` export to remove `cli/core/` after publishing.

```typescript
import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const src = resolve(root, "core");
const dest = resolve(root, "cli", "core");

export function copyCore() {
  if (existsSync(dest)) rmSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function cleanCore() {
  if (existsSync(dest)) rmSync(dest, { recursive: true });
}
```

The publish script imports and calls these functions — no `cp -r` shell dependency.

**Git ignore:** Add `core/` to `cli/.gitignore` so the prepublish copy is never committed. The canonical `core/` stays at the monorepo root.

## Workspace Dependency Resolution

**Problem:** npm registries don't understand `workspace:*`.

**Solution:** The publish script (`scripts/publish.ts`) replaces `workspace:*` with the pinned version before publishing, then restores it afterward.

**Flow:**
1. Read `cli/package.json` and save original content
2. Replace `"@aos-harness/runtime": "workspace:*"` with `"@aos-harness/runtime": "0.1.0"`
3. Copy `core/` into `cli/core/` via `scripts/copy-core.ts`
4. Run `bun publish --access public` in `cli/` **inside a try/finally block**
5. **Finally (always runs, even on publish failure):** Restore original `cli/package.json` and remove `cli/core/`

The try/finally ensures that if the publish step fails mid-way, `package.json` is never left in a modified state with a pinned version instead of `workspace:*`.

## First-Run Wizard

**Trigger:** User runs `aos` or `bunx aos-harness` with no arguments in a directory where no AOS project is detected (no `core/agents/` or `.aos/` in current or parent directories).

**Flow:**

```
$ bunx aos-harness

  AOS Harness v0.1.0

  No AOS project detected in this directory.
  Would you like to initialize one? (Y/n)

  > Y

  Copying core configs (13 agents, 6 profiles, 5 domains)... done.
  Created .aos/ directory.

  Your AOS project is ready. Next steps:

    aos run strategic-council --brief <your-brief.md>
    aos list
    aos create agent <name>
    aos validate
```

**Implementation:** In `cli/src/index.ts`, before the command switch:

1. Command provided? Proceed normally.
2. No command, no project detected? Prompt for init.
3. No command, project exists? Print help.

### aos init — Existing Project Guard

When `aos init` is run explicitly in a directory that already has an AOS project (detected by `core/agents/` existing), it must refuse:

```
$ aos init

  AOS project already exists in this directory.
  Use "aos init --force" to reinitialize (overwrites existing core configs).
```

The `--force` flag overwrites `core/` with fresh configs from the package. Without `--force`, init exits with code 1. This protects against accidental config loss.

**Config resolution change:** `aos init` currently copies configs from the repo's `core/` directory (found via `getHarnessRoot()`). After npm install, `core/` lives inside the installed package. The `init` command resolves `core/` from `import.meta.dir` (the package's install location) as a fallback when the working directory doesn't contain a `core/` directory.

Resolution order:
1. Working directory `core/` (development — monorepo)
2. Package directory `core/` (production — npm install)

**Note:** `import.meta.dir` is a Bun-specific API that returns the directory of the current module as a string. This is intentional given the Bun-only stance. Do not refactor to `__dirname` (CJS) or `import.meta.url` (Node ESM) — those are Node.js patterns. Future contributors should be aware this is a deliberate Bun dependency, not an oversight.

## Publishing Workflow

### Publish order

1. `@aos-harness/runtime` first (dependency)
2. `aos-harness` second (depends on runtime)

### Commands

```bash
# Dry-run (default — tests, validates, shows what would publish)
bun run scripts/publish.ts

# Publish for real
bun run scripts/publish.ts --confirm
```

### Updated publish script flow

1. Run unit tests (347 tests)
2. Run integration validation
3. Publish `@aos-harness/runtime` with `bun publish --access public`
4. For `aos-harness` (CLI):
   a. Save original `cli/package.json` content
   b. Copy `core/` into `cli/core/` via `copyCore()` from `scripts/copy-core.ts`
   c. Replace `workspace:*` with pinned version in `cli/package.json`
   d. **try:** `bun publish --access public`
   e. **finally:** Restore original `cli/package.json`, call `cleanCore()` to remove `cli/core/`

### Version strategy

Both packages share the same version number. Bump both when releasing. No version matrix.

## Documentation Updates

### README.md (root)

Update Quick Start from "git clone" to:

```markdown
### Prerequisites
- [Bun](https://bun.sh) 1.0+

### Install
bun add -g aos-harness

### Initialize
cd your-project
aos init

### Run
aos run strategic-council --brief brief.md
```

### cli/README.md (new — npm page)

Concise README for npmjs.com:
- One-liner description
- Install command
- Quick start (init, run, list)
- Link to full docs at aos.engineer
- Link to GitHub repo

### docs/getting-started/README.md

Replace "clone the repo" instructions with `bun add -g aos-harness`.

### Astro site getting-started page

Match the updated docs.

## Non-Goals

- **Node.js compatibility** — Bun is a hard requirement. No compilation, no polyfills.
- **Adapter publishing** — Pi, Claude Code, Gemini adapters stay in the repo but are not published to npm. They require platform-specific runtimes.
- **Monorepo restructuring** — The workspace layout stays the same. Only package.json metadata and the publish script change.
- **Bundling** — No esbuild, rollup, or tsup. TypeScript source is the artifact.

## Dependencies

- npm account with access to publish `aos-harness` and `@aos-harness` scope
- Both package names must be available on npm (verify before starting)
