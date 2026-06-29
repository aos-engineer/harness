/**
 * aos replay — Replay a transcript JSONL file with colored output.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { c, type ParsedArgs } from "../colors";

const HELP = `
${c.bold("aos replay")} — Replay a deliberation transcript

${c.bold("USAGE")}
  aos replay <transcript.jsonl>

${c.bold("DESCRIPTION")}
  Reads a JSONL transcript file and replays it with colored,
  formatted output. Each event type is displayed with appropriate
  formatting and color coding.

${c.bold("EXAMPLES")}
  aos replay .aos/sessions/session-abc123/transcript.jsonl
  aos replay output/my-deliberation/transcript.jsonl
`;

// ── ANSI helpers (no external deps) ──────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

const AGENT_COLORS = [CYAN, YELLOW, MAGENTA, GREEN, BLUE, WHITE, RED];
const agentColorMap = new Map<string, string>();
let nextColorIdx = 0;

function agentColor(agentId: string): string {
  if (!agentColorMap.has(agentId)) {
    agentColorMap.set(agentId, AGENT_COLORS[nextColorIdx % AGENT_COLORS.length]);
    nextColorIdx++;
  }
  return agentColorMap.get(agentId)!;
}

function preview(text: string, maxLen = 200): string {
  if (!text) return "(empty)";
  const oneLine = text.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + "...";
}

function separator(): string {
  return `${DIM}${"─".repeat(72)}${RESET}`;
}

// ── Event formatters ─────────────────────────────────────────

function formatSessionStart(entry: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(separator());
  lines.push(`${CYAN}${BOLD}SESSION START${RESET}`);
  if (entry.sessionId) lines.push(`  ${DIM}Session:${RESET}      ${entry.sessionId}`);
  if (entry.profile) lines.push(`  ${DIM}Profile:${RESET}      ${entry.profile}`);
  if (entry.domain) lines.push(`  ${DIM}Domain:${RESET}       ${entry.domain}`);
  if (entry.briefPath) lines.push(`  ${DIM}Brief:${RESET}        ${entry.briefPath}`);
  if (entry.participants) {
    const p = entry.participants as string[];
    lines.push(`  ${DIM}Participants:${RESET} ${p.join(", ")}`);
  }
  lines.push(`  ${DIM}Time:${RESET}         ${entry.timestamp || "unknown"}`);
  lines.push(separator());
  return lines.join("\n");
}

function formatDelegation(entry: Record<string, unknown>): string {
  const targets = entry.parallel
    ? (entry.parallel as string[]).concat((entry.sequential as string[]) || [])
    : entry.target;
  const targetStr = Array.isArray(targets) ? targets.join(", ") : String(targets || "all");
  const msg = preview(String(entry.message || ""), 120);
  return `${YELLOW}${BOLD}Arbiter${RESET} ${YELLOW}->${RESET} [${targetStr}]\n  ${DIM}Round ${entry.round || "?"}:${RESET} ${msg}`;
}

function formatResponse(entry: Record<string, unknown>): string {
  const aid = String(entry.agentId || "unknown");
  const color = agentColor(aid);
  const text = preview(String(entry.text || ""));
  const cost = entry.cost ? ` ${DIM}($${(entry.cost as number).toFixed(4)})${RESET}` : "";
  return `${color}${BOLD}${aid}${RESET}${cost}\n  ${text}`;
}

function formatConstraintCheck(entry: Record<string, unknown>): string {
  const state = (entry.state || {}) as Record<string, unknown>;
  const approaching = state.approaching_any_maximum;
  const hitMax = state.hit_maximum;

  let gauge: string;
  if (hitMax) {
    gauge = `${RED}${BOLD}[MAX HIT]${RESET}`;
  } else if (approaching) {
    gauge = `${YELLOW}[APPROACHING MAX]${RESET}`;
  } else {
    gauge = `${GREEN}[OK]${RESET}`;
  }

  const elapsed = state.elapsed_minutes ? `${(state.elapsed_minutes as number).toFixed(1)}min` : "?";
  const budget = state.budget_spent ? `$${(state.budget_spent as number).toFixed(4)}` : "?";
  const rounds = state.rounds_completed ?? "?";

  return `${DIM}Constraint Check R${entry.round || "?"}${RESET} ${gauge}  ${DIM}elapsed=${elapsed} budget=${budget} rounds=${rounds}${RESET}`;
}

function formatConstraintWarning(entry: Record<string, unknown>): string {
  const warnings: string[] = [];
  if (entry.approaching_max_time) warnings.push("time");
  if (entry.approaching_max_budget) warnings.push("budget");
  if (entry.approaching_max_rounds) warnings.push("rounds");
  return `${YELLOW}${BOLD}CONSTRAINT WARNING${RESET} ${YELLOW}Approaching maximum: ${warnings.join(", ")}${RESET}`;
}

function formatFinalStatement(entry: Record<string, unknown>): string {
  const aid = String(entry.agentId || "unknown");
  const color = agentColor(aid);
  const text = String(entry.text || "");
  return `${color}${BOLD}FINAL — ${aid}${RESET}\n${text}`;
}

function formatSessionEnd(entry: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(separator());
  lines.push(`${CYAN}${BOLD}SESSION END${RESET}`);
  if (entry.sessionId) lines.push(`  ${DIM}Session:${RESET}  ${entry.sessionId}`);
  if (entry.roundsCompleted != null) lines.push(`  ${DIM}Rounds:${RESET}   ${entry.roundsCompleted}`);
  if (entry.duration) lines.push(`  ${DIM}Duration:${RESET} ${entry.duration}`);
  if (entry.totalCost) lines.push(`  ${DIM}Cost:${RESET}     $${(entry.totalCost as number).toFixed(4)}`);
  lines.push(`  ${DIM}Time:${RESET}     ${entry.timestamp || "unknown"}`);
  lines.push(separator());
  return lines.join("\n");
}

function formatError(entry: Record<string, unknown>): string {
  const msg = entry.error || entry.message || "Unknown error";
  const aid = entry.agentId ? ` (${entry.agentId})` : "";
  return `${RED}${BOLD}ERROR${aid}${RESET} ${RED}${msg}${RESET}`;
}

function formatSteer(entry: Record<string, unknown>): string {
  const source = entry.source ? ` from ${entry.source}` : "";
  const target = entry.target ? ` -> ${entry.target}` : "";
  const message = preview(String(entry.message || ""), 180);
  return `${MAGENTA}${BOLD}STEER${RESET}${DIM}${source}${target}${RESET}\n  ${message}`;
}

function formatToolDenied(entry: Record<string, unknown>): string {
  const agent = entry.agent || entry.agentId || "system";
  const tool = entry.tool || "unknown";
  const reason = entry.reason || entry.message || "Denied by active tool policy";
  const detail = entry.detail ? `\n  ${DIM}Detail:${RESET} ${preview(JSON.stringify(entry.detail), 140)}` : "";
  return `${RED}${BOLD}TOOL DENIED${RESET} ${RED}${tool}${RESET} ${DIM}for ${agent}${RESET}\n  ${reason}${detail}`;
}

function formatLifecycle(entry: Record<string, unknown>): string {
  const label = entry.type === "session_resumed" ? "SESSION RESUMED" : "SESSION PAUSED";
  const session = entry.sessionId ? ` ${DIM}${entry.sessionId}${RESET}` : "";
  return `${CYAN}${BOLD}${label}${RESET}${session}`;
}

function formatGeneric(entry: Record<string, unknown>): string {
  const type = entry.type || "unknown";
  const timestamp = entry.timestamp || "";
  return `${DIM}[${type}] ${timestamp}${RESET} ${JSON.stringify(entry, null, 0).slice(0, 200)}`;
}

// ── Main ─────────────────────────────────────────────────────

export async function replayCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  const filePath = args.positional[0];
  if (!filePath) {
    console.error(c.red("Usage: aos replay <transcript.jsonl>"));
    process.exit(1);
  }

  // Direct CLI arg — not passed through confinedResolve (spec D4: user is trusted
  // at the CLI boundary). If this ever becomes config-driven, use confinedResolve.
  const resolved = filePath.startsWith("/") ? filePath : resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    console.error(c.red(`Transcript file not found: ${resolved}`));
    process.exit(1);
  }

  const content = readFileSync(resolved, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  console.log(`\n${BOLD}Replaying transcript:${RESET} ${resolved}\n`);

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      console.error(`${DIM}(skipping malformed line)${RESET}`);
      continue;
    }

    let output: string;
    switch (entry.type) {
      case "session_start":
        output = formatSessionStart(entry);
        break;
      case "delegation":
        output = formatDelegation(entry);
        break;
      case "response":
        output = formatResponse(entry);
        break;
      case "constraint_check":
        output = formatConstraintCheck(entry);
        break;
      case "constraint_warning":
        output = formatConstraintWarning(entry);
        break;
      case "final_statement":
        output = formatFinalStatement(entry);
        break;
      case "session_end":
        output = formatSessionEnd(entry);
        break;
      case "error":
        output = formatError(entry);
        break;
      case "steer":
        output = formatSteer(entry);
        break;
      case "tool-denied":
        output = formatToolDenied(entry);
        break;
      case "session_paused":
      case "session_resumed":
        output = formatLifecycle(entry);
        break;
      default:
        output = formatGeneric(entry);
        break;
    }

    console.log(output);
    console.log();
  }

  console.log(`${DIM}Replay complete. ${lines.length} events.${RESET}\n`);
}
