#!/usr/bin/env bun
/**
 * Builds the publishable `aos-harness` npm package into <out>/aos-harness.
 *
 * The workspace CLI imports @aos-harness/kernel from source, and that package is not published, so the npm
 * package is a bundle instead: the CLI with the kernel and its dependencies inlined, the reference pack next to
 * it (where the CLI looks for it), the README, and a manifest with no runtime dependencies.
 *
 * Usage: bun run scripts/release/pack-cli.ts <out-dir>
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const outArg = process.argv[2];
if (!outArg) {
  console.error("usage: pack-cli.ts <out-dir>");
  process.exit(2);
}
const out = join(resolve(outArg), "aos-harness");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, "cli/src/index.ts")],
  outdir: join(out, "dist"),
  naming: "aos.js",
  target: "bun",
  format: "esm",
  minify: { whitespace: true, syntax: true, identifiers: false },
  sourcemap: "none",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

cpSync(join(ROOT, "packs/feature-delivery"), join(out, "pack"), { recursive: true, filter: (src) => !src.endsWith("package.json") });
cpSync(join(ROOT, "cli/README.md"), join(out, "README.md"));
cpSync(join(ROOT, "LICENSE"), join(out, "LICENSE"));

const workspace = JSON.parse(readFileSync(join(ROOT, "cli/package.json"), "utf8")) as Record<string, unknown>;
const manifest = {
  name: workspace.name,
  version: workspace.version,
  description: workspace.description,
  license: workspace.license,
  repository: workspace.repository,
  homepage: workspace.homepage,
  type: "module",
  bin: { aos: "./dist/aos.js" },
  engines: workspace.engines,
  files: ["dist/", "pack/", "README.md", "LICENSE"],
  keywords: ["ai", "agents", "claude-code", "governance", "gates", "mcp"],
};
writeFileSync(join(out, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`packed ${manifest.name}@${manifest.version} into ${out}`);
