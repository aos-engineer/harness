import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import pluginJson from "../.claude-plugin/plugin.json" with { type: "json" };
import hooksJson from "../hooks/hooks.json" with { type: "json" };
import mcpJson from "../.mcp.json" with { type: "json" };
import { CLI_EVENTS } from "../src/events.ts";
import { normalize } from "../src/payload.ts";
import { fx } from "./fixture.ts";

const pluginRoot = join(import.meta.dir, "..");

type Hook = { type: string; command: string; timeout?: number; onFailure?: string };
type Entry = { matcher?: string; hooks: Hook[] };
const hooks = hooksJson.hooks as Record<string, Entry[]>;

function allEntries(): { event: string; entry: Entry; hook: Hook }[] {
  return Object.entries(hooks).flatMap(([event, entries]) => entries.flatMap((entry) => entry.hooks.map((hook) => ({ event, entry, hook }))));
}

function allCommands(): string[] {
  return allEntries().map((e) => e.hook.command);
}

function entriesWith(field: keyof Hook): [string, string | undefined][] {
  return allEntries()
    .filter((e) => e.hook[field] !== undefined)
    .map((e) => [e.event, e.entry.matcher]);
}

function matcherNames(event: string): string[] {
  return hooks[event]!.flatMap((e) => (e.matcher ?? "").split("|")).filter((s) => s !== "");
}

function kindOf(toolName: string): string {
  return normalize("PreToolUse", { ...fx("pre-tool-use-bash-true"), tool_name: toolName }).tool!.kind;
}

describe("hooks.json", () => {
  test("every hook command runs the launcher's hook entry with a known event", () => {
    for (const cmd of allCommands()) {
      const ev = cmd.match(/aos\.sh" hook (\S+)$/)![1]!;
      expect(Object.keys(CLI_EVENTS)).toContain(ev);
    }
  });

  // The launcher runs the bundled entry point under Bun, and steps aside when Bun is missing instead of
  // failing every Bash call.
  test("every command is exactly sh on the plugin-rooted launcher", () => {
    for (const cmd of allCommands()) expect(cmd).toMatch(/^sh "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/aos\.sh" hook [a-z-]+$/);
  });

  test("each command passes the event it is registered under", () => {
    for (const { event, hook } of allEntries()) {
      const arg = hook.command.split(" ").at(-1)!;
      expect(CLI_EVENTS[arg]).toBe(event as never);
    }
  });

  test("registers exactly the events the host translates", () => {
    expect(Object.keys(hooks).sort()).toEqual([...new Set(Object.values(CLI_EVENTS))].sort());
  });

  test("only the Bash PreToolUse entry fails closed", () => {
    expect(entriesWith("onFailure")).toEqual([["PreToolUse", "Bash"]]);
    expect(hooks.PreToolUse![0]!.hooks[0]!.onFailure).toBe("block");
  });

  test("every hook has a timeout well under Claude Code's 600 second default", () => {
    for (const { hook } of allEntries()) {
      expect(hook.type).toBe("command");
      expect(hook.timeout).toBeGreaterThan(0);
      expect(hook.timeout!).toBeLessThanOrEqual(30);
    }
  });

  test("matchers use exact-name syntax, which Claude Code does not treat as an unanchored regex", () => {
    for (const entries of Object.values(hooks)) for (const e of entries) if (e.matcher !== undefined) expect(e.matcher).toMatch(/^[A-Za-z0-9_|]+$/);
  });

  test("PreToolUse matchers route Bash and every write tool, and nothing that normalizes as other", () => {
    expect(hooks.PreToolUse!.map((e) => e.matcher)).toEqual(["Bash", "Write|Edit|MultiEdit|NotebookEdit"]);
    expect(kindOf("Bash")).toBe("bash");
    for (const name of hooks.PreToolUse![1]!.matcher!.split("|")) expect(kindOf(name)).toBe("write");
  });

  test("PostToolUse matches only tools the observer records", () => {
    for (const name of matcherNames("PostToolUse")) expect(["bash", "write", "skill", "aos-mcp"]).toContain(kindOf(name));
    expect(matcherNames("PostToolUse")).toContain("Skill");
  });

  test("the PostToolUse matcher names aos_run_start by this plugin's MCP tool prefix", () => {
    const server = Object.keys(mcpJson.mcpServers)[0]!;
    expect(matcherNames("PostToolUse")).toContain(`mcp__plugin_${pluginJson.name}_${server}__aos_run_start`);
  });

  test("PostToolUseFailure observes Bash only", () => {
    expect(matcherNames("PostToolUseFailure")).toEqual(["Bash"]);
  });
});

describe("plugin.json and .mcp.json", () => {
  test("the MCP server key and plugin name match the tool-name prefix", () => {
    expect(pluginJson.name).toBe("aos");
    expect(Object.keys(mcpJson.mcpServers)).toEqual(["aos"]);
  });

  test("the manifest carries a version, description, and attribution", () => {
    expect(pluginJson).toEqual({
      name: "aos",
      version: "1.0.0-next.0",
      description: "AOS run gates for Claude Code: staged gates, observed evidence, human approvals.",
      author: { name: "AOS Engineer", url: "https://github.com/aos-engineer" },
      homepage: "https://github.com/aos-engineer/harness/blob/main/docs/1.0/getting-started.md",
      repository: "https://github.com/aos-engineer/harness",
      license: "MIT",
    });
  });

  test("the MCP server runs through the launcher with the pack shipped in the plugin", () => {
    expect(mcpJson.mcpServers.aos).toEqual({
      command: "sh",
      args: ["${CLAUDE_PLUGIN_ROOT}/bin/aos.sh", "mcp"],
      env: { AOS_PACK: "${CLAUDE_PLUGIN_ROOT}/pack", AOS_HOST: "claude-code" },
    });
  });

  // A marketplace install copies only the plugin directory, so nothing may reach outside it.
  test("no plugin-rooted path leaves the plugin directory", () => {
    const all = [...allCommands(), ...mcpJson.mcpServers.aos.args, mcpJson.mcpServers.aos.env.AOS_PACK];
    for (const p of all) expect(p).not.toContain("..");
  });

  test("every plugin-rooted path points at something that exists in the checkout", () => {
    const paths = [
      ...allCommands().map((c) => /"\$\{CLAUDE_PLUGIN_ROOT\}([^"]+)"/.exec(c)![1]!),
      ...mcpJson.mcpServers.aos.args.filter((a) => a.startsWith("${CLAUDE_PLUGIN_ROOT}")).map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", "")),
      mcpJson.mcpServers.aos.env.AOS_PACK.replace("${CLAUDE_PLUGIN_ROOT}", ""),
    ];
    for (const p of new Set(paths)) expect(existsSync(join(pluginRoot, p))).toBe(true);
    expect(statSync(join(pluginRoot, mcpJson.mcpServers.aos.env.AOS_PACK.replace("${CLAUDE_PLUGIN_ROOT}", ""))).isDirectory()).toBe(true);
  });
});
