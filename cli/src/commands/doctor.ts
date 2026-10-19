// aos doctor: checks the toolchain, the pack, and every run's log, and says how to fix what it finds.
// FAIL means AOS cannot be trusted to enforce anything until it is fixed; WARN means something works in a
// weaker mode than it should. Probes read the command's environment, so tests can point them at fixtures.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aosDir, gitRoot, listRuns, loadPack, PackError, RunNotFoundError, runPaths, verifyChain } from "@aos-harness/kernel";
import type { ResolvedPack } from "@aos-harness/kernel";
import type { CliIO, CommandFn } from "../io.ts";
import { parseFlags, printable, readBindings, resolveRoot, UsageError } from "./shared.ts";
import type { BindingFile } from "./shared.ts";

const MIN_BUN = "1.3.11";
// The first Claude Code release with onFailure: "block", which lets a dead hook process fail closed.
const MIN_CLAUDE = "2.1.295";
const PROBE_TIMEOUT_MS = 10_000;
const HOOK_ERROR_LINES = 3;
const DEFAULT_PACK = fileURLToPath(new URL("../../../packs/feature-delivery", import.meta.url));

const USAGE = `Usage: aos doctor [--pack <dir>] [--root <path>]

Checks Bun, git, Claude Code, the pack (--pack, else AOS_PACK, else the reference pack), its bound
skills, and the hash chain of every run under the root. Exits 1 if any check fails.`;

type Level = "OK" | "WARN" | "FAIL";
interface Finding { level: Level; text: string; fix?: string; detail?: string[] }

export const doctorCommand: CommandFn = async (io) => {
  let flags;
  try {
    flags = parseFlags(io.argv.slice(1), ["root", "pack", "help"]);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`aos doctor: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (flags.help) {
    io.out(USAGE);
    return 0;
  }
  if (flags.positionals.length > 0) {
    io.err(USAGE);
    return 2;
  }
  const root = resolveRoot(io, flags);
  const packDir = resolve(io.cwd, flags.pack ?? io.env.AOS_PACK ?? DEFAULT_PACK);

  const findings: Finding[] = [checkBun(), checkGit(io), checkClaude(io), ...checkRepo(io, root)];
  const pack = checkPack(packDir);
  findings.push(pack.finding);
  if (pack.pack !== null) findings.push(...checkSkills(io, pack.pack));
  findings.push(...checkRuns(root), ...checkBindings(root), checkHookErrors(root));

  io.out(printable(`AOS doctor: ${root}`));
  // Findings quote log lines, file names, pack issues, and tool output, so every one is made printable here.
  for (const f of findings) {
    io.out(printable(`${f.level.padEnd(4)} ${f.text}${f.fix === undefined ? "" : `. Fix: ${f.fix}`}`));
    for (const line of f.detail ?? []) io.out(`       ${printable(line)}`);
  }
  const count = (level: Level) => findings.filter((f) => f.level === level).length;
  io.out(`${count("FAIL")} FAIL, ${count("WARN")} WARN, ${count("OK")} OK.`);
  return count("FAIL") > 0 ? 1 : 0;
};

/** True when dotted version `have` is at least `want`, compared numerically. A pre-release suffix is ignored. */
export function versionAtLeast(have: string, want: string): boolean {
  const parts = (v: string) => (/^\d+(?:\.\d+)*/.exec(v.trim())?.[0] ?? "0").split(".").map(Number);
  const a = parts(have);
  const b = parts(want);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function checkBun(): Finding {
  // The CLI may use Bun APIs, so running it under another runtime is a failure, not a degraded mode.
  if (typeof Bun === "undefined") return { level: "FAIL", text: "not running under Bun", fix: `run aos with Bun ${MIN_BUN} or newer` };
  if (!versionAtLeast(Bun.version, MIN_BUN)) return { level: "FAIL", text: `bun ${Bun.version} is older than ${MIN_BUN}`, fix: "upgrade Bun (bun upgrade)" };
  return { level: "OK", text: `bun ${Bun.version}` };
}

function checkGit(io: CliIO): Finding {
  const r = spawnSync("git", ["--version"], { env: io.env, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (r.error !== undefined || r.status !== 0) return { level: "FAIL", text: "git --version does not run", fix: "install git" };
  return { level: "OK", text: r.stdout.trim() };
}

function checkClaude(io: CliIO): Finding {
  const text = claudeVersionText(io);
  if (text === null) {
    return { level: "WARN", text: "Claude Code (claude) was not found", fix: `install Claude Code ${MIN_CLAUDE} or newer to use the AOS plugin` };
  }
  const version = /\d+\.\d+\.\d+/.exec(text)?.[0];
  if (version === undefined) return { level: "WARN", text: `could not read a version from claude --version (${printable(text.trim())})` };
  if (!versionAtLeast(version, MIN_CLAUDE)) {
    return {
      level: "WARN", text: `Claude Code ${version} is older than ${MIN_CLAUDE}`,
      fix: "upgrade Claude Code; without onFailure, a crashed hook process cannot fail closed on push",
    };
  }
  return { level: "OK", text: `Claude Code ${version}` };
}

// AOS_DOCTOR_CLAUDE_VERSION stands in for the output of claude --version (empty means not installed), so
// tests and CI never spawn claude.
function claudeVersionText(io: CliIO): string | null {
  const override = io.env.AOS_DOCTOR_CLAUDE_VERSION;
  if (override !== undefined) return override.trim() === "" ? null : override;
  const r = spawnSync("claude", ["--version"], { env: io.env, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (r.error !== undefined || r.status !== 0) return null;
  return r.stdout;
}

function checkRepo(io: CliIO, root: string): Finding[] {
  if (gitRoot(root) === null) {
    return [{ level: "WARN", text: "not inside a git repository, so freshness falls back to a weak edit counter", fix: "run AOS in a git checkout" }];
  }
  const found: Finding[] = [{ level: "OK", text: "inside a git repository" }];
  const r = spawnSync("git", ["check-ignore", "-q", ".aos/x"], { cwd: root, env: io.env, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (r.status === 0) found.push({ level: "OK", text: ".aos/ is gitignored" });
  else if (r.status === 1) found.push({ level: "WARN", text: ".aos/ is not gitignored, so run logs could be committed", fix: "add .aos/ to .gitignore" });
  else found.push({ level: "WARN", text: `could not check whether .aos/ is gitignored (${printable((r.stderr ?? "").trim() || "git check-ignore failed")})`, fix: "add .aos/ to .gitignore" });
  return found;
}

function checkPack(dir: string): { finding: Finding; pack: ResolvedPack | null } {
  try {
    const pack = loadPack(dir);
    return { finding: { level: "OK", text: `pack ${pack.name}@${pack.version} loads from ${dir}` }, pack };
  } catch (e) {
    const issues = e instanceof PackError ? e.issues : [e instanceof Error ? e.message : String(e)];
    return { finding: { level: "FAIL", text: `pack at ${dir} does not load`, fix: "correct the issues below", detail: issues.map(printable) }, pack: null };
  }
}

/**
 * Best effort: a bound skill should resolve to <cache>/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md.
 * A missing skill is a WARN, because stage instructions still tell the agent what to do without it.
 */
function checkSkills(io: CliIO, pack: ResolvedPack): Finding[] {
  const cache = io.env.AOS_DOCTOR_PLUGIN_CACHE ?? join(io.env.HOME ?? homedir(), ".claude", "plugins", "cache");
  const binds = [...new Set(Object.values(pack.tiers).flatMap((t) => t?.stages.flatMap((s) => s.bind) ?? []))];
  return binds.map((bind): Finding => {
    const colon = bind.indexOf(":");
    const plugin = colon === -1 ? null : bind.slice(0, colon);
    const skill = colon === -1 ? bind : bind.slice(colon + 1);
    if (skillInstalled(cache, plugin, skill)) return { level: "OK", text: `bound skill ${bind} is installed` };
    return {
      level: "WARN", text: `bound skill ${bind} is not installed under ${cache}`,
      fix: `install the ${plugin ?? "plugin that provides it"}${plugin === null ? "" : " plugin"}, or the agent falls back to the stage's inline instructions`,
    };
  });
}

function skillInstalled(cache: string, plugin: string | null, skill: string): boolean {
  for (const market of dirNames(cache)) {
    for (const p of plugin === null ? dirNames(join(cache, market)) : [plugin]) {
      for (const version of dirNames(join(cache, market, p))) {
        if (existsSync(join(cache, market, p, version, "skills", skill, "SKILL.md"))) return true;
      }
    }
  }
  return false;
}

function dirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function checkRuns(root: string): Finding[] {
  const runs = listRuns(root);
  if (runs.length === 0) return [{ level: "OK", text: `no runs under ${root}` }];
  const found: Finding[] = [];
  for (const run of runs) {
    const loc = { root, run };
    let chain;
    try {
      chain = verifyChain(loc);
    } catch (e) {
      found.push({ level: "FAIL", text: `run ${run}: log unreadable (${printable(e instanceof Error ? e.message : String(e))})`, fix: "inspect the run directory under .aos/runs" });
      continue;
    }
    if (!chain.ok) {
      found.push({
        level: "FAIL", text: `run ${run}: log tampered or corrupt at seq ${chain.badSeq ?? "?"} (${chain.reason ?? "unknown"})`,
        fix: `its gates and evidence cannot be trusted; inspect .aos/runs/${run}/log.jsonl and start a new run`,
      });
      continue;
    }
    // Torn bytes are crash damage that the next append saves and drops, not tampering.
    if (chain.reason !== null) found.push({ level: "WARN", text: `run ${run}: ${chain.reason}`, fix: "none needed; the next append repairs it" });
    const snap = snapshotSeq(runPaths(loc).state);
    if (snap !== chain.events) {
      const where = snap === null ? "state.json is missing or unreadable" : `state.json is at seq ${snap} but the log is at seq ${chain.events}`;
      found.push({ level: "WARN", text: `run ${run}: ${where}`, fix: "none needed; it is rebuilt on the next append" });
    } else {
      found.push({ level: "OK", text: `run ${run}: log verified (${chain.events} events)` });
    }
  }
  return found;
}

function snapshotSeq(path: string): number | null {
  try {
    const f = JSON.parse(readFileSync(path, "utf8")) as { seq?: unknown } | null;
    return typeof f?.seq === "number" && Number.isInteger(f.seq) ? f.seq : null;
  } catch {
    return null;
  }
}

// Hooks look up the bound run on every tool call and fail closed when they cannot read it, so a binding to a
// run that is gone or fails verification blocks pushes in that session until it is released.
function checkBindings(root: string): Finding[] {
  let files: BindingFile[];
  try {
    files = readBindings(root);
  } catch (e) {
    return [{ level: "FAIL", text: `could not list .aos/sessions (${message(e)})`, fix: "check the permissions on .aos/sessions" }];
  }
  const found: Finding[] = [];
  for (const f of files) {
    const where = `session binding .aos/sessions/${f.name}`;
    if (f.binding === null) {
      found.push({ level: "WARN", text: `${where} is unreadable (${f.problem ?? "unknown"})`, fix: "delete it to unbind that session" });
      continue;
    }
    const { run } = f.binding;
    const problem = boundRunProblem(root, run);
    if (problem !== null) found.push({ level: "FAIL", text: `${where} points at run ${run}, which ${problem}`, fix: `aos run cancel ${run} --reason "..."` });
  }
  return found;
}

function boundRunProblem(root: string, run: string): string | null {
  try {
    const chain = verifyChain({ root, run });
    return chain.ok ? null : `fails verification at seq ${chain.badSeq ?? "?"}`;
  } catch (e) {
    if (e instanceof RunNotFoundError) return "does not exist";
    return `cannot be read (${message(e)})`;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function checkHookErrors(root: string): Finding {
  const path = join(aosDir(root), "hook-errors.log");
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
  } catch {
    lines = [];
  }
  if (lines.length === 0) return { level: "OK", text: "no hook errors logged" };
  const shown = lines.slice(-HOOK_ERROR_LINES);
  return {
    level: "WARN", text: `.aos/hook-errors.log has ${lines.length} ${lines.length === 1 ? "line" : "lines"}; the last ${shown.length} are below`,
    fix: "fix the cause, then clear the file", detail: shown.map(printable),
  };
}
