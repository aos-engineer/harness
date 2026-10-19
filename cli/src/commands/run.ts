// aos run cancel: the human's way out of a run that is stuck or no longer wanted. Cancelling returns every
// session bound to the run to pass-through, so the agent stops enforcing its gates. That has to work even
// when the run's log is damaged or gone, or a bound session would fail closed with no way out.
import { cancelRun, ChainError, humanActor, loadState, OpError, projector, RunNotFoundError, unbindRun, verifyChain } from "@aos-harness/kernel";
import type { RunLocation, RunState } from "@aos-harness/kernel";
import type { CliIO, CommandFn } from "../io.ts";
import { clipText, parseFlags, printable, readBindings, requireTty, resolveRoot, TTY_NOTE, UsageError } from "./shared.ts";

const USAGE = `Usage: aos run cancel <run> --reason "..." [--root <path>]

Ends the run and unbinds its sessions. The reason is kept in the run log. --root points at the
checkout that holds the run (default: the git top level of the current directory).

${TTY_NOTE}`;

export const runCommand: CommandFn = async (io) => {
  let flags;
  try {
    flags = parseFlags(io.argv.slice(1), ["root", "reason", "help"]);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`aos run: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  const [sub, run, ...extra] = flags.positionals;
  if (flags.help && (sub === undefined || sub === "cancel")) {
    io.out(USAGE);
    return 0;
  }
  if (sub !== "cancel") {
    io.err(`aos run: this release supports only "cancel".\n\n${USAGE}`);
    return 2;
  }
  if (run === undefined || extra.length > 0) {
    io.err(USAGE);
    return 2;
  }
  const reason = flags.reason ?? "";
  if (reason.trim() === "") {
    io.err('aos run cancel: --reason "..." is required; the run log keeps it.');
    return 2;
  }
  if (!requireTty(io, "run cancel")) return 2;

  const loc = { root: resolveRoot(io, flags), run };
  const opened = openRun(loc);
  if (opened.state !== null && opened.state.status !== "active") {
    io.err(`aos run cancel: run ${run} is already ${opened.state.status}.`);
    return 1;
  }
  if (opened.state === null) {
    const bound = readBindings(loc.root).filter((b) => b.binding?.run === run).length;
    if (bound === 0) {
      io.err(`aos run cancel: ${printable(opened.broken)}, and no session is bound to it. Pass --root if the run lives in another checkout.`);
      return 1;
    }
    io.out(`Run ${run} cannot be read: ${printable(opened.broken)}.`);
    io.out(`Cancelling releases the ${sessions(bound)} bound to it. The log cannot record the cancel.`);
  } else {
    const { state } = opened;
    io.out(`Run:   ${state.run} (${state.tier}, ${printable(`${state.pack.name}@${state.pack.version}`)})`);
    io.out(`Brief: ${printable(clipText(state.brief.replace(/\s+/g, " ").trim(), 200))}`);
    io.out(`Stage: ${state.current.stage} (${state.current.index + 1}/${state.stages.length})`);
  }
  io.out("");

  const answer = await io.prompt(`Type "cancel" to end run ${run}: `);
  if (answer.trim() !== "cancel") {
    io.err("Not cancelled.");
    return 1;
  }

  if (opened.state === null) return release(io, loc, opened.broken);
  let unbound: number;
  try {
    ({ unbound } = cancelRun(loc, { actor: humanActor(), reason }));
  } catch (e) {
    // Another terminal may have ended the run while this one waited for the typed word.
    if (e instanceof OpError) {
      io.err(`Not cancelled: ${e.message}.`);
      return 1;
    }
    // The log broke between the check above and the append; the session still has to be let go.
    if (e instanceof ChainError || e instanceof RunNotFoundError) return release(io, loc, e.message);
    throw e;
  }
  io.out(`Cancelled run ${run}. Unbound ${sessions(unbound)}; they no longer enforce this run.`);
  return 0;
};

/**
 * The run's state, or why it cannot be trusted. The full chain is verified here, unlike the agent's fast
 * path, because a cancel recorded into a tampered log would read as a legitimate end to that log.
 */
function openRun(loc: RunLocation): { state: RunState; broken: null } | { state: null; broken: string } {
  try {
    const chain = verifyChain(loc);
    if (!chain.ok) return { state: null, broken: `its log is tampered or corrupt at seq ${chain.badSeq ?? "?"} (${chain.reason ?? "unknown"})` };
    return { state: loadState(loc, projector).state, broken: null };
  } catch (e) {
    if (e instanceof ChainError || e instanceof RunNotFoundError) return { state: null, broken: e.message };
    throw e;
  }
}

// Unbinding grants nothing: it only returns the sessions to pass-through, which is what the human asked for.
function release(io: CliIO, loc: RunLocation, broken: string): number {
  const n = unbindRun(loc.root, loc.run);
  io.out(`Released ${sessions(n)} bound to run ${loc.run}. The run log could not record the cancel: ${printable(broken)}.`);
  io.out("Run aos doctor to see what is wrong with the run.");
  return 0;
}

function sessions(n: number): string {
  return `${n} ${n === 1 ? "session" : "sessions"}`;
}
