// Turns the docs-shaped fixtures into payloads for a real temp repo: every "/repo" path is rewritten to
// the repo, and the session id becomes the one the kernel test helpers bind.
import { join } from "node:path";
import { SESSION } from "../../../../kernel/tests/hooks/helpers.ts";
import { fx } from "../fixture.ts";

type Obj = Record<string, unknown>;

function retarget(value: unknown, repo: string): unknown {
  if (typeof value === "string") return value === "/repo" || value.startsWith("/repo/") ? repo + value.slice("/repo".length) : value;
  if (Array.isArray(value)) return value.map((v) => retarget(v, repo));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retarget(v, repo)]));
  }
  return value;
}

export interface Patch {
  /** A path relative to the repo, set as tool_input.file_path. */
  file?: string;
  /** Replaces tool_input.command. */
  command?: string;
  /** Merged over the payload's top level. */
  top?: Obj;
}

export function payload(name: string, repo: string, patch: Patch = {}): Obj {
  const p = retarget(fx(name), repo) as Obj;
  p.session_id = SESSION;
  const input = { ...(p.tool_input as Obj | undefined) };
  if (patch.file !== undefined) input.file_path = join(repo, patch.file);
  if (patch.command !== undefined) input.command = patch.command;
  if (p.tool_input !== undefined) p.tool_input = input;
  return { ...p, ...patch.top };
}

/** A PostToolUse payload for the aos_run_start MCP tool, with the response in the given shape. */
export function runStartPayload(repo: string, response: unknown): Obj {
  return {
    ...payload("post-tool-use-write", repo),
    tool_name: "mcp__plugin_aos_aos__aos_run_start",
    tool_input: { brief: "add rate limiting" },
    tool_response: response,
  };
}
