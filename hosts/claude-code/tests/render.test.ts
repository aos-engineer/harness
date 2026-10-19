import { describe, expect, test } from "bun:test";
import type { HookDecision } from "@aos-harness/kernel";
import type { ClaudeEventName } from "../src/events.ts";
import { render } from "../src/render.ts";

const EVENTS: ClaudeEventName[] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "SessionStart", "Stop"];

function json(event: ClaudeEventName, decision: HookDecision): unknown {
  const out = render(event, decision);
  expect(out.exitCode).toBe(0);
  return JSON.parse(out.stdout);
}

describe("render: allow", () => {
  test("allow without notice renders nothing, never permissionDecision allow", () => {
    for (const ev of EVENTS) expect(render(ev, { kind: "allow", notice: null })).toEqual({ stdout: "", exitCode: 0 });
  });

  test("an empty notice counts as no notice", () => {
    for (const ev of EVENTS) expect(render(ev, { kind: "allow", notice: "" })).toEqual({ stdout: "", exitCode: 0 });
  });

  test("a PostToolUse notice goes to the model as additionalContext", () => {
    expect(json("PostToolUse", { kind: "allow", notice: "n" })).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "n" } });
  });

  test("a SessionStart notice goes to the model as additionalContext", () => {
    expect(json("SessionStart", { kind: "allow", notice: "n" })).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "n" } });
  });

  test("Stop and PostToolUseFailure notices go to the user as systemMessage", () => {
    expect(json("Stop", { kind: "allow", notice: "n" })).toEqual({ systemMessage: "n" });
    expect(json("PostToolUseFailure", { kind: "allow", notice: "n" })).toEqual({ systemMessage: "n" });
  });

  test("a PreToolUse notice is a systemMessage and carries no permission decision", () => {
    expect(json("PreToolUse", { kind: "allow", notice: "n" })).toEqual({ systemMessage: "n" });
  });

  test("no allow decision on any event mentions a permission decision", () => {
    for (const ev of EVENTS) {
      for (const notice of [null, "", "n"]) expect(render(ev, { kind: "allow", notice }).stdout).not.toContain("permissionDecision");
    }
  });
});

describe("render: deny and block-stop", () => {
  test("deny renders a PreToolUse permission decision", () => {
    expect(json("PreToolUse", { kind: "deny", reason: "r" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "r" },
    });
  });

  test("block-stop renders decision block", () => {
    expect(json("Stop", { kind: "block-stop", reason: "r" })).toEqual({ decision: "block", reason: "r" });
  });

  test("reasons with quotes and newlines survive as valid JSON", () => {
    const reason = 'gate "verify" pending:\n- run tests';
    expect(json("PreToolUse", { kind: "deny", reason })).toMatchObject({ hookSpecificOutput: { permissionDecisionReason: reason } });
  });

  test("render rejects a deny outside PreToolUse", () => {
    expect(() => render("Stop", { kind: "deny", reason: "r" })).toThrow();
    for (const ev of EVENTS.filter((e) => e !== "PreToolUse")) expect(() => render(ev, { kind: "deny", reason: "r" })).toThrow(/deny/);
  });

  test("render rejects a block-stop outside Stop", () => {
    for (const ev of EVENTS.filter((e) => e !== "Stop")) expect(() => render(ev, { kind: "block-stop", reason: "r" })).toThrow(/block-stop/);
  });

  test("render rejects an unknown decision kind", () => {
    expect(() => render("Stop", { kind: "ask", reason: "r" } as unknown as HookDecision)).toThrow(/unknown decision kind "ask"/);
  });
});
