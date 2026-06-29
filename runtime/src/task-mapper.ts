// ── task-mapper (Phase 3) ────────────────────────────────────────
//
// The SINGLE place the A2A 9-state Task lifecycle collapses onto AOS's
// request/response AgentResponse{text,status,cost}. Keeping this impedance in
// one pure, testable module is a deliberate design choice (the rest of the
// engine stays request/response and never learns about A2A states).
//
// State → status: completed→success; failed/rejected→failed; canceled→aborted;
// input-required/auth-required→success (a question IS a contribution — the
// pause is surfaced via a2aPaused for a future continue-same-task round).
// Remote cost is always 0 here (we have no trustworthy token counts); the
// unmetered default keeps it out of budget gating cleanly.

import type { AgentResponse } from "./types";
import type { A2aTask, A2aMessage, A2aPart } from "./a2a-client";

export function partsToText(parts: A2aPart[] | undefined): string {
  return (parts ?? [])
    .map((p) => {
      if (p.kind === "text") return p.text ?? "";
      // JSON.stringify(undefined) returns undefined (not a string), which would
      // crash the downstream .filter — coerce to "".
      if (p.kind === "data") return typeof p.data === "string" ? p.data : (JSON.stringify(p.data) ?? "");
      if (p.kind === "file") return `[file: ${p.file?.name ?? p.file?.uri ?? "binary"}]`;
      return "";
    })
    .filter((s) => s.length > 0)
    .join("\n");
}

export function taskToText(task: A2aTask): string {
  const fromArtifacts = (task.artifacts ?? [])
    .map((a) => partsToText(a.parts))
    .filter((s) => s.length > 0)
    .join("\n\n");
  if (fromArtifacts) return fromArtifacts;
  if (task.status.message) return partsToText(task.status.message.parts);
  return "";
}

function isTask(x: A2aTask | A2aMessage): x is A2aTask {
  const status = (x as A2aTask).status;
  return !!status && typeof status.state === "string";
}

export function mapStateToStatus(state: string): AgentResponse["status"] {
  switch (state) {
    case "canceled":
      return "aborted";
    case "failed":
    case "rejected":
      return "failed";
    default:
      // completed, input-required, auth-required, working, submitted, unknown
      return "success";
  }
}

export interface A2aMapResult extends AgentResponse {
  a2aState?: string;
  a2aTaskId?: string;
  a2aContextId?: string;
  a2aPaused?: boolean;
}

/** Collapse a final A2A Task (or bare Message) into an AgentResponse. */
export function a2aToAgentResponse(result: A2aTask | A2aMessage, model = "a2a"): A2aMapResult {
  const base: AgentResponse = {
    text: "",
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    contextTokens: 0,
    model,
    status: "success",
  };

  if (!isTask(result)) {
    return { ...base, text: partsToText(result.parts), a2aContextId: result.contextId };
  }

  const task = result;
  const status = mapStateToStatus(task.status.state);
  const paused = task.status.state === "input-required" || task.status.state === "auth-required";
  const out: A2aMapResult = {
    ...base,
    text: taskToText(task),
    status,
    a2aState: task.status.state,
    a2aTaskId: task.id,
    a2aContextId: task.contextId,
    a2aPaused: paused,
  };
  if (status === "failed") {
    out.error = out.text || `remote task ${task.status.state}`;
  }
  return out;
}
