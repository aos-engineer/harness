// aos status: read-only, so it needs no terminal. The list reads each run's snapshot, which is cheap; a
// single run's summary replays and verifies the whole log first, so it never presents a tampered run as
// healthy.
import { evaluateGate, listRuns, loadState, projector, readLog, renderSummary, RunNotFoundError, treeFingerprint, verifyChain } from "@aos-harness/kernel";
import type { RunLocation, RunState } from "@aos-harness/kernel";
import type { CliIO, CommandFn } from "../io.ts";
import { parseFlags, printable, resolveRoot, UsageError } from "./shared.ts";

const USAGE = `Usage: aos status [run] [--json] [--root <path>]

Without a run, lists every run under the root as: run  status  tier  stage.
With a run, verifies its log and prints its stage, gate, and gaps; an ended run shows its final state.
--root points at the checkout that holds the runs (default: the git top level of the current directory).`;

export const statusCommand: CommandFn = async (io) => {
  let flags;
  try {
    flags = parseFlags(io.argv.slice(1), ["root", "json", "help"]);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`aos status: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (flags.help) {
    io.out(USAGE);
    return 0;
  }
  const [run, ...extra] = flags.positionals;
  if (extra.length > 0) {
    io.err(USAGE);
    return 2;
  }
  const root = resolveRoot(io, flags);
  return run === undefined ? listAll(io, root, flags.json) : showOne(io, { root, run }, flags.json);
};

function listAll(io: CliIO, root: string, json: boolean): number {
  const rows: Array<{ run: string; status: string; tier: string; stage: string } | { run: string; error: string }> = [];
  for (const run of listRuns(root)) {
    try {
      const { state } = loadState({ root, run }, projector);
      rows.push({ run, status: state.status, tier: state.tier, stage: state.current.stage });
    } catch (e) {
      // One damaged run must not hide the others.
      rows.push({ run, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (json) io.out(JSON.stringify(rows, null, 2));
  else if (rows.length === 0) io.out(`No AOS runs under ${root}.`);
  else {
    for (const r of rows) {
      io.out(printable("error" in r ? `${r.run}  unreadable: ${r.error}. Run aos doctor.` : `${r.run}  ${r.status}  ${r.tier}  ${r.stage}`));
    }
  }
  return rows.some((r) => "error" in r) ? 1 : 0;
}

function showOne(io: CliIO, loc: RunLocation, json: boolean): number {
  let chain;
  try {
    chain = verifyChain(loc);
  } catch (e) {
    if (!(e instanceof RunNotFoundError)) throw e;
    io.err(`aos status: ${e.message}. Pass --root if the run lives in another checkout.`);
    return 1;
  }
  if (!chain.ok) {
    io.err(`Run log is tampered or corrupt at seq ${chain.badSeq ?? "?"}. Run aos doctor.`);
    return 1;
  }
  const { state } = loadState(loc, projector);
  if (state.status !== "active") return showEnded(io, loc, state, json);
  // The tree is read where the run was found, which is where the agent's hooks read it too.
  const tree = treeFingerprint(loc.root, { git: state.git, changes: state.changes });
  const gate = evaluateGate(state, state.current.stage, tree);
  if (json) {
    const { used, limit } = state.budget.iterations;
    io.out(JSON.stringify({ run: state.run, status: state.status, tier: state.tier, stage: state.current.stage, stages: state.stages, gate, final: false, iterations: { used, limit } }, null, 2));
  } else {
    io.out(printable(renderSummary(state, gate)));
  }
  return 0;
}

/**
 * A completed or cancelled run has no work left, so evaluating its gate now would list gaps nobody will
 * close. It is shown as it ended: the stage it stopped at and the last gate result the log recorded.
 */
function showEnded(io: CliIO, loc: RunLocation, state: RunState, json: boolean): number {
  const { stage, index } = state.current;
  const gate = state.lastGate[stage] ?? null;
  const reason = state.status === "cancelled" ? cancelReason(loc) : null;
  const { used, limit } = state.budget.iterations;
  if (json) {
    const ended = { run: state.run, status: state.status, tier: state.tier, stage, stages: state.stages, gate, final: true, iterations: { used, limit } };
    io.out(JSON.stringify(reason === null ? ended : { ...ended, reason }, null, 2));
    return 0;
  }
  const label = (name: string) => (name === stage ? `${name} (final)` : state.lastGate[name]?.verdict === "pass" ? `${name} (passed)` : name);
  const lines = [
    `AOS run ${state.run} (${state.tier}, ${state.pack.name}@${state.pack.version}), ${state.status}. This is its final state; no work remains.`,
    `Final stage ${index + 1}/${state.stages.length}: ${stage}. ${gate === null ? `No gate result was recorded for ${stage}.` : `Final gate result: ${gate.verdict}.`}`,
    ...(reason === null ? [] : [`Cancelled: ${reason.replace(/\s+/g, " ").trim()}`]),
    `Stages: ${state.stages.map(label).join(", ")}`,
    `Iterations: ${used}/${limit}.`,
  ];
  io.out(printable(lines.join("\n")));
  return 0;
}

// The projection keeps only the status, so the reason comes from the log, which was just verified.
function cancelReason(loc: RunLocation): string | null {
  const events = readLog(loc).events;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "run.cancelled") return e.data.reason;
  }
  return null;
}
