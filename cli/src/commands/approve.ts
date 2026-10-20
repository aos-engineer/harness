// aos approve: a human passes (or denies) a human gate. The human sees what the agent submitted, then types
// the stage name, so a stray Enter or a pasted command cannot approve by itself.
import { approve, ChainError, deny, humanActor, loadState, OpError, pendingApproval, projector, RunNotFoundError, verifyChain } from "@aos-harness/kernel";
import type { RunState } from "@aos-harness/kernel";
import type { CommandFn } from "../io.ts";
import { clipText, parseFlags, printable, requireHuman, resolveRoot, TTY_NOTE, UsageError } from "./shared.ts";

const SUMMARY_CHARS = 2000;

const USAGE = `Usage: aos approve <run> [stage] [--reason "..."] [--root <path>]
       aos approve <run> [stage] --deny --reason "..." [--root <path>]

Shows the pending approval request for the run's current stage and asks you to type the stage name.
--deny records a denial instead; the agent revises from the reason. --root points at the checkout
that holds the run (default: the git top level of the current directory).

${TTY_NOTE}`;

export const approveCommand: CommandFn = async (io) => {
  let flags;
  try {
    flags = parseFlags(io.argv.slice(1), ["root", "reason", "deny", "help"]);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`aos approve: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (flags.help) {
    io.out(USAGE);
    return 0;
  }
  const [run, stageArg, ...extra] = flags.positionals;
  if (run === undefined || extra.length > 0) {
    io.err(USAGE);
    return 2;
  }
  const reason = flags.reason?.trim() ? flags.reason : null;
  if (flags.deny && reason === null) {
    io.err('aos approve: --deny needs --reason "..." so the agent knows what to revise.');
    return 2;
  }
  if (!requireHuman(io, "approve")) return 2;

  const verb = flags.deny ? "deny" : "approve";
  const loc = { root: resolveRoot(io, flags), run };
  let state: RunState;
  try {
    // Verify before showing anything: a human should never be asked to approve a run whose log was edited.
    const chain = verifyChain(loc);
    if (!chain.ok) {
      io.err(tampered(chain.badSeq));
      return 1;
    }
    state = loadState(loc, projector).state;
  } catch (e) {
    if (e instanceof RunNotFoundError) {
      io.err(`aos approve: ${e.message}. Pass --root if the run lives in another checkout.`);
      return 1;
    }
    if (e instanceof ChainError) {
      io.err(tampered(e.badSeq));
      return 1;
    }
    throw e;
  }

  const stage = stageArg ?? state.current.stage;
  const pending = pendingApproval(state, stage);
  if (pending === null) {
    io.err(`aos approve: ${nothingPending(state, stage)}`);
    return 1;
  }

  io.out(`Run:     ${state.run} (${state.tier}, ${printable(`${state.pack.name}@${state.pack.version}`)})`);
  io.out(`Brief:   ${printable(clipText(oneLine(state.brief), 200))}`);
  io.out(`Stage:   ${pending.stage} (${state.current.index + 1}/${state.stages.length})`);
  io.out(`Request: ${pending.request}`);
  io.out("Summary from the agent:");
  io.out(printable(clipText(pending.summary, SUMMARY_CHARS)));
  io.out("End of the agent's summary.");
  io.out("");
  // The summary can imitate the header above, so the command, not the agent, writes the last line the human
  // reads before typing.
  io.out(printable(`You are ${flags.deny ? "denying" : "approving"} request ${pending.request} for stage "${pending.stage}" of run ${state.run}.`));

  const answer = await io.prompt(`Type the stage name ("${pending.stage}") to ${verb}: `);
  if (answer.trim() !== pending.stage) {
    io.err(flags.deny ? "Not denied." : "Not approved.");
    return 1;
  }

  try {
    // Pinned to the request shown above: one the agent filed while the human typed is not this decision.
    const p = { stage: pending.stage, request: pending.request, actor: humanActor() };
    if (reason !== null && flags.deny) deny(loc, { ...p, reason });
    else approve(loc, { ...p, reason });
  } catch (e) {
    if (e instanceof ChainError) {
      io.err(tampered(e.badSeq));
      return 1;
    }
    if (e instanceof OpError && e.code === "not_found") {
      io.err(`${flags.deny ? "Not denied" : "Not approved"}: ${e.message}. Run aos approve again to see the current request.`);
      return 1;
    }
    throw e;
  }
  io.out(flags.deny
    ? `Denied ${pending.stage} for run ${state.run}. The agent sees your reason and revises.`
    : `Approved ${pending.stage} for run ${state.run}. The agent can advance the stage.`);
  return 0;
};

function tampered(badSeq: number | null): string {
  return `Run log is tampered or corrupt at seq ${badSeq ?? "?"}; not approving. Run aos doctor.`;
}

function nothingPending(state: RunState, stage: string): string {
  if (state.status !== "active") return `run ${state.run} is ${state.status}; there is nothing to approve.`;
  if (stage !== state.current.stage) return `run ${state.run} is at ${state.current.stage}, not ${stage}. Only the current stage can be approved.`;
  return `run ${state.run} has no pending approval request for ${stage}. The agent files one when the ${stage} work is ready for you.`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
