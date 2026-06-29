import { describe, it, expect } from "bun:test";
import { DomainEnforcer } from "../src/domain-enforcer";
import type { DomainRules } from "../src/types";

describe("DomainEnforcer — path matching", () => {
  const rules: DomainRules = {
    rules: [
      { path: "apps/web/**", read: true, write: true, delete: false },
      { path: "apps/web/components/**", read: true, write: false, delete: false },
      { path: "apps/api/**", read: true, write: false, delete: false },
      { path: "**/*.env*", read: false, write: false, delete: false },
    ],
  };
  const enforcer = new DomainEnforcer(rules);

  it("allows read on matched path", () => {
    expect(enforcer.checkFileAccess("apps/web/page.tsx", "read").allowed).toBe(true);
  });
  it("allows write on matched writable path", () => {
    expect(enforcer.checkFileAccess("apps/web/page.tsx", "write").allowed).toBe(true);
  });
  it("denies delete when rule says false", () => {
    const result = enforcer.checkFileAccess("apps/web/page.tsx", "delete");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("delete");
  });
  it("most-specific rule wins — components blocked for write", () => {
    expect(enforcer.checkFileAccess("apps/web/components/Button.tsx", "write").allowed).toBe(false);
  });
  it("most-specific rule wins — components allowed for read", () => {
    expect(enforcer.checkFileAccess("apps/web/components/Button.tsx", "read").allowed).toBe(true);
  });
  it("denies access to .env files regardless of location", () => {
    expect(enforcer.checkFileAccess(".env", "read").allowed).toBe(false);
    expect(enforcer.checkFileAccess("apps/api/.env.local", "read").allowed).toBe(false);
  });
  it("denies access to unmatched paths (deny-by-default)", () => {
    const result = enforcer.checkFileAccess("packages/shared/index.ts", "read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no matching rule");
  });
  it("handles empty rules — denies everything", () => {
    const empty = new DomainEnforcer({ rules: [] });
    expect(empty.checkFileAccess("any/file.ts", "read").allowed).toBe(false);
  });
});

describe("DomainEnforcer — tool access", () => {
  const rules: DomainRules = {
    rules: [],
    tool_allowlist: ["read", "write", "edit", "grep", "glob"],
    tool_denylist: ["bash"],
  };
  const enforcer = new DomainEnforcer(rules);

  it("allows tools in allowlist", () => {
    expect(enforcer.checkToolAccess("read").allowed).toBe(true);
    expect(enforcer.checkToolAccess("write").allowed).toBe(true);
  });
  it("denies tools in denylist (takes precedence)", () => {
    expect(enforcer.checkToolAccess("bash").allowed).toBe(false);
    expect(enforcer.checkToolAccess("bash").reason).toContain("denylist");
  });
  it("denies tools not in allowlist", () => {
    expect(enforcer.checkToolAccess("unknown_tool").allowed).toBe(false);
    expect(enforcer.checkToolAccess("unknown_tool").reason).toContain("not in allowlist");
  });
  it("allows all tools when no allowlist or denylist", () => {
    const noLists = new DomainEnforcer({ rules: [] });
    expect(noLists.checkToolAccess("anything").allowed).toBe(true);
  });
});

describe("DomainEnforcer — bash token analysis", () => {
  const rules: DomainRules = {
    rules: [],
    bash_restrictions: {
      blocked_tokens: [
        { tokens: ["rm", "recursive"], aliases: { recursive: ["-r", "-R", "--recursive"] } },
        { tokens: ["git", "push"] },
        { tokens: ["git", "reset"] },
        { tokens: ["find", "delete"], aliases: { delete: ["-delete", "--delete"] } },
      ],
      blocked_patterns: ["curl.*-X DELETE"],
    },
  };
  const enforcer = new DomainEnforcer(rules);

  it("blocks rm -rf", () => {
    expect(enforcer.checkBashCommand("rm -rf /tmp/foo").allowed).toBe(false);
  });
  it("blocks rm -r -f (split flags)", () => {
    expect(enforcer.checkBashCommand("rm -r -f /tmp/foo").allowed).toBe(false);
  });
  it("blocks rm --recursive --force", () => {
    expect(enforcer.checkBashCommand("rm --recursive --force /tmp/foo").allowed).toBe(false);
  });
  it("blocks git push", () => {
    expect(enforcer.checkBashCommand("git push origin main").allowed).toBe(false);
  });
  it("blocks git reset", () => {
    expect(enforcer.checkBashCommand("git reset --hard HEAD").allowed).toBe(false);
  });
  it("blocks find -delete", () => {
    expect(enforcer.checkBashCommand("find . -name '*.tmp' -delete").allowed).toBe(false);
  });
  it("allows safe rm (no recursive flag)", () => {
    expect(enforcer.checkBashCommand("rm /tmp/single-file.txt").allowed).toBe(true);
  });
  it("allows safe git commands", () => {
    expect(enforcer.checkBashCommand("git status").allowed).toBe(true);
    expect(enforcer.checkBashCommand("git log --oneline").allowed).toBe(true);
  });
  it("blocks curl DELETE via regex pattern", () => {
    expect(enforcer.checkBashCommand("curl -X DELETE https://api.example.com/resource").allowed).toBe(false);
  });
  it("allows curl GET", () => {
    expect(enforcer.checkBashCommand("curl https://api.example.com/resource").allowed).toBe(true);
  });
  it("allows all bash when no restrictions set", () => {
    const noRestrictions = new DomainEnforcer({ rules: [] });
    expect(noRestrictions.checkBashCommand("rm -rf /").allowed).toBe(true);
  });
});
