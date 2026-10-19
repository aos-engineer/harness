// aos run cancel: the human's way out of a run that is stuck or no longer wanted. Cancelling returns every
// session bound to the run to pass-through, so the agent stops enforcing its gates.
import { cancelRun, ChainError, humanActor, loadState, OpError, projector, RunNotFoundError } from "@aos-harness/kernel";
import type { RunState } from "@aos-harness/kernel";
import type { CommandFn } from "../io.ts";
import { clipText, parseFlags, printable, requireTty, resolveRoot, TTY_NOTE, UsageError } from "./shared.ts";

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
  let state: RunState;
  try {
    state = loadState(loc, projector).state;
  } catch (e) {
    if (e instanceof RunNotFoundError) {
      io.err(`aos run cancel: ${e.message}. Pass --root if the run lives in another checkout.`);
      return 1;
    }
    if (e instanceof ChainError) {
      io.err(`Run log is tampered or corrupt at seq ${e.badSeq ?? "?"}; it cannot be cancelled through the log. Run aos doctor.`);
      return 1;
    }
    throw e;
  }
  if (state.status !== "active") {
    io.err(`aos run cancel: run ${run} is already ${state.status}.`);
    return 1;
  }

  io.out(`Run:   ${state.run} (${state.tier}, ${state.pack.name}@${state.pack.version})`);
  io.out(`Brief: ${printable(clipText(state.brief.replace(/\s+/g, " ").trim(), 200))}`);
  io.out(`Stage: ${state.current.stage} (${state.current.index + 1}/${state.stages.length})`);
  io.out("");

  const answer = await io.prompt(`Type "cancel" to end run ${run}: `);
  if (answer.trim() !== "cancel") {
    io.err("Not cancelled.");
    return 1;
  }

  let unbound: number;
  try {
    ({ unbound } = cancelRun(loc, { actor: humanActor(), reason }));
  } catch (e) {
    // Another terminal may have ended the run while this one waited for the typed word.
    if (e instanceof OpError) {
      io.err(`Not cancelled: ${e.message}.`);
      return 1;
    }
    if (e instanceof ChainError) {
      io.err(`Run log is tampered or corrupt at seq ${e.badSeq ?? "?"}; it cannot be cancelled through the log. Run aos doctor.`);
      return 1;
    }
    throw e;
  }
  io.out(`Cancelled run ${run}. Unbound ${unbound} ${unbound === 1 ? "session" : "sessions"}; they no longer enforce this run.`);
  return 0;
};
