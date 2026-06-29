import { describe, test, expect } from "bun:test";
import { parseToolsBlock, DEFAULT_TOOL_POLICY, type ToolsBlock } from "../src/profile-schema";

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

  test("rejects array as tools block", () => {
    expect(() => parseToolsBlock([])).toThrow(/array|must be an object/i);
  });

  test("DEFAULT_TOOL_POLICY exported shape matches missing-block result", () => {
    const p: ToolsBlock = DEFAULT_TOOL_POLICY;
    expect(p.execute_code.enabled).toBe(false);
  });
});
