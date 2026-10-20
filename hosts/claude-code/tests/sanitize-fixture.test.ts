import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpDir } from "../../../kernel/tests/helpers.ts";
import { findLeaks, sanitize, type Capture } from "../tools/sanitize-fixture.ts";

const HOME = "/Users/alice";
const REPO = "/Users/alice/scratch/capture-repo";
const opts = { home: HOME, repo: REPO };

function capture(file: string, payload: Record<string, unknown>): Capture {
  return { file, raw: payload };
}

function bashPost(session: string, prompt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: session,
    prompt_id: prompt,
    transcript_path: `${HOME}/.claude/projects/-Users-alice-scratch-capture-repo/${session}.jsonl`,
    cwd: REPO,
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: `cat ${REPO}/a.txt` },
    tool_response: { stdout: `read ${HOME}/notes`, stderr: "", interrupted: false, isImage: false },
    ...extra,
  };
}

const S1 = "0b9c6a52-1f8e-4c1d-9d3e-7a1b2c3d4e5f";
const S2 = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const P1 = "prompt-aaaaaaaa-1111";
const P2 = "prompt-bbbbbbbb-2222";

describe("sanitize", () => {
  test("replaces the repo path with /repo before replacing HOME, since the repo sits under HOME", () => {
    const [fx] = sanitize([capture("100-1-PostToolUse.json", bashPost(S1, P1))], opts);
    expect(fx!.content.cwd).toBe("/repo");
    expect((fx!.content.tool_input as { command: string }).command).toBe("cat /repo/a.txt");
    expect((fx!.content.tool_response as { stdout: string }).stdout).toBe("read /home/user/notes");
  });

  test("maps session, prompt, and agent ids to stable placeholders across files and inside other strings", () => {
    const out = sanitize(
      [
        capture("100-1-PostToolUse.json", bashPost(S1, P1)),
        capture("101-2-PreToolUse.json", { ...bashPost(S1, P2), hook_event_name: "PreToolUse", agent_id: "agent-7f3e2d1c", agent_type: "Explore" }),
        capture("102-3-PostToolUse.json", bashPost(S1, P1, { tool_response: { stdout: `agent agent-7f3e2d1c done`, stderr: "" } })),
      ],
      opts,
    );
    expect(out.map((f) => [f.content.session_id, f.content.prompt_id])).toEqual([
      ["SESSION", "PROMPT-1"],
      ["SESSION", "PROMPT-2"],
      ["SESSION", "PROMPT-1"],
    ]);
    expect(out[1]!.content.agent_id).toBe("AGENT-1");
    expect((out[2]!.content.tool_response as { stdout: string }).stdout).toBe("agent AGENT-1 done");
  });

  test("numbers a second distinct session SESSION-2", () => {
    const out = sanitize([capture("100-1-Stop.json", bashPost(S1, P1)), capture("200-2-Stop.json", bashPost(S2, P2))], opts);
    expect(out.map((f) => f.content.session_id)).toEqual(["SESSION", "SESSION-2"]);
  });

  test("keeps transcript_path as a path with the encoded project dir and session id replaced", () => {
    const [fx] = sanitize([capture("100-1-PostToolUse.json", bashPost(S1, P1))], opts);
    expect(fx!.content.transcript_path).toBe("/home/user/.claude/projects/-repo/SESSION.jsonl");
  });

  test("leaves look-alike paths that only share a prefix untouched", () => {
    const [fx] = sanitize(
      [capture("100-1-PostToolUse.json", bashPost(S1, P1, { tool_input: { command: "ls /Users/alicex /Users/alice/scratch/capture-repo2" } }))],
      opts,
    );
    expect((fx!.content.tool_input as { command: string }).command).toBe("ls /Users/alicex /home/user/scratch/capture-repo2");
  });

  test("handles the macOS /private alias of a temp repo path", () => {
    const tmpRepo = { home: HOME, repo: "/var/folders/xy/T/scratch" };
    const [fx] = sanitize(
      [capture("100-1-PostToolUse.json", bashPost(S1, P1, { cwd: "/private/var/folders/xy/T/scratch", tool_input: { command: "ls /var/folders/xy/T/scratch/a" } }))],
      tmpRepo,
    );
    expect(fx!.content.cwd).toBe("/repo");
    expect((fx!.content.tool_input as { command: string }).command).toBe("ls /repo/a");
  });

  test("puts _source: captured first and names fixtures <event>-<tool or source>-<n>", () => {
    const out = sanitize(
      [
        capture("100-1-PostToolUseFailure.json", { ...bashPost(S1, P1), hook_event_name: "PostToolUseFailure", error: "Exit code 3" }),
        capture("101-2-PostToolUseFailure.json", { ...bashPost(S1, P1), hook_event_name: "PostToolUseFailure", error: "Exit code 1" }),
        capture("102-3-PreToolUse.json", { ...bashPost(S1, P1), hook_event_name: "PreToolUse", tool_name: "NotebookEdit" }),
        capture("103-4-SessionStart.json", { session_id: S1, cwd: REPO, hook_event_name: "SessionStart", source: "compact" }),
        capture("104-5-Stop.json", { session_id: S1, cwd: REPO, stop_hook_active: false }),
      ],
      opts,
    );
    expect(out.map((f) => f.name)).toEqual([
      "post-tool-use-failure-bash-1.json",
      "post-tool-use-failure-bash-2.json",
      "pre-tool-use-notebook-edit-1.json",
      "session-start-compact-1.json",
      "stop-1.json",
    ]);
    for (const f of out) expect(Object.keys(f.content)[0]).toBe("_source");
    expect(out[0]!.content._source).toBe("captured");
  });

  test("orders captures by their epoch prefix numerically, not lexically", () => {
    const out = sanitize([capture("1000-1-Stop.json", bashPost(S2, P2)), capture("999-2-Stop.json", bashPost(S1, P1))], opts);
    // A lexical sort would put "1000-..." first and hand S2 the SESSION placeholder.
    expect(out.map((f) => f.source)).toEqual(["999-2-Stop.json", "1000-1-Stop.json"]);
    expect(out.map((f) => f.content.session_id)).toEqual(["SESSION", "SESSION-2"]);
    expect(out[0]!.content.prompt_id).toBe("PROMPT-1");
  });

  test("reports a leftover username so a fixture with personal data is never written", () => {
    const [fx] = sanitize(
      [capture("100-1-PostToolUse.json", bashPost(S1, P1, { tool_response: { stdout: "committed by alice@example.com", stderr: "" } }))],
      opts,
    );
    expect(fx!.leaks).toEqual(["alice"]);
  });

  test("reports no leaks for a clean capture", () => {
    const [fx] = sanitize([capture("100-1-PostToolUse.json", bashPost(S1, P1))], opts);
    expect(fx!.leaks).toEqual([]);
  });

  test("checks for a leftover username regardless of case", () => {
    const [fx] = sanitize(
      [capture("100-1-PostToolUse.json", bashPost(S1, P1, { tool_response: { stdout: "Written by ALICE", stderr: "" } }))],
      opts,
    );
    expect(fx!.leaks).toEqual(["alice"]);
  });

  test("maps tool_use_id to stable placeholders, so a call and its result keep matching ids", () => {
    const out = sanitize(
      [
        capture("100-1-PreToolUse.json", { ...bashPost(S1, P1), hook_event_name: "PreToolUse", tool_use_id: "toolu_01XYZaaaa" }),
        capture("101-2-PostToolUse.json", { ...bashPost(S1, P1), tool_use_id: "toolu_01XYZaaaa" }),
        capture("102-3-PostToolUse.json", { ...bashPost(S1, P1), tool_use_id: "toolu_01XYZbbbb" }),
      ],
      opts,
    );
    expect(out.map((f) => f.content.tool_use_id)).toEqual(["TOOLU-1", "TOOLU-1", "TOOLU-2"]);
  });

  test("replaces each --also value, regardless of case, with a numbered placeholder", () => {
    const [fx] = sanitize(
      [capture("100-1-PostToolUse.json", bashPost(S1, P1, { tool_response: { stdout: "commit by alice smith <ALICE@example.com>", stderr: "" } }))],
      { ...opts, also: ["Alice Smith", "alice@example.com"] },
    );
    expect((fx!.content.tool_response as { stdout: string }).stdout).toBe("commit by REDACTED-1 <REDACTED-2>");
    expect(fx!.leaks).toEqual([]);
  });

  test("leak-checks --also values regardless of case", () => {
    const leakOpts = { ...opts, also: ["alice@example.com"] };
    expect(findLeaks("contact ALICE@Example.com", leakOpts)).toEqual(["alice", "alice@example.com"]);
    expect(findLeaks("nothing personal here", leakOpts)).toEqual([]);
  });

  test("rejects a capture that is not a JSON object", () => {
    expect(() => sanitize([{ file: "100-1-Stop.json", raw: [] }], opts)).toThrow(/100-1-Stop\.json/);
  });
});

describe("sanitize-fixture CLI", () => {
  const script = join(import.meta.dir, "..", "tools", "sanitize-fixture.ts");

  function run(...args: string[]): { code: number; stderr: string } {
    const p = Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
    return { code: p.exitCode, stderr: p.stderr.toString() };
  }

  test("writes sanitized fixtures from a capture dir", () => {
    const inDir = tmpDir("aos-capture-in-");
    const outDir = tmpDir("aos-capture-out-");
    writeFileSync(join(inDir, "100-1-PostToolUse.json"), JSON.stringify(bashPost(S1, P1)));
    const r = run(inDir, outDir, "--home", HOME, "--repo", REPO);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(readdirSync(outDir)).toEqual(["post-tool-use-bash-1.json"]);
    const written = JSON.parse(readFileSync(join(outDir, "post-tool-use-bash-1.json"), "utf8"));
    expect(written).toMatchObject({ _source: "captured", session_id: "SESSION", cwd: "/repo" });
  });

  test("defaults the repo to the first capture's cwd", () => {
    const inDir = tmpDir("aos-capture-in-");
    const outDir = tmpDir("aos-capture-out-");
    writeFileSync(join(inDir, "100-1-PostToolUse.json"), JSON.stringify(bashPost(S1, P1)));
    expect(run(inDir, outDir, "--home", HOME).code).toBe(0);
    expect(JSON.parse(readFileSync(join(outDir, "post-tool-use-bash-1.json"), "utf8")).cwd).toBe("/repo");
  });

  test("exits 1 and writes nothing when any fixture still holds personal data", () => {
    const inDir = tmpDir("aos-capture-in-");
    const outDir = tmpDir("aos-capture-out-");
    writeFileSync(join(inDir, "100-1-PostToolUse.json"), JSON.stringify(bashPost(S1, P1)));
    writeFileSync(join(inDir, "101-2-PostToolUse.json"), JSON.stringify(bashPost(S1, P1, { tool_response: { stdout: "alice", stderr: "" } })));
    const r = run(inDir, outDir, "--home", HOME, "--repo", REPO);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("101-2-PostToolUse.json");
    expect(readdirSync(outDir)).toEqual([]);
  });

  test("accepts --also more than once", () => {
    const inDir = tmpDir("aos-capture-in-");
    const outDir = tmpDir("aos-capture-out-");
    writeFileSync(join(inDir, "100-1-PostToolUse.json"), JSON.stringify(bashPost(S1, P1, { tool_response: { stdout: "Bo Diddley bo@example.org", stderr: "" } })));
    const r = run(inDir, outDir, "--home", HOME, "--repo", REPO, "--also", "Bo Diddley", "--also", "bo@example.org");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(outDir, "post-tool-use-bash-1.json"), "utf8")).tool_response.stdout).toBe("REDACTED-1 REDACTED-2");
  });

  test("exits 2 when --also has no value or an empty one", () => {
    const inDir = tmpDir("aos-capture-in-");
    const outDir = tmpDir("aos-capture-out-");
    for (const tail of [["--also"], ["--also", ""]]) {
      const r = run(inDir, outDir, "--home", HOME, "--repo", REPO, ...tail);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("--also needs a non-empty value");
    }
  });

  test("exits 2 with usage when arguments are missing", () => {
    const r = run();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage");
  });

  test("exits 1 on a capture file that is not valid JSON", () => {
    const inDir = tmpDir("aos-capture-in-");
    const outDir = tmpDir("aos-capture-out-");
    writeFileSync(join(inDir, "100-1-Stop.json"), "{not json");
    const r = run(inDir, outDir, "--home", HOME, "--repo", REPO);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("100-1-Stop.json");
    expect(existsSync(join(outDir, "stop-1.json"))).toBe(false);
  });
});
