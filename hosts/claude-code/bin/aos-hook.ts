#!/usr/bin/env bun
// Claude Code runs this for every hook the plugin registers, with the event as the argument and the
// payload on stdin. It always exits 0 and speaks only through JSON on stdout: a non-zero exit is left
// for a runtime that died, which is what the Bash guard's `onFailure: "block"` catches.
//
// It runs before and after every tool call, so its imports stay small: the kernel barrel and this
// plugin's own src, nothing from the CLI.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { handleHook, payloadFailsafe, type HookDecision } from "@aos-harness/kernel";
import { CLI_EVENTS, HOOK_EVENT } from "../src/events.ts";
import { normalize } from "../src/payload.ts";
import { render } from "../src/render.ts";

export interface RespondOptions {
  /** The directory the session started in; see projectDir below. */
  projectDir?: string;
  /** Swappable so a test can make rendering fail; nothing real renders a decision its event cannot carry. */
  render?: typeof render;
}

/** One hook call: the event argument and the raw payload in, Claude Code's hook JSON (or nothing) out. */
export function respond(arg: string, raw: string, opts: RespondOptions = {}): string {
  const event = CLI_EVENTS[arg];
  if (event === undefined) return "";
  let parsed: unknown;
  // Read straight from the raw payload, so the fallbacks below still know the command and where it ran.
  const site = () => ({ cwd: field(parsed, "cwd"), projectDir: opts.projectDir ?? null, command: commandOf(parsed) });

  let decision: HookDecision;
  try {
    parsed = JSON.parse(raw);
    decision = handleHook(normalize(event, parsed), opts.projectDir === undefined ? {} : { projectDir: opts.projectDir });
  } catch (err) {
    // handleHook never throws, so this is a payload that did not parse or normalize.
    decision = payloadFailsafe(HOOK_EVENT[event], site(), err);
  }

  const draw = opts.render ?? render;
  try {
    return draw(event, decision).stdout;
  } catch (err) {
    // A decision this event cannot carry is a kernel bug. Fall back to the failure policy with the real
    // command, so a push still fails closed.
    try {
      return draw(event, payloadFailsafe(HOOK_EVENT[event], site(), err)).stdout;
    } catch {
      return "";
    }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? "";
  const raw = await text(process.stdin);
  capture(arg, raw);
  const stdout = respond(arg, raw, projectDir());
  if (stdout !== "") process.stdout.write(stdout);
}

// Claude Code exports the session's starting directory to hook commands, and it does not follow the
// agent's cd. The kernel looks for the binding there when the payload's cwd has none.
function projectDir(): { projectDir?: string } {
  const dir = process.env.CLAUDE_PROJECT_DIR;
  return dir === undefined || dir === "" ? {} : { projectDir: dir };
}

/** A string field of a JSON object, or null for anything else. */
function field(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function commandOf(parsed: unknown): string | null {
  const input = typeof parsed === "object" && parsed !== null ? (parsed as { tool_input?: unknown }).tool_input : null;
  return field(input, "command");
}

// For re-capturing host payloads after a Claude Code upgrade. Best effort: capture never affects the decision.
function capture(arg: string, raw: string): void {
  const dir = process.env.AOS_HOOK_CAPTURE_DIR;
  if (dir === undefined || dir === "") return;
  try {
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${process.pid}-${arg.replace(/[^a-z-]/g, "_") || "none"}.json`;
    writeFileSync(join(dir, name), raw);
  } catch {
    // Capture is a debugging aid.
  }
}

// Imported by tests for respond(); run only as the hook command itself.
if (import.meta.main) {
  main().catch(() => {
    // Reading stdin failed, so there is no payload to judge. Print nothing: the runtime itself is fine.
  });
}
