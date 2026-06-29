#!/usr/bin/env bun
/**
 * AOS Harness — Monorepo Publish Script
 *
 * Two explicit modes (per Publish Pipeline Hardening spec D4):
 *
 *   --dry-run   Local verification. Copies the repo into a tempdir (via
 *               rsync, excluding node_modules / .git), pins workspace deps
 *               in the copy, then runs `bun publish --dry-run` for each
 *               package. The source tree is never mutated; this script
 *               asserts `git status --porcelain` is empty at the end.
 *
 *   --ci        Release workflow only. Refuses to run unless
 *               GITHUB_ACTIONS=true. Pins in place (preserving the
 *               existing try/finally restore), publishes each package with
 *               `--access public --tag=<distTag>` via the npm CLI, and
 *               preserves the idempotent-retry behaviour where an
 *               "already exists" error causes the package to be skipped.
 *               Note: --provenance is not passed by default. Add it (and
 *               `id-token: write` in release.yml) to emit SLSA build
 *               provenance when publishing from a public repo.
 *
 * Flags:
 *   --dry-run
 *   --ci
 *   --dist-tag=<tag>   (default: latest; applies to --ci)
 *
 * If no mode flag is passed, prints usage and exits 2.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { copyCore, cleanCore, copyCoreTo } from "./copy-core";

const root = resolve(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------
type Mode = "dry-run" | "ci";
const argv = process.argv.slice(2);
const mode: Mode | null =
  argv.includes("--ci") ? "ci" :
  argv.includes("--dry-run") ? "dry-run" :
  null;
const distTag =
  argv.find((a) => a.startsWith("--dist-tag="))?.slice("--dist-tag=".length) ??
  "latest";

if (!mode) {
  console.error(
    "publish.ts: specify --dry-run (local) or --ci (release workflow only)\n" +
    "  --dist-tag=<tag>  (default: latest)\n"
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Shared definitions
// ---------------------------------------------------------------------------
type PublishEntry = {
  dir: string;
  name: string;
  pinDeps: string[];
  postPublish?: () => void;
  prePublish?: () => void;
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

function readPkgAt(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readPkgRawAt(path: string): string {
  return readFileSync(path, "utf-8");
}

function writePkgAt(path: string, content: string): void {
  writeFileSync(path, content, "utf-8");
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
  const s = stderr.toLowerCase();
  return (
    s.includes("already exists") ||
    s.includes("cannot publish over") ||
    s.includes("you cannot publish over the previously published versions") ||
    (s.includes("403") && s.includes("previously published"))
  );
}

function computePinMap(baseDir: string): { releaseVersion: string; pinMap: Record<string, string> } {
  const versions = new Map<string, string>();
  for (const entry of PUBLISH_ORDER) {
    const pkg = readPkgAt(resolve(baseDir, entry.dir, "package.json"));
    versions.set(entry.name, pkg.version as string);
  }
  const releaseVersion = versions.get("@aos-harness/runtime")!;
  const mismatches = [...versions.entries()].filter(([, v]) => v !== releaseVersion);
  if (mismatches.length > 0) {
    console.error(`✗ Lockstep violation: expected all packages at ${releaseVersion}`);
    for (const [name, v] of mismatches) console.error(`  ${name}@${v}`);
    process.exit(1);
  }
  return {
    releaseVersion,
    pinMap: {
      "@aos-harness/runtime": releaseVersion,
      "@aos-harness/adapter-shared": releaseVersion,
    },
  };
}

async function runPrereleaseChecks(): Promise<void> {
  console.log("▸ Running unit tests...");
  const testResult = await $`bun test --cwd ${resolve(root, "runtime")}`.quiet().nothrow();
  if (testResult.exitCode !== 0) {
    console.error("✗ Unit tests failed:\n", testResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Unit tests passed\n");

  console.log("▸ Running integration validation...");
  const integrationScript = resolve(root, "tests/integration/validate-config.ts");
  const intResult = await $`bun run ${integrationScript}`.quiet().nothrow();
  if (intResult.exitCode !== 0) {
    console.error("✗ Integration validation failed:\n", intResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Integration validation passed\n");
}

// ---------------------------------------------------------------------------
// --dry-run mode: tempdir-based, source tree must remain bit-identical
// ---------------------------------------------------------------------------
async function runDryRun(): Promise<void> {
  console.log("=== AOS Harness Publish (--dry-run) ===\n");

  await runPrereleaseChecks();

  const { releaseVersion, pinMap } = computePinMap(root);
  console.log(`▸ Release version: ${releaseVersion}\n`);

  const tmpRoot = (await $`mktemp -d`.text()).trim();
  console.log(`publish.ts --dry-run: staging in ${tmpRoot}`);

  try {
    // Copy the repo (excluding node_modules / .git) to tmpRoot. Trailing
    // slashes on rsync args are significant: `${root}/` copies the contents
    // of root into tmpRoot (rather than creating a nested dir).
    await $`rsync -a --exclude=node_modules --exclude=.git ${root}/ ${tmpRoot}/`;

    // Apply workspace-dep pinning to the COPY's package.json files.
    for (const entry of PUBLISH_ORDER) {
      if (entry.pinDeps.length === 0) continue;
      const pkgPath = join(tmpRoot, entry.dir, "package.json");
      const raw = readPkgRawAt(pkgPath);
      const pinned = pinWorkspaceDeps(raw, pinMap);
      writePkgAt(pkgPath, pinned);
    }

    // Pack each package into tmpRoot/tarballs using bun pm pack.
    //
    // NOTE: Bun's `bun publish --dry-run` does NOT support a
    // --pack-destination flag (verified on bun 1.3.11), so we use
    // `bun pm pack --destination` for the tarball artifact. We still run
    // `bun publish --dry-run` afterwards so the publish-side preflight
    // (manifest lint, file set, registry auth probe) is exercised.
    const tbDir = join(tmpRoot, "tarballs");
    await $`mkdir -p ${tbDir}`;

    console.log("\n▸ Packing + dry-run publishing each package:\n");
    for (const entry of PUBLISH_ORDER) {
      const cwd = join(tmpRoot, entry.dir);
      const pkg = readPkgAt(join(cwd, "package.json"));
      const label = `${entry.name}@${pkg.version as string}`;

      // cli/ has a prePublish hook (copyCore) — but that would mutate
      // SOURCE cli/core/, violating the "source tree untouched" invariant.
      // Instead, copy the filtered core payload into the tempdir cli/ so
      // dry-run tarballs match the real published package contents.
      if (entry.dir === "cli") {
        copyCoreTo(join(cwd, "core"));
      }

      const packResult = await $`bun pm pack --destination ${tbDir} --quiet`.cwd(cwd).nothrow();
      if (packResult.exitCode !== 0) {
        console.error(`  ✗ pack failed for ${label}\n${packResult.stderr.toString()}`);
        process.exit(1);
      }

      const pubResult = await $`bun publish --dry-run`.cwd(cwd).quiet().nothrow();
      if (pubResult.exitCode !== 0) {
        console.log(`    ⚠ dry-run issue for ${label}: ${pubResult.stderr.toString().trim()}`);
      } else {
        console.log(`    ✓ would publish ${label}`);
      }
    }

    // Count tarballs for report clarity.
    const tarballList = (await $`ls ${tbDir}`.text()).trim().split(/\n+/).filter(Boolean);
    console.log(`\npublish.ts --dry-run: ${tarballList.length} tarball(s) in ${tbDir}`);

    // Verify the SOURCE tree is bit-for-bit identical to what git knows.
    const diff = (await $`git -C ${root} status --porcelain`.text()).trim();
    if (diff.length > 0) {
      console.error("publish.ts --dry-run: source tree modified (should be bit-for-bit identical)");
      console.error(diff);
      process.exit(1);
    }

    console.log("publish.ts --dry-run: source tree clean ✓");
  } finally {
    await $`rm -rf ${tmpRoot}`.nothrow();
  }
}

// ---------------------------------------------------------------------------
// --ci mode: in-place pin + real publish via `npm publish --access public
// --tag=<distTag>`. No --provenance (private-source repo; see header doc).
// ---------------------------------------------------------------------------
async function runCi(): Promise<void> {
  // NEVER add a force flag — CI-only is a security property, not a convenience.
  if (process.env.GITHUB_ACTIONS !== "true") {
    console.error("publish.ts --ci must only run in GitHub Actions. Refusing.");
    process.exit(1);
  }

  console.log(`=== AOS Harness Publish (--ci, --tag=${distTag}) ===\n`);

  await runPrereleaseChecks();

  const { releaseVersion, pinMap } = computePinMap(root);
  console.log(`▸ Release version: ${releaseVersion}\n`);

  console.log("▸ Packages to publish:\n");
  for (const entry of PUBLISH_ORDER) {
    console.log(`  ${entry.name}@${releaseVersion}  (${entry.dir}/)`);
  }
  console.log();

  for (const entry of PUBLISH_ORDER) {
    const cwd = resolve(root, entry.dir);
    const pkgPath = resolve(cwd, "package.json");
    const originalRaw = readPkgRawAt(pkgPath);
    const label = `${entry.name}@${releaseVersion}`;

    try {
      if (entry.prePublish) entry.prePublish();

      if (entry.pinDeps.length > 0) {
        writePkgAt(pkgPath, pinWorkspaceDeps(originalRaw, pinMap));
      }

      console.log(`  Publishing ${label}...`);
      // We publish via the npm CLI (not `bun publish`) because Bun 1.3.12
      // does NOT expand `${NODE_AUTH_TOKEN}` in the .npmrc written by
      // actions/setup-node and errors with "missing authentication" in CI.
      // Task 0 probe (2026-04-14, GitHub Actions run 24408969472) confirmed.
      //
      // --provenance is not passed here by default. Add it (and the
      // `id-token: write` permission in release.yml) to emit SLSA build
      // provenance when publishing from a public repo.
      const result = await $`npx --yes npm@latest publish --access public --tag=${distTag}`
        .cwd(cwd)
        .nothrow();

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
    } finally {
      writePkgAt(pkgPath, originalRaw);
      if (entry.postPublish) entry.postPublish();
    }
  }

  console.log("\nDone.");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
await (mode === "ci" ? runCi() : runDryRun()).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
