// The MCP server never sees the host's session id, so the session is bound here instead: after
// aos_run_start succeeds, this hook reads the new run's id out of the tool response.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { projector } from "../projection.ts";
import { runPaths } from "../store/paths.ts";
import { bindSession } from "../store/sessions.ts";
import { appendEvents, loadState } from "../store/store.ts";
import { gitRoot } from "../tree/fingerprint.ts";
import type { HookDecision, HookInput } from "../types.ts";
import { allow, hookActor } from "./context.ts";

// The response shape is undocumented and may nest the result as JSON text inside JSON, so the id is found
// in the serialized response, with or without escaped quotes. The closing quote rejects a longer id.
const RUN_ID = /runId\\?"\s*:\s*\\?"([0-9A-HJKMNP-TV-Z]{26})\\?"/;

/** A decision when this call started a run and bound the session to it; null to carry on as usual. */
export function bindOnRunStart(input: HookInput): HookDecision | null {
  if (input.event !== "post-tool" || input.tool?.kind !== "aos-mcp" || input.tool.aosTool !== "aos_run_start") return null;
  const run = runIdIn(input.result?.raw);
  if (run === null) return null;
  // The same root the MCP server resolves for a run, so a session in a subdirectory binds at the top.
  const root = gitRoot(input.cwd) ?? resolve(input.cwd);
  const loc = { root, run };
  if (!existsSync(runPaths(loc).log)) return null;
  const { state } = loadState(loc, projector);
  bindSession(root, input.host, input.session, run);
  appendEvents(loc, [{ type: "session.bound", actor: hookActor(input), data: { host: input.host, session: input.session } }], projector);
  return allow(`AOS: this session is bound to run ${run} (${state.tier}). Gates apply from now on.`);
}

function runIdIn(raw: unknown): string | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(raw);
  } catch {
    return null; // a cyclic or otherwise unserializable response carries no id we can trust
  }
  return text === undefined ? null : (RUN_ID.exec(text)?.[1] ?? null);
}
