# npm Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AOS Harness installable via `bun add -g aos-harness` and runnable via `bunx aos-harness init`, with a first-run interactive wizard.

**Architecture:** Bun-only distribution — ship TypeScript source as-is, no build pipeline. CLI package (`aos-harness`) bundles core configs and depends on `@aos-harness/runtime`. Publish script handles core copying, workspace resolution, and try/finally safety.

**Tech Stack:** TypeScript, Bun, npm registry

**Spec:** `docs/specs/2026-04-10-npm-distribution-design.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `scripts/copy-core.ts` | Cross-platform copy/clean of core/ into cli/core/ |
| `cli/.gitignore` | Exclude copied core/ from version control |
| `cli/README.md` | npm package page README |

### Modified Files
| File | Change |
|---|---|
| `cli/src/index.ts` | Add Bun runtime guard, first-run wizard |
| `cli/src/commands/init.ts` | Add existing project guard (`--force`), resolve core from package dir |
| `cli/src/utils.ts` | Add `getPackageCoreDir()` for resolving bundled core/ |
| `cli/package.json` | Rename to `aos-harness`, add engines/files/metadata |
| `runtime/package.json` | Add engines, update files field |
| `scripts/publish.ts` | Add core copy, workspace resolution, try/finally safety |
| `README.md` | Update Quick Start to `bun add -g` |
| `docs/getting-started/README.md` | Update install instructions |

---

## Task 1: Add Bun Runtime Guard to CLI Entry Point

**Files:**
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Add runtime guard after shebang**

Replace lines 1-5 of `cli/src/index.ts`:

```typescript
#!/usr/bin/env bun
/**
 * AOS Harness CLI — entry point.
 * Usage: aos <command> [options]
 */
```

With:

```typescript
#!/usr/bin/env bun
// Runtime guard — must be before any other imports
if (typeof Bun === "undefined") {
  console.error("AOS Harness requires Bun 1.0+. Install at https://bun.sh");
  process.exit(1);
}

/**
 * AOS Harness CLI — entry point.
 * Usage: aos <command> [options]
 */
```

- [ ] **Step 2: Verify it still works**

Run: `cd aos-harness && bun run cli/src/index.ts --help`
Expected: Normal help output (Bun is present, guard passes)

- [ ] **Step 3: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): add Bun runtime guard for npm distribution

Checks for Bun global before any imports. Prints clear install
message if run under Node.js instead of a cryptic TS parse error."
```

---

## Task 2: Add First-Run Wizard

**Files:**
- Modify: `cli/src/index.ts`
- Modify: `cli/src/utils.ts`

- [ ] **Step 1: Add project detection helper to utils.ts**

Append to `cli/src/utils.ts`:

```typescript
/**
 * Detect if the current directory (or ancestors) contains an AOS project.
 * Checks for core/agents/ or .aos/ directory.
 */
export function detectProject(startDir: string): string | null {
  let dir = startDir;
  const root = resolve("/");
  while (dir !== root) {
    if (existsSync(join(dir, "core", "agents")) || existsSync(join(dir, ".aos"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the bundled core/ directory from the installed package.
 * Used when AOS is installed via npm (core/ lives inside the package,
 * not in the working directory).
 *
 * NOTE: import.meta.dir is Bun-specific. Do not refactor to __dirname
 * or import.meta.url — this is a deliberate Bun dependency.
 */
export function getPackageCoreDir(): string | null {
  // cli/src/utils.ts -> cli/src -> cli -> look for core/
  const packageRoot = resolve(import.meta.dir, "../..");
  const coreDir = join(packageRoot, "core");
  if (existsSync(join(coreDir, "agents"))) {
    return coreDir;
  }
  return null;
}
```

- [ ] **Step 2: Add first-run wizard to main() in index.ts**

In `cli/src/index.ts`, replace the `case "":` block (line 83-84):

```typescript
    case "":
      printHelp();
      break;
```

With:

```typescript
    case "": {
      // First-run wizard: detect project, offer to initialize
      const { detectProject } = await import("./utils");
      const projectDir = detectProject(process.cwd());
      if (!projectDir) {
        const pkg = await import("../../package.json");
        console.log(`\n${c.bold("AOS Harness")} ${c.dim(`v${pkg.version}`)}\n`);
        console.log(`  No AOS project detected in this directory.`);
        console.log(`  Would you like to initialize one? ${c.dim("(Y/n)")}\n`);

        process.stdout.write("  > ");
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        reader.releaseLock();
        const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "y";

        if (input === "" || input === "y" || input === "yes") {
          await initCommand({ command: "init", subcommand: "", flags: {}, positional: [] } as ParsedArgs);
        } else {
          printHelp();
        }
      } else {
        printHelp();
      }
      break;
    }
```

- [ ] **Step 3: Verify wizard triggers**

Run from a directory without an AOS project:
```bash
cd /tmp && bun cli/src/index.ts
```
Expected: Shows "No AOS project detected" prompt

- [ ] **Step 4: Verify help shows in AOS project directory**

Run:
```bash
cd aos-harness && bun run cli/src/index.ts
```
Expected: Normal help output (project detected)

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts cli/src/utils.ts
git commit -m "feat(cli): add first-run wizard and project detection

When run without arguments in a non-AOS directory, prompts user
to initialize. In AOS directories, shows normal help."
```

---

## Task 3: Update init Command — Existing Project Guard + Package Core Resolution

**Files:**
- Modify: `cli/src/commands/init.ts`

- [ ] **Step 1: Add --force flag and existing project guard**

Read `cli/src/commands/init.ts`. Replace the existing project check (lines 62-68):

```typescript
  if (existsSync(configPath)) {
    console.log(c.yellow("AOS is already initialized in this project."));
    console.log(c.dim(`  Config: ${configPath}`));
    console.log(c.dim(`  To reinitialize, remove the .aos/ directory first.`));
    return;
  }
```

With:

```typescript
  const force = !!args.flags.force;

  // Check for existing project
  if (existsSync(join(cwd, "core", "agents")) && !force) {
    console.error(c.yellow("AOS project already exists in this directory."));
    console.log(c.dim(`  Use "aos init --force" to reinitialize (overwrites existing core configs).`));
    process.exit(1);
  }

  if (existsSync(configPath) && !force) {
    console.log(c.yellow("AOS is already initialized in this project."));
    console.log(c.dim(`  Config: ${configPath}`));
    console.log(c.dim(`  Use "aos init --force" to reinitialize.`));
    return;
  }
```

- [ ] **Step 2: Add core config copying from package**

After the `.aos` directory creation and config write, add core copying logic. Import at top of file:

```typescript
import { cpSync } from "node:fs";
import { getHarnessRoot, getPackageCoreDir } from "../utils";
```

After the `writeFileSync(configPath, ...)` line, add:

```typescript
  // Copy core configs if not already present (or --force)
  const destCore = join(cwd, "core");
  if (!existsSync(destCore) || force) {
    // Try 1: bundled in package (npm install)
    // Try 2: monorepo root (development)
    const sourceCore = getPackageCoreDir() ?? join(getHarnessRoot(), "core");

    if (existsSync(join(sourceCore, "agents"))) {
      cpSync(sourceCore, destCore, { recursive: true });
      console.log(c.green("  Copied core configs (agents, profiles, domains, workflows, skills)"));
    } else {
      console.log(c.yellow("  Warning: Could not find core configs to copy."));
      console.log(c.dim(`  You may need to manually copy the core/ directory from the AOS Harness repository.`));
    }
  }
```

- [ ] **Step 3: Update HELP text**

Add `--force` to the help text:

```typescript
const HELP = `
${c.bold("aos init")} — Initialize AOS in the current project

${c.bold("USAGE")}
  aos init [--adapter <adapter>] [--force]

${c.bold("OPTIONS")}
  --adapter <name>    Adapter to use: pi (default), claude-code, gemini
  --force             Reinitialize even if project already exists

${c.bold("DESCRIPTION")}
  Creates an .aos/ configuration directory and copies core configs
  (agents, profiles, domains) into the current project.

${c.bold("EXAMPLES")}
  aos init
  aos init --adapter pi
  aos init --force
`;
```

- [ ] **Step 4: Verify init works**

Run:
```bash
cd /tmp && mkdir test-init && cd test-init && bun cli/src/index.ts init
```
Expected: Creates `.aos/` and copies `core/`

Run again without --force:
```bash
bun cli/src/index.ts init
```
Expected: "AOS project already exists" error

Run with --force:
```bash
bun cli/src/index.ts init --force
```
Expected: Reinitializes successfully

Clean up:
```bash
cd /tmp && rm -rf test-init
```

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/init.ts
git commit -m "feat(cli): add --force flag and core config copying to init

Refuses to init over existing project without --force. Copies
bundled core configs (agents, profiles, domains) into project.
Resolves core from package dir (npm) or monorepo root (dev)."
```

---

## Task 4: Create Cross-Platform Copy Script

**Files:**
- Create: `scripts/copy-core.ts`

- [ ] **Step 1: Create the script**

```typescript
#!/usr/bin/env bun
/**
 * Cross-platform copy/clean utilities for bundling core/ into cli/
 * before npm publish. Uses Node.js fs APIs (supported by Bun) instead
 * of shell commands for Windows compatibility.
 */

import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const src = resolve(root, "core");
const dest = resolve(root, "cli", "core");

export function copyCore(): void {
  if (!existsSync(src)) {
    throw new Error(`Source core/ not found at ${src}`);
  }
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  cpSync(src, dest, { recursive: true });
  console.log(`  Copied core/ → cli/core/`);
}

export function cleanCore(): void {
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
    console.log(`  Cleaned cli/core/`);
  }
}

// Allow running directly: bun run scripts/copy-core.ts [copy|clean]
if (import.meta.main) {
  const action = process.argv[2] ?? "copy";
  if (action === "copy") copyCore();
  else if (action === "clean") cleanCore();
  else console.error(`Unknown action: ${action}. Use "copy" or "clean".`);
}
```

- [ ] **Step 2: Verify it works**

Run:
```bash
cd aos-harness && bun run scripts/copy-core.ts copy
ls cli/core/agents/ | head -3
bun run scripts/copy-core.ts clean
ls cli/core/ 2>/dev/null || echo "cleaned"
```
Expected: Copies core, lists agents, then cleans

- [ ] **Step 3: Commit**

```bash
git add scripts/copy-core.ts
git commit -m "feat(scripts): add cross-platform copy-core utility

Uses fs.cpSync/rmSync for Windows compatibility. Replaces shell
cp -r in publish pipeline."
```

---

## Task 5: Create cli/.gitignore

**Files:**
- Create: `cli/.gitignore`

- [ ] **Step 1: Create the file**

```
# Bundled core configs (copied during publish, not committed)
core/
```

- [ ] **Step 2: Commit**

```bash
git add cli/.gitignore
git commit -m "chore: add cli/.gitignore to exclude bundled core/"
```

---

## Task 6: Update Package.json Files

**Files:**
- Modify: `cli/package.json`
- Modify: `runtime/package.json`

- [ ] **Step 1: Update cli/package.json**

Replace the full content of `cli/package.json` with:

```json
{
  "name": "aos-harness",
  "version": "0.1.0",
  "description": "Agentic Orchestration System — assemble AI agents into deliberation and execution teams",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git"
  },
  "homepage": "https://aos.engineer",
  "keywords": [
    "ai",
    "agents",
    "orchestration",
    "multi-agent",
    "deliberation",
    "execution",
    "llm",
    "bun"
  ],
  "type": "module",
  "bin": {
    "aos": "./src/index.ts"
  },
  "engines": {
    "bun": ">=1.0.0"
  },
  "files": [
    "src/",
    "core/",
    "README.md"
  ],
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun run src/index.ts validate"
  },
  "dependencies": {
    "@aos-harness/runtime": "workspace:*",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.4.0"
  }
}
```

Note: `dependencies` keeps `workspace:*` for development. The publish script replaces it with pinned version before publishing.

- [ ] **Step 2: Update runtime/package.json**

Add `engines` and update `files` field. The full file becomes:

```json
{
  "name": "@aos-harness/runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "src/engine.ts",
  "engines": {
    "bun": ">=1.0.0"
  },
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "bun x tsc --noEmit"
  },
  "exports": {
    ".": "./src/engine.ts",
    "./config-loader": "./src/config-loader.ts",
    "./types": "./src/types.ts",
    "./constraint-engine": "./src/constraint-engine.ts",
    "./delegation-router": "./src/delegation-router.ts",
    "./domain-merger": "./src/domain-merger.ts",
    "./template-resolver": "./src/template-resolver.ts",
    "./workflow-runner": "./src/workflow-runner.ts",
    "./artifact-manager": "./src/artifact-manager.ts",
    "./output-renderer": "./src/output-renderer.ts",
    "./domain-enforcer": "./src/domain-enforcer.ts",
    "./child-agent-manager": "./src/child-agent-manager.ts",
    "./expertise-manager": "./src/expertise-manager.ts",
    "./event-summarizer": "./src/event-summarizer.ts",
    "./session-checkpoint": "./src/session-checkpoint.ts"
  },
  "files": [
    "src/",
    "README.md"
  ],
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 3: Update root package.json workspace reference**

The root `package.json` has `"bin": { "aos": "./cli/src/index.ts" }`. Since the CLI package name changed from `@aos-harness/cli` to `aos-harness`, verify the workspace still resolves. Check that `"workspaces": ["runtime", "cli", "adapters/*"]` still works (it uses directory names, not package names, so this is fine).

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `cd aos-harness && bun test`
Expected: All 347 tests pass

- [ ] **Step 5: Commit**

```bash
git add cli/package.json runtime/package.json
git commit -m "feat: update package.json for npm distribution

CLI renamed to aos-harness (unscoped). Both packages get engines.bun
constraint. Runtime files field updated to exclude tests/fixtures."
```

---

## Task 7: Update Publish Script

**Files:**
- Modify: `scripts/publish.ts`

- [ ] **Step 1: Rewrite the publish script**

Replace the full content of `scripts/publish.ts` with:

```typescript
#!/usr/bin/env bun
/**
 * AOS Harness — Monorepo Publish Script
 *
 * Publishes @aos-harness/runtime and aos-harness (CLI) to npm.
 * Handles core/ bundling and workspace:* resolution with try/finally safety.
 *
 * Dry-run by default. Pass --confirm to actually publish.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { copyCore, cleanCore } from "./copy-core";

const root = resolve(import.meta.dir, "..");
const confirm = process.argv.includes("--confirm");

function readPkg(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

function readPkgRaw(dir: string): string {
  return readFileSync(resolve(root, dir, "package.json"), "utf-8");
}

function writePkg(dir: string, content: string): void {
  writeFileSync(resolve(root, dir, "package.json"), content, "utf-8");
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

  // 3. Read package versions
  const runtimePkg = readPkg("runtime");
  const cliPkg = readPkg("cli");
  if (!runtimePkg || !cliPkg) {
    console.error("✗ Could not read package.json for runtime or cli");
    process.exit(1);
  }

  const runtimeVersion = runtimePkg.version as string;
  const cliVersion = cliPkg.version as string;
  console.log(`▸ Packages to publish:\n`);
  console.log(`  ${runtimePkg.name}@${runtimeVersion}  (runtime/)`);
  console.log(`  ${cliPkg.name}@${cliVersion}  (cli/)\n`);

  if (runtimeVersion !== cliVersion) {
    console.error(`✗ Version mismatch: runtime=${runtimeVersion}, cli=${cliVersion}`);
    process.exit(1);
  }

  // 4. Publish runtime first
  const runtimeCwd = resolve(root, "runtime");
  if (!confirm) {
    console.log(`  [dry-run] bun publish --dry-run  (${runtimePkg.name})`);
    const result = await $`bun publish --dry-run`.cwd(runtimeCwd).quiet().nothrow();
    if (result.exitCode !== 0) {
      console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
    } else {
      console.log(`    ✓ would publish ${runtimePkg.name}@${runtimeVersion}`);
    }
  } else {
    console.log(`  Publishing ${runtimePkg.name}@${runtimeVersion}...`);
    const result = await $`bun publish --access public`.cwd(runtimeCwd).nothrow();
    if (result.exitCode !== 0) {
      console.error(`  ✗ Failed to publish ${runtimePkg.name}`);
      process.exit(1);
    }
    console.log(`  ✓ Published ${runtimePkg.name}@${runtimeVersion}\n`);
  }

  // 5. Publish CLI with core bundling and workspace resolution
  const cliCwd = resolve(root, "cli");
  const originalPkgJson = readPkgRaw("cli");

  try {
    // Copy core/ into cli/core/
    console.log("  Bundling core configs...");
    copyCore();

    // Replace workspace:* with pinned version
    const resolved = originalPkgJson.replace(
      `"@aos-harness/runtime": "workspace:*"`,
      `"@aos-harness/runtime": "${runtimeVersion}"`,
    );
    writePkg("cli", resolved);
    console.log(`  Pinned @aos-harness/runtime to ${runtimeVersion}`);

    if (!confirm) {
      console.log(`  [dry-run] bun publish --dry-run  (${cliPkg.name})`);
      const result = await $`bun publish --dry-run`.cwd(cliCwd).quiet().nothrow();
      if (result.exitCode !== 0) {
        console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
      } else {
        console.log(`    ✓ would publish ${cliPkg.name}@${cliVersion}`);
      }
    } else {
      console.log(`  Publishing ${cliPkg.name}@${cliVersion}...`);
      const result = await $`bun publish --access public`.cwd(cliCwd).nothrow();
      if (result.exitCode !== 0) {
        console.error(`  ✗ Failed to publish ${cliPkg.name}`);
        // Don't exit — finally block must run
        throw new Error(`Publish failed for ${cliPkg.name}`);
      }
      console.log(`  ✓ Published ${cliPkg.name}@${cliVersion}`);
    }
  } finally {
    // Always restore original package.json and clean core/
    writePkg("cli", originalPkgJson);
    console.log("  Restored cli/package.json");
    cleanCore();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Test dry-run**

Run: `cd aos-harness && bun run scripts/publish.ts`
Expected: Tests pass, shows "would publish" for both packages, copies and cleans core/

- [ ] **Step 3: Verify cli/package.json is restored after dry-run**

Run: `grep 'workspace' cli/package.json`
Expected: Shows `"@aos-harness/runtime": "workspace:*"` (restored)

Run: `ls cli/core/ 2>/dev/null || echo "cleaned"`
Expected: "cleaned"

- [ ] **Step 4: Commit**

```bash
git add scripts/publish.ts
git commit -m "feat(scripts): rewrite publish script with try/finally safety

Publishes runtime first, then CLI with core bundling and workspace
resolution. Always restores cli/package.json and cleans cli/core/
even if publish fails mid-way."
```

---

## Task 8: Create CLI README for npm Page

**Files:**
- Create: `cli/README.md`

- [ ] **Step 1: Write the npm page README**

```markdown
# aos-harness

**Agentic Orchestration System** — Assemble specialized AI agents into deliberation and execution teams.

## Prerequisites

- [Bun](https://bun.sh) 1.0+

## Install

```bash
bun add -g aos-harness
```

Or run directly:

```bash
bunx aos-harness init
```

## Quick Start

```bash
# Initialize a project
aos init

# Run a strategic deliberation
aos run strategic-council --brief brief.md

# Run a CTO execution workflow
aos run cto-execution --brief feature-brief.md --domain saas

# List available agents, profiles, and domains
aos list

# Create custom configs
aos create agent my-analyst
aos create profile my-review

# Validate all configurations
aos validate
```

## What It Does

AOS Harness orchestrates multiple AI agents with distinct cognitive biases into structured deliberation and execution sessions:

- **Deliberation** — Agents debate a strategic question. An Arbiter synthesizes ranked recommendations with documented dissent.
- **Execution** — A CTO orchestrator delegates production work through multi-phase workflows with review gates.

Ships with 13 agent personas, 6 orchestration profiles, 5 domain packs, and full constraint management (time, budget, rounds).

## Documentation

- [Full documentation](https://aos.engineer/docs/getting-started)
- [GitHub repository](https://github.com/aos-engineer/aos-harness)

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add cli/README.md
git commit -m "docs: add CLI README for npm package page"
```

---

## Task 9: Update Documentation — Install Instructions

**Files:**
- Modify: `README.md`
- Modify: `docs/getting-started/README.md`

- [ ] **Step 1: Update root README Quick Start**

In `README.md`, find the Quick Start / Install section. Replace the `git clone` instructions with:

```markdown
### Prerequisites

- [Bun](https://bun.sh) 1.0+

### Install

```bash
bun add -g aos-harness
```

### Initialize a project

```bash
cd your-project
aos init
```
```

Keep the rest of the Quick Start (Run a deliberation, Run an execution, CLI commands) as-is — just update any `cd aos-harness` references.

- [ ] **Step 2: Update getting-started docs**

In `docs/getting-started/README.md`, find the install/prerequisites section. Update to reference `bun add -g aos-harness` instead of `git clone`. Keep the rest of the guide intact.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/getting-started/README.md
git commit -m "docs: update install instructions to bun add -g aos-harness"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd aos-harness && bun test`
Expected: All 347 tests pass

- [ ] **Step 2: Run publish dry-run**

Run: `bun run scripts/publish.ts`
Expected: Tests pass, dry-run succeeds for both packages, cli/package.json restored, cli/core/ cleaned

- [ ] **Step 3: Verify CLI works end-to-end**

```bash
# From the project directory (should show help)
bun run cli/src/index.ts

# From a clean directory (should show wizard)
cd /tmp && mkdir npm-test && cd npm-test
bun cli/src/index.ts
# Answer N to skip init, verify prompt appears

# Clean up
cd /tmp && rm -rf npm-test
```

- [ ] **Step 4: Verify git status**

Run: `git status`
Expected: Clean working tree
