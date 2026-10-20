# Troubleshooting

Most problems show up first in `aos doctor` or in a block message that already says what to do. This page covers the doctor report, the hook error log, the common block messages, and the situations where AOS is quietly not enforcing anything: Bun missing, or a session that is not bound to the run.

## Start with aos doctor

Run it in the project:

```bash
aos doctor
```

It checks Bun, git, Claude Code, whether `.aos/` is gitignored, the pack and its bound skills, every run's hash chain, every session binding, and the hook error log. Each finding is `OK`, `WARN`, or `FAIL`, with a fix where one applies, and the command exits 1 if anything failed. [The CLI reference](cli.md#aos-doctor) lists every check.

| Finding | What to do |
|---|---|
| `FAIL not running under Bun` or `bun ... is older than 1.3.11` | Install or upgrade Bun (`bun upgrade`). |
| `WARN Claude Code ... is older than 2.1.295` | Upgrade Claude Code. Older versions cannot block a command when the Bash hook process itself crashes. |
| `WARN not inside a git repository` | Run AOS in a git checkout. Outside git, freshness is a counter of file edits and cannot see shell changes. |
| `WARN .aos/ is not gitignored` | Add `.aos/` to `.gitignore` yourself. In a gated session the agent cannot, because its Bash guard refuses any command that names `.aos/`. |
| `FAIL pack at <dir> does not load` | Fix each listed issue. See [packs](packs.md). |
| `WARN bound skill <skill> is not installed` | Install the plugin that provides it, such as superpowers. Without it the agent follows the stage's written instructions. |
| `FAIL run <run>: log tampered or corrupt at seq <n>` | The run's gates and evidence cannot be trusted. Release its sessions with `aos run cancel <run> --reason "..."`, inspect `.aos/runs/<run>/log.jsonl`, then move the run's directory out of `.aos/runs` to retire it. An ended run with the same damage is a WARN. |
| `WARN run <run>: the log ends in <n> torn bytes` | Crash damage, not tampering. The next append saves the bytes as an artifact and drops them. |
| `WARN run <run>: state.json is at seq <a> but the log is at seq <b>` | Nothing; the snapshot is rebuilt on the next append. |
| `FAIL session binding ... points at run <run>, which does not exist` (or fails verification) | `aos run cancel <run> --reason "..."` releases the binding. |
| `WARN .aos/hook-errors.log has <n> lines` | See [the hook error log](#the-hook-error-log). |

## The hook error log

When a hook or the run store fails, it appends one line to `.aos/hook-errors.log` in the run's repository and carries on with its fail-safe decision. Each line is a timestamp, the event, and the error with its causes:

```
2026-10-19T14:02:11.408Z pre-tool TreeError: git write-tree failed in /path/to/greeter: <git's message>
2026-10-19T14:05:40.117Z store run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z: state.json not written (ENOSPC): <message>
```

Causes are chained with `<-`, so a wrapped git or filesystem error keeps its origin. Logging never creates `.aos/`: a failure in a project with no `.aos/` directory is not logged anywhere.

`aos doctor` shows the last three lines. Fix the cause, then clear the file yourself (`: > .aos/hook-errors.log`); the agent cannot, because `.aos/` is off limits to it.

## Block messages

Every refusal starts with `AOS:` and says what to do. The agent sees these; so do you, in the transcript.

| Message | Meaning and fix |
|---|---|
| `AOS: push blocked: verify gate pending.` followed by gaps | The verify gate does not pass at the current tree. Close each gap: reach the verify stage, run the tests on their own, record an approved review. The same form appears for `pr_create`. |
| `AOS: stage "design" allows writes only under docs/specs/. Pass its gate with aos_stage_advance first.` | The file is outside the stage's write scope. Wait for the next stage, or write the design under `docs/specs/`. |
| `AOS: stage "frame" allows no file writes. Get its approval first (aos_request_approval).` | Spike frame writes nothing; the probe stage opens writes after approval. |
| `AOS: .aos/ is kernel-owned. Read run state with the aos_status tool.` | The command or path names `.aos/`. The agent reads run state through `aos_status`; you can use `aos status`. |
| ``AOS: `aos approve` is a human-only command. Ask the human to run it in their own terminal.`` | Run the command yourself, in a real terminal. The same applies to `aos run cancel`. |
| `AOS: commit is allowed only in stages build, verify; the current stage is design.` | Commits open in build. |
| `AOS: push is not allowed in a spike run. Spike code is throwaway by design; start a bounded run to build it for real.` | Spike code never leaves the machine. Start a bounded run for the real change. |
| `AOS: deploy is not allowed in a bounded run.` | Deploy is never allowed inside a run. Deploy outside the session, through your normal release process. |
| ``AOS error, run `aos doctor`: <cause>`` | AOS itself failed, so push, PR create, and deploy are denied until it is fixed. Run `aos doctor` and read the hook error log. |

`aos approve` and `aos run cancel` refuse to run from an agent's shell, without a terminal or with Claude Code's environment variables set. Run them in your own terminal, outside Claude Code.

## A test run did not count

| Notice | Fix |
|---|---|
| `AOS: this test run's exit status was hidden by a pipe or chain, so it does not count as evidence. Re-run the test command on its own.` | Run `bun test`, not `bun test \| tail` or `bun test \|\| true`. `&&` before or after is fine. |
| `AOS: this test run produced no exit code (it was backgrounded, interrupted, or timed out), so it does not count. Run the test command in the foreground on its own.` | Run it in the foreground and let it finish. |
| Gap: `No observed "test" run at the current tree. Run one of: ...` | The command must start with one of the listed prefixes. A test command the pack does not list, such as `npx vitest`, plays no role; add it to the pack's `test` role. |
| Gap: `The last observed "test" run predates the current tree (...). Re-run it.` | Something changed since the last run. Run the tests again. |

## The agent will not stop, or stops too soon

The Stop hook sends the agent back when it tries to stop with gaps it can close. It does this at most once per distinct set of gaps per prompt, never while only you can act, and at most 20 times per run in the reference pack.

| Message | Meaning |
|---|---|
| `AOS: stop blocked: <stage> gate <verdict>.` then gaps, then `Keep working on the gaps above.` | The agent is sent back to work. |
| `AOS: waiting on the human.` | Only you can act. Usually an approval: run the `aos approve` command shown. |
| `AOS: no progress on these gaps since the last nudge, so handing back to you:` | The agent stopped with gaps open. Read them, then prompt it again or step in. |
| `AOS: iteration budget used (20/20). Open gaps:` | The run's budget for blocked stops is spent. The agent may now stop with gaps open; gates still hold. |

## Bun is not on PATH

The plugin's launcher steps aside when it cannot find Bun. Hooks allow every tool call, and each new session starts with this note to the agent:

```
AOS is installed but Bun is not on PATH, so AOS gates are off in this session. Tell the user: install Bun (https://bun.sh), then restart Claude Code.
```

The MCP server exits with `AOS needs Bun (https://bun.sh) on PATH; the AOS MCP server cannot start without it.`, so the `aos_*` tools are unavailable.

Install Bun 1.3.11 or later, make sure it is on the `PATH` that Claude Code starts with, and restart Claude Code. `aos doctor` also needs Bun, so a working `aos doctor` in the same environment is a good check.

## The session is not bound to the run

Gates apply only in the session that started the run (and its subagents). A session that is not bound gets this note at startup when a run is active in the project:

```
AOS: run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z (bounded, stage build) is active in /path/to/greeter, but this session is not bound to it, so AOS gates do not apply to this session.
```

This happens after `/clear`, after forking a session, and in a second terminal: each has a new session id. The reference skill tells the agent not to continue the old run. Your options:

- Go back to the session that started the run with `claude --resume`, where the run is still gated.
- Cancel the old run (`aos run cancel <run> --reason "..."`) and start a new run in this session with `/aos:run`.

If binding itself failed, the agent sees this right after `aos_run_start`:

```
AOS: could not bind this session to run <run>: there is no .aos/runs/<run> under <dirs>. AOS gates do not apply to this session. The aos MCP server may be running from a different directory than this session.
```

The MCP server creates runs under the directory Claude Code reports as the project. Start Claude Code from inside the repository you want gated, then start a new run.

## MCP tool errors

| Error | Fix |
|---|---|
| `invalid: no run was started in this session, so pass the runId that aos_run_start returned (a session-start note also names it).` | The MCP server restarted (for example on resume) and has no default run. Pass `runId` explicitly. |
| `refused: Run <run> is completed; only aos_status works on it. ...` | Start a new run for more work. |
| `refused: The run changed while this call ran; call aos_status and try again.` | Another writer kept changing the run. Check `aos_status` and retry. |
| `refused: The architectural tier is not available in this version of AOS (...)` | See [spikes and architectural work](getting-started.md#spikes-and-architectural-work). |
| `internal: invalid pack at <dir>: ...` | The pack does not load. Run `aos doctor --pack <dir>`. |

## aos approve problems

| Message | Fix |
|---|---|
| `aos approve: no run <run> under <root>. Pass --root if the run lives in another checkout.` | Run it from the project, or pass `--root /path/to/greeter`. The agent's instructions include `--root`. |
| `run <run> has no pending approval request for <stage>. ...` | The agent has not called `aos_request_approval` yet, or the request was already decided. |
| `run <run> is at build, not design. Only the current stage can be approved.` | That stage is past. Check `aos status <run>`. |
| `Not approved.` | The typed name did not match the stage. Run it again. |
| `Not approved: request <id> is no longer the pending request for <stage> (now <id>); review the new request first. ...` | The agent filed a newer request while you were reading. Run `aos approve` again to see it. |
| `Run log is tampered or corrupt at seq <n>; not approving. Run aos doctor.` | See the doctor finding above. |

## A run's lock is stuck

Writers take a lock file, `.aos/runs/<run>/log.lock`, for the few milliseconds an append takes. A waiter gives up after 3 seconds with `timed out after 3000 ms waiting for <path>, held by pid <pid> on <host>`. A lock whose holder process is dead on this host, or that is older than 30 seconds, is treated as stale and broken automatically, so a crash never wedges a run. Repeated timeouts mean something is holding the lock for real; check the named process.
