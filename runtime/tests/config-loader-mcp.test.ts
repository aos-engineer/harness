import { test, expect, describe, afterAll } from "bun:test";
import { loadMcp, discoverMcpRegistries } from "../src/config-loader";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];
function writeMcp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aos-mcp-"));
  created.push(dir);
  writeFileSync(join(dir, "mcp.yaml"), content);
  return dir;
}
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe("loadMcp (aos/mcp/v1)", () => {
  test("loads a valid stdio + http registry", () => {
    const dir = writeMcp(
      [
        "schema: aos/mcp/v1",
        "id: tools",
        "description: external tools",
        "servers:",
        "  - id: github",
        "    transport: stdio",
        "    command: bunx",
        '    args: ["-y", "@modelcontextprotocol/server-github"]',
        "    env:",
        '      GITHUB_TOKEN: "${GH_TOKEN}"',
        "  - id: sonar",
        "    transport: http",
        "    url: https://sonar.example.com/mcp",
        "    auth_ref: SONAR_TOKEN",
        '    tool_allowlist: ["analyze"]',
      ].join("\n"),
    );
    const cfg = loadMcp(dir);
    expect(cfg.id).toBe("tools");
    expect(cfg.servers).toHaveLength(2);
    expect(cfg.servers[0]!.command).toBe("bunx");
    expect(cfg.servers[0]!.env?.GITHUB_TOKEN).toBe("${GH_TOKEN}");
    expect(cfg.servers[1]!.transport).toBe("http");
    expect(cfg.servers[1]!.tool_allowlist).toEqual(["analyze"]);
  });

  test("rejects the wrong schema const", () => {
    const dir = writeMcp("schema: aos/agent/v1\nid: x\nservers: []");
    expect(() => loadMcp(dir)).toThrow(/Unknown schema/);
  });

  test("rejects a stdio server without command", () => {
    const dir = writeMcp("schema: aos/mcp/v1\nid: x\nservers:\n  - id: a\n    transport: stdio");
    expect(() => loadMcp(dir)).toThrow(/requires "command"/);
  });

  test("rejects an http server without url", () => {
    const dir = writeMcp("schema: aos/mcp/v1\nid: x\nservers:\n  - id: a\n    transport: http");
    expect(() => loadMcp(dir)).toThrow(/requires "url"/);
  });

  test("rejects an invalid transport", () => {
    const dir = writeMcp("schema: aos/mcp/v1\nid: x\nservers:\n  - id: a\n    transport: carrier-pigeon");
    expect(() => loadMcp(dir)).toThrow(/invalid transport/);
  });

  test("rejects duplicate server ids", () => {
    const dir = writeMcp(
      "schema: aos/mcp/v1\nid: x\nservers:\n  - id: a\n    transport: stdio\n    command: foo\n  - id: a\n    transport: stdio\n    command: bar",
    );
    expect(() => loadMcp(dir)).toThrow(/Duplicate MCP server id/);
  });

  test("rejects an empty servers list", () => {
    const dir = writeMcp("schema: aos/mcp/v1\nid: x\nservers: []");
    expect(() => loadMcp(dir)).toThrow(/at least one server/);
  });

  test("rejects a bad id (uppercase)", () => {
    const dir = writeMcp("schema: aos/mcp/v1\nid: BadId\nservers:\n  - id: a\n    transport: stdio\n    command: foo");
    expect(() => loadMcp(dir)).toThrow(/Invalid ID/);
  });
});

describe("discoverMcpRegistries", () => {
  function makeProject(): string {
    const root = mkdtempSync(join(tmpdir(), "aos-proj-"));
    created.push(root);
    return root;
  }

  test("returns [] when core/mcp is absent", () => {
    expect(discoverMcpRegistries(makeProject())).toEqual([]);
  });

  test("loads registries from subdirectories and top-level files", () => {
    const root = makeProject();
    // subdir form: core/mcp/tools/mcp.yaml
    const sub = join(root, "core", "mcp", "tools");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "mcp.yaml"),
      "schema: aos/mcp/v1\nid: tools\nservers:\n  - id: a\n    transport: stdio\n    command: foo",
    );
    // top-level file form: core/mcp/more.yaml
    writeFileSync(
      join(root, "core", "mcp", "more.yaml"),
      "schema: aos/mcp/v1\nid: more\nservers:\n  - id: b\n    transport: stdio\n    command: bar",
    );

    const regs = discoverMcpRegistries(root);
    expect(regs.map((r) => r.id).sort()).toEqual(["more", "tools"]);
  });

  test("propagates a malformed registry error", () => {
    const root = makeProject();
    const sub = join(root, "core", "mcp", "broken");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "mcp.yaml"), "schema: aos/mcp/v1\nid: broken\nservers: []");
    expect(() => discoverMcpRegistries(root)).toThrow(/at least one server/);
  });
});
