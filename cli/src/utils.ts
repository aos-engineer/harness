/**
 * Shared utilities for CLI commands.
 */

import { join, normalize, resolve, sep, dirname } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";


/**
 * Resolve the AOS harness root directory.
 *
 * Resolution order:
 * 1. Walk up from cwd looking for a directory with core/agents/ (user's project)
 * 2. Fall back to the package install location (monorepo dev or npm install)
 *
 * This ensures commands like `aos list` find the user's project configs
 * after `aos init`, not the package's internal directory.
 */
export function getHarnessRoot(): string {
  // 1. Walk up from cwd looking for a project with core/
  let dir = process.cwd();
  const fsRoot = resolve("/");
  while (dir !== fsRoot) {
    if (existsSync(join(dir, "core", "agents"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Fall back to package location (monorepo: cli/ -> root)
  return resolve(import.meta.dir, "../..");
}

/**
 * Discover all directories containing a given YAML file (e.g. agent.yaml)
 * by recursively walking a directory tree.
 */
export function discoverDirs(baseDir: string, yamlFile: string): string[] {
  const results: string[] = [];
  if (!existsSync(baseDir)) return results;

  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const subDir = join(baseDir, entry.name);
    if (existsSync(join(subDir, yamlFile))) {
      results.push(subDir);
    } else {
      results.push(...discoverDirs(subDir, yamlFile));
    }
  }
  return results;
}

/**
 * Convert a name to kebab-case.
 */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Prompt user to select from a list of options (simple numbered list).
 */
export async function promptSelect(label: string, options: string[]): Promise<number> {
  console.log(`\n${label}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}. ${options[i]}`);
  }

  process.stdout.write("\nEnter number: ");

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  if (!value) {
    throw new Error("No input received.");
  }

  const input = new TextDecoder().decode(value).trim();
  const index = parseInt(input, 10) - 1;

  if (isNaN(index) || index < 0 || index >= options.length) {
    throw new Error(`Invalid selection: "${input}". Expected a number between 1 and ${options.length}.`);
  }

  return index;
}

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
/**
 * Resolve an adapter directory on disk. Returns the directory containing
 * `src/index.ts` for the named adapter, or null if none found.
 *
 * Checked in order:
 * 1. Monorepo dev layout: harness-root/adapters/<name>/
 * 2. Installed standalone package: node_modules/@aos-harness/<name>-adapter/
 *    (via import.meta.resolve). Post-0.6.0 this is the primary path —
 *    the CLI no longer bundles adapter source.
 */
function resolvePackageRootFromEntry(pkgName: string, entryRef: string): string | null {
  const pathRef = entryRef.startsWith("file://") ? fileURLToPath(entryRef) : entryRef;
  let dir = resolve(pathRef, "..");
  const fsRoot = resolve("/");

  while (dir !== fsRoot) {
    const pkgJson = join(dir, "package.json");
    if (existsSync(pkgJson)) {
      try {
        const contents = JSON.parse(readFileSync(pkgJson, "utf-8")) as { name?: string };
        if (contents.name === pkgName) {
          return dir;
        }
      } catch {
        // Keep walking up.
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function getGlobalPackageDir(pkgName: string, env: Record<string, string | undefined> = process.env): string | null {
  const searchRoots = [
    env.AOS_BUN_GLOBAL_DIR,
    join(homedir(), ".bun", "install", "global", "node_modules"),
    env.AOS_NPM_GLOBAL_DIR,
    env.npm_config_prefix ? join(env.npm_config_prefix, "lib", "node_modules") : null,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!env.AOS_NPM_GLOBAL_DIR && !env.npm_config_prefix) {
    const npmPrefix = Bun.spawnSync(["npm", "prefix", "-g"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = npmPrefix.stdout.toString().trim();
    if (out) {
      searchRoots.push(join(out, "lib", "node_modules"));
    }
  }

  const seen = new Set<string>();
  for (const root of searchRoots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const candidate = join(root, pkgName);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
  }

  return null;
}

export function getAdapterDir(adapterName: string, env: Record<string, string | undefined> = process.env): string | null {
  // 1. Monorepo dev layout
  const monorepoDir = resolve(import.meta.dir, "../..", "adapters", adapterName);
  if (existsSync(join(monorepoDir, "src", "index.ts"))) {
    return monorepoDir;
  }

  // 2. Installed @aos-harness/<name>-adapter package
  const pkgName = `@aos-harness/${adapterName}-adapter`;
  try {
    const resolver = (import.meta as any).resolve;
    if (typeof resolver === "function") {
      const resolvedDir = resolvePackageRootFromEntry(pkgName, resolver(pkgName));
      if (resolvedDir && existsSync(join(resolvedDir, "src", "index.ts"))) {
        return resolvedDir;
      }
    }
  } catch {
    // Fall through to explicit global package directory detection.
  }

  const globalDir = getGlobalPackageDir(pkgName, env);
  if (globalDir && existsSync(join(globalDir, "src", "index.ts"))) {
    return globalDir;
  }

  return null;
}

export function getPackageCoreDir(): string | null {
  // When installed via npm: src/utils.ts → src/ → package root (1 level up)
  // When in monorepo dev:   cli/src/utils.ts → cli/src → cli → root (2 levels up)
  const candidates = [
    resolve(import.meta.dir, "..", "core"),    // npm install: package-root/core
    resolve(import.meta.dir, "../..", "core"), // monorepo dev: harness-root/core
  ];
  for (const coreDir of candidates) {
    if (existsSync(join(coreDir, "agents"))) {
      return coreDir;
    }
  }
  return null;
}

/**
 * Read the CLI's own version from package.json at runtime. Works both in the
 * monorepo (where import.meta.url → cli/src/utils.ts) and after npm install
 * (where it → node_modules/aos-harness/src/utils.ts). In both cases `..`
 * lands on the package root containing package.json.
 */
export function getCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "package.json"), "utf-8");
    return (JSON.parse(raw) as { version: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Adapters the CLI is permitted to load. Security boundary, not a convenience
 * list: expanding it requires a CLI release because every entry has been
 * reviewed by a CLI maintainer. Spec D2.
 */
export const ADAPTER_ALLOWLIST = ["pi", "claude-code", "codex", "gemini"] as const;
export type AdapterName = typeof ADAPTER_ALLOWLIST[number];

export function isValidAdapter(name: unknown): name is AdapterName {
  return typeof name === "string" && (ADAPTER_ALLOWLIST as readonly string[]).includes(name);
}

/**
 * Resolve `rel` against `base` and require the result stays inside `base`.
 * Throws if `rel` escapes. Use for any path value sourced from config or
 * adapter output (spec D4). Direct CLI args from the user are NOT passed
 * through this — the user trusts themselves.
 */
export function confinedResolve(base: string, rel: string): string {
  const absBase = normalize(resolve(base));
  const absTarget = normalize(resolve(absBase, rel));
  if (absTarget !== absBase && !absTarget.startsWith(absBase + sep)) {
    throw new Error(`Path escapes base directory: ${rel}`);
  }
  return absTarget;
}

/**
 * Validate a platform URL (telemetry endpoint). Rejects non-http(s), plain
 * http to non-loopback hosts, and link-local / metadata-service addresses
 * (169.254.0.0/16). See spec D5 for DNS-rebinding caveat.
 *
 * Bypass: set AOS_ALLOW_INSECURE_PLATFORM_URL=1 for internal testing only.
 */
export function validatePlatformUrl(raw: string): URL {
  if (process.env.AOS_ALLOW_INSECURE_PLATFORM_URL === "1") {
    return new URL(raw); // still throws on parse failure
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`platform.url rejected: unparseable URL "${raw}"`);
  }

  const isLoopbackHost = u.hostname === "localhost" || u.hostname === "127.0.0.1";

  // Link-local / metadata service: 169.254.0.0/16
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(u.hostname)) {
    throw new Error(`platform.url rejected: link-local / metadata address ${u.hostname}`);
  }

  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost)) {
    throw new Error(`platform.url rejected: scheme "${u.protocol.replace(":", "")}" not allowed`);
  }

  return u;
}

/**
 * Parse the `--allow-code-execution[=<val>]` flag (spec D3.2).
 *
 * Semantics (narrow-only — never widens the profile):
 *   undefined         → undefined   (no flag: use profile as-is)
 *   true (bare flag)  → "all"       (no-op vs profile)
 *   "" or "all"       → "all"
 *   "none"            → "none"      (force-deny)
 *   "python,bash"     → ["python", "bash"]  (narrow to set; buildToolPolicy
 *                                             will reject widening attempts)
 */
export function parseAllowCodeExecutionFlag(
  raw: unknown,
): "none" | "all" | string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === true) return "all";
  if (typeof raw !== "string") return undefined;
  if (raw === "none") return "none";
  if (raw === "all" || raw === "") return "all";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
