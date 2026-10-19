// Turns a kernel HookDecision into what Claude Code reads from a command hook. Every decision exits 0
// and speaks through JSON on stdout, because Claude Code only parses hook JSON from a zero exit.
import type { HookDecision } from "@aos-harness/kernel";
import type { ClaudeEventName } from "./events.ts";

type Rendered = { stdout: string; exitCode: 0 };

function out(body: unknown): Rendered {
  return { stdout: JSON.stringify(body), exitCode: 0 };
}

function notice(event: ClaudeEventName, text: string): Rendered {
  switch (event) {
    // These reach the model. A failure notice has to as well: a masked test run can still fail, and
    // the agent must hear that its result was not recorded.
    case "PostToolUse":
    case "PostToolUseFailure":
    case "SessionStart":
      return out({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
    // A Stop notice is for the user. On PreToolUse, a systemMessage cannot touch the permission
    // flow, which a hookSpecificOutput block might.
    case "Stop":
    case "PreToolUse":
      return out({ systemMessage: text });
    default:
      throw new Error(`cannot render a notice for unknown event ${JSON.stringify(event)}`);
  }
}

export function render(event: ClaudeEventName, decision: HookDecision): Rendered {
  switch (decision.kind) {
    case "allow":
      // Allow prints nothing. A permissionDecision of "allow" would skip the user's own
      // permission prompt for the tool, which AOS must never do on the user's behalf.
      return decision.notice === null || decision.notice === "" ? { stdout: "", exitCode: 0 } : notice(event, decision.notice);
    case "deny":
      if (event !== "PreToolUse") throw new Error(`cannot render a deny decision for ${event}: only PreToolUse can deny a tool call`);
      return out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason } });
    case "block-stop":
      if (event !== "Stop") throw new Error(`cannot render a block-stop decision for ${event}: only Stop can block a stop`);
      return out({ decision: "block", reason: decision.reason });
    default:
      throw new Error(`unknown decision kind ${JSON.stringify((decision as { kind: unknown }).kind)}`);
  }
}
