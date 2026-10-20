import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { RunLocation } from "../../src/types.ts";
import { runPaths } from "../../src/store/paths.ts";
import { readLog, verifyChain } from "../../src/store/log.ts";
import { createRun, loadState } from "../../src/store/store.ts";
import { tmpDir } from "../helpers.ts";
import { range, startedDraft } from "./fixtures.ts";
import { testProjector } from "./test-projector.ts";

const WORKER = join(import.meta.dirname, "append-worker.ts");

function runWorker(root: string, run: string, count: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, root, run, String(count)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function appendFromEightProcesses(staleLock: boolean): Promise<void> {
  const loc: RunLocation = { root: tmpDir("aos-concurrency-"), run: "01JRUN0000000000000000000A" };
  createRun(loc, startedDraft(), testProjector);
  if (staleLock) {
    // Left by a writer that died holding the lock: every worker sees it first and races to break it.
    writeFileSync(runPaths(loc).lock, JSON.stringify({ pid: 2 ** 22 + 7, host: hostname(), ts: Date.now(), nonce: "dead" }));
  }

  const results = await Promise.all(range(8).map(() => runWorker(loc.root, loc.run, 50)));
  expect(results).toEqual(range(8).map(() => ({ code: 0, stderr: "" })));

  const r = readLog(loc);
  expect(r.events.length).toBe(401);
  expect(r.tornBytes).toBe(0);
  expect(r.events.map((e) => e.seq)).toEqual(range(401).map((i) => i + 1));
  expect(new Set(r.events.map((e) => e.id)).size).toBe(401);
  expect(verifyChain(loc)).toMatchObject({ ok: true, events: 401 });
  expect(loadState(loc, testProjector).seq).toBe(401);
  // No lock, break marker, or snapshot temp file outlives the writers.
  expect(readdirSync(runPaths(loc).dir).sort()).toEqual(["log.jsonl", "state.json"]);
}

test("8 processes x 50 appends: contiguous seq, valid chain, no torn lines", () => appendFromEightProcesses(false), 60_000);

test("8 processes breaking one dead holder's lock still serialize", () => appendFromEightProcesses(true), 60_000);
