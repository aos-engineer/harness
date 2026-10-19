// The MCP server never sees the host's session id, so the session is bound here instead: after
// aos_run_start succeeds, this hook reads the new run's id out of the tool response.
import { existsSync } from "node:fs";
import { projector } from "../projection.ts";
import { runPaths } from "../store/paths.ts";
import { bindSession } from "../store/sessions.ts";
import { appendEvents, loadState } from "../store/store.ts";
import { gitRoot } from "../tree/fingerprint.ts";
import type { HookDecision, HookInput } from "../types.ts";
import { allow, hookActor } from "./context.ts";
import { physicalPath } from "./paths.ts";

// The response shape is undocumented and may nest the result as JSON text inside JSON, so the id is found
// in the serialized response, with or without escaped quotes. The closing quote rejects a longer id.
const RUN_ID = /runId\\?"\s*:\s*\\?"([0-9A-HJKMNP-TV-Z]{26})\\?"/;

/** A decision when this call started a run and bound the session to it; null to carry on as usual. */
export function bindOnRunStart(input: HookInput, projectDir: string | null): HookDecision | null {
  if (input.event !== "post-tool" || input.tool?.kind !== "aos-mcp" || input.tool.aosTool !== "aos_run_start") return null;
  const run = runIdIn(input.result?.raw);
  if (run === null) return null;
  // The same roots the MCP server could have resolved for the run: the session's cwd, then the directory the
  // session started in, since the agent's shell may have left it.
  const roots = candidateRoots([input.cwd, ...(projectDir === null ? [] : [projectDir])]);
  const root = roots.find((r) => existsSync(runPaths({ root: r, run }).log));
  if (root === undefined) {
    return allow(
      `AOS: could not bind this session to run ${run}: there is no .aos/runs/${run} under ${roots.join(" or ")}. ` +
        "AOS gates do not apply to this session. The aos MCP server may be running from a different directory than this session.",
    );
  }
  const loc = { root, run };
  const { state } = loadState(loc, projector);
  // A new run is always active. Rebinding to a cancelled or completed one would switch enforcement off
  // (or loosen it) for the session, so any other id in the response is ignored.
  if (state.status !== "active") return null;
  bindSession(root, input.host, input.session, run);
  appendEvents(loc, [{ type: "session.bound", actor: hookActor(input), data: { host: input.host, session: input.session } }], projector);
  return allow(`AOS: this session is bound to run ${run} (${state.tier}). Gates apply from now on.`);
}

/**
 * Each directory's repository root, so a session in a subdirectory binds at the top. git already reports a
 * physical path; outside git the directory is resolved the same way, so the binding's root compares equal to
 * the run's however the session reached it.
 */
function candidateRoots(dirs: string[]): string[] {
  const roots: string[] = [];
  for (const dir of dirs) {
    const root = gitRoot(dir) ?? physicalPath(dir);
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
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
