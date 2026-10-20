// Runs built straight through the kernel store, so CLI tests depend on the log format and the reference
// pack, not on the MCP tools that normally start runs.
import { join } from "node:path";
import { appendEvents, createRun, loadPack, projector, readLog, ulid } from "@aos-harness/kernel";
import type { Actor, EventEnvelope, EventType, RunLocation, Tier } from "@aos-harness/kernel";

export const PACK_DIR = join(import.meta.dirname, "../../packs/feature-delivery");
export const PACK = loadPack(PACK_DIR);
export const AGENT: Actor = { kind: "agent", id: "mcp:aos_request_approval", agent: null };

export function newRun(root: string, o: { tier?: Tier; git?: boolean; brief?: string } = {}): RunLocation {
  const loc = { root, run: ulid() };
  createRun(loc, {
    type: "run.started",
    actor: AGENT,
    data: { brief: o.brief ?? "add a widget", tier: o.tier ?? "bounded", tierReason: "default", root, git: o.git ?? false, host: "claude-code", pack: PACK },
  }, projector);
  return loc;
}

let requests = 0;
export function request(loc: RunLocation, stage = "design", summary = "Design: one widget, no new dependencies."): string {
  const id = `req_${++requests}`;
  appendEvents(loc, [{ type: "approval.requested", actor: AGENT, data: { request: id, stage, summary } }], projector);
  return id;
}

export function events(loc: RunLocation): EventEnvelope[] {
  return readLog(loc).events;
}

export function types(loc: RunLocation): EventType[] {
  return events(loc).map((e) => e.type);
}

export function lastEvent(loc: RunLocation): EventEnvelope {
  const all = events(loc);
  return all[all.length - 1];
}
