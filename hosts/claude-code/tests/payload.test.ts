import { describe, expect, test } from "bun:test";
import { PayloadError } from "@aos-harness/kernel";
import { normalize } from "../src/payload.ts";
import { fx, withTool } from "./fixture.ts";

function preTool(toolName: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  return { ...fx("pre-tool-use-write"), tool_name: toolName, tool_input: toolInput };
}

describe("normalize: Bash results", () => {
  test("Bash success normalizes to exit 0 with stdout and stderr", () => {
    expect(normalize("PostToolUse", fx("post-tool-use-bash-true")).result).toMatchObject({ exitCode: 0 });
    expect(normalize("PostToolUse", fx("post-tool-use-bash-stdout-stderr")).result).toMatchObject({ exitCode: 0, output: "out\nerr" });
  });

  test("Bash success without stderr keeps stdout exactly", () => {
    const raw = { ...fx("post-tool-use-bash-true"), tool_response: { stdout: "ok\n", stderr: "", interrupted: false, isImage: false } };
    expect(normalize("PostToolUse", raw).result?.output).toBe("ok\n");
  });

  function bashWith(response: Record<string, unknown>): Record<string, unknown> {
    const raw = fx("post-tool-use-bash-true");
    raw.tool_response = { ...(raw.tool_response as Record<string, unknown>), ...response };
    return raw;
  }

  test("a non-zero exit the Bash tool reports as a normal result has no exit code", () => {
    expect(normalize("PostToolUse", fx("post-tool-use-bash-grep-no-match")).result?.exitCode).toBeNull();
    for (const text of ["Condition is false", "Files differ", ""]) {
      expect(normalize("PostToolUse", bashWith({ returnCodeInterpretation: text })).result?.exitCode).toBeNull();
    }
  });

  test("a non-zero or non-numeric exit_code in a PostToolUse response has no exit code", () => {
    expect(normalize("PostToolUse", bashWith({ exit_code: 7 })).result?.exitCode).toBeNull();
    expect(normalize("PostToolUse", bashWith({ exit_code: "0" })).result?.exitCode).toBeNull();
  });

  test("an exit_code of 0 on the plain foreground shape is exit 0", () => {
    expect(normalize("PostToolUse", bashWith({ exit_code: 0 })).result?.exitCode).toBe(0);
  });

  test("a response that does not say interrupted is false has no exit code", () => {
    const raw = bashWith({});
    delete (raw.tool_response as Record<string, unknown>).interrupted;
    expect(normalize("PostToolUse", raw).result?.exitCode).toBeNull();
    expect(normalize("PostToolUse", bashWith({ interrupted: "false" })).result?.exitCode).toBeNull();
  });

  test("a background Bash run has no exit code, since PostToolUse fires before it finishes", () => {
    expect(normalize("PostToolUse", fx("post-tool-use-bash-background")).result?.exitCode).toBeNull();
  });

  test("run_in_background alone marks a Bash run as backgrounded", () => {
    const raw = fx("post-tool-use-bash-true");
    raw.tool_input = { ...(raw.tool_input as Record<string, unknown>), run_in_background: true };
    expect(normalize("PostToolUse", raw).result?.exitCode).toBeNull();
  });

  test("a background task id in the response alone marks a Bash run as backgrounded", () => {
    for (const key of ["backgroundTaskId", "background_task_id"]) {
      const raw = fx("post-tool-use-bash-true");
      raw.tool_response = { ...(raw.tool_response as Record<string, unknown>), [key]: "bash_1" };
      expect(normalize("PostToolUse", raw).result?.exitCode).toBeNull();
    }
  });

  test("an interrupted Bash run has no exit code", () => {
    const raw = { ...fx("post-tool-use-bash-true"), tool_response: { stdout: "", stderr: "", interrupted: true, isImage: false } };
    expect(normalize("PostToolUse", raw).result?.exitCode).toBeNull();
  });

  test("a Bash PostToolUse without a response object throws rather than reading as a pass", () => {
    const raw = { ...fx("post-tool-use-bash-true") };
    delete raw.tool_response;
    expect(() => normalize("PostToolUse", raw)).toThrow(PayloadError);
    expect(() => normalize("PostToolUse", { ...raw, tool_response: "ok" })).toThrow(PayloadError);
  });

  test("result.raw is the original tool_response", () => {
    const raw = fx("post-tool-use-bash-stdout-stderr");
    expect(normalize("PostToolUse", raw).result?.raw).toEqual(raw.tool_response);
  });
});

describe("normalize: failures", () => {
  test("Bash failure parses Exit code N", () => {
    expect(normalize("PostToolUseFailure", fx("post-tool-use-failure-bash-exit3")).result?.exitCode).toBe(3);
  });

  test("a failure keeps the whole error as output and raw", () => {
    const raw = fx("post-tool-use-failure-bash-test-fail");
    expect(normalize("PostToolUseFailure", raw).result).toEqual({ exitCode: 1, output: raw.error as string, raw: raw.error });
  });

  test("Exit code is read only from the start of the error, so program output cannot fake a status", () => {
    const raw = { ...fx("post-tool-use-failure-bash-exit3"), error: "Command timed out after 2m\nExit code 0" };
    expect(normalize("PostToolUseFailure", raw).result?.exitCode).toBeNull();
  });

  test("a failure with no Exit code prefix (timeout, interrupt) has no exit code", () => {
    const raw = { ...fx("post-tool-use-failure-bash-exit3"), error: "Interrupted by user", is_interrupt: true };
    expect(normalize("PostToolUseFailure", raw).result).toEqual({ exitCode: null, output: "Interrupted by user", raw: "Interrupted by user" });
  });

  test("a failure whose error is not a string has no exit code and empty output", () => {
    const raw = { ...fx("post-tool-use-failure-bash-exit3"), error: { message: "Exit code 2" } };
    expect(normalize("PostToolUseFailure", raw).result).toEqual({ exitCode: null, output: "", raw: { message: "Exit code 2" } });
  });
});

describe("normalize: other results", () => {
  test("a non-Bash PostToolUse carries the response only as raw", () => {
    const raw = fx("post-tool-use-write");
    expect(normalize("PostToolUse", raw).result).toEqual({ exitCode: null, output: "", raw: raw.tool_response });
  });

  test("PreToolUse, SessionStart, and Stop have no result", () => {
    expect(normalize("PreToolUse", fx("pre-tool-use-bash-true")).result).toBeNull();
    expect(normalize("SessionStart", fx("session-start-startup")).result).toBeNull();
    expect(normalize("Stop", fx("stop")).result).toBeNull();
  });
});

describe("normalize: tools", () => {
  test("Write and Edit carry an absolute path", () => {
    expect(normalize("PreToolUse", fx("pre-tool-use-write")).tool).toMatchObject({ kind: "write", path: "/repo/a.txt" });
    expect(normalize("PreToolUse", fx("pre-tool-use-edit")).tool).toMatchObject({ kind: "write", path: "/repo/a.txt" });
  });

  test("NotebookEdit and MultiEdit are writes; NotebookEdit's path comes from notebook_path", () => {
    expect(normalize("PreToolUse", fx("pre-tool-use-notebook-edit")).tool).toMatchObject({ kind: "write", path: "/repo/n.ipynb" });
    expect(normalize("PreToolUse", preTool("MultiEdit", { file_path: "/repo/a.txt", edits: [] })).tool).toMatchObject({ kind: "write", path: "/repo/a.txt" });
  });

  test("a relative path resolves against cwd", () => {
    expect(normalize("PreToolUse", preTool("Write", { file_path: "src/a.ts", content: "" })).tool?.path).toBe("/repo/src/a.ts");
  });

  test("dot-dot segments are resolved, so a scope check sees the real target", () => {
    expect(normalize("PreToolUse", preTool("Write", { file_path: "docs/specs/../../.aos/runs/x", content: "" })).tool?.path).toBe("/repo/.aos/runs/x");
    expect(normalize("PreToolUse", preTool("Edit", { file_path: "/repo/docs/specs/../../.aos/state.json" })).tool?.path).toBe("/repo/.aos/state.json");
  });

  test("an empty or missing path is null", () => {
    expect(normalize("PreToolUse", preTool("Write", { file_path: "", content: "" })).tool?.path).toBeNull();
    expect(normalize("PreToolUse", preTool("Write", { content: "" })).tool?.path).toBeNull();
  });

  test("Bash carries its command; other tools do not", () => {
    expect(normalize("PreToolUse", fx("pre-tool-use-bash-true")).tool).toMatchObject({ kind: "bash", name: "Bash", command: "true", path: null, skill: null, aosTool: null });
    expect(normalize("PreToolUse", preTool("Write", { file_path: "/repo/a", command: "git push" })).tool?.command).toBeNull();
  });

  test("tool name and input pass through unchanged", () => {
    const raw = fx("pre-tool-use-edit");
    expect(normalize("PreToolUse", raw).tool).toMatchObject({ name: "Edit", input: raw.tool_input as Record<string, unknown> });
  });

  test("Skill carries the skill name", () => {
    expect(normalize("PostToolUse", fx("post-tool-use-skill")).tool?.skill).toBe("superpowers:brainstorming");
    expect(normalize("PostToolUse", fx("post-tool-use-skill")).tool?.kind).toBe("skill");
  });

  test("Skill falls back to name, then command, for the skill field", () => {
    expect(normalize("PostToolUse", withTool("Skill", { name: "a:b" })).tool?.skill).toBe("a:b");
    expect(normalize("PostToolUse", withTool("Skill", { command: "c:d" })).tool?.skill).toBe("c:d");
    expect(normalize("PostToolUse", withTool("Skill", {})).tool?.skill).toBeNull();
  });

  test("aos MCP tools are recognized by suffix", () => {
    expect(normalize("PostToolUse", withTool("mcp__plugin_aos_aos__aos_run_start")).tool).toMatchObject({ kind: "aos-mcp", aosTool: "aos_run_start" });
    expect(normalize("PostToolUse", withTool("mcp__aos__aos_status")).tool).toMatchObject({ kind: "aos-mcp", aosTool: "aos_status" });
  });

  test("other MCP tools and unknown tools are other", () => {
    expect(normalize("PostToolUse", withTool("mcp__github__create_pr")).tool).toMatchObject({ kind: "other", aosTool: null });
    expect(normalize("PostToolUse", withTool("aos_run_start")).tool).toMatchObject({ kind: "other", aosTool: null });
    expect(normalize("PostToolUse", withTool("Read", { file_path: "/repo/a.txt" })).tool?.kind).toBe("other");
  });

  test("SessionStart and Stop have no tool", () => {
    expect(normalize("SessionStart", fx("session-start-startup")).tool).toBeNull();
    expect(normalize("Stop", fx("stop")).tool).toBeNull();
  });
});

describe("normalize: session fields", () => {
  test("carries host, event, session, prompt, and cwd", () => {
    expect(normalize("PreToolUse", fx("pre-tool-use-bash-true"))).toMatchObject({
      host: "claude-code",
      event: "pre-tool",
      session: "SESSION",
      promptId: "PROMPT-1",
      cwd: "/repo",
      agent: null,
    });
  });

  test("subagent payloads carry agent", () => {
    expect(normalize("PreToolUse", fx("pre-tool-use-bash-subagent")).agent).toBe("AGENT-1");
  });

  test("a missing prompt_id is null", () => {
    expect(normalize("SessionStart", fx("session-start-startup")).promptId).toBeNull();
  });

  test("SessionStart carries its source", () => {
    expect(normalize("SessionStart", fx("session-start-compact"))).toMatchObject({ event: "session-start", source: "compact" });
    expect(normalize("PreToolUse", fx("pre-tool-use-bash-true")).source).toBeNull();
  });

  test("Stop carries stop_hook_active only when it is exactly true", () => {
    expect(normalize("Stop", fx("stop-hook-active")).stopHookActive).toBe(true);
    expect(normalize("Stop", fx("stop")).stopHookActive).toBe(false);
    expect(normalize("Stop", { ...fx("stop"), stop_hook_active: "true" }).stopHookActive).toBe(false);
  });
});

describe("normalize: malformed payloads", () => {
  test("missing session_id throws PayloadError", () => {
    expect(() => normalize("Stop", {})).toThrow(PayloadError);
  });

  test("a payload that is not an object throws PayloadError", () => {
    for (const raw of [null, undefined, "x", 3, []]) expect(() => normalize("Stop", raw)).toThrow(PayloadError);
  });

  test("an empty or non-string session_id or cwd throws PayloadError", () => {
    expect(() => normalize("Stop", { ...fx("stop"), session_id: "" })).toThrow(PayloadError);
    expect(() => normalize("Stop", { ...fx("stop"), session_id: 1 })).toThrow(PayloadError);
    expect(() => normalize("Stop", { ...fx("stop"), cwd: undefined })).toThrow(PayloadError);
  });

  test("a relative cwd throws PayloadError, since paths could not be resolved against it", () => {
    expect(() => normalize("PreToolUse", { ...fx("pre-tool-use-write"), cwd: "repo" })).toThrow(PayloadError);
  });

  test("a tool event without a tool name or input object throws PayloadError", () => {
    const raw = fx("pre-tool-use-bash-true");
    expect(() => normalize("PreToolUse", { ...raw, tool_name: undefined })).toThrow(PayloadError);
    expect(() => normalize("PreToolUse", { ...raw, tool_name: "" })).toThrow(PayloadError);
    expect(() => normalize("PreToolUse", { ...raw, tool_input: undefined })).toThrow(PayloadError);
    expect(() => normalize("PreToolUse", { ...raw, tool_input: "true" })).toThrow(PayloadError);
  });

  test("a payload for a different event than the hook was registered for throws PayloadError", () => {
    expect(() => normalize("PreToolUse", fx("post-tool-use-bash-true"))).toThrow(PayloadError);
  });

  test("an event name outside the contract throws PayloadError", () => {
    expect(() => normalize("SubagentStart" as never, { ...fx("stop"), hook_event_name: "SubagentStart" })).toThrow(PayloadError);
  });
});
