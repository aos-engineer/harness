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
import { failsafeDecision, handleHook, type HookDecision } from "@aos-harness/kernel";
import { CLI_EVENTS, HOOK_EVENT, type ClaudeEventName } from "../src/events.ts";
import { normalize } from "../src/payload.ts";
import { render } from "../src/render.ts";

async function main(): Promise<string> {
  const arg = process.argv[2] ?? "";
  const raw = await text(process.stdin);
  capture(arg, raw);
  const event = CLI_EVENTS[arg];
  if (event === undefined) return "";
  return output(event, decide(event, raw));
}

function decide(event: ClaudeEventName, raw: string): HookDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    return handleHook(normalize(event, parsed));
  } catch (err) {
    // handleHook never throws, so this is a payload that did not parse or normalize. The command is read
    // straight from the raw payload, so a push still fails closed.
    return failsafeDecision(HOOK_EVENT[event], commandOf(parsed), err);
  }
}

function output(event: ClaudeEventName, decision: HookDecision): string {
  try {
    return render(event, decision).stdout;
  } catch (err) {
    // A decision this event cannot carry is a kernel bug; fall back to the failure policy for the event.
    try {
      return render(event, failsafeDecision(HOOK_EVENT[event], null, err)).stdout;
    } catch {
      return "";
    }
  }
}

function commandOf(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const input = (parsed as { tool_input?: unknown }).tool_input;
  if (typeof input !== "object" || input === null) return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
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

main().then(
  (stdout) => {
    if (stdout !== "") process.stdout.write(stdout);
  },
  () => {
    // Reading stdin failed, so there is no payload to judge. Print nothing: the runtime itself is fine.
  },
);
