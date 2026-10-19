// Stub: real implementation lands later; signatures are the agreed contract.
import type { GateResult, RunStatus, Tier } from "../types.ts";
import { notImplemented } from "../util/errors.ts";
import type { OpContext } from "./context.ts";

export interface RunStartResult { runId: string; tier: Tier; tierReason: string; stages: string[]; stage: string; instructions: string; notice: string }

export interface StatusResult { runId: string; status: RunStatus; tier: Tier; stage: string; stages: string[]; gate: GateResult; iterations: { used: number; limit: number }; summary: string }

export interface GateCheckResult { gate: GateResult; message: string | null }

export interface StageAdvanceResult { advanced: boolean; completed: boolean; gate: GateResult; stage: string; instructions: string | null; message: string | null }

export type EvidenceInput =
  | { kind: "artifact"; path: string }

  | { kind: "citation"; path: string; line: number; note: string }

  | { kind: "review"; status: "approved" | "rejected" | "needs-revision"; feedback: string; reviewer: string }

  | { kind: "skill"; skill: string };

export function runStart(ctx: OpContext, p: { brief: string; tier?: Tier }): RunStartResult {
  return notImplemented("F");
}

export function runStatus(ctx: OpContext, p: { runId: string }): StatusResult {
  return notImplemented("F");
}

export function gateCheck(ctx: OpContext, p: { runId: string }): GateCheckResult {
  return notImplemented("F");
}

export function stageAdvance(ctx: OpContext, p: { runId: string }): StageAdvanceResult {
  return notImplemented("F");
}

export function taskAdd(ctx: OpContext, p: { runId: string; title: string }): { task: string; stage: string } {
  return notImplemented("F");
}

export function taskComplete(ctx: OpContext, p: { runId: string; task: string; evidence?: string[] }): { task: string; open: number } {
  return notImplemented("F");
}

export function evidenceRecord(ctx: OpContext, p: EvidenceInput & { runId: string }): { evidenceId: string; fingerprint: string } {
  return notImplemented("F");
}

export function requestApproval(ctx: OpContext, p: { runId: string; summary: string }): { request: string; stage: string; instructions: string } {
  return notImplemented("F");
}
