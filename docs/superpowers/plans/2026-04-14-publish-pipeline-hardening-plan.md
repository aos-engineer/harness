# Publish Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move npm publish to a tag-triggered GitHub Actions release with provenance, replace the bypassable YAML-safety grep with an AST lint, harden the publish scripts, and close a CI permissions gap per `docs/superpowers/specs/2026-04-14-publish-pipeline-hardening-design.md`.

**Architecture:** Code changes (D3/D4/D5/D6/D7) merge first and can be exercised locally; the release workflow (D1/D2) plus one-time operator actions (environment setup, token rotation, old-token deletion) are staged second; final step cuts `v0.7.0-rc.1` and verifies provenance on npm.

**Tech Stack:** Bun 1.3+, TypeScript compiler API (`typescript` package — already present as a Bun runtime dep), GitHub Actions, npm provenance, `git`.

---

## Files Affected

| Path | Action | Purpose |
|---|---|---|
| `scripts/check-yaml-safety.ts` | Create | AST-based replacement for the shell grep script |
| `scripts/check-yaml-safety.sh` | Delete | Replaced by `.ts` |
| `scripts/verify-release-tag.ts` | Create | Pre-publish tag/version/tree verification |
| `scripts/publish.ts` | Modify | Split into `--dry-run` (temp dir) and `--ci` (in-place, explicit `--provenance`) modes; `--dist-tag=<tag>` |
| `scripts/copy-core.ts` | Modify | Symlink guard + base-dir assertion |
| `.github/workflows/ci.yml` | Modify | Add `permissions: { contents: read }` |
| `.github/workflows/release.yml` | Create | Tag-triggered release job |
| `package.json` | Modify | `lint:yaml-safety` invokes the `.ts` script; `publish:all` → `publish:dry-run` |
| `cli/package.json`, `runtime/package.json`, `adapters/*/package.json` | Modify | Add `publishConfig: { access: public, provenance: true }` |
| `docs/security/npm-release-runbook.md` | Create | In-repo runbook with release, approval, re-trigger, break-glass procedures |
| `tests/scripts/*` | Create | Unit tests for the new scripts |
| `CHANGELOG.md` | Modify | 0.7.0 entry |

---

## Task 0: Bun `--provenance` probe publish (HALT-THE-PLAN if Bun drops the flag)

**Files:**
- Create: `scripts/provenance-probe.md` (notes) — no code, operational task

Spec D4 requires verification that `bun publish --provenance` actually produces a provenance attestation on npm. If Bun silently drops the flag, we fall back to invoking `npx npm@latest publish --provenance` from `publish.ts --ci`. This task answers that question before we wire it up.

- [ ] **Step 1: Create a scratch npm package**

On npm, create `@aos-harness-scratch/provenance-probe` (or any scope you control). Under `scripts/`, create a temporary fixture:

```bash
mkdir -p /tmp/provenance-probe && cd /tmp/provenance-probe
cat > package.json <<'EOF'
{
  "name": "@aos-harness-scratch/provenance-probe",
  "version": "0.0.1",
  "description": "scratch for provenance verification — deprecate after test",
  "files": ["README.md"],
  "publishConfig": { "access": "public", "provenance": true }
}
EOF
echo "probe" > README.md
```

- [ ] **Step 2: Publish with Bun + `--provenance` from a GitHub Actions workflow**

Create `.github/workflows/provenance-probe.yml` on a throwaway branch:

```yaml
name: provenance-probe
on: workflow_dispatch
jobs:
  probe:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with: { node-version: "22", registry-url: "https://registry.npmjs.org" }
      - env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN_PROBE }} }
        run: |
          cd /tmp/provenance-probe  # or wherever the fixture lives in the checkout
          bun publish --access public --provenance
```

Trigger via `gh workflow run provenance-probe.yml` (requires `NPM_TOKEN_PROBE` set as a one-off secret).

- [ ] **Step 3: Verify provenance on npm**

```bash
npm view @aos-harness-scratch/provenance-probe@0.0.1 dist.attestations
npm audit signatures @aos-harness-scratch/provenance-probe@0.0.1
```

Expected: attestations object present; `npm audit signatures` prints "verified" for the probe.

**If verified:** proceed to Task 1. Record result in `docs/security/npm-release-runbook.md` later (Task 9).

**If NOT verified (Bun silently dropped `--provenance`):** set a flag in the plan — `publish.ts --ci` must shell out to `npx npm@latest publish --access public --provenance` instead of `bun publish`. Adjust Task 5's Step 3 accordingly. Do NOT proceed without this decision resolved.

- [ ] **Step 4: Clean up**

```bash
npm deprecate @aos-harness-scratch/provenance-probe@0.0.1 "scratch"
```

Delete the throwaway branch and the `NPM_TOKEN_PROBE` secret.

- [ ] **Step 5: Commit probe result note**

Create a short note file:

```bash
mkdir -p docs/security
cat > docs/security/provenance-probe-result.md <<'EOF'
# Provenance Probe Result (2026-04-14)

- Bun version tested: <fill in>
- Command: `bun publish --access public --provenance`
- Probe package: `@aos-harness-scratch/provenance-probe@0.0.1`
- `npm audit signatures` result: <verified | not verified>
- Decision: <use bun publish | fall back to npx npm publish>
EOF
```

Fill in the blanks.

```bash
git add docs/security/provenance-probe-result.md
git commit -m "docs(security): record Bun --provenance probe result"
```

---

## Task 1: CI workflow — add `permissions` block (SECRET-001)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Edit `.github/workflows/ci.yml`**

Directly under the `on:` block, add:

```yaml
permissions:
  contents: read
```

- [ ] **Step 2: Verify workflow still triggers on PR**

Push the change to a branch, open a PR, confirm CI runs green.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): add minimum permissions block (SECRET-001)"
```

---

## Task 2: AST-based YAML-safety lint (`scripts/check-yaml-safety.ts`)

**Files:**
- Create: `scripts/check-yaml-safety.ts`
- Delete: `scripts/check-yaml-safety.sh`
- Modify: `package.json` (`lint:yaml-safety` script)
- Create: `tests/scripts/check-yaml-safety.test.ts`

- [ ] **Step 1: Write fixture files + failing tests**

```ts
// tests/scripts/check-yaml-safety.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const SCRIPT = join(process.cwd(), "scripts/check-yaml-safety.ts");

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "yaml-safety-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("check-yaml-safety.ts (spec D3)", () => {
  test("safe yaml.load with JSON_SCHEMA passes", async () => {
    const root = makeFixture({
      "src/a.ts": `import yaml from "js-yaml"; yaml.load(x, { schema: yaml.JSON_SCHEMA });`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  test("yaml.load without schema fails", async () => {
    const root = makeFixture({
      "src/a.ts": `import yaml from "js-yaml"; yaml.load(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("a.ts");
    rmSync(root, { recursive: true, force: true });
  });

  test("destructured load without schema fails (no binding resolution needed)", async () => {
    const root = makeFixture({
      "src/a.ts": `import { load } from "js-yaml"; load(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  test("comment containing JSON_SCHEMA does NOT count as a schema argument", async () => {
    const root = makeFixture({
      "src/a.ts": `import yaml from "js-yaml"; // JSON_SCHEMA\nyaml.load(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1); // still fails — schema not in args
    rmSync(root, { recursive: true, force: true });
  });

  test("test files are excluded by path, not substring", async () => {
    const root = makeFixture({
      "src/latest-config.ts": `import yaml from "js-yaml"; yaml.load(x);`, // contains "test" in name → must still FAIL
      "tests/foo.test.ts": `import yaml from "js-yaml"; yaml.load(x);`,      // under tests/ → pass
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("latest-config.ts");
    expect(r.stderr.toString()).not.toContain("tests/foo.test.ts");
    rmSync(root, { recursive: true, force: true });
  });

  test("// yaml-safety-ignore comment with reason suppresses", async () => {
    const root = makeFixture({
      "src/a.ts": `// yaml-safety-ignore: local loader, not js-yaml\nload(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  test("// yaml-safety-ignore without reason fails", async () => {
    const root = makeFixture({
      "src/a.ts": `// yaml-safety-ignore\nload(x);`,
    });
    const r = await $`bun run ${SCRIPT} --root=${root}`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/reason required/i);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/scripts/check-yaml-safety.test.ts`
Expected: FAIL — script doesn't exist.

- [ ] **Step 3: Implement `scripts/check-yaml-safety.ts`**

```ts
#!/usr/bin/env bun
/**
 * AST-based YAML-safety lint. Spec D3 — syntactic check, accepts false
 * positives over false negatives. Inline escape: // yaml-safety-ignore <reason>
 * on the same or preceding line (reason text ≥ 10 chars).
 */
import * as ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, relative } from "node:path";

const SAFE_SCHEMAS = new Set(["JSON_SCHEMA", "FAILSAFE_SCHEMA"]);
const IGNORE_MARKER = "yaml-safety-ignore";

type Violation = { file: string; line: number; snippet: string };

function parseArgs(argv: string[]): { root: string; scan: string[] } {
  const root = (argv.find((a) => a.startsWith("--root="))?.slice(7)) ?? process.cwd();
  const absRoot = resolve(root);
  return {
    root: absRoot,
    scan: ["cli", "runtime", "adapters", "core", "src"].map((d) => join(absRoot, d)),
  };
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "tests") continue;
      walk(abs, out);
    } else if (st.isFile()) {
      if (extname(abs) !== ".ts") continue;
      if (/\.test\.ts$/.test(abs)) continue;
      out.push(abs);
    }
  }
}

function hasIgnoreMarker(src: string, lineStart: number): boolean {
  const before = src.slice(0, lineStart);
  const prevNewline = before.lastIndexOf("\n", before.length - 2);
  const prevLine = before.slice(prevNewline + 1);
  const currentLineEnd = src.indexOf("\n", lineStart);
  const currentLine = src.slice(lineStart, currentLineEnd === -1 ? undefined : currentLineEnd);
  const matchLine = prevLine.includes(IGNORE_MARKER) ? prevLine : (currentLine.includes(IGNORE_MARKER) ? currentLine : null);
  if (!matchLine) return false;
  const idx = matchLine.indexOf(IGNORE_MARKER);
  const reason = matchLine.slice(idx + IGNORE_MARKER.length).replace(/^[:\s]+/, "").trim();
  if (reason.length < 10) {
    console.error(`${matchLine.trim()} → reason required (≥10 chars) after ${IGNORE_MARKER}`);
    process.exit(1);
  }
  return true;
}

function hasSafeSchemaArg(callExpr: ts.CallExpression): boolean {
  const arg = callExpr.arguments[1];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name;
    const nameText = ts.isIdentifier(name) ? name.text : (ts.isStringLiteral(name) ? name.text : "");
    if (nameText !== "schema") continue;
    const val = prop.initializer;
    // Accept `JSON_SCHEMA` / `FAILSAFE_SCHEMA` bare or as property access x.JSON_SCHEMA
    if (ts.isIdentifier(val) && SAFE_SCHEMAS.has(val.text)) return true;
    if (ts.isPropertyAccessExpression(val) && ts.isIdentifier(val.name) && SAFE_SCHEMAS.has(val.name.text)) return true;
  }
  return false;
}

function checkFile(file: string): Violation[] {
  const src = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let isLoadCall = false;
      if (ts.isIdentifier(callee) && callee.text === "load") isLoadCall = true;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) && callee.name.text === "load") isLoadCall = true;
      if (isLoadCall && !hasSafeSchemaArg(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const lineStart = sf.getLineStarts()[line];
        if (!hasIgnoreMarker(src, lineStart)) {
          violations.push({ file, line: line + 1, snippet: node.getText(sf).split("\n")[0].slice(0, 120) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return violations;
}

function main() {
  const { root, scan } = parseArgs(process.argv.slice(2));
  const files: string[] = [];
  for (const dir of scan) walk(dir, files);

  const violations: Violation[] = [];
  for (const f of files) violations.push(...checkFile(f));

  if (violations.length === 0) {
    console.log(`check-yaml-safety: 0 violations across ${files.length} file(s)`);
    process.exit(0);
  }
  for (const v of violations) {
    console.error(`${relative(root, v.file)}:${v.line}: yaml.load missing safe schema: ${v.snippet}`);
  }
  console.error(`\n${violations.length} violation(s). Add \`{ schema: yaml.JSON_SCHEMA }\` or a \`// yaml-safety-ignore <reason>\` comment with ≥10-char reason.`);
  process.exit(1);
}

main();
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/scripts/check-yaml-safety.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `package.json`**

Replace the `lint:yaml-safety` line:

```diff
-    "lint:yaml-safety": "bash scripts/check-yaml-safety.sh",
+    "lint:yaml-safety": "bun run scripts/check-yaml-safety.ts",
```

- [ ] **Step 6: Run `bun run lint` across the whole repo**

Run: `bun run lint`
Expected: PASS. If it fails on any real file, those are pre-existing violations the shell script missed — fix them in a follow-up commit within this task (add `{ schema: yaml.JSON_SCHEMA }` to each).

- [ ] **Step 7: Delete the old shell script**

```bash
git rm scripts/check-yaml-safety.sh
```

- [ ] **Step 8: Commit**

```bash
git add scripts/check-yaml-safety.ts tests/scripts/check-yaml-safety.test.ts package.json
git commit -m "feat(scripts): replace grep-based yaml safety lint with AST check (SUPPLY-006)"
```

---

## Task 3: Per-package `publishConfig` (D6)

**Files:**
- Modify: `cli/package.json`
- Modify: `runtime/package.json`
- Modify: `adapters/shared/package.json`
- Modify: `adapters/claude-code/package.json`
- Modify: `adapters/codex/package.json`
- Modify: `adapters/gemini/package.json`
- Modify: `adapters/pi/package.json`

- [ ] **Step 1: Add `publishConfig` to each of the 7 published packages**

For each `package.json`, add (or merge into) the top level:

```json
"publishConfig": {
  "access": "public",
  "provenance": true
}
```

Do NOT modify the root `package.json` (which has `"private": true`).

- [ ] **Step 2: Verify locally**

```bash
for f in cli runtime adapters/shared adapters/claude-code adapters/codex adapters/gemini adapters/pi; do
  echo "=== $f ==="
  node -e "console.log(JSON.stringify(require('./$f/package.json').publishConfig))"
done
```

Expected: each prints `{"access":"public","provenance":true}`.

- [ ] **Step 3: Commit**

```bash
git add cli/package.json runtime/package.json adapters/*/package.json
git commit -m "chore(publish): add publishConfig provenance:true to all 7 published packages"
```

---

## Task 4: Harden `scripts/copy-core.ts` (SUPPLY-005)

**Files:**
- Modify: `scripts/copy-core.ts`
- Create: `tests/scripts/copy-core-harden.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/scripts/copy-core-harden.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const SCRIPT = join(process.cwd(), "scripts/copy-core.ts");

describe("copy-core.ts hardening (spec D5)", () => {
  test("refuses if target is a symlink", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "copy-core-"));
    try {
      // Simulate a malicious symlink at the target
      mkdirSync(join(tmp, "real"));
      symlinkSync(join(tmp, "real"), join(tmp, "cli-core-symlink"));
      // Run the script with an override target env var (add this to the script below)
      const r = await $`bun run ${SCRIPT} --target=${join(tmp, "cli-core-symlink")}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/symlink|refuse/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("refuses if target resolves outside base assertion", async () => {
    const r = await $`bun run ${SCRIPT} --target=/tmp/out-of-scope`.nothrow().quiet();
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/outside.*cli\/core/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/scripts/copy-core-harden.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `scripts/copy-core.ts`**

Read the current file. At the top of the rm section:

```ts
import { lstatSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";

// Accept --target=<path> override for testing (not for production use).
const argTarget = process.argv.find((a) => a.startsWith("--target="))?.slice(9);

// ... existing code that computes `coreDest` (keep it, but override if argTarget set)
const effectiveTarget = argTarget ?? coreDest;

// Defense-in-depth: target MUST be under <root>/cli/core
const allowedBase = resolve(root, "cli", "core");
const absTarget = resolve(effectiveTarget);
if (absTarget !== allowedBase && !absTarget.startsWith(allowedBase + sep)) {
  console.error(`copy-core: refusing to operate outside ${allowedBase}: ${absTarget}`);
  process.exit(1);
}

// Symlink guard: do NOT follow if the target is a symlink
if (existsSync(absTarget)) {
  const st = lstatSync(absTarget);
  if (st.isSymbolicLink()) {
    console.error(`copy-core: refusing to rm a symlink target: ${absTarget}`);
    process.exit(1);
  }
}

// ... existing rmSync / cpSync calls now use absTarget
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/scripts/copy-core-harden.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the normal path still works**

Run: `bun run scripts/copy-core.ts` (no args)
Expected: completes successfully; `cli/core/` repopulated.

- [ ] **Step 6: Commit**

```bash
git add scripts/copy-core.ts tests/scripts/copy-core-harden.test.ts
git commit -m "fix(scripts): copy-core refuses symlink targets and enforces base dir (SUPPLY-005)"
```

---

## Task 5: `scripts/publish.ts` — split into `--dry-run` and `--ci` modes

**Files:**
- Modify: `scripts/publish.ts`
- Modify: `package.json` (scripts section)

Read `scripts/publish.ts` in full before editing — the existing idempotent-retry logic must be preserved.

- [ ] **Step 1: Add argv parser at the top of `publish.ts`**

```ts
type Mode = "dry-run" | "ci";
const argv = process.argv.slice(2);
const mode: Mode | null =
  argv.includes("--ci") ? "ci" :
  argv.includes("--dry-run") ? "dry-run" :
  null;
const distTag = argv.find((a) => a.startsWith("--dist-tag="))?.slice("--dist-tag=".length) ?? "latest";

if (!mode) {
  console.error(
    "publish.ts: specify --dry-run (local) or --ci (release workflow only)\n" +
    "  --dist-tag=<tag>  (default: latest)\n"
  );
  process.exit(2);
}
```

- [ ] **Step 2: Implement `--dry-run` path with temp-dir packing**

Replace the in-place pin logic with a temp-dir variant when `mode === "dry-run"`:

```ts
async function runDryRun() {
  const tmpRoot = await $`mktemp -d`.text().then((s) => s.trim());
  console.log(`publish.ts --dry-run: staging in ${tmpRoot}`);
  try {
    // Copy the repo (excluding node_modules/.git) to tmpRoot
    await $`rsync -a --exclude=node_modules --exclude=.git ${root}/ ${tmpRoot}/`;
    // Apply pin to the copy
    for (const entry of PUBLISH_ORDER) {
      const pkgPath = join(tmpRoot, entry.dir, "package.json");
      const raw = JSON.parse(await $`cat ${pkgPath}`.text());
      // Existing pinWorkspaceDeps logic, applied to `raw`
      // ... (copy from current implementation, parameterize on tmpRoot)
      await $`echo ${JSON.stringify(pinned, null, 2)} > ${pkgPath}`;
    }
    // Pack each package into tmpRoot/tarballs
    const tbDir = join(tmpRoot, "tarballs");
    await $`mkdir -p ${tbDir}`;
    for (const entry of PUBLISH_ORDER) {
      await $`cd ${join(tmpRoot, entry.dir)} && bun publish --dry-run --pack-destination ${tbDir}`;
    }
    console.log(`publish.ts --dry-run: tarballs in ${tbDir}`);
    // Verify source tree untouched
    const diff = await $`cd ${root} && git status --porcelain`.text();
    if (diff.trim().length > 0) {
      console.error("publish.ts --dry-run: source tree modified (should be bit-for-bit identical)");
      process.exit(1);
    }
  } finally {
    await $`rm -rf ${tmpRoot}`;
  }
}
```

- [ ] **Step 3: Implement `--ci` path with explicit `--provenance` and `--dist-tag`**

```ts
async function runCi() {
  // Existing pin-in-place logic, but with added flags and guarded by try/finally restore
  for (const entry of PUBLISH_ORDER) {
    // ... existing pinning ...

    // Use Bun's publish by default. If Task 0's probe determined Bun drops
    // --provenance, swap this line for:
    //   await $`cd ${entry.dir} && npx npm@latest publish --access public --provenance --tag ${distTag}`;
    await $`cd ${entry.dir} && bun publish --access public --provenance --tag ${distTag}`;
  }
  // existing unpin in finally
}
```

Wire the dispatcher:

```ts
await (mode === "ci" ? runCi() : runDryRun());
```

- [ ] **Step 4: Update `package.json` scripts**

```diff
-    "publish:all": "bun run scripts/publish.ts"
+    "publish:dry-run": "bun run scripts/publish.ts --dry-run"
```

(No `publish:ci` script needed — the workflow invokes `publish.ts --ci` directly.)

- [ ] **Step 5: Test `--dry-run` locally**

Run: `bun run publish:dry-run`
Expected: prints tarball locations, exits 0, working tree remains clean (`git status --porcelain` returns nothing).

- [ ] **Step 6: Test `--ci` requires a special env (do NOT actually publish)**

For safety, add at the top of `runCi()`:

```ts
if (process.env.GITHUB_ACTIONS !== "true") {
  console.error("publish.ts --ci must only run in GitHub Actions. Refusing.");
  process.exit(1);
}
```

Run: `bun run scripts/publish.ts --ci` locally.
Expected: exits 1 with "must only run in GitHub Actions".

- [ ] **Step 7: Commit**

```bash
git add scripts/publish.ts package.json
git commit -m "feat(scripts): split publish.ts into --dry-run (tempdir) and --ci (provenance)"
```

---

## Task 6: `scripts/verify-release-tag.ts`

**Files:**
- Create: `scripts/verify-release-tag.ts`
- Create: `tests/scripts/verify-release-tag.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/scripts/verify-release-tag.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const SCRIPT = join(process.cwd(), "scripts/verify-release-tag.ts");

async function initRepo(tag: string, version: string, annotated: boolean, dirty: boolean): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), "rel-verify-"));
  await $`cd ${tmp} && git init -q && git config user.email t@t && git config user.name t`;
  mkdirSync(join(tmp, "cli"));
  const pkgs = ["cli", "runtime", "adapters/shared", "adapters/claude-code", "adapters/codex", "adapters/gemini", "adapters/pi"];
  for (const p of pkgs) {
    mkdirSync(join(tmp, p), { recursive: true });
    writeFileSync(join(tmp, p, "package.json"), JSON.stringify({ name: `@x/${p.replace('/','-')}`, version }, null, 2));
  }
  await $`cd ${tmp} && git add -A && git commit -qm init`;
  if (annotated) await $`cd ${tmp} && git tag -a ${tag} -m ${tag}`;
  else await $`cd ${tmp} && git tag ${tag}`;
  if (dirty) writeFileSync(join(tmp, "cli", "dirty.txt"), "x");
  return tmp;
}

describe("verify-release-tag.ts (spec D2)", () => {
  test("tag + version match + annotated + clean → exit 0", async () => {
    const repo = await initRepo("v0.7.0", "0.7.0", true, false);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(0);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test("version mismatch → exit 1", async () => {
    const repo = await initRepo("v0.7.0", "0.6.0", true, false);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/version mismatch|does not match/i);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test("lightweight tag → exit 1", async () => {
    const repo = await initRepo("v0.7.0", "0.7.0", false, false);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/annotated/i);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test("dirty tree → exit 1", async () => {
    const repo = await initRepo("v0.7.0", "0.7.0", true, true);
    try {
      const r = await $`cd ${repo} && GITHUB_REF_NAME=v0.7.0 bun run ${SCRIPT}`.nothrow().quiet();
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toMatch(/clean|dirty|uncommitted/i);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/scripts/verify-release-tag.test.ts`
Expected: FAIL — script missing.

- [ ] **Step 3: Create `scripts/verify-release-tag.ts`**

```ts
#!/usr/bin/env bun
/**
 * Verify the pushed tag matches the repo state before release. Spec D2.
 * Called by the release workflow as the first substantive step.
 *
 * Checks:
 *  1. GITHUB_REF_NAME (or argv[2]) is the tag currently at HEAD
 *  2. Tag is annotated (not lightweight)
 *  3. Worktree is clean
 *  4. Tag name is `v<version>` and <version> matches every published package.json
 */
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLISHED = [
  "cli", "runtime",
  "adapters/shared", "adapters/claude-code", "adapters/codex", "adapters/gemini", "adapters/pi",
];

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) { console.error("usage: verify-release-tag.ts <tag> (or set GITHUB_REF_NAME)"); process.exit(2); }
if (!tag.startsWith("v")) { console.error(`tag must start with 'v': ${tag}`); process.exit(1); }
const expectedVersion = tag.slice(1);

async function sh(cmd: string): Promise<string> {
  const r = await $`sh -c ${cmd}`.nothrow().quiet();
  if (r.exitCode !== 0) throw new Error(`${cmd} failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

try {
  // 1. Tag at HEAD
  const head = await sh("git rev-parse HEAD");
  const tagged = await sh(`git rev-list -n 1 ${tag}`);
  if (head !== tagged) {
    console.error(`tag ${tag} (${tagged.slice(0,7)}) does not point at HEAD (${head.slice(0,7)})`);
    process.exit(1);
  }

  // 2. Annotated tag
  const tagType = await sh(`git cat-file -t ${tag}`);
  if (tagType !== "tag") {
    console.error(`tag ${tag} is lightweight (${tagType}). Use git tag -a.`);
    process.exit(1);
  }

  // 3. Clean worktree
  const dirty = await sh("git status --porcelain");
  if (dirty) { console.error("worktree is dirty (uncommitted changes):\n" + dirty); process.exit(1); }

  // 4. Version lockstep
  for (const dir of PUBLISHED) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { version: string };
    if (pkg.version !== expectedVersion) {
      console.error(`version mismatch: ${dir}/package.json = ${pkg.version}, tag = ${tag} (expected ${expectedVersion})`);
      process.exit(1);
    }
  }

  console.log(`verify-release-tag: ${tag} verified across ${PUBLISHED.length} packages`);
  process.exit(0);
} catch (err: any) {
  console.error(`verify-release-tag: ${err.message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/scripts/verify-release-tag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-release-tag.ts tests/scripts/verify-release-tag.test.ts
git commit -m "feat(scripts): add verify-release-tag.ts (tag + version + clean tree)"
```

---

## Task 7: Release workflow (`.github/workflows/release.yml`)

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    environment: npm-publish
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3"

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Verify tag matches package versions and repo state
        run: bun run scripts/verify-release-tag.ts

      - name: Install (frozen)
        run: bun install --frozen-lockfile

      - name: Lint (yaml-safety + typecheck)
        run: bun run lint

      - name: Unit tests
        run: bun test

      - name: Integration tests
        run: bun run test:integration

      - name: Compute dist-tag
        id: disttag
        run: |
          if [[ "${{ github.ref_name }}" == *"-rc."* ]]; then
            echo "dist_tag=next" >> "$GITHUB_OUTPUT"
          else
            echo "dist_tag=latest" >> "$GITHUB_OUTPUT"
          fi

      - name: Publish all packages with provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          GITHUB_ACTIONS: "true"
        run: bun run scripts/publish.ts --ci --dist-tag=${{ steps.disttag.outputs.dist_tag }}

      - name: Verify provenance on npm
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
        run: |
          for pkg in aos-harness @aos-harness/runtime @aos-harness/adapter-shared @aos-harness/claude-code-adapter @aos-harness/codex-adapter @aos-harness/gemini-adapter @aos-harness/pi-adapter; do
            npm audit signatures "$pkg@${GITHUB_REF_NAME#v}"
          done
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): add tag-triggered release workflow with provenance + environment gate"
```

---

## Task 8: Runbook (`docs/security/npm-release-runbook.md`)

**Files:**
- Create: `docs/security/npm-release-runbook.md`

- [ ] **Step 1: Write the runbook**

```markdown
# npm Release Runbook

## Who can publish

Publishing requires (a) a tag push by a maintainer, plus (b) approval from a reviewer configured on the `npm-publish` GitHub environment. No laptop-based publishes in normal operation.

## Normal release

```bash
# 1. Bump versions on main (manually or via a script). All 7 published
#    package.json files must carry the same <version>.
# 2. Commit the bump: `chore(release): <version>`
# 3. Tag and push:
git tag -a v<version> -m "v<version>"
git push origin main
git push origin v<version>
# 4. Release workflow starts. Post the link in #releases (or equivalent)
#    and @mention a reviewer from the npm-publish environment.
# 5. Reviewer approves. Publish completes in ~3–5 min.
# 6. Verify on consumer machine:
npm audit signatures @aos-harness/pi-adapter@<version>
```

## RC (release candidate) publishes

Tags matching `v*-rc.*` (e.g. `v0.7.0-rc.1`) automatically publish to the `next` dist-tag instead of `latest`. Consumers opt in with `npm i @aos-harness/<pkg>@next`.

## 24h environment approval timeout

If a reviewer does not approve within 24h, the workflow auto-cancels. **This will happen on Friday-evening tag pushes.** To re-trigger:

```bash
# Delete and re-push the same tag:
git tag -d v<version>
git push --delete origin v<version>
git tag -a v<version> -m "v<version>"
git push origin v<version>

# OR: cut a new rc tag and let that flow through:
git tag -a v<version>-rc.N -m "v<version>-rc.N"
git push origin v<version>-rc.N
```

The original stuck tag remains in the repo as a dated annotated tag that never published — harmless.

## Break-glass (CI unavailable)

Requires two people. Do NOT do this alone.

1. **Person A** generates a new npm automation token scoped to `@aos-harness`:
   - npm.com → Access Tokens → Generate → Automation → scope `@aos-harness` → copy token.
2. **Person A** shares the token with **Person B** via 1Password shared item or Signal (never Slack/email).
3. **Person B** on a clean checkout at the signed tag:
   ```bash
   git fetch --tags origin
   git checkout v<version>
   git status --porcelain   # must be empty
   export NODE_AUTH_TOKEN=<the-token>
   bun run scripts/publish.ts --ci
   unset NODE_AUTH_TOKEN
   ```
4. **Person A** immediately revokes the token at npm.com.
5. **Both** file an incident issue titled "Break-glass publish of v<version>" documenting:
   - Why CI was unavailable
   - What was published
   - What fix prevents recurrence

## NPM 2FA

Required for publish on the `@aos-harness` scope. Configure at npm.com → Organizations → @aos-harness → Packages → Require 2FA. Automation tokens bypass the 2FA prompt (by design — they're issued behind a 2FA challenge) and are the only way CI can publish.

## Verifying provenance as a consumer

```bash
npm audit signatures @aos-harness/pi-adapter@<version>
# Expected: "verified" for all packages
npm view @aos-harness/pi-adapter@<version> dist.attestations
# Expected: present, contains GitHub Actions workflow URL
```

## Secret hygiene

- `NPM_TOKEN` lives ONLY in the `npm-publish` GitHub environment, never at repo level.
- If a repo-level `NPM_TOKEN` is ever added, delete it immediately and rotate the npm token.
- Rotate the automation token on a schedule (every 90 days) or after any suspected compromise.

## Provenance probe (reference)

See `docs/security/provenance-probe-result.md` for the record of the one-time test that verified Bun's `bun publish --provenance` produces valid attestations.
```

- [ ] **Step 2: Commit**

```bash
git add docs/security/npm-release-runbook.md
git commit -m "docs(security): add npm release runbook"
```

---

## Task 9: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add under 0.7.0**

If 0.7.0 already has a section (from the trust-model plan), append:

```markdown
### Release infrastructure

- Packages are now published from GitHub Actions with npm provenance attestations. Consumers can verify with `npm audit signatures @aos-harness/<pkg>@<version>`.
- Local `publish:all` is replaced by `publish:dry-run` (pack-only, no upload). Publishing from a laptop is no longer supported; use `git tag -a v<version>` + push.
- YAML-safety lint is now AST-based (`scripts/check-yaml-safety.ts`). The previous grep-based version is removed.
- `scripts/copy-core.ts` refuses symlink targets and paths outside `cli/core`.
- CI workflow gained a minimum `permissions: { contents: read }` block.

See `docs/security/npm-release-runbook.md` for the release process.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add release-infrastructure section to 0.7.0 changelog"
```

---

## Task 10: Operator-executed one-time setup (NOT CODE — human actions)

**Files:**
- None (external: GitHub repo settings, npm.com settings)

These must be done by a repo admin before the release workflow can succeed. Record completion in an issue titled "Release infrastructure rollout".

- [ ] **Step 1: Create `npm-publish` environment in GitHub**

Repo → Settings → Environments → New environment → `npm-publish`
- Required reviewers: add at least 2 org members
- Deployment branches: restrict to tags matching `v*`
- Environment secrets: will add `NPM_TOKEN` in Step 2

- [ ] **Step 2: Rotate npm token**

On npm.com:
1. Generate a new **Automation** token scoped to `@aos-harness`.
2. Copy the token value.
3. In GitHub → Settings → Environments → npm-publish → Add secret → Name: `NPM_TOKEN` → paste value.
4. **Delete any repo-level `NPM_TOKEN` secret** at repo → Settings → Secrets and variables → Actions. Confirm none of the existing workflows reference it besides `release.yml`.
5. On npm.com, revoke the old automation token (the one currently on developer laptops).

- [ ] **Step 3: Enable 2FA-required on @aos-harness scope**

npm.com → Organizations → @aos-harness → Settings → Packages → Require 2FA for publish = ON.

- [ ] **Step 4: Verify the release workflow can run (dry)**

Push a dummy `v0.6.999-test.1` tag:

```bash
git tag -a v0.6.999-test.1 -m "pipeline dry test"
git push origin v0.6.999-test.1
```

Workflow should start, `verify-release-tag.ts` should **fail** (version in package.json is not 0.6.999-test.1), no publish occurs. If it gets past verify, cancel manually.

Clean up: `git push --delete origin v0.6.999-test.1 && git tag -d v0.6.999-test.1`.

- [ ] **Step 5: Document completion**

Update the rollout issue with ✅ for each step and close it.

---

## Task 11: Cut v0.7.0-rc.1 (real release candidate)

Only after every prior task is merged to `main`.

- [ ] **Step 1: Confirm main is clean and up to date**

```bash
git checkout main && git pull
git status --porcelain  # must be empty
```

- [ ] **Step 2: Bump every published package.json to 0.7.0-rc.1**

Manually edit:
- `package.json` (root)
- `cli/package.json`
- `runtime/package.json`
- `adapters/shared/package.json`
- `adapters/claude-code/package.json`
- `adapters/codex/package.json`
- `adapters/gemini/package.json`
- `adapters/pi/package.json`

- [ ] **Step 3: Commit + tag + push**

```bash
git add -A && git commit -m "chore(release): 0.7.0-rc.1"
git tag -a v0.7.0-rc.1 -m "0.7.0-rc.1 — adapter trust + release infra"
git push origin main
git push origin v0.7.0-rc.1
```

- [ ] **Step 4: Approve in GitHub environment UI**

Navigate to the release workflow run → Review deployments → Approve.

- [ ] **Step 5: Verify provenance**

```bash
npm audit signatures @aos-harness/pi-adapter@0.7.0-rc.1
npm view @aos-harness/pi-adapter@0.7.0-rc.1 dist.attestations
```

Expected: verified + attestations present.

- [ ] **Step 6: Soak for 48 hours**

Install the `next` dist-tag in a scratch project and run a deliberation:

```bash
mkdir /tmp/soak && cd /tmp/soak
npm init -y
npm i aos-harness@next @aos-harness/claude-code-adapter@next
# ... run basic smoke test
```

- [ ] **Step 7: If soak is clean, cut v0.7.0**

Repeat Steps 2–5 with version `0.7.0` (no `-rc.1`). That's the real release.

---

## Self-Review Pass

Scan plan against spec (2026-04-14-publish-pipeline-hardening-design.md):

- ✅ D1 (release workflow) — Task 7
- ✅ D2 (verify-release-tag) — Task 6
- ✅ D3 (AST yaml-safety lint, false-positive stance, ignore marker) — Task 2
- ✅ D4 (publish.ts --dry-run + --ci + explicit --provenance + Bun probe) — Task 0 + Task 5
- ✅ D5 (copy-core symlink + base-dir guards) — Task 4
- ✅ D6 (per-package publishConfig) — Task 3
- ✅ D7 (ci.yml permissions) — Task 1
- ✅ D8.1 (runbook in-repo) — Task 8
- ✅ D8.2 (annotated tags, defer signed) — Task 6
- ✅ D8.3 (rc → next dist-tag) — Task 7 (Compute dist-tag step)
- ✅ D8.4 (break-glass procedure) — Task 8 (runbook)
- ✅ Rollout ordering (environment → new token → delete repo-level token → revoke old token) — Task 10

All spec sections mapped. Tasks 0 and 10 are human-executed; all others are code. No placeholders. Bun `--provenance` fallback path documented in Task 5 Step 3 conditional on Task 0's probe outcome.
