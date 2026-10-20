import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpDir } from "../../../kernel/tests/helpers.ts";
import pluginJson from "../tools/capture-plugin/.claude-plugin/plugin.json" with { type: "json" };
import hooksJson from "../tools/capture-plugin/hooks/hooks.json" with { type: "json" };

const root = join(import.meta.dir, "..", "tools", "capture-plugin");
const script = join(root, "capture.sh");

type Entry = { matcher?: string; hooks: { type: string; command: string }[] };
const hooks = hooksJson.hooks as Record<string, Entry[]>;

function runCapture(event: string, stdin: string, env: Record<string, string | undefined>) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "AOS_CAPTURE_DIR") base[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
  return Bun.spawnSync([script, event], { stdin: Buffer.from(stdin), env: base, stdout: "pipe", stderr: "pipe" });
}

describe("capture plugin", () => {
  test("is named aos-capture so it cannot collide with the real plugin", () => {
    expect(pluginJson.name).toBe("aos-capture");
  });

  test("registers every event the host contract depends on, each passing its own name to capture.sh", () => {
    const events = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "SessionStart", "PostCompact", "Stop", "SubagentStart", "SubagentStop"];
    expect(Object.keys(hooks).sort()).toEqual([...events].sort());
    for (const ev of events) {
      const commands = hooks[ev]!.flatMap((e) => e.hooks.map((h) => h.command));
      expect(commands).toEqual([`"\${CLAUDE_PLUGIN_ROOT}/capture.sh" ${ev}`]);
    }
  });

  test("tool events match every tool", () => {
    for (const ev of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) expect(hooks[ev]!.map((e) => e.matcher)).toEqual(["*"]);
  });

  test("capture.sh is executable", () => {
    expect(statSync(script).mode & 0o111).toBe(0o111);
  });

  test("capture.sh saves the payload verbatim as <epoch>-<pid>-<event>.json and exits 0", () => {
    const dir = tmpDir("aos-capture-");
    const payload = '{"session_id":"s","hook_event_name":"Stop"}\n';
    const p = runCapture("Stop", payload, { AOS_CAPTURE_DIR: dir });
    expect(p.exitCode).toBe(0);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d+-\d+-Stop\.json$/);
    expect(readFileSync(join(dir, files[0]!), "utf8")).toBe(payload);
  });

  test("capture.sh still exits 0 when AOS_CAPTURE_DIR is unset, so capture never blocks a tool", () => {
    const p = runCapture("PreToolUse", "{}", {});
    expect(p.exitCode).toBe(0);
    expect(p.stderr.toString()).toContain("AOS_CAPTURE_DIR");
  });
});
