#!/usr/bin/env bun
/**
 * Builds the self-contained Claude Code plugin in hosts/claude-code.
 *
 * A marketplace install copies only the plugin directory into Claude Code's cache, so the plugin cannot reach
 * the workspace's node_modules or the repository's packs/. This bundles the hook and MCP entry points (kernel,
 * MCP SDK, ajv, and js-yaml included) into hosts/claude-code/dist and copies the reference pack into
 * hosts/claude-code/pack. Both are committed, because the marketplace installs straight from git.
 *
 * Usage: bun run build:plugin            (writes the files)
 *        bun run build:plugin --check    (exits 1 if the committed files are out of date)
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "hosts/claude-code");
const ENTRIES = { "aos-hook": join(PLUGIN, "bin/aos-hook.ts"), "aos-mcp": join(PLUGIN, "bin/aos-mcp.ts") };
const PACK_SRC = join(ROOT, "packs/feature-delivery");
const check = process.argv.includes("--check");

async function build(outRoot: string): Promise<void> {
  for (const [name, entry] of Object.entries(ENTRIES)) {
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(outRoot, "dist"),
      naming: `${name}.js`,
      target: "bun",
      format: "esm",
      // Whitespace and syntax only: identifiers stay readable, so stack traces in hook-errors.log make sense.
      minify: { whitespace: true, syntax: true, identifiers: false },
      sourcemap: "none",
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error(`bundling ${name} failed`);
    }
  }
  cpSync(PACK_SRC, join(outRoot, "pack"), {
    recursive: true,
    // The pack's own package.json is for the workspace; the plugin only needs the data.
    filter: (src) => !src.endsWith("package.json"),
  });
}

function files(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p), readFileSync(p, "utf8"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

if (check) {
  const tmp = mkdtempSync(join(tmpdir(), "aos-plugin-build-"));
  try {
    await build(tmp);
    const stale: string[] = [];
    for (const part of ["dist", "pack"]) {
      const want = files(join(tmp, part));
      const have = files(join(PLUGIN, part));
      for (const [path, content] of want) if (have.get(path) !== content) stale.push(`${part}/${path}`);
      for (const path of have.keys()) if (!want.has(path)) stale.push(`${part}/${path} (extra)`);
    }
    if (stale.length > 0) {
      console.error(`build:plugin --check: hosts/claude-code is out of date. Run bun run build:plugin and commit.\n  ${stale.join("\n  ")}`);
      process.exit(1);
    }
    console.log("build:plugin --check: hosts/claude-code/dist and pack are up to date");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  rmSync(join(PLUGIN, "dist"), { recursive: true, force: true });
  rmSync(join(PLUGIN, "pack"), { recursive: true, force: true });
  await build(PLUGIN);
  for (const [name] of Object.entries(ENTRIES)) {
    const size = statSync(join(PLUGIN, "dist", `${name}.js`)).size;
    console.log(`built hosts/claude-code/dist/${name}.js (${Math.round(size / 1024)} KiB)`);
  }
  console.log("copied packs/feature-delivery to hosts/claude-code/pack");
}
