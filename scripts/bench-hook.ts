#!/usr/bin/env bun
// Hook latency benchmark. Claude Code runs the plugin's hook entry point as a fresh process before and
// after every tool call, so its wall time is added to every tool call. This spawns the entry point the same
// way, n times per scenario, and reports p50, p95, and max. The target is p95 under 100 ms; it is a
// target, not a gate, so the script always exits 0.
//
//   bun run scripts/bench-hook.ts [--n 50]
//
// It runs in a throwaway shallow clone of this checkout, so the fingerprint scenario hashes a tree the
// size of this repository without writing .aos/ into the checkout. Two reference rows separate process
// startup and module loading from the hook's own work. A scenario whose hook logged errors measured the
// failure path, not the real one, so the errors column must be 0 for a timing to count.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindSession, openContext, runStart } from "@aos-harness/kernel";

const CHECKOUT = join(import.meta.dirname, "..");
const BIN = join(CHECKOUT, "hosts/claude-code/bin/aos-hook.ts");
const PACK = join(CHECKOUT, "packs/feature-delivery");
const HOST = "claude-code";
const WARMUP = 2;

interface Scenario { name: string; argv: string[]; stdin: string }
interface Row { scenario: string; n: number; p50: number; p95: number; max: number; errors: number }

function parseN(argv: string[]): number {
  const i = argv.indexOf("--n");
  if (i === -1) return 50;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--n needs a whole number of at least 1 (got ${JSON.stringify(argv[i + 1])}); using 50`);
    return 50;
  }
  return n;
}

// Nearest rank: the smallest sample with at least p percent of samples at or below it.
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

// The hook must see this clone as the project, not a Claude Code session running the benchmark, and no
// exported git variable may point it at another repository.
function childEnv(repo: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_") || key.startsWith("CLAUDE_") || key.startsWith("AOS_")) continue;
    env[key] = value;
  }
  env.CLAUDE_PROJECT_DIR = repo;
  return env;
}

function payload(repo: string, session: string, event: string, tool: Record<string, unknown>): string {
  return JSON.stringify({
    session_id: session, prompt_id: "bench", transcript_path: join(repo, "bench.jsonl"), cwd: repo,
    permission_mode: "default", hook_event_name: event, tool_use_id: "toolu_bench", ...tool,
  });
}

function errorLines(repo: string): number {
  const log = join(repo, ".aos", "hook-errors.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").length : 0;
}

function measure(s: Scenario, repo: string, env: NodeJS.ProcessEnv, n: number): Row {
  const before = errorLines(repo);
  const times: number[] = [];
  for (let i = 0; i < WARMUP + n; i++) {
    const t0 = performance.now();
    const r = spawnSync(process.execPath, s.argv, { cwd: repo, env, input: s.stdin, encoding: "utf8" });
    const ms = performance.now() - t0;
    if (r.status !== 0) console.error(`${s.name}: exited ${r.status}: ${r.stderr.trim()}`);
    if (i >= WARMUP) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const round = (x: number) => Math.round(x * 10) / 10;
  return { scenario: s.name, n, p50: round(percentile(times, 50)), p95: round(percentile(times, 95)), max: round(times[times.length - 1] ?? NaN), errors: errorLines(repo) - before };
}

function main(): void {
  const n = parseN(process.argv.slice(2));
  const dir = mkdtempSync(join(tmpdir(), "aos-bench-"));
  const repo = join(dir, "repo");
  try {
    const clone = spawnSync("git", ["clone", "-q", "--depth", "1", `file://${CHECKOUT}`, repo], { encoding: "utf8" });
    if (clone.status !== 0) {
      console.error(`could not clone ${CHECKOUT}: ${clone.stderr.trim()}`);
      return;
    }

    // A real bounded run in its design stage, bound to one session; a second session stays unbound.
    const ctx = openContext({ cwd: repo, packDir: PACK, host: HOST });
    const { runId } = runStart(ctx, { brief: "Benchmark the hook entry point" });
    const bound = randomUUID();
    const unbound = randomUUID();
    bindSession(ctx.root, HOST, bound, runId);

    const ls = { tool_name: "Bash", tool_input: { command: "ls", description: "List files" } };
    const write = { tool_name: "Write", tool_input: { file_path: join(repo, "docs/specs/bench.md"), content: "# bench\n" } };
    const test = {
      tool_name: "Bash",
      tool_input: { command: "bun test", description: "Run tests" },
      tool_response: { stdout: " 1 pass\n 0 fail\n", stderr: "", interrupted: false, isImage: false },
    };
    const scenarios: Scenario[] = [
      { name: "reference: bun startup", argv: ["--eval", "0"], stdin: "" },
      { name: "reference: load the hook modules", argv: ["--eval", `await import(${JSON.stringify(BIN)})`], stdin: "" },
      { name: "1. unbound pass-through (PreToolUse Bash ls)", argv: [BIN, "pre-tool-use"], stdin: payload(repo, unbound, "PreToolUse", ls) },
      { name: "2. bound PreToolUse Write in scope", argv: [BIN, "pre-tool-use"], stdin: payload(repo, bound, "PreToolUse", write) },
      { name: "3. bound PreToolUse Bash ls", argv: [BIN, "pre-tool-use"], stdin: payload(repo, bound, "PreToolUse", ls) },
      { name: "4. bound PostToolUse Bash bun test (fingerprint)", argv: [BIN, "post-tool-use"], stdin: payload(repo, bound, "PostToolUse", test) },
    ];

    const env = childEnv(repo);
    const rows = scenarios.map((s) => measure(s, repo, env, n));
    const files = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter((l) => l !== "").length;

    console.log(`Hook latency, n=${n} per scenario after ${WARMUP} warm-up runs, bun ${Bun.version}, ${process.platform}/${process.arch}, clone of ${files} tracked files`);
    console.log("");
    const width = Math.max(...rows.map((r) => r.scenario.length));
    console.log(`${"scenario".padEnd(width)}  ${"p50 ms".padStart(8)}  ${"p95 ms".padStart(8)}  ${"max ms".padStart(8)}  errors`);
    for (const r of rows) {
      console.log(`${r.scenario.padEnd(width)}  ${r.p50.toFixed(1).padStart(8)}  ${r.p95.toFixed(1).padStart(8)}  ${r.max.toFixed(1).padStart(8)}  ${r.errors}`);
    }
    const counted = rows.filter((r) => !r.scenario.startsWith("reference") && r.errors === 0);
    const missed = counted.filter((r) => r.p95 >= 100).map((r) => r.scenario);
    const failed = rows.filter((r) => r.errors > 0).map((r) => r.scenario);
    console.log("");
    if (failed.length > 0) console.log(`Hook errors, so these timings are of the failure path and do not count: ${failed.join("; ")}`);
    console.log(missed.length === 0 ? `${failed.length > 0 ? "Every other scenario" : "Every scenario"} meets the p95 < 100 ms target.` : `p95 at or over 100 ms: ${missed.join("; ")}`);
    console.log(JSON.stringify({ bench: "aos-hook", n, warmup: WARMUP, bun: Bun.version, platform: process.platform, arch: process.arch, trackedFiles: files, rows }));
  } catch (err) {
    console.error(`benchmark failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
