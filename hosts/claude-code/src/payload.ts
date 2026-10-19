// Translates a Claude Code hook payload into the kernel's host-agnostic HookInput. Anything the
// kernel would have to guess about is rejected with PayloadError, so the hook falls back to its
// failure policy instead of acting on a misread payload.
import { isAbsolute, resolve } from "node:path";
import type { HookInput, HookTool, ToolKind } from "@aos-harness/kernel";
import { PayloadError } from "@aos-harness/kernel";
import { HOOK_EVENT, type ClaudeEventName } from "./events.ts";

type Obj = Record<string, unknown>;

const WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Matched by suffix so the tools are recognized whether the server is registered by this plugin
// (mcp__plugin_aos_aos__aos_status) or directly in a project's MCP config (mcp__aos__aos_status).
const AOS_MCP_TOOL = /^mcp__.+__(aos_[a-z0-9_]+)$/;

// Claude Code starts a failed Bash call's error with "Exit code N", then the output. Only the start
// counts: a later line reading "Exit code 0" is program output, and trusting it would turn a
// timed-out or interrupted command into a pass.
const EXIT_CODE_PREFIX = /^Exit code (\d+)/;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function firstString(...vs: unknown[]): string | null {
  for (const v of vs) if (typeof v === "string" && v !== "") return v;
  return null;
}

function requiredString(raw: Obj, key: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v === "") throw new PayloadError(`hook payload has no ${key}`);
  return v;
}

function toolKind(name: string): ToolKind {
  if (name === "Bash") return "bash";
  if (WRITE_TOOLS.has(name)) return "write";
  if (name === "Skill") return "skill";
  if (AOS_MCP_TOOL.test(name)) return "aos-mcp";
  return "other";
}

function toolOf(raw: Obj, cwd: string): HookTool {
  const name = raw.tool_name;
  if (typeof name !== "string" || name === "") throw new PayloadError("tool hook payload has no tool_name");
  const input = raw.tool_input;
  if (!isObj(input)) throw new PayloadError(`${name} hook payload has no tool_input object`);
  const kind = toolKind(name);
  const path = firstString(input.file_path, input.notebook_path);
  return {
    name,
    kind,
    input,
    command: kind === "bash" && typeof input.command === "string" ? input.command : null,
    // resolve() also collapses "..", so a write scope check sees the file that will really change.
    path: path === null ? null : resolve(cwd, path),
    skill: kind === "skill" ? firstString(input.skill, input.name, input.command) : null,
    aosTool: AOS_MCP_TOOL.exec(name)?.[1] ?? null,
  };
}

function resultOf(event: ClaudeEventName, raw: Obj, tool: HookTool | null): HookInput["result"] {
  if (event === "PostToolUseFailure") {
    const error = raw.error;
    if (typeof error !== "string") return { exitCode: null, output: "", raw: error ?? null };
    // An interrupted run did not finish, so whatever status it reports says nothing about the code.
    if (raw.is_interrupt === true) return { exitCode: null, output: error, raw: error };
    const m = EXIT_CODE_PREFIX.exec(error);
    return { exitCode: m ? Number(m[1]) : null, output: error, raw: error };
  }
  if (event !== "PostToolUse") return null;

  const response = raw.tool_response;
  if (tool?.kind !== "bash") return { exitCode: null, output: "", raw: response ?? null };

  // Without a response there is nothing to observe; reading the gap as exit 0 would record a pass.
  if (!isObj(response)) throw new PayloadError("Bash PostToolUse payload has no tool_response object");
  const stdout = typeof response.stdout === "string" ? response.stdout : "";
  const stderr = typeof response.stderr === "string" ? response.stderr : "";
  // Only the plain foreground shape counts as exit 0. The Bash tool also reports some non-zero exits
  // as normal results (grep with no match, diff finding differences, test evaluating false) and
  // explains them in returnCodeInterpretation. Those, backgrounded runs, interrupts, and any shape
  // not recognized here get no exit code rather than a guessed one.
  const code = response.exit_code;
  const plain =
    response.interrupted === false &&
    (response.returnCodeInterpretation === undefined || response.returnCodeInterpretation === null) &&
    (code === undefined || code === null || code === 0) &&
    !isBackgrounded(tool.input, response);
  return { exitCode: plain ? 0 : null, output: stderr === "" ? stdout : `${stdout}\n${stderr}`, raw: response };
}

// A backgrounded command's PostToolUse fires as soon as it starts, before any result exists. The
// response field naming the background task is matched loosely, since only its presence matters.
function isBackgrounded(input: Obj, response: Obj): boolean {
  if (input.run_in_background === true) return true;
  return Object.keys(response).some((k) => /background/i.test(k) && response[k] !== undefined && response[k] !== null && response[k] !== false);
}

export function normalize(event: ClaudeEventName, raw: unknown): HookInput {
  const hookEvent = Object.hasOwn(HOOK_EVENT, event) ? HOOK_EVENT[event] : undefined;
  if (hookEvent === undefined) throw new PayloadError(`unsupported hook event ${JSON.stringify(event)}`);
  if (!isObj(raw)) throw new PayloadError("hook payload is not a JSON object");

  // A mismatch means hooks.json wires this command to the wrong event; acting on it could, for
  // example, read a finished tool call as one still waiting for permission.
  const declared = raw.hook_event_name;
  if (typeof declared === "string" && declared !== event) {
    throw new PayloadError(`hook registered for ${event} received a ${declared} payload`);
  }

  const session = requiredString(raw, "session_id");
  const cwd = requiredString(raw, "cwd");
  if (!isAbsolute(cwd)) throw new PayloadError(`hook payload cwd is not absolute: ${cwd}`);

  const isToolEvent = event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure";
  const tool = isToolEvent ? toolOf(raw, cwd) : null;
  return {
    host: "claude-code",
    event: hookEvent,
    session,
    promptId: optionalString(raw.prompt_id),
    cwd,
    agent: optionalString(raw.agent_id),
    tool,
    result: resultOf(event, raw, tool),
    source: optionalString(raw.source),
    stopHookActive: raw.stop_hook_active === true,
  };
}
