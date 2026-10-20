# CLI reference

The `aos` CLI is the human side of AOS. The agent drives a run through [MCP tools](mcp-tools.md) inside its host; this CLI is how a person approves a gate, checks a run, diagnoses the setup, and ends a run. Install it with `npm install -g aos-harness@next` or `bun add -g aos-harness@next`. It needs Bun 1.3.11 or later on `PATH`, because the installed binary is a Bun script.

```
aos <command> [options]
```

| Command | Purpose | Needs a terminal |
|---|---|---|
| [`aos approve`](#aos-approve) | Approve or deny the pending human gate of a run | yes |
| [`aos status`](#aos-status) | List runs, or summarize one run | no |
| [`aos doctor`](#aos-doctor) | Check the toolchain, the pack, and every run log | no |
| [`aos run cancel`](#aos-run-cancel) | End a run and release its sessions | yes |
| [`aos mcp`](#aos-mcp) | Serve the AOS MCP tools on stdio | no |

## Global behavior

- `aos --help`, `aos -h`, or `aos` with no arguments prints the command list and exits 0. `aos --version` or `aos -v` prints `aos <version>` and exits 0.
- `aos <command> --help` (or `-h`) prints that command's usage and exits 0. `aos mcp` has no help flag.
- Value flags take `--flag value` or `--flag=value`. `--` ends the flags; everything after it is positional. A flag a command does not accept is an error, never silently ignored.
- **Where runs live.** Commands that take `--root <path>` look for runs under `<path>/.aos/runs/`. Without it they use the git top level of the current directory, or the directory itself outside git. Runs always live at the repository top level, so any subdirectory works.
- Text from run logs and agents (briefs, summaries, reasons, file names) is printed with control, format, and bidirectional characters shown as visible `\uXXXX` escapes, so a crafted summary cannot repaint the terminal or hide what is being approved.

Exit codes shared by every command:

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | The command ran and failed: a run was not found or failed verification, nothing was pending, the confirmation was not typed, or a check failed. Uncaught errors also print `aos: <message>` and exit 1, for example `aos: AOS refuses to write through the symlink <path>; remove it and rerun` when something under `.aos/` is a symlink. |
| 2 | Usage error: an unknown command or flag, a missing argument or value, or a human-only command run from an agent's shell or without a terminal. |

## Human-only commands

`aos approve` and `aos run cancel` decide what only a person may decide, so before prompting, and before reading any run, they make two checks:

1. **Not an agent's shell.** If `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CLAUDE_CODE_SESSION_ID` is set to a non-empty value, the command exits 2 with:

   ```
   aos approve must be run by a person in their own terminal. This shell belongs to an agent session (CLAUDECODE is set). Run it from a terminal outside Claude Code.
   ```

   Claude Code sets these variables in every command its agent runs, so this check holds even when a wrapper such as `script` gives the agent a terminal. Run the command from a terminal outside Claude Code.
2. **An interactive terminal.** Without one, the command exits 2 with `aos approve needs an interactive terminal (TTY). Run it yourself, not through an agent.`

The messages name the command (`aos run cancel` for a cancel) and the variable that was found. Neither check is a security boundary: a process can clear the variables and allocate a terminal. They stop an agent from passing its own gate by accident or shortcut, and the run log records who decided each gate and why. In a gated session, the Bash guard also refuses these commands before they run; see [security](security.md).

## aos approve

```
aos approve <run> [stage] [--reason "..."] [--root <path>]
aos approve <run> [stage] --deny --reason "..." [--root <path>]
```

Shows the pending approval request for the run's current stage, then asks you to type the stage name to record your decision. `stage` defaults to the run's current stage; only the current stage can be decided.

| Flag | Meaning |
|---|---|
| `--reason "..."` | Recorded with the decision. Optional for an approval. |
| `--deny` | Record a denial instead. Requires `--reason`, because the agent revises from it. |
| `--root <path>` | The checkout that holds the run. |
| `--help`, `-h` | Print usage. |

What it does, in order:

1. Refuses when an agent's shell started it, then when there is no interactive terminal. See [human-only commands](#human-only-commands).
2. Verifies the run's entire hash chain. A tampered log is refused: `Run log is tampered or corrupt at seq <n>; not approving. Run aos doctor.`
3. Finds the pending request: the latest one filed since the stage was entered, still undecided.
4. Prints the run, brief, stage, request id, and the agent's summary (the summary is capped at 2,000 characters, the brief at 200), then a closing line written by the command itself, so the summary cannot imitate it.
5. Asks `Type the stage name ("<stage>") to approve:` (or `to deny:`). Anything else prints `Not approved.` (or `Not denied.`) and exits 1.
6. Records the decision, pinned to the request id it showed. If the agent filed a newer request meanwhile, nothing is recorded and you are asked to run `aos approve` again.

The decision's actor is your OS account name (from the OS user database, falling back to `USER` or `LOGNAME`).

| Exit | When |
|---|---|
| 0 | `Approved <stage> for run <run>. The agent can advance the stage.` or `Denied <stage> for run <run>. The agent sees your reason and revises.` |
| 1 | The run does not exist under the root, its log fails verification, nothing is pending for that stage, the typed name did not match, or the request was superseded. |
| 2 | Usage error, `--deny` without `--reason`, started from an agent's shell, or no terminal. |

Messages when nothing is pending:

- `run <run> is <status>; there is nothing to approve.`
- `run <run> is at <current>, not <stage>. Only the current stage can be approved.`
- `run <run> has no pending approval request for <stage>. The agent files one when the <stage> work is ready for you.`

## aos status

```
aos status [run] [--json] [--root <path>]
```

Read-only; it needs no terminal.

**Without a run**, it lists every run under the root, one line each: `<run>  <status>  <tier>  <stage>`. With no runs it prints `No AOS runs under <root>.` The list verifies each run's whole log first. A run whose chain is broken is listed as `<run>  log tampered or corrupt at seq <n>. Run aos doctor.`, a run that cannot be read is listed as `<run>  unreadable: <reason>. Run aos doctor.`, and in either case the other runs are still listed and the command exits 1.

**With a run**, it verifies the run's whole log first, then:

- for an active run, evaluates the current gate against the current tree and prints the same summary the agent sees after compaction:

  ```
  AOS run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z (bounded, feature-delivery@1.0.0), active.
  Stage 1/3: design. Gate: pending.
  - Waiting on the human. They approve with: aos approve 01JB2Q4X7N5K8M3R6T9V0W1Y2Z design --root "/path/to/greeter"
  Stages: design (current), build, verify
  Iterations: 1/20.
  ```

- for a completed or cancelled run, shows its final state: the stage it ended at, the last gate result the log recorded, and for a cancelled run the reason.

| Flag | Meaning |
|---|---|
| `--json` | Machine-readable output (see below). |
| `--root <path>` | The checkout that holds the runs. |
| `--help`, `-h` | Print usage. |

JSON shapes:

- List: an array of `{ "run", "status", "tier", "stage" }`, or `{ "run", "error" }` for an unreadable run.
- One run: `{ "run", "status", "tier", "stage", "stages", "gate", "final", "iterations": { "used", "limit" } }`, plus `"reason"` for a cancelled run. `final` is `false` for an active run and `true` for an ended one. `gate` has `stage`, `verdict`, `gaps`, `fingerprint`, and `weakFreshness`; for an ended run it is the last recorded result, or `null`.

| Exit | When |
|---|---|
| 0 | Success. |
| 1 | List: at least one run is unreadable. One run: it does not exist under the root, or its log fails verification (`Run log is tampered or corrupt at seq <n>. Run aos doctor.`). |
| 2 | Usage error. |

## aos doctor

```
aos doctor [--pack <dir>] [--root <path>]
```

Checks everything AOS depends on and prints one line per finding: `OK`, `WARN` (works, but in a weaker mode than it should), or `FAIL` (AOS cannot be trusted to enforce anything until it is fixed), each with a fix where one applies. It ends with a count, and exits 1 if any check failed.

| Check | OK | WARN or FAIL |
|---|---|---|
| Bun | running under Bun 1.3.11 or later | FAIL: not Bun, or older |
| git | `git --version` runs | FAIL: git missing |
| Claude Code | `claude --version` is 2.1.295 or later | WARN: not found, unreadable, or older (a crashed Bash hook could not fail closed) |
| Repository | inside a git repository, and `.aos/` is gitignored | WARN: not in git (weak freshness), or `.aos/` not ignored (run logs could be committed) |
| Pack | the pack loads | FAIL: lists every issue the loader found |
| Bound skills | each skill a stage names is installed under `~/.claude/plugins/cache/` | WARN: not installed; the agent falls back to the stage's written instructions |
| Runs | each run's hash chain verifies and its snapshot is current | FAIL: an active run's log is tampered or unreadable. WARN: an ended run's log is tampered, the log ends in torn bytes (repaired on the next append), or `state.json` lags (rebuilt on the next append) |
| Session bindings | every binding points at a run that verifies | FAIL: a binding points at a run that is missing or fails verification; release it with `aos run cancel`. WARN: a binding file is unreadable; delete it to unbind that session |
| Hook errors | `.aos/hook-errors.log` is empty or absent | WARN: shows the last three lines |

The pack checked is `--pack`, else `AOS_PACK`, else the reference pack that ships with the CLI. A relative `--pack` resolves against the current directory. Each check that throws is reported as its own FAIL, so one broken check never hides the rest.

| Flag | Meaning |
|---|---|
| `--pack <dir>` | The pack to load and check. |
| `--root <path>` | The checkout whose runs and bindings to check. |
| `--help`, `-h` | Print usage. |

| Exit | When |
|---|---|
| 0 | No FAIL findings. |
| 1 | At least one FAIL. |
| 2 | Usage error. |

## aos run cancel

```
aos run cancel <run> --reason "..." [--root <path>]
```

Ends an active run and unbinds every session bound to it, so those sessions return to normal Claude Code behavior. The reason is required and kept in the run log. `cancel` is the only `aos run` subcommand in this release.

What it does, in order:

1. Refuses when an agent's shell started it, then when there is no interactive terminal, like `aos approve`. See [human-only commands](#human-only-commands).
2. Verifies the run's whole chain, so a cancel is never recorded into a tampered log as if it were a legitimate end.
3. Prints the run, brief, and current stage, and asks `Type "cancel" to end run <run>:`. Anything else prints `Not cancelled.` and exits 1.
4. Appends `run.cancelled` and removes the run's session bindings: `Cancelled run <run>. Unbound <n> sessions; they no longer enforce this run.`

If the run's log cannot be read or fails verification, cancel still releases the sessions bound to it (a bound session would otherwise keep failing closed on push), says the log could not record the cancel, and points you at `aos doctor`. If such a run has no bound sessions, there is nothing to release and it exits 1.

| Flag | Meaning |
|---|---|
| `--reason "..."` | Required. Why the run ended. |
| `--root <path>` | The checkout that holds the run. |
| `--help`, `-h` | Print usage. |

| Exit | When |
|---|---|
| 0 | Cancelled, or a broken run's sessions were released. |
| 1 | The run is already completed or cancelled, it cannot be read and nothing is bound to it, the confirmation was not typed, or another terminal ended it first. |
| 2 | Usage error, a subcommand other than `cancel`, a missing `--reason`, started from an agent's shell, or no terminal. |

## aos mcp

```
aos mcp [--pack <dir>]
```

Serves the eight AOS [MCP tools](mcp-tools.md) over stdio until the host closes the connection, then exits 0. It is for hosts that register the CLI as their MCP server. The Claude Code plugin does not need it: the plugin starts its own server. The plugin's hooks bind a session only when `aos_run_start` comes from the plugin's own server, so pointing Claude Code at `aos mcp` instead leaves sessions ungated.

The pack is `--pack` (or `--pack=<dir>`), else `AOS_PACK`, else the reference pack that ships with the CLI. Runs go under the git top level of the directory the server starts in.

| Exit | When |
|---|---|
| 0 | The host closed the connection. |
| 2 | An unknown argument, or `--pack` without a directory. |

## Environment

| Variable | Read by | Effect |
|---|---|---|
| `AOS_PACK` | `aos doctor`, `aos mcp`, the plugin's MCP server | The pack directory, when `--pack` is not given. The plugin sets it to its bundled pack. |
| `AOS_HOST` | `aos mcp`, the plugin's MCP server | The host name recorded on runs. Defaults to `claude-code`. |
| `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID` | `aos approve`, `aos run cancel` | Any of them set to a non-empty value means an agent's shell; the command refuses with exit 2. |
| `CLAUDE_PROJECT_DIR` | the plugin's hooks and MCP server | Set by Claude Code to the directory the session started in. Runs and bindings are found from there when the agent's shell has moved elsewhere. |
