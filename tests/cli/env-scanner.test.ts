import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveAdapterStatus, scanEnvironment } from "../../cli/src/env-scanner";

describe("env-scanner readiness matrix", () => {
  test("deriveAdapterStatus carries Claude API-key warning into ready status", () => {
    const status = deriveAdapterStatus(
      "claude-code",
      {
        present: true,
        path: "/usr/local/bin/claude",
        auth: {
          state: "ready",
          hint: "Claude Code is using ANTHROPIC_API_KEY. If runs fail with 'Invalid API key', unset or refresh the key.",
        },
      },
      {
        installed: true,
        loadable: true,
        store: "bun",
      },
    );

    expect(status.status).toBe("ready");
    expect(status.statusHint).toContain("ANTHROPIC_API_KEY");
  });

  test("deriveAdapterStatus => needs-adapter when vendor CLI is ready but adapter missing", () => {
    const status = deriveAdapterStatus(
      "codex",
      {
        present: true,
        path: "/usr/local/bin/codex",
        auth: { state: "ready" },
      },
      {
        installed: false,
        loadable: false,
        store: "unknown",
      },
    );

    expect(status.status).toBe("needs-adapter");
  });

  test("deriveAdapterStatus => broken for project-local-only adapter", () => {
    const status = deriveAdapterStatus(
      "gemini",
      {
        present: true,
        path: "/usr/local/bin/gemini",
        auth: { state: "ready" },
      },
      {
        installed: false,
        loadable: false,
        store: "project-local",
      },
    );

    expect(status.status).toBe("broken");
  });

  test("scanEnvironment reports ready when vendor CLI and adapter are both usable", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-scan-"));
    const bunGlobal = join(root, "bun-global");
    const pkgDir = join(bunGlobal, "@aos-harness", "codex-adapter");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@aos-harness/codex-adapter", version: "0.7.1" }));
    writeFileSync(
      join(pkgDir, "src", "index.ts"),
      `export async function probeAdapterInfo() {
  return { info: { runtime: "codex" } };
}
`,
    );

    const scan = await scanEnvironment({
      cwd: root,
      env: {},
      bunGlobalDir: bunGlobal,
      npmGlobalDir: null,
      probeVendorCli: async () => ({
        present: true,
        path: "/usr/local/bin/codex",
        auth: { state: "ready" },
      }),
      resolveAdapterDir: () => pkgDir,
    });

    expect(scan.adapters.codex.status).toBe("ready");
    expect(scan.adapters.codex.aosAdapter.store).toBe("bun");
    expect(scan.adapters.codex.info).toEqual({ runtime: "codex" });
  });

  test("scanEnvironment reports broken for project-local-only install", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-scan-"));
    const projectLocal = join(root, "node_modules", "@aos-harness", "gemini-adapter");
    mkdirSync(projectLocal, { recursive: true });
    writeFileSync(join(projectLocal, "package.json"), JSON.stringify({ name: "@aos-harness/gemini-adapter", version: "0.7.1" }));

    const scan = await scanEnvironment({
      cwd: root,
      env: {},
      bunGlobalDir: null,
      npmGlobalDir: null,
      probeVendorCli: async () => ({
        present: true,
        path: "/usr/local/bin/gemini",
        auth: { state: "ready" },
      }),
      resolveAdapterDir: () => null,
    });

    expect(scan.adapters.gemini.status).toBe("broken");
    expect(scan.adapters.gemini.aosAdapter.store).toBe("project-local");
  });

  test("scanEnvironment reports mempalace binary even when socket is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-scan-"));
    const scan = await scanEnvironment({
      cwd: root,
      env: { TMPDIR: join(root, "tmp") },
      bunGlobalDir: null,
      npmGlobalDir: null,
      probeVendorCli: async () => ({
        present: false,
        auth: { state: "unknown" },
      }),
      resolveAdapterDir: () => null,
      findBinary: (name) => (name === "mempalace" ? "/Users/test/.local/bin/mempalace" : null),
    });

    expect(scan.memory.mempalace.available).toBe(false);
    expect(scan.memory.mempalace.binaryInstalled).toBe(true);
    expect(scan.memory.mempalace.binaryPath).toBe("/Users/test/.local/bin/mempalace");
    expect(scan.notes.some((note) => note.includes("MEMPALACE_SOCKET"))).toBe(true);
  });

  test("scanEnvironment marks adapter broken when installed package cannot be imported", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-scan-"));
    const bunGlobal = join(root, "bun-global");
    const pkgDir = join(bunGlobal, "@aos-harness", "pi-adapter");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@aos-harness/pi-adapter", version: "0.7.1" }));
    writeFileSync(join(pkgDir, "src", "index.ts"), `throw new Error("boom");\n`);

    const scan = await scanEnvironment({
      cwd: root,
      env: {},
      bunGlobalDir: bunGlobal,
      npmGlobalDir: null,
      probeVendorCli: async () => ({
        present: true,
        path: "/usr/local/bin/pi",
        auth: { state: "ready" },
      }),
      resolveAdapterDir: () => pkgDir,
    });

    expect(scan.adapters.pi.status).toBe("broken");
    expect(scan.notes.some((note) => note.includes("could not be imported"))).toBe(true);
  });
});
