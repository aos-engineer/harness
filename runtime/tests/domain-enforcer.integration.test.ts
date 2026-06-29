import { describe, it, expect } from "bun:test";
import { DomainEnforcer } from "../src/domain-enforcer";
import type { DomainRules, EnforcementResult, ToolCommand } from "../src/types";
import { MockAdapter } from "./mock-adapter";

// ── Test 1: DomainEnforcer with DomainRules directly ──────────────────────────

describe("DomainEnforcer — direct rule enforcement", () => {
  const rules: DomainRules = {
    rules: [
      // Allow read+write under src/ broadly
      { path: "src/**", read: true, write: true, delete: false },
      // Deny write under src/config/ (more specific — should win over src/**)
      { path: "src/config/**", read: true, write: false, delete: false },
    ],
    tool_allowlist: ["read", "write", "edit"],
    tool_denylist: ["bash"],
  };

  const enforcer = new DomainEnforcer(rules);

  // ── Path enforcement ─────────────────────────────────────────────────────

  it("allows read on src/ path", () => {
    const result = enforcer.checkFileAccess("src/index.ts", "read");
    expect(result.allowed).toBe(true);
  });

  it("allows write on src/ path", () => {
    const result = enforcer.checkFileAccess("src/index.ts", "write");
    expect(result.allowed).toBe(true);
  });

  it("allows read on src/config/ path", () => {
    const result = enforcer.checkFileAccess("src/config/settings.ts", "read");
    expect(result.allowed).toBe(true);
  });

  it("denies write on src/config/ path (more specific rule wins)", () => {
    const result = enforcer.checkFileAccess("src/config/settings.ts", "write");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("write denied");
  });

  it("denies access to unmatched paths", () => {
    const result = enforcer.checkFileAccess("vendor/lib/something.ts", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no matching rule");
  });

  it("denies delete on src/ path (rule disallows delete)", () => {
    const result = enforcer.checkFileAccess("src/utils.ts", "delete");
    expect(result.allowed).toBe(false);
  });

  // ── Tool enforcement ─────────────────────────────────────────────────────

  it("allows a tool in the allowlist (read)", () => {
    const result = enforcer.checkToolAccess("read");
    expect(result.allowed).toBe(true);
  });

  it("allows a tool in the allowlist (write)", () => {
    const result = enforcer.checkToolAccess("write");
    expect(result.allowed).toBe(true);
  });

  it("denies bash tool — present in denylist", () => {
    const result = enforcer.checkToolAccess("bash");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denylist");
  });

  it("denies unknown tool — not in allowlist", () => {
    const result = enforcer.checkToolAccess("unknown_tool");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in allowlist");
  });
});

// ── Test 2: enforceToolAccess on MockAdapter with domainEnforcerOverride ──────

describe("MockAdapter — enforceToolAccess with domainEnforcerOverride", () => {
  const rules: DomainRules = {
    rules: [
      { path: "src/**", read: true, write: true, delete: false },
      { path: "src/config/**", read: true, write: false, delete: false },
    ],
    tool_allowlist: ["read", "write"],
    tool_denylist: ["bash"],
  };

  const enforcer = new DomainEnforcer(rules);

  function makeAdapter(): MockAdapter {
    const adapter = new MockAdapter();
    adapter.domainEnforcerOverride = (
      _agentId: string,
      toolCall: { tool: string; path?: string; command?: string | ToolCommand },
    ): EnforcementResult => {
      // Check tool access first
      const toolResult = enforcer.checkToolAccess(toolCall.tool);
      if (!toolResult.allowed) return toolResult;

      // If a path is provided, check file access (default to "read" for read-like tools)
      if (toolCall.path) {
        const op = toolCall.tool === "write" ? "write" : "read";
        return enforcer.checkFileAccess(toolCall.path, op);
      }

      return { allowed: true };
    };
    return adapter;
  }

  it("allows read tool on src/ path", async () => {
    const adapter = makeAdapter();
    const result = await adapter.enforceToolAccess("agent-a", {
      tool: "read",
      path: "src/utils.ts",
    });
    expect(result.allowed).toBe(true);
    expect(adapter.calls.some((c) => c.method === "enforceToolAccess")).toBe(true);
  });

  it("allows write tool on src/ path", async () => {
    const adapter = makeAdapter();
    const result = await adapter.enforceToolAccess("agent-a", {
      tool: "write",
      path: "src/feature.ts",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies write tool on src/config/ path", async () => {
    const adapter = makeAdapter();
    const result = await adapter.enforceToolAccess("agent-a", {
      tool: "write",
      path: "src/config/env.ts",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("denies bash tool regardless of path", async () => {
    const adapter = makeAdapter();
    const result = await adapter.enforceToolAccess("agent-b", {
      tool: "bash",
      command: "rm -rf /",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denylist");
  });

  it("denies unknown tool not in allowlist", async () => {
    const adapter = makeAdapter();
    const result = await adapter.enforceToolAccess("agent-b", {
      tool: "network_request",
      path: "src/api.ts",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in allowlist");
  });

  it("denies read tool on unmatched path", async () => {
    const adapter = makeAdapter();
    const result = await adapter.enforceToolAccess("agent-a", {
      tool: "read",
      path: "vendor/external/lib.ts",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no matching rule");
  });

  it("records all enforceToolAccess calls", async () => {
    const adapter = makeAdapter();
    await adapter.enforceToolAccess("agent-a", { tool: "read", path: "src/a.ts" });
    await adapter.enforceToolAccess("agent-a", { tool: "bash" });
    const enforceCalls = adapter.calls.filter((c) => c.method === "enforceToolAccess");
    expect(enforceCalls.length).toBe(2);
  });
});
