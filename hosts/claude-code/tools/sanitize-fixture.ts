#!/usr/bin/env bun
// Turns raw payloads saved by the aos-capture plugin into fixtures safe to commit to a public repo.
//
//   bun hosts/claude-code/tools/sanitize-fixture.ts <in-dir> <out-dir> [--home <path>] [--repo <path>] [--also <text>]...
//
// --home defaults to the current user's home; --repo defaults to the first capture's cwd. Each --also
// value (a real name, an email) is replaced with REDACTED-<n>, ignoring case, and leak-checked. Fixtures are
// named <event>-<tool or source>-<n>.json; rename them to a case name (post-tool-use-bash-true.json)
// once you have checked what each one shows. Nothing is written if any fixture still contains the
// home path, the repo path, the username, or an --also value, compared without case: those are the
// leaks a public fixture cannot carry.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Capture { file: string; raw: unknown }
export interface SanitizeOptions { home: string; repo: string; also?: readonly string[] }
export interface Fixture { name: string; source: string; content: Record<string, unknown>; leaks: string[] }

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const ID_KINDS = [
  { key: /(^|_)session_id$/, label: (n: number) => (n === 1 ? "SESSION" : `SESSION-${n}`) },
  { key: /(^|_)prompt_id$/, label: (n: number) => `PROMPT-${n}` },
  { key: /(^|_)agent_id$/, label: (n: number) => `AGENT-${n}` },
  { key: /(^|_)tool_use_id$/, label: (n: number) => `TOOLU-${n}` },
];

// Short ids could match unrelated text, so only ids this long are replaced inside other strings.
const MIN_EMBEDDED_ID = 8;

export function sanitize(captures: readonly Capture[], opts: SanitizeOptions): Fixture[] {
  const ordered = [...captures].sort(byCaptureOrder);
  for (const c of ordered) {
    if (!isObject(c.raw)) throw new Error(`${c.file}: capture is not a JSON object`);
  }

  const ids = collectIds(ordered.map((c) => c.raw as Json));
  const paths = [...pathReplacements(opts), ...alsoReplacements(opts)];
  const counters = new Map<string, number>();

  return ordered.map((c) => {
    const payload = c.raw as { [key: string]: Json };
    const clean = scrub(payload, ids, paths) as { [key: string]: Json };
    const prefix = fixturePrefix(c.file, payload);
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    const content: Record<string, unknown> = { _source: "captured", ...clean };
    return { name: `${prefix}-${n}.json`, source: c.file, content, leaks: findLeaks(JSON.stringify(content), opts) };
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// capture.sh names files <epoch>-<pid>-<event>.json. Epochs differ in length across a long session,
// so compare them as numbers; the full name breaks ties so the order is stable.
function byCaptureOrder(a: Capture, b: Capture): number {
  const ea = Number.parseInt(basename(a.file), 10);
  const eb = Number.parseInt(basename(b.file), 10);
  if (Number.isFinite(ea) && Number.isFinite(eb) && ea !== eb) return ea - eb;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

function collectIds(payloads: Json[]): Map<string, string> {
  const ids = new Map<string, string>();
  const counts = ID_KINDS.map(() => 0);
  const visit = (v: Json): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v === null || typeof v !== "object") return;
    for (const [k, child] of Object.entries(v)) {
      const kind = ID_KINDS.findIndex((x) => x.key.test(k));
      if (kind >= 0 && typeof child === "string" && child !== "" && !ids.has(child)) {
        counts[kind] += 1;
        ids.set(child, ID_KINDS[kind]!.label(counts[kind]));
      }
      visit(child);
    }
  };
  payloads.forEach(visit);
  return ids;
}

interface Replacement { pattern: RegExp; to: string }

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// macOS reports temp dirs both as /var/... and /private/var/...; a capture may carry either.
function aliases(p: string): string[] {
  const out = [p];
  if (p.startsWith("/private/")) out.push(p.slice("/private".length));
  else if (/^\/(var|tmp|etc)\//.test(p)) out.push("/private" + p);
  return out;
}

// Claude Code names a project's transcript dir after its path with separators turned into dashes.
function encoded(p: string): string {
  return p.replace(/[^A-Za-z0-9-]/g, "-");
}

function pathReplacements(opts: SanitizeOptions): Replacement[] {
  const plain = (from: string, to: string): Replacement => ({
    pattern: new RegExp(escape(from) + "(?![A-Za-z0-9._-])", "g"),
    to,
  });
  const enc = (from: string, to: string): Replacement => ({
    pattern: new RegExp(escape(encoded(from)) + "(?![A-Za-z0-9])", "g"),
    to,
  });
  // The repo usually sits under HOME, so its longer paths go first or HOME would split them.
  const list: { from: string; rep: Replacement }[] = [];
  for (const p of aliases(opts.repo)) list.push({ from: p, rep: plain(p, "/repo") }, { from: encoded(p), rep: enc(p, "-repo") });
  for (const p of aliases(opts.home)) list.push({ from: p, rep: plain(p, "/home/user") }, { from: encoded(p), rep: enc(p, "-home-user") });
  return list.sort((a, b) => b.from.length - a.from.length).map((x) => x.rep);
}

// Runs after the path replacements, so an --also value that also appears in a path cannot stop the
// path from being normalized first.
function alsoReplacements(opts: SanitizeOptions): Replacement[] {
  return (opts.also ?? [])
    .filter((s) => s !== "")
    .map((s, i) => ({ pattern: new RegExp(escape(s), "gi"), to: `REDACTED-${i + 1}` }));
}

function leakNeedles(opts: SanitizeOptions): string[] {
  const needles = [...aliases(opts.home), ...aliases(opts.repo)];
  const user = basename(opts.home);
  // A very short or generic name would match ordinary text and make every capture look leaky.
  if (user.length >= 3 && user !== "user") needles.push(user);
  needles.push(...(opts.also ?? []).filter((s) => s !== ""));
  return [...new Set(needles)];
}

/** The personal strings still present in text. Case is ignored: "Alice" leaks "alice" all the same. */
export function findLeaks(text: string, opts: SanitizeOptions): string[] {
  const lower = text.toLowerCase();
  return leakNeedles(opts).filter((s) => lower.includes(s.toLowerCase()));
}

function scrubString(s: string, ids: Map<string, string>, paths: Replacement[]): string {
  const exact = ids.get(s);
  if (exact !== undefined) return exact;
  let out = s;
  for (const [id, label] of ids) if (id.length >= MIN_EMBEDDED_ID) out = out.split(id).join(label);
  for (const r of paths) out = out.replace(r.pattern, r.to);
  return out;
}

function scrub(v: Json, ids: Map<string, string>, paths: Replacement[]): Json {
  if (typeof v === "string") return scrubString(v, ids, paths);
  if (Array.isArray(v)) return v.map((x) => scrub(x, ids, paths));
  if (v === null || typeof v !== "object") return v;
  const out: { [key: string]: Json } = {};
  for (const [k, child] of Object.entries(v)) out[k] = scrub(child, ids, paths);
  return out;
}

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fixturePrefix(file: string, payload: { [key: string]: Json }): string {
  const fromFile = /-([A-Za-z]+)\.json$/.exec(basename(file))?.[1] ?? "unknown";
  const event = typeof payload.hook_event_name === "string" ? payload.hook_event_name : fromFile;
  const detail =
    typeof payload.tool_name === "string" ? payload.tool_name
    : typeof payload.source === "string" ? payload.source
    : "";
  return [kebab(event), kebab(detail)].filter((s) => s !== "").join("-");
}

function usage(): number {
  console.error("usage: sanitize-fixture.ts <in-dir> <out-dir> [--home <path>] [--repo <path>] [--also <text>]...");
  return 2;
}

export function main(argv: string[]): number {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const also: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--also") {
      const v = argv[++i];
      if (v === undefined || v === "") {
        console.error("--also needs a non-empty value");
        return usage();
      }
      also.push(v);
    } else if (a === "--home" || a === "--repo") {
      const v = argv[++i];
      if (v === undefined) return usage();
      flags[a.slice(2)] = v;
    } else positional.push(a);
  }
  if (positional.length !== 2) return usage();
  const [inDir, outDir] = positional as [string, string];

  const captures: Capture[] = [];
  for (const file of readdirSync(inDir).filter((f) => f.endsWith(".json"))) {
    try {
      captures.push({ file, raw: JSON.parse(readFileSync(join(inDir, file), "utf8")) });
    } catch (e) {
      console.error(`${file}: not valid JSON (${(e as Error).message})`);
      return 1;
    }
  }
  if (captures.length === 0) {
    console.error(`no .json captures in ${inDir}`);
    return 1;
  }

  const firstCwd = [...captures].sort(byCaptureOrder).map((c) => (isObject(c.raw) ? c.raw.cwd : undefined)).find((v) => typeof v === "string");
  const repo = flags.repo ?? (firstCwd as string | undefined);
  if (repo === undefined) {
    console.error("no capture has a cwd; pass --repo <path>");
    return 1;
  }

  let fixtures: Fixture[];
  try {
    fixtures = sanitize(captures, { home: flags.home ?? homedir(), repo, also });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const leaky = fixtures.filter((f) => f.leaks.length > 0);
  if (leaky.length > 0) {
    for (const f of leaky) console.error(`${f.source}: still contains ${f.leaks.map((s) => JSON.stringify(s)).join(", ")}`);
    console.error("nothing written; edit those captures by hand or pass --home/--repo, then re-run");
    return 1;
  }

  mkdirSync(outDir, { recursive: true });
  for (const f of fixtures) writeFileSync(join(outDir, f.name), JSON.stringify(f.content, null, 2) + "\n");
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
