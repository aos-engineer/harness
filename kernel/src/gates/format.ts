// Text that hooks and tools hand to the agent: a blocked-action message and a compact run summary.
// Both list agent gaps before human ones, because the agent reads from the top and acts on what it can.
import type { Gap, GateResult, RunState } from "../types.ts";

const MAX_GAP_LINES = 8;
const MAX_SUMMARY_CHARS = 1200;

// The state argument is unused today; it is part of the signature callers already pass.
export function formatGate(result: GateResult, _state: RunState, verb: string): string {
  const gaps = agentFirst(result.gaps);
  const shown = gaps.slice(0, MAX_GAP_LINES).map(dash);
  return [`AOS: ${verb} blocked: ${result.stage} gate ${result.verdict}.`, ...withOverflow(shown, gaps.length - shown.length)].join("\n");
}

// Injected into context at session start and after compaction, so it is capped hard: the stage line
// and the iteration line always survive, and gap lines give way first.
export function renderSummary(state: RunState, gate: GateResult | null): string {
  const head = [
    `AOS run ${state.run} (${state.tier}, ${state.pack.name}@${state.pack.version}), ${state.status}.`,
    `Stage ${state.current.index + 1}/${state.stages.length}: ${state.current.stage}. Gate: ${gate === null ? "not evaluated" : gate.verdict}.`,
  ];
  const tail = [
    `Stages: ${state.stages.map((name) => stageLabel(state, name)).join(", ")}`,
    `Iterations: ${state.budget.iterations.used}/${state.budget.iterations.limit}.`,
  ];
  const compose = (lines: string[]) => [...head, ...lines, ...tail].join("\n");

  const gaps = gate === null ? [] : agentFirst(gate.gaps).map(dash);
  if (gaps.length === 0) return clip(compose([]), MAX_SUMMARY_CHARS);
  for (let k = Math.min(gaps.length, MAX_GAP_LINES); k >= 1; k--) {
    const text = compose(withOverflow(gaps.slice(0, k), gaps.length - k));
    if (text.length <= MAX_SUMMARY_CHARS) return text;
  }
  // Not even one whole gap fits: cut the first one, so the agent still sees what to do next.
  const overflow = withOverflow([], gaps.length - 1);
  const room = MAX_SUMMARY_CHARS - compose(["", ...overflow]).length;
  return clip(compose([clip(gaps[0] ?? "", room), ...overflow]), MAX_SUMMARY_CHARS);
}

function agentFirst(gaps: Gap[]): Gap[] {
  return [...gaps.filter((g) => g.who === "agent"), ...gaps.filter((g) => g.who !== "agent")];
}

const dash = (g: Gap) => `- ${g.text}`;

function withOverflow(lines: string[], hidden: number): string[] {
  return hidden > 0 ? [...lines, `- (+${hidden} more; see aos_status)`] : lines;
}

function stageLabel(state: RunState, name: string): string {
  if (name === state.current.stage) return `${name} (current)`;
  return state.lastGate[name]?.verdict === "pass" ? `${name} (passed)` : name;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return max <= 3 ? s.slice(0, Math.max(max, 0)) : s.slice(0, max - 3) + "...";
}
