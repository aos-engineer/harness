import { describe, test, expect } from "bun:test";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";
import {
  DEFAULT_TOOL_POLICY,
  type SupportedLanguage,
  type ToolsBlock,
} from "../../runtime/src/profile-schema";

function makeProfile(languages: SupportedLanguage[]): ToolsBlock {
  return {
    ...DEFAULT_TOOL_POLICY,
    execute_code: {
      enabled: true,
      languages,
      max_timeout_ms: 30_000,
    },
  };
}

describe("buildToolPolicy (spec D3)", () => {
  test("no profile, no flags → default policy (execute_code disabled)", () => {
    const p = buildToolPolicy(DEFAULT_TOOL_POLICY, {});
    expect(p.execute_code.enabled).toBe(false);
    // Frozen
    expect(() => { (p as any).execute_code.enabled = true; }).toThrow();
  });

  test("profile allows [python, bash] + flag=python narrows to [python]", () => {
    const profile = makeProfile(["python", "bash"]);
    const p = buildToolPolicy(profile, { allowCodeExecution: ["python"] });
    expect(p.execute_code.enabled).toBe(true);
    expect(p.execute_code.languages).toEqual(["python"]);
  });

  test("profile denies execute_code + --allow-code-execution=python throws (widens)", () => {
    expect(() => buildToolPolicy(DEFAULT_TOOL_POLICY, { allowCodeExecution: ["python"] }))
      .toThrow(/cannot widen/);
  });

  test("--allow-code-execution=none forces deny even if profile allows", () => {
    const profile = makeProfile(["python"]);
    const p = buildToolPolicy(profile, { allowCodeExecution: "none" });
    expect(p.execute_code.enabled).toBe(false);
  });

  test("bare --allow-code-execution with profile allow leaves profile unchanged", () => {
    const profile = makeProfile(["python"]);
    const p = buildToolPolicy(profile, { allowCodeExecution: "all" });
    expect(p.execute_code.languages).toEqual(["python"]);
  });

  test("flag requests a language not in profile's list → throws (partial mismatch)", () => {
    const profile = makeProfile(["python", "bash"]);
    expect(() => buildToolPolicy(profile, { allowCodeExecution: ["ruby"] }))
      .toThrow(/cannot widen|ruby/i);
  });
});
