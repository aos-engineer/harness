// Shared builders and log-tampering tools for the store tests.
import { appendFileSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { GENESIS_PREV } from "../../src/types.ts";
import type { Actor, EventDraft, ResolvedPack, RunLocation, StateFile } from "../../src/types.ts";
import { sha256Tag } from "../../src/util/hash.ts";
import { runPaths } from "../../src/store/paths.ts";

export const hookActor: Actor = { kind: "hook", id: "test:PostToolUse", agent: null };

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function testPack(): ResolvedPack {
  const action = { patterns: [], policy: {} };
  return {
    name: "test-pack", version: "0.0.0", roles: {},
    classify: { rules: [], default: "bounded" }, tiers: {},
    actions: { commit: action, push: action, pr_create: action, deploy: action },
    budget: { iterations: 20 },
    integrity: "sha256:" + "a".repeat(64), instructions: {},
  };
}

export function startedDraft(root = "/repo"): EventDraft<"run.started"> {
  return {
    type: "run.started",
    actor: { kind: "agent", id: "test", agent: null },
    data: { brief: "test run", tier: "bounded", tierReason: "default", root, git: true, host: "test", pack: testPack() },
  };
}

export function worktreeDraft(i = 0, path = `src/f${i}.ts`): EventDraft<"worktree.changed"> {
  return { type: "worktree.changed", actor: hookActor, data: { path, tool: "Write" } };
}

function logLines(loc: RunLocation): string[] {
  const text = readFileSync(runPaths(loc).log, "utf8");
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function writeLines(loc: RunLocation, lines: string[]): void {
  writeFileSync(runPaths(loc).log, lines.map((l) => l + "\n").join(""));
}

function at<T>(xs: T[], index: number): number {
  return index < 0 ? xs.length + index : index;
}

/** Rewrites one event's data as valid JSON, the way a hand edit would. Negative indexes count from the end. */
export function mutateLine(loc: RunLocation, index: number): void {
  const lines = logLines(loc);
  const i = at(lines, index);
  const e = JSON.parse(lines[i]) as { data: Record<string, unknown> };
  e.data = { ...e.data, tampered: true };
  lines[i] = JSON.stringify(e);
  writeLines(loc, lines);
}

export function deleteLine(loc: RunLocation, index: number): void {
  const lines = logLines(loc);
  lines.splice(at(lines, index), 1);
  writeLines(loc, lines);
}

/** Replaces one line with arbitrary text, keeping its newline. */
export function replaceLine(loc: RunLocation, index: number, text: string): void {
  const lines = logLines(loc);
  lines[at(lines, index)] = text;
  writeLines(loc, lines);
}

export function appendRawBytes(loc: RunLocation, text: string): void {
  appendFileSync(runPaths(loc).log, text);
}

/** Cuts the log's final newline, as a crash between the last byte of an event and its newline would. */
export function stripFinalNewline(loc: RunLocation): void {
  const path = runPaths(loc).log;
  truncateSync(path, statSync(path).size - 1);
}

/** Rewrites state.json as if it had been written after event `seq`, which makes it lag the log. */
export function writeStale(at: RunLocation, seq: number): void {
  const cur = JSON.parse(readFileSync(runPaths(at).state, "utf8")) as StateFile;
  const head = seq === 0 ? GENESIS_PREV : sha256Tag(logLines(at)[seq - 1]);
  writeFileSync(runPaths(at).state, JSON.stringify({ ...cur, seq, head, state: { ...cur.state, seq } }));
}

export function taskDraft(i: number): EventDraft<"task.added"> {
  return { type: "task.added", actor: { kind: "agent", id: "test", agent: null }, data: { task: `t${i}`, stage: "build", title: `task ${i}` } };
}
