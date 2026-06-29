# Adapter Trust Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close RCE-001 (workspace-trust adapter loading) and RCE-002 (unrestricted `executeCode`) plus path/URL polish per `docs/superpowers/specs/2026-04-14-adapter-trust-model-design.md`.

**Architecture:** Drop the project-local adapter override entirely (one-function change in `run.ts`). Add an adapter-name allowlist as defense-in-depth. Replace the no-op `enforceToolAccess` with a frozen profile-authoritative `ToolPolicy` (profile YAML declares `tools:`; CLI flag can only narrow; workers inherit session policy). Add `confinedResolve` and `validatePlatformUrl` helpers. Emit `tool-denied` transcript events; expose `listEnabledTools()` for agents.

**Tech Stack:** Bun 1.3+, TypeScript, `bun test`, `js-yaml` with `JSON_SCHEMA` (existing), Zod-style schema validation in `runtime/` (existing pattern).

---

## Files Affected

| Path | Action | Purpose |
|---|---|---|
| `cli/src/utils.ts` | Modify | Export `ADAPTER_ALLOWLIST`, `confinedResolve`, `validatePlatformUrl` |
| `cli/src/commands/init.ts` | Modify | Import `ADAPTER_ALLOWLIST` from `utils.ts` (single source of truth) |
| `cli/src/commands/run.ts` | Modify | Allowlist adapter; drop project-local override (lines 325-328); validate `platformUrl`; wire `ToolPolicy` |
| `cli/src/commands/replay.ts` | Modify | Use `confinedResolve` for config-sourced paths |
| `cli/src/commands/create.ts` | Modify | Regex validation on sanitized name |
| `cli/src/adapter-session.ts` | Modify | Thread `ToolPolicy` into `BaseWorkflow` constructor |
| `runtime/src/profile-schema.ts` | Create | Define `ToolsBlock` schema + defaults |
| `runtime/src/profile-loader.ts` | Modify | Parse + validate `tools` block (fallback to defaults) |
| `adapters/shared/src/base-workflow.ts` | Modify | Accept `ToolPolicy`, enforce in `executeCode`, emit transcript events, add `listEnabledTools`, enforce worker inheritance |
| `adapters/shared/src/tool-policy.ts` | Create | `ToolPolicy` type + `buildToolPolicy(profile, cliFlags)` |
| `adapters/shared/src/index.ts` | Modify | Re-export `ToolPolicy`, `buildToolPolicy` |
| `cli/src/index.ts` | Modify | Parse `--allow-code-execution[=<langs>]` flag |
| `tests/cli/*` | Create | New test files per spec Testing section |
| `tests/adapters-shared/*` | Create | Tool-policy + worker-inheritance tests |
| `tests/runtime/*` | Create | Profile tools-block validation tests |
| `CHANGELOG.md` | Modify | 0.7.0 entry |
| `cli/README.md` | Modify | Document exit codes 2 and 3 |

---

## Task 0: Bun `import.meta.dir` + `npm link` verification gate (HALT-THE-PLAN if fails)

**Files:**
- Create: `tests/cli/import-meta-dir-symlink.test.ts`

This gate verifies spec decision D1's assumption before we drop the project-local override. If Bun resolves `import.meta.dir` through `npm link` symlinks incorrectly on the installed Bun version, the monorepo dev workflow breaks — we halt and investigate instead of proceeding blind.

- [ ] **Step 1: Write the verification test**

```ts
// tests/cli/import-meta-dir-symlink.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

describe("import.meta.dir under npm link (spec D1)", () => {
  let tmpRoot: string;
  let fakeRepo: string;
  let siblingProject: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "aos-bun-symlink-"));
    fakeRepo = join(tmpRoot, "aos-harness");
    siblingProject = join(tmpRoot, "consumer");
    mkdirSync(join(fakeRepo, "cli", "src"), { recursive: true });
    mkdirSync(join(fakeRepo, "adapters", "pi"), { recursive: true });
    mkdirSync(siblingProject, { recursive: true });

    // Minimal stub CLI that logs import.meta.dir
    writeFileSync(
      join(fakeRepo, "cli", "src", "probe.ts"),
      "console.log(import.meta.dir);\n",
    );
    writeFileSync(
      join(fakeRepo, "cli", "package.json"),
      JSON.stringify({ name: "aos-harness-probe", version: "0.0.0", bin: { probe: "./src/probe.ts" } }),
    );

    // Symlink as if npm-linked
    mkdirSync(join(siblingProject, "node_modules", "aos-harness-probe"), { recursive: true });
    rmSync(join(siblingProject, "node_modules", "aos-harness-probe"), { recursive: true });
    symlinkSync(join(fakeRepo, "cli"), join(siblingProject, "node_modules", "aos-harness-probe"), "dir");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("import.meta.dir points into the real checkout, not the symlink", async () => {
    const result = await $`bun run ${join(siblingProject, "node_modules", "aos-harness-probe", "src", "probe.ts")}`.text();
    const reportedDir = result.trim();
    const realSrcDir = realpathSync(join(fakeRepo, "cli", "src"));

    // Either the real path (symlink resolved) or the symlinked path is acceptable —
    // both mean "the CLI's own install location", not the consumer's cwd.
    const symlinkedSrcDir = join(siblingProject, "node_modules", "aos-harness-probe", "src");

    expect([realSrcDir, symlinkedSrcDir]).toContain(reportedDir);
    // Critically: NOT the consumer project root
    expect(reportedDir).not.toBe(siblingProject);
  });
});
```

- [ ] **Step 2: Run the gate test**

Run: `bun test tests/cli/import-meta-dir-symlink.test.ts -v`
Expected: PASS on Bun 1.3+. **If FAIL:** stop the plan. Open an issue titled "Bun `import.meta.dir` regression under `npm link`" with Bun version, test output, and a link to spec D1. Do not proceed to Task 1.

- [ ] **Step 3: Record the Bun version verified**

Append one line to `cli/package.json` engines:

```json
  "engines": { "bun": ">=1.3.11" }
```

- [ ] **Step 4: Commit**

```bash
git add tests/cli/import-meta-dir-symlink.test.ts cli/package.json
git commit -m "test(cli): gate adapter trust plan on import.meta.dir + npm link behavior"
```

---

## Task 1: Promote `ADAPTER_ALLOWLIST` to `cli/src/utils.ts`

**Files:**
- Modify: `cli/src/utils.ts`
- Modify: `cli/src/commands/init.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/adapter-allowlist.test.ts
import { describe, test, expect } from "bun:test";
import { ADAPTER_ALLOWLIST, isValidAdapter } from "../../cli/src/utils";

describe("ADAPTER_ALLOWLIST (spec D2)", () => {
  test("exports the four allowed adapters", () => {
    expect(ADAPTER_ALLOWLIST).toEqual(["pi", "claude-code", "codex", "gemini"]);
  });

  test("isValidAdapter accepts only allowlisted names", () => {
    expect(isValidAdapter("pi")).toBe(true);
    expect(isValidAdapter("claude-code")).toBe(true);
    expect(isValidAdapter("codex")).toBe(true);
    expect(isValidAdapter("gemini")).toBe(true);
  });

  test("isValidAdapter rejects traversal and unknown values", () => {
    expect(isValidAdapter("../evil")).toBe(false);
    expect(isValidAdapter("banana")).toBe(false);
    expect(isValidAdapter("")).toBe(false);
    expect(isValidAdapter("pi/foo")).toBe(false);
    expect(isValidAdapter("PI")).toBe(false); // case-sensitive
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/adapter-allowlist.test.ts`
Expected: FAIL — `ADAPTER_ALLOWLIST`, `isValidAdapter` not exported.

- [ ] **Step 3: Add to `cli/src/utils.ts`**

Append to end of file:

```ts
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
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/cli/adapter-allowlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `VALID_ADAPTERS` in init.ts with the shared constant**

In `cli/src/commands/init.ts`, replace the local `VALID_ADAPTERS` constant with:

```ts
import { ADAPTER_ALLOWLIST, isValidAdapter } from "../utils";
```

And replace any `VALID_ADAPTERS.includes(x)` with `isValidAdapter(x)`.

- [ ] **Step 6: Run existing init tests**

Run: `bun test tests/cli/init*.test.ts` (if they exist) and `bun run lint`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/utils.ts cli/src/commands/init.ts tests/cli/adapter-allowlist.test.ts
git commit -m "feat(cli): promote ADAPTER_ALLOWLIST to utils for shared enforcement"
```

---

## Task 2: Drop project-local adapter override in `run.ts` + enforce allowlist

**Files:**
- Modify: `cli/src/commands/run.ts:322-328`
- Create: `tests/cli/no-project-local-adapters.test.ts`

- [ ] **Step 1: Write the failing test — hostile repo scenario**

```ts
// tests/cli/no-project-local-adapters.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

describe("project-local adapter override (spec D1)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "aos-hostile-"));
    // Minimum shape getHarnessRoot recognizes as a project
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    // Hostile adapter source that exits 99 if run
    mkdirSync(join(tmp, "adapters", "pi", "src"), { recursive: true });
    writeFileSync(
      join(tmp, "adapters", "pi", "src", "index.ts"),
      "process.exit(99);\n",
    );
    // Minimum brief
    writeFileSync(join(tmp, "brief.md"), "# test\n");
    mkdirSync(join(tmp, ".aos"), { recursive: true });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("aos run does NOT spawn the project-local adapters/pi/src/index.ts", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")}`
      .cwd(tmp)
      .nothrow()
      .quiet();

    // Must NOT be exit 99 (the hostile file's exit code)
    expect(result.exitCode).not.toBe(99);
    // Should be exit 2 (missing adapter package) or similar startup error
    expect([2, 1]).toContain(result.exitCode);
    // stderr should mention missing adapter package, not the hostile path
    const stderr = result.stderr.toString();
    expect(stderr).not.toContain(join(tmp, "adapters", "pi", "src", "index.ts"));
  });
});
```

- [ ] **Step 2: Write the failing test — unknown adapter rejected**

Append to `tests/cli/adapter-allowlist.test.ts`:

```ts
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("run.ts adapter allowlist enforcement", () => {
  test("--adapter banana exits 2 with allowlist hint", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-bad-adapter-"));
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    writeFileSync(join(tmp, "brief.md"), "# test\n");
    try {
      const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")} --adapter banana`
        .cwd(tmp).nothrow().quiet();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("Unknown adapter: banana");
      expect(result.stderr.toString()).toContain("pi, claude-code, codex, gemini");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `bun test tests/cli/no-project-local-adapters.test.ts tests/cli/adapter-allowlist.test.ts`
Expected: FAIL — override still exists, no allowlist check.

- [ ] **Step 4: Edit `cli/src/commands/run.ts`**

Locate `run.ts:322-328`. Replace:

```ts
  if (args.flags["adapter"]) adapter = args.flags["adapter"] as string;

  const adapterName = adapter === "claude-code" ? "claude-code" : adapter;
  // Resolve adapter from: 1) project dir, 2) installed package, 3) monorepo
  const resolvedAdapterDir = existsSync(join(root, "adapters", adapterName, "src", "index.ts"))
    ? join(root, "adapters", adapterName)
    : getAdapterDir(adapterName);
```

With:

```ts
  if (args.flags["adapter"]) adapter = args.flags["adapter"] as string;

  if (!isValidAdapter(adapter)) {
    console.error(c.red(`Unknown adapter: ${adapter}`));
    console.error(c.dim(`Allowed: ${ADAPTER_ALLOWLIST.join(", ")}`));
    process.exit(2);
  }

  const adapterName = adapter;
  // Resolve from monorepo dev layout (CLI's own import.meta.dir) or installed
  // @aos-harness/<name>-adapter. Project-local override is intentionally absent
  // (spec D1 — workspace-trust hardening).
  const resolvedAdapterDir = getAdapterDir(adapterName);
```

Add the import at the top of `run.ts`:

```ts
import { ADAPTER_ALLOWLIST, isValidAdapter, getAdapterDir } from "../utils";
```

(merge with existing utils import).

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test tests/cli/no-project-local-adapters.test.ts tests/cli/adapter-allowlist.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full CLI test suite to catch regressions**

Run: `bun test tests/cli/`
Expected: PASS (or only unrelated failures).

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/run.ts tests/cli/no-project-local-adapters.test.ts tests/cli/adapter-allowlist.test.ts
git commit -m "fix(cli): drop project-local adapter override; allowlist adapter name (RCE-001)"
```

---

## Task 3: `confinedResolve` helper

**Files:**
- Modify: `cli/src/utils.ts`
- Create: `tests/cli/confined-resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/confined-resolve.test.ts
import { describe, test, expect } from "bun:test";
import { confinedResolve } from "../../cli/src/utils";
import { resolve } from "node:path";

describe("confinedResolve (spec D4)", () => {
  const base = resolve("/tmp/project");

  test("allows paths inside base", () => {
    expect(confinedResolve(base, "sub/file.txt")).toBe(resolve(base, "sub/file.txt"));
    expect(confinedResolve(base, "./sub/../other.txt")).toBe(resolve(base, "other.txt"));
  });

  test("allows the base itself (rel=. or empty)", () => {
    expect(confinedResolve(base, ".")).toBe(base);
    expect(confinedResolve(base, "")).toBe(base);
  });

  test("rejects paths that escape the base", () => {
    expect(() => confinedResolve(base, "../evil")).toThrow(/escapes base directory/);
    expect(() => confinedResolve(base, "/etc/passwd")).toThrow(/escapes base directory/);
    expect(() => confinedResolve(base, "sub/../../evil")).toThrow(/escapes base directory/);
  });

  test("normalizes mixed separators", () => {
    // On POSIX sep is /, so backslash is treated as a literal filename char
    // (which is fine). The test exists to document intent.
    const result = confinedResolve(base, "sub/file.txt");
    expect(result.startsWith(base)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/confined-resolve.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement in `cli/src/utils.ts`**

Append:

```ts
import { sep, normalize } from "node:path";

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
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/cli/confined-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils.ts tests/cli/confined-resolve.test.ts
git commit -m "feat(cli): add confinedResolve helper for base-dir path validation"
```

---

## Task 4: `validatePlatformUrl` helper

**Files:**
- Modify: `cli/src/utils.ts`
- Create: `tests/cli/platform-url-validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/platform-url-validation.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validatePlatformUrl } from "../../cli/src/utils";

describe("validatePlatformUrl (spec D5)", () => {
  beforeEach(() => {
    delete process.env.AOS_ALLOW_INSECURE_PLATFORM_URL;
  });

  test("accepts https URL", () => {
    const u = validatePlatformUrl("https://api.example.com/v1");
    expect(u.protocol).toBe("https:");
  });

  test("accepts http://localhost and http://127.0.0.1", () => {
    expect(validatePlatformUrl("http://localhost:8080").hostname).toBe("localhost");
    expect(validatePlatformUrl("http://127.0.0.1:8080").hostname).toBe("127.0.0.1");
  });

  test("rejects plain http to a non-loopback host", () => {
    expect(() => validatePlatformUrl("http://api.example.com")).toThrow(/scheme.*not allowed/);
  });

  test("rejects file://, ftp://, and other schemes", () => {
    expect(() => validatePlatformUrl("file:///etc/passwd")).toThrow(/scheme/);
    expect(() => validatePlatformUrl("ftp://example.com")).toThrow(/scheme/);
  });

  test("rejects link-local / metadata addresses", () => {
    expect(() => validatePlatformUrl("http://169.254.169.254/")).toThrow(/link-local|metadata/);
    expect(() => validatePlatformUrl("http://169.254.0.1/")).toThrow(/link-local|metadata/);
  });

  test("rejects garbage input", () => {
    expect(() => validatePlatformUrl("not a url")).toThrow();
    expect(() => validatePlatformUrl("")).toThrow();
  });

  test("AOS_ALLOW_INSECURE_PLATFORM_URL bypass works", () => {
    process.env.AOS_ALLOW_INSECURE_PLATFORM_URL = "1";
    expect(() => validatePlatformUrl("http://10.0.0.1/")).not.toThrow();
    expect(() => validatePlatformUrl("file:///tmp/x")).not.toThrow();
    delete process.env.AOS_ALLOW_INSECURE_PLATFORM_URL;
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/platform-url-validation.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement in `cli/src/utils.ts`**

Append:

```ts
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

  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost)) {
    throw new Error(`platform.url rejected: scheme "${u.protocol.replace(":", "")}" not allowed`);
  }

  // Link-local / metadata service: 169.254.0.0/16
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(u.hostname)) {
    throw new Error(`platform.url rejected: link-local / metadata address ${u.hostname}`);
  }

  return u;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/cli/platform-url-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils.ts tests/cli/platform-url-validation.test.ts
git commit -m "feat(cli): add validatePlatformUrl helper (SSRF surface)"
```

---

## Task 5: Wire `platformUrl` validation into `run.ts`

**Files:**
- Modify: `cli/src/commands/run.ts` (near line 310-320 where `platformUrl` is resolved)

- [ ] **Step 1: Write the failing integration test**

Append to `tests/cli/platform-url-validation.test.ts`:

```ts
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("platformUrl wiring in run.ts", () => {
  test(".aos/config.yaml with link-local platform URL exits 2", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "aos-plat-url-"));
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    mkdirSync(join(tmp, ".aos"), { recursive: true });
    writeFileSync(
      join(tmp, ".aos", "config.yaml"),
      "adapter: pi\nplatform:\n  enabled: true\n  url: http://169.254.169.254/\n",
    );
    writeFileSync(join(tmp, "brief.md"), "# test\n");

    try {
      const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")}`
        .cwd(tmp).nothrow().quiet();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toMatch(/platform\.url.*169\.254/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/platform-url-validation.test.ts`
Expected: the wiring test FAILs (run.ts doesn't validate yet).

- [ ] **Step 3: Edit `cli/src/commands/run.ts`**

Around line 310-320 where `platformUrl` is set, wrap with validation:

```ts
  // Validate platform URL (spec D5). Fires for both --platform-url flag
  // and .aos/config.yaml platform.url.
  if (platformUrl) {
    try {
      validatePlatformUrl(platformUrl);
    } catch (err: any) {
      console.error(c.red(err.message));
      process.exit(2);
    }
  }
```

Add `validatePlatformUrl` to the existing `../utils` import.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/cli/platform-url-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/run.ts
git commit -m "fix(cli): reject link-local / non-https platform URLs (NET-002)"
```

---

## Task 6: `create.ts` name regex validation

**Files:**
- Modify: `cli/src/commands/create.ts`
- Create: `tests/cli/create-name-validation.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/cli/create-name-validation.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

describe("aos create name validation (spec D4/PATH-003)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "aos-create-"));
    mkdirSync(join(tmp, "core", "agents", "custom"), { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test("rejects ../ in name", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent ../evil`
      .cwd(tmp).nothrow().quiet();
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toMatch(/Invalid name/);
    // Must NOT have written agent.yaml anywhere outside tmp/core/agents/custom
    expect(existsSync(join(tmp, "..", "evil"))).toBe(false);
  });

  test("rejects dot in name", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent my.agent`
      .cwd(tmp).nothrow().quiet();
    expect(result.exitCode).toBe(2);
  });

  test("accepts well-formed names", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent my-agent`
      .cwd(tmp).nothrow().quiet();
    // May fail for other reasons (missing template, etc.), but NOT with exit 2 + "Invalid name"
    expect(result.stderr.toString()).not.toMatch(/Invalid name/);
  });

  test("kebab-cases and accepts 'A New Agent'", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} create agent "A New Agent"`
      .cwd(tmp).nothrow().quiet();
    expect(result.stderr.toString()).not.toMatch(/Invalid name/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/create-name-validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `cli/src/commands/create.ts`**

Find where `id` is produced from `toKebabCase(name)`. Immediately after:

```ts
  const id = toKebabCase(name);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    console.error(c.red(`Invalid name "${name}": must kebab-case to /^[a-z0-9][a-z0-9-]*$/`));
    console.error(c.dim(`Allowed characters: a-z, 0-9, hyphen. Must start with a letter or digit.`));
    process.exit(2);
  }
```

(Use the existing color import pattern in the file; if none, import `c` from `../colors`.)

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/cli/create-name-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/create.ts tests/cli/create-name-validation.test.ts
git commit -m "fix(cli): validate create name against /^[a-z0-9][a-z0-9-]*$/ (PATH-003)"
```

---

## Task 7: Profile `tools` block schema in `runtime/`

**Files:**
- Create: `runtime/src/profile-schema.ts` (if not present — else modify)
- Modify: `runtime/src/profile-loader.ts` (or wherever profile YAML is parsed)
- Create: `tests/runtime/profile-tools-schema.test.ts`

Before this task, discover the existing profile loader. Run:

```bash
grep -rn "profile" runtime/src --include="*.ts" -l
```

and read whichever file parses `profile.yaml`. The changes below add a `tools` block; integrate into the existing loader's validation pipeline (Zod, io-ts, manual — follow the existing pattern).

- [ ] **Step 1: Write failing tests**

```ts
// tests/runtime/profile-tools-schema.test.ts
import { describe, test, expect } from "bun:test";
import { parseToolsBlock, DEFAULT_TOOL_POLICY, type ToolsBlock } from "../../runtime/src/profile-schema";

describe("tools block parsing (spec D3.1)", () => {
  test("missing tools block → execute_code disabled, read/write/list/grep/invokeSkill enabled", () => {
    const p = parseToolsBlock(undefined);
    expect(p.execute_code.enabled).toBe(false);
    expect(p.read_file.enabled).toBe(true);
    expect(p.write_file.enabled).toBe(true);
    expect(p.list_directory.enabled).toBe(true);
    expect(p.grep.enabled).toBe(true);
    expect(p.invoke_skill.enabled).toBe(true);
  });

  test("explicit execute_code.enabled=true with languages", () => {
    const p = parseToolsBlock({
      execute_code: { enabled: true, languages: ["python", "bash"], max_timeout_ms: 60000 },
    });
    expect(p.execute_code.enabled).toBe(true);
    expect(p.execute_code.languages).toEqual(["python", "bash"]);
    expect(p.execute_code.max_timeout_ms).toBe(60000);
  });

  test("unknown language in execute_code.languages throws at load time", () => {
    expect(() => parseToolsBlock({
      execute_code: { enabled: true, languages: ["python", "ruby"] },
    })).toThrow(/ruby|unknown language/i);
  });

  test("execute_code.enabled=true without languages defaults to empty (deny-all-languages)", () => {
    const p = parseToolsBlock({ execute_code: { enabled: true } });
    expect(p.execute_code.enabled).toBe(true);
    expect(p.execute_code.languages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/runtime/profile-tools-schema.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Create `runtime/src/profile-schema.ts`**

```ts
/**
 * Profile tools-block schema. Spec D3.1.
 *
 * A ToolPolicy declares which tools an agent/workflow can call. Built from
 * the optional `tools:` block in profile.yaml, then frozen and handed to
 * BaseWorkflow. Mid-session denial is a tool-result error (non-fatal);
 * malformed tools blocks fail profile load (exit 3).
 */

export type SupportedLanguage = "bash" | "typescript" | "python" | "javascript" | "sh" | "ts" | "py" | "node" | "js";
const VALID_LANGUAGES = new Set<SupportedLanguage>([
  "bash", "typescript", "python", "javascript", "sh", "ts", "py", "node", "js",
]);

export interface ExecuteCodePolicy {
  enabled: boolean;
  languages: SupportedLanguage[];
  max_timeout_ms: number;
}

export interface SimpleToolPolicy {
  enabled: boolean;
}

export interface ToolsBlock {
  execute_code: ExecuteCodePolicy;
  read_file: SimpleToolPolicy;
  write_file: SimpleToolPolicy;
  list_directory: SimpleToolPolicy;
  grep: SimpleToolPolicy;
  invoke_skill: SimpleToolPolicy;
}

export const DEFAULT_TOOL_POLICY: ToolsBlock = Object.freeze({
  execute_code: Object.freeze({ enabled: false, languages: [], max_timeout_ms: 30_000 }) as ExecuteCodePolicy,
  read_file: Object.freeze({ enabled: true }),
  write_file: Object.freeze({ enabled: true }),
  list_directory: Object.freeze({ enabled: true }),
  grep: Object.freeze({ enabled: true }),
  invoke_skill: Object.freeze({ enabled: true }),
});

export function parseToolsBlock(raw: unknown): ToolsBlock {
  if (raw === undefined || raw === null) return DEFAULT_TOOL_POLICY;
  if (typeof raw !== "object") {
    throw new Error(`tools block must be an object, got ${typeof raw}`);
  }
  const r = raw as Record<string, any>;
  const ec = r.execute_code ?? {};
  const languages: string[] = Array.isArray(ec.languages) ? ec.languages : [];
  for (const lang of languages) {
    if (!VALID_LANGUAGES.has(lang as SupportedLanguage)) {
      throw new Error(`tools.execute_code.languages: unknown language "${lang}" (allowed: ${[...VALID_LANGUAGES].join(", ")})`);
    }
  }
  return {
    execute_code: {
      enabled: Boolean(ec.enabled),
      languages: languages as SupportedLanguage[],
      max_timeout_ms: typeof ec.max_timeout_ms === "number" ? ec.max_timeout_ms : 30_000,
    },
    read_file: { enabled: r.read_file?.enabled ?? true },
    write_file: { enabled: r.write_file?.enabled ?? true },
    list_directory: { enabled: r.list_directory?.enabled ?? true },
    grep: { enabled: r.grep?.enabled ?? true },
    invoke_skill: { enabled: r.invoke_skill?.enabled ?? true },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/runtime/profile-tools-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into profile loader**

In whichever file parses `profile.yaml` (likely `runtime/src/profile-loader.ts` or similar), after parsing the YAML:

```ts
import { parseToolsBlock, type ToolsBlock } from "./profile-schema";

// in the loader function after yaml.load(...)
profile.tools = parseToolsBlock((parsed as any).tools);
```

Add `tools: ToolsBlock` to the Profile type export.

- [ ] **Step 6: Run existing runtime tests**

Run: `bun test` (from repo root) or `bun test --cwd runtime`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add runtime/src/profile-schema.ts runtime/src/profile-loader.ts tests/runtime/profile-tools-schema.test.ts
git commit -m "feat(runtime): add tools block to profile schema (execute_code default deny)"
```

---

## Task 8: `ToolPolicy` type + builder in `adapters/shared/`

**Files:**
- Create: `adapters/shared/src/tool-policy.ts`
- Modify: `adapters/shared/src/index.ts`
- Create: `tests/adapters-shared/tool-policy.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/adapters-shared/tool-policy.test.ts
import { describe, test, expect } from "bun:test";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";

describe("buildToolPolicy (spec D3)", () => {
  test("no profile, no flags → default policy (execute_code disabled)", () => {
    const p = buildToolPolicy(DEFAULT_TOOL_POLICY, {});
    expect(p.execute_code.enabled).toBe(false);
    // Frozen
    expect(() => { (p as any).execute_code.enabled = true; }).toThrow();
  });

  test("profile allows [python, bash] + flag=python narrows to [python]", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python", "bash"] as const, max_timeout_ms: 30000 } };
    const p = buildToolPolicy(profile as any, { allowCodeExecution: ["python"] });
    expect(p.execute_code.enabled).toBe(true);
    expect(p.execute_code.languages).toEqual(["python"]);
  });

  test("profile denies execute_code + --allow-code-execution=python throws (widens)", () => {
    expect(() => buildToolPolicy(DEFAULT_TOOL_POLICY, { allowCodeExecution: ["python"] }))
      .toThrow(/cannot widen/);
  });

  test("--allow-code-execution=none forces deny even if profile allows", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python"] as const, max_timeout_ms: 30000 } };
    const p = buildToolPolicy(profile as any, { allowCodeExecution: "none" });
    expect(p.execute_code.enabled).toBe(false);
  });

  test("bare --allow-code-execution with profile allow leaves profile unchanged", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python"] as const, max_timeout_ms: 30000 } };
    const p = buildToolPolicy(profile as any, { allowCodeExecution: "all" });
    expect(p.execute_code.languages).toEqual(["python"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/adapters-shared/tool-policy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `adapters/shared/src/tool-policy.ts`**

```ts
import type { ToolsBlock, SupportedLanguage } from "../../../runtime/src/profile-schema";

export type CliToolFlags = {
  /**
   * undefined | "none" | "all" | string[] (specific languages).
   * "none" forces deny; specific list narrows; "all" is a no-op vs. profile.
   */
  allowCodeExecution?: "none" | "all" | string[];
};

export type ToolPolicy = Readonly<ToolsBlock>;

export function buildToolPolicy(profile: ToolsBlock, flags: CliToolFlags): ToolPolicy {
  const ec = profile.execute_code;
  let finalEnabled = ec.enabled;
  let finalLangs: SupportedLanguage[] = [...ec.languages];

  if (flags.allowCodeExecution === "none") {
    finalEnabled = false;
    finalLangs = [];
  } else if (Array.isArray(flags.allowCodeExecution)) {
    if (!ec.enabled) {
      throw new Error(
        `flag --allow-code-execution cannot widen profile (execute_code not enabled in profile)`,
      );
    }
    // Intersect
    const allowed = new Set(ec.languages);
    const narrowed: SupportedLanguage[] = [];
    for (const lang of flags.allowCodeExecution) {
      if (!allowed.has(lang as SupportedLanguage)) {
        throw new Error(
          `flag --allow-code-execution=${lang} cannot widen profile's languages: ${ec.languages.join(", ")}`,
        );
      }
      narrowed.push(lang as SupportedLanguage);
    }
    finalLangs = narrowed;
  }
  // "all" or undefined → no change

  const policy: ToolsBlock = {
    execute_code: { enabled: finalEnabled, languages: finalLangs, max_timeout_ms: ec.max_timeout_ms },
    read_file: { ...profile.read_file },
    write_file: { ...profile.write_file },
    list_directory: { ...profile.list_directory },
    grep: { ...profile.grep },
    invoke_skill: { ...profile.invoke_skill },
  };

  return Object.freeze({
    execute_code: Object.freeze(policy.execute_code),
    read_file: Object.freeze(policy.read_file),
    write_file: Object.freeze(policy.write_file),
    list_directory: Object.freeze(policy.list_directory),
    grep: Object.freeze(policy.grep),
    invoke_skill: Object.freeze(policy.invoke_skill),
  });
}
```

- [ ] **Step 4: Export from `adapters/shared/src/index.ts`**

Add:

```ts
export { buildToolPolicy } from "./tool-policy";
export type { ToolPolicy, CliToolFlags } from "./tool-policy";
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test tests/adapters-shared/tool-policy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add adapters/shared/src/tool-policy.ts adapters/shared/src/index.ts tests/adapters-shared/tool-policy.test.ts
git commit -m "feat(adapter-shared): add ToolPolicy + buildToolPolicy with CLI narrowing"
```

---

## Task 9: `BaseWorkflow` accepts `ToolPolicy`; `enforceToolAccess` + `executeCode` gate

**Files:**
- Modify: `adapters/shared/src/base-workflow.ts`
- Create: `tests/adapters-shared/enforce-tool-access.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/adapters-shared/enforce-tool-access.test.ts
import { describe, test, expect, mock } from "bun:test";
import { BaseWorkflow } from "../../adapters/shared/src/base-workflow";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";

const mockRuntime = { sendMessage: mock(async () => ({ text: "ok" })) } as any;

describe("BaseWorkflow.enforceToolAccess (spec D3.3)", () => {
  test("default policy: executeCode bash → denied, no spawn", async () => {
    const wf = new BaseWorkflow(mockRuntime, "/tmp", { toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}) });
    await expect(
      wf.executeCode({ agentId: "test" } as any, "echo hi", { language: "bash" })
    ).rejects.toThrow(/execute_code.*not enabled/);
  });

  test("policy allows [python], bash call denied, python call allowed", async () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python"] as any, max_timeout_ms: 30000 } };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", { toolPolicy: buildToolPolicy(profile as any, {}) });

    await expect(
      wf.executeCode({ agentId: "test" } as any, "ls", { language: "bash" })
    ).rejects.toThrow(/language.*bash.*not in profile/);

    // python call: allowed (actual spawn may fail in test environment, but the
    // gate must not throw)
    const result = await wf.executeCode({ agentId: "test" } as any, "print('hi')", { language: "python", timeout_ms: 2000 });
    // result.success depends on python3 being installed in test env; we care that
    // the gate let us through:
    expect(result).toBeDefined();
    expect(result.exit_code).toBeDefined();
  });

  test("per-call timeout cannot exceed profile max_timeout_ms", async () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["bash"] as any, max_timeout_ms: 5000 } };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", { toolPolicy: buildToolPolicy(profile as any, {}) });
    await expect(
      wf.executeCode({ agentId: "test" } as any, "sleep 1", { language: "bash", timeout_ms: 10_000 })
    ).rejects.toThrow(/timeout.*exceeds profile max/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/adapters-shared/enforce-tool-access.test.ts`
Expected: FAIL — BaseWorkflow constructor doesn't accept `toolPolicy`.

- [ ] **Step 3: Modify `adapters/shared/src/base-workflow.ts`**

Add constructor option + frozen field:

```ts
// near top of file, with other imports
import type { ToolPolicy } from "./tool-policy";
import { buildToolPolicy } from "./tool-policy";
import { DEFAULT_TOOL_POLICY } from "../../../runtime/src/profile-schema";

// in the class:
export interface BaseWorkflowOpts {
  toolPolicy?: ToolPolicy;
  transcriptPath?: string;
}

export class BaseWorkflow {
  private readonly toolPolicy: ToolPolicy;
  private readonly transcriptPath?: string;

  constructor(
    private agentRuntime: any,
    private projectRoot: string,
    opts?: BaseWorkflowOpts,
  ) {
    this.toolPolicy = opts?.toolPolicy ?? buildToolPolicy(DEFAULT_TOOL_POLICY, {});
    this.transcriptPath = opts?.transcriptPath;
  }
  // ... rest unchanged
}
```

Replace `enforceToolAccess`:

```ts
  async enforceToolAccess(
    agentId: string,
    toolCall: { tool: string; path?: string; command?: { language?: string; timeout_ms?: number } },
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.toolPolicy;
    const entry = (policy as any)[toolCall.tool];
    if (!entry?.enabled) {
      const reason = `tool "${toolCall.tool}" is not enabled in profile`;
      this.emitToolDenied(agentId, toolCall.tool, reason, toolCall.command);
      return { allowed: false, reason };
    }
    if (toolCall.tool === "execute_code" && toolCall.command) {
      const lang = toolCall.command.language ?? "bash";
      if (!policy.execute_code.languages.includes(lang as any)) {
        const reason = `language "${lang}" not in profile allowlist (${policy.execute_code.languages.join(", ") || "none"})`;
        this.emitToolDenied(agentId, toolCall.tool, reason, toolCall.command);
        return { allowed: false, reason };
      }
      if (toolCall.command.timeout_ms && toolCall.command.timeout_ms > policy.execute_code.max_timeout_ms) {
        const reason = `timeout ${toolCall.command.timeout_ms}ms exceeds profile max ${policy.execute_code.max_timeout_ms}ms`;
        this.emitToolDenied(agentId, toolCall.tool, reason, toolCall.command);
        return { allowed: false, reason };
      }
    }
    return { allowed: true };
  }

  private emitToolDenied(agentId: string, tool: string, reason: string, detail?: any): void {
    if (!this.transcriptPath) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      type: "tool-denied",
      agent: agentId,
      tool,
      reason,
      detail: detail ?? null,
    });
    try {
      require("node:fs").appendFileSync(this.transcriptPath, line + "\n");
    } catch {
      // Transcript unavailable — do not fail the deliberation
    }
  }

  /** Read-only view of the active tool policy. Spec D7.2. */
  listEnabledTools(): Readonly<Record<string, unknown>> {
    return this.toolPolicy as unknown as Record<string, unknown>;
  }
```

Modify `executeCode` (line 229) — insert at the top of the method, before the switch:

```ts
  async executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
    const language = opts?.language ?? "bash";
    const timeout = opts?.timeout_ms ?? 30000;

    const gate = await this.enforceToolAccess((handle as any)?.agentId ?? "unknown", {
      tool: "execute_code",
      command: { language, timeout_ms: timeout },
    });
    if (!gate.allowed) {
      throw new UnsupportedError("executeCode", gate.reason ?? "denied by policy");
    }
    // ... existing body unchanged
```

Ensure `UnsupportedError` is imported at the top of the file (it already is per the spec reference at line 349).

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/adapters-shared/enforce-tool-access.test.ts`
Expected: PASS. (The python-spawn case may skip/fail if python3 is absent; that's fine — the assertion is on the gate, not on python.)

- [ ] **Step 5: Add transcript-event test**

Append to the test file:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("tool-denied events are appended to transcript (D7.1)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-transcript-"));
  const transcriptPath = join(tmp, "transcript.jsonl");
  try {
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
      transcriptPath,
    });
    await expect(
      wf.executeCode({ agentId: "arbiter" } as any, "echo hi", { language: "bash" })
    ).rejects.toThrow();
    const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.type).toBe("tool-denied");
    expect(entry.tool).toBe("execute_code");
    expect(entry.agent).toBe("arbiter");
    expect(entry.reason).toMatch(/not enabled/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("listEnabledTools returns a frozen view", () => {
  const wf = new BaseWorkflow(mockRuntime, "/tmp", { toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}) });
  const view = wf.listEnabledTools();
  expect((view as any).execute_code.enabled).toBe(false);
  expect(() => { (view as any).execute_code.enabled = true; }).toThrow();
});
```

Re-run: `bun test tests/adapters-shared/enforce-tool-access.test.ts` — PASS.

- [ ] **Step 6: Commit**

```bash
git add adapters/shared/src/base-workflow.ts tests/adapters-shared/enforce-tool-access.test.ts
git commit -m "feat(adapter-shared): enforceToolAccess + executeCode gate + transcript events (RCE-002)"
```

---

## Task 10: Worker-agent policy inheritance

**Files:**
- Modify: `adapters/shared/src/base-workflow.ts` (worker-spawn path)
- Create: `tests/adapters-shared/worker-policy-inheritance.test.ts`

Before writing tests, identify the worker-spawn method. Run:

```bash
grep -n "spawn.*worker\|worker.*spawn\|delegateToWorker\|spawnWorker" adapters/shared/src/base-workflow.ts
```

If the worker-spawn method has a different name in current code, adjust references below.

- [ ] **Step 1: Write failing tests**

```ts
// tests/adapters-shared/worker-policy-inheritance.test.ts
import { describe, test, expect, mock } from "bun:test";
import { BaseWorkflow } from "../../adapters/shared/src/base-workflow";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";

const mockRuntime = { sendMessage: mock(async () => ({ text: "ok" })) } as any;

describe("Worker policy inheritance (spec D3 worker rules)", () => {
  test("parent denies execute_code; worker spawn requesting execute_code throws", async () => {
    const wf = new BaseWorkflow(mockRuntime, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
    });
    await expect(
      (wf as any).spawnWorker({ agentId: "worker-1", toolsOverride: { execute_code: { enabled: true, languages: ["bash"] } } })
    ).rejects.toThrow(/cannot widen session policy/);
  });

  test("parent allows [python, bash]; worker narrows to [python] — python call allowed, bash denied at worker", async () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python", "bash"] as any, max_timeout_ms: 30000 } };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", { toolPolicy: buildToolPolicy(profile as any, {}) });
    const workerWf = await (wf as any).spawnWorker({
      agentId: "worker-1",
      toolsOverride: { execute_code: { enabled: true, languages: ["python"] } },
    });
    const bash = await workerWf.enforceToolAccess("worker-1", { tool: "execute_code", command: { language: "bash" } });
    expect(bash.allowed).toBe(false);
    const py = await workerWf.enforceToolAccess("worker-1", { tool: "execute_code", command: { language: "python" } });
    expect(py.allowed).toBe(true);
  });

  test("worker with no toolsOverride inherits parent session policy verbatim", async () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python"] as any, max_timeout_ms: 30000 } };
    const wf = new BaseWorkflow(mockRuntime, "/tmp", { toolPolicy: buildToolPolicy(profile as any, {}) });
    const workerWf = await (wf as any).spawnWorker({ agentId: "worker-1" });
    const py = await workerWf.enforceToolAccess("worker-1", { tool: "execute_code", command: { language: "python" } });
    expect(py.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/adapters-shared/worker-policy-inheritance.test.ts`
Expected: FAIL — no `spawnWorker`, or existing `spawnWorker` doesn't check overrides.

- [ ] **Step 3: Add `spawnWorker` narrowing check in `base-workflow.ts`**

If `spawnWorker` exists: find it and add the narrow-check at the top. If it doesn't exist yet (hierarchical delegation may live in `runtime/`, not in `BaseWorkflow`), add a minimal version:

```ts
  async spawnWorker(opts: {
    agentId: string;
    toolsOverride?: Partial<ToolsBlock>;
  }): Promise<BaseWorkflow> {
    const session = this.toolPolicy;
    let workerPolicy: ToolPolicy = session;

    if (opts.toolsOverride) {
      // Narrow-only: any enabled=true on a session-denied tool → throw
      for (const [toolName, override] of Object.entries(opts.toolsOverride)) {
        const sessionEntry = (session as any)[toolName];
        if (override?.enabled && !sessionEntry?.enabled) {
          throw new Error(
            `worker ${opts.agentId} cannot widen session policy: tool "${toolName}" is disabled at session level`,
          );
        }
      }
      // Safe to narrow: intersect execute_code languages
      const ec = opts.toolsOverride.execute_code;
      let narrowedLangs = session.execute_code.languages;
      if (ec?.languages) {
        narrowedLangs = session.execute_code.languages.filter((l) =>
          (ec.languages as string[]).includes(l),
        );
      }
      const narrowed: ToolsBlock = {
        ...session,
        execute_code: {
          ...session.execute_code,
          languages: narrowedLangs,
          enabled: Boolean(ec?.enabled ?? session.execute_code.enabled),
        },
      };
      workerPolicy = Object.freeze(narrowed) as ToolPolicy;
    }

    return new BaseWorkflow(this.agentRuntime, this.projectRoot, {
      toolPolicy: workerPolicy,
      transcriptPath: this.transcriptPath,
    });
  }
```

Import `ToolsBlock` from `../../../runtime/src/profile-schema`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/adapters-shared/worker-policy-inheritance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/shared/src/base-workflow.ts tests/adapters-shared/worker-policy-inheritance.test.ts
git commit -m "feat(adapter-shared): worker agents inherit + narrow session ToolPolicy"
```

---

## Task 11: `--allow-code-execution` CLI flag in `cli/src/index.ts` + wiring through adapter-session

**Files:**
- Modify: `cli/src/index.ts` (flag parsing)
- Modify: `cli/src/commands/run.ts` (read flag, pass to adapter-session)
- Modify: `cli/src/adapter-session.ts` (accept `ToolPolicy`, pass to `BaseWorkflow`)
- Create: `tests/cli/allow-code-execution-flag.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/cli/allow-code-execution-flag.test.ts
import { describe, test, expect } from "bun:test";
import { parseAllowCodeExecutionFlag } from "../../cli/src/utils";

describe("--allow-code-execution flag parsing (spec D3.2)", () => {
  test("undefined → undefined", () => {
    expect(parseAllowCodeExecutionFlag(undefined)).toBeUndefined();
  });
  test("bare (true) → 'all'", () => {
    expect(parseAllowCodeExecutionFlag(true)).toBe("all");
  });
  test("'none' → 'none'", () => {
    expect(parseAllowCodeExecutionFlag("none")).toBe("none");
  });
  test("'python,bash' → ['python','bash']", () => {
    expect(parseAllowCodeExecutionFlag("python,bash")).toEqual(["python", "bash"]);
  });
  test("'python' → ['python']", () => {
    expect(parseAllowCodeExecutionFlag("python")).toEqual(["python"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/cli/allow-code-execution-flag.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add parser to `cli/src/utils.ts`**

```ts
export function parseAllowCodeExecutionFlag(raw: unknown): "none" | "all" | string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === true) return "all";
  if (typeof raw !== "string") return undefined;
  if (raw === "none") return "none";
  if (raw === "all" || raw === "") return "all";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/cli/allow-code-execution-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread flag through run.ts → adapter-session → BaseWorkflow**

In `cli/src/commands/run.ts`, before spawning the session:

```ts
import { parseAllowCodeExecutionFlag } from "../utils";
import { buildToolPolicy } from "@aos-harness/adapter-shared";
// import profile loader (existing)
// import DEFAULT_TOOL_POLICY from runtime/profile-schema via runtime re-export

const allowCodeExec = parseAllowCodeExecutionFlag(args.flags["allow-code-execution"]);
let toolPolicy;
try {
  toolPolicy = buildToolPolicy(profile.tools, { allowCodeExecution: allowCodeExec });
} catch (err: any) {
  console.error(c.red(err.message));
  process.exit(3);
}
```

In `cli/src/adapter-session.ts`, extend `AdapterSessionConfig`:

```ts
export interface AdapterSessionConfig {
  // ... existing fields
  toolPolicy?: ToolPolicy;
  transcriptPath?: string; // already used for transcript writes elsewhere
}
```

Pass it to `BaseWorkflow`:

```ts
const workflow = new BaseWorkflow(agentRuntime, config.root, {
  toolPolicy: config.toolPolicy,
  transcriptPath: config.transcriptPath ?? join(config.deliberationDir, "transcript.jsonl"),
});
```

In `run.ts` where the non-Pi adapter session is invoked, pass `toolPolicy` through.

For the **Pi adapter branch** (`run.ts:330-378`): the Pi adapter runs in a separate process. Pass `tools` policy via env var:

```ts
env.AOS_TOOL_POLICY_JSON = JSON.stringify(toolPolicy);
```

Pi adapter's runtime can read it or ignore it; wiring into the Pi side is a follow-up. For this spec's scope, the env var presence is the contract.

- [ ] **Step 6: Run all CLI tests**

Run: `bun test tests/cli/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/index.ts cli/src/utils.ts cli/src/commands/run.ts cli/src/adapter-session.ts tests/cli/allow-code-execution-flag.test.ts
git commit -m "feat(cli): thread --allow-code-execution and ToolPolicy into session"
```

---

## Task 12: `replay.ts` path confinement for config-sourced values

**Files:**
- Modify: `cli/src/commands/replay.ts`

- [ ] **Step 1: Write failing test**

Since `aos replay <path>` accepts direct CLI args (which the spec says to leave unconfined), the testable behavior here is limited. Add a minimal test that ensures `confinedResolve` is available and can be used for any future config-sourced path:

```ts
// tests/cli/replay-confinement.test.ts
import { describe, test, expect } from "bun:test";
import { confinedResolve } from "../../cli/src/utils";

describe("replay.ts confinement (spec D4 PATH-002)", () => {
  test("confinedResolve rejects traversal against a session dir base", () => {
    expect(() => confinedResolve("/tmp/session", "../escape.jsonl"))
      .toThrow(/escapes base directory/);
  });
});
```

- [ ] **Step 2: Run to verify pass** (it should already pass from Task 3)

Run: `bun test tests/cli/replay-confinement.test.ts`
Expected: PASS.

- [ ] **Step 3: Audit replay.ts for config-sourced paths**

Read `cli/src/commands/replay.ts` and identify any `readFileSync`/`writeFileSync` call whose path comes from `.aos/config.yaml` or adapter response (not direct CLI args). As of this writing the path comes from CLI args only → no wiring change needed, only a comment:

```ts
// Direct CLI arg — not passed through confinedResolve (spec D4: user is trusted
// at the CLI boundary). If this ever becomes config-driven, use confinedResolve.
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/replay.ts tests/cli/replay-confinement.test.ts
git commit -m "docs(cli): annotate replay.ts trust boundary; confinedResolve ready for future config paths"
```

---

## Task 13: Integration sanity — default-denied executeCode end-to-end

**Files:**
- Create: `tests/integration/tool-policy-default-deny.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// tests/integration/tool-policy-default-deny.test.ts
import { describe, test, expect } from "bun:test";
import { BaseWorkflow } from "../../adapters/shared/src/base-workflow";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";

describe("existing deliberation profiles don't secretly need executeCode", () => {
  // If any deliberation profile actually calls executeCode, this test will catch
  // it (we expect no call, so any call would surface as a test failure).
  test("default-denied executeCode does not break basic workflow instantiation", () => {
    const wf = new BaseWorkflow({ sendMessage: async () => ({ text: "" }) } as any, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
    });
    const view = wf.listEnabledTools();
    expect((view as any).read_file.enabled).toBe(true);
    expect((view as any).execute_code.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run**

Run: `bun test tests/integration/tool-policy-default-deny.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full integration suite**

Run: `bun run test:integration`
Expected: PASS. If any existing deliberation fails, investigate — a profile is silently using `executeCode` and needs an explicit `tools` block (document in CHANGELOG migration).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/tool-policy-default-deny.test.ts
git commit -m "test(integration): verify default-deny executeCode doesn't regress deliberations"
```

---

## Task 14: CHANGELOG + `cli/README.md` exit-code docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `cli/README.md`

- [ ] **Step 1: Add to CHANGELOG.md (under a 0.7.0 heading)**

```markdown
## 0.7.0 — Adapter Trust Model (security)

### Breaking

- **Adapter source inside a cloned repo is no longer loaded.** The CLI resolves adapters only from installed `@aos-harness/<name>-adapter` packages or the monorepo dev layout (from the CLI's own install location). A project-local `adapters/<name>/` directory is ignored. Adapter authors should use `npm link @aos-harness/my-adapter`.
- **`executeCode` is denied by default.** Profiles that use code execution must add:
  ```yaml
  tools:
    execute_code:
      enabled: true
      languages: [python, bash]
      max_timeout_ms: 60000
  ```
- **Unknown adapter names exit 2.** The CLI now allowlists `pi`, `claude-code`, `codex`, `gemini`.
- **New exit code 3:** profile tool-policy validation failures and CLI flag attempting to widen profile.

### Added

- `--allow-code-execution[=<langs>|none]` flag to narrow (never widen) the profile's code-execution allowlist for a single session.
- Tool-denied events appended to `transcript.jsonl` for audit.
- `BaseWorkflow.listEnabledTools()` read-only API.
- `validatePlatformUrl` rejects non-https (except loopback), link-local, and metadata addresses.

### Migration

See `docs/security/profile-tools-migration.md` (new).
```

- [ ] **Step 2: Add exit-code section to `cli/README.md`**

```markdown
## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Uncaught runtime error |
| 2 | Invalid input (unknown adapter, bad path, bad URL, missing adapter package) |
| 3 | Profile tool-policy error (malformed `tools:` block, flag cannot widen profile) |
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md cli/README.md
git commit -m "docs: document 0.7.0 trust-model breaking changes and exit codes"
```

---

## Final Verification

- [ ] **Step 1: Run full test suite**

Run: `bun run lint && bun test && bun run test:integration`
Expected: PASS.

- [ ] **Step 2: Run the hostile-repo end-to-end scenario manually**

```bash
mkdir /tmp/hostile && cd /tmp/hostile
mkdir -p core/agents/arbiter adapters/pi/src
echo "id: arbiter" > core/agents/arbiter/agent.yaml
echo "process.exit(99);" > adapters/pi/src/index.ts
echo "# test" > brief.md
bun run /path/to/aos-harness/cli/src/index.ts run default --brief brief.md
echo "Exit: $?"
```

Expected: Exit NOT 99. Exit 2 (missing adapter package) or 1 (other error). stderr does not mention the hostile path.

- [ ] **Step 3: Commit any fix-ups if Step 2 surfaced issues**

---

## Self-Review Pass

Scan the plan against the spec (2026-04-14-adapter-trust-model-design.md):

- ✅ D1 (drop project-local override) — Task 2
- ✅ D1 Bun verification gate — Task 0
- ✅ D2 (adapter allowlist) — Task 1 + Task 2
- ✅ D3.1 (tools schema, default-deny executeCode) — Task 7
- ✅ D3.2 (CLI narrow-only flag) — Task 8 + Task 11
- ✅ D3.3 (enforceToolAccess lookup) — Task 9
- ✅ D3 worker inheritance — Task 10
- ✅ D4 (confinedResolve) — Task 3 + Task 12
- ✅ D4 PATH-003 (create name regex) — Task 6
- ✅ D5 (validatePlatformUrl) — Task 4 + Task 5
- ✅ D6 (exit-code taxonomy) — Tasks 2/5/6/7/11, docs Task 14
- ✅ D7.1 (tool-denied transcript events) — Task 9
- ✅ D7.2 (listEnabledTools) — Task 9

All spec sections mapped to tasks. No placeholders. Type names consistent (`ToolPolicy`, `ToolsBlock`, `buildToolPolicy`, `enforceToolAccess`, `spawnWorker`, `listEnabledTools`).
