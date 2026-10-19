# AOS for Claude Code

This plugin runs AOS inside Claude Code. You hand Claude a piece of work with `/aos:run`, and AOS splits it into stages that each end at a gate. For a bounded change that is design, build, and verify. A gate passes only on evidence: test runs AOS watched Claude run, reviews Claude records, and approvals only you can give, from your own terminal. Until the gate passes, the stage's limits hold. Design can only write specs, a stop with work left sends Claude back to it, and `git push` waits for verify.

The plugin does this with Claude Code's own extension points. MCP tools let Claude start a run, advance it, and record what it did. Hooks check every Bash command and file edit before it runs, observe test runs and edits after they finish, re-inject the run's state when a session starts or is compacted, and decide whether Claude may stop. Every change to a run is appended to a hash-chained log under `.aos/runs/<run>/`, so a run can be replayed and its verdicts checked. Sessions with no run see none of this: an unbound session costs one lookup per hook and is otherwise untouched.

AOS is a guardrail for a cooperating agent, not a security boundary. [What AOS does not defend](#what-aos-does-not-defend) says exactly where it stops.

## Install for dogfood

You need [Bun](https://bun.sh) 1.3.11 or newer, git, and Claude Code 2.1.295 or newer, which the Bash guard's fail-closed setting (`onFailure: "block"`) needs. The reference pack's stages name skills from the [superpowers](https://github.com/obra/superpowers) plugin; install it so Claude can load them.

```bash
git clone https://github.com/aos-engineer/harness.git
cd harness && bun install
alias aos="bun $PWD/cli/src/index.ts"     # the human-side CLI, from this checkout

cd /path/to/your/project
echo ".aos/" >> .gitignore                # run logs are AOS's records, not your project's
claude --plugin-dir /path/to/harness/hosts/claude-code
```

The plugin loads the reference pack from the checkout (`packs/feature-delivery`, two directories above the plugin) until a later release bundles it. Point `--plugin-dir` at `hosts/claude-code` inside a full checkout, not at a copy of that directory.

Run `aos doctor` in your project to check Bun, git, Claude Code, the pack, its bound skills, and every run log.

## First run

In Claude Code:

```
/aos:run add a --shout flag to greet
```

1. Claude starts a run and tells you the tier and why. A brief with no spike or architectural signal is `bounded`.
2. **Design.** Claude may write only under `docs/specs/`. It presents the design, requests approval, and stops.
3. **You approve** from your own terminal: `aos approve <run> design`. It shows the request Claude filed and asks you to type the stage name. Then tell Claude to continue.
4. **Build.** Claude writes the change and runs the tests. AOS records the exit code of the test command itself, so a run piped through `tail` or chained with `|| true` does not count, and Claude is told to run it again on its own. A failing run sends Claude back to fix it.
5. **Verify.** Claude reviews the change and records the review. Push and `gh pr create` stay blocked until the tests pass and an approved review exists, both at the current tree. An edit after either makes it stale.

A spike (`/aos:run spike: can we ...`) has two stages: frame, where you approve the question and the probe before any file is written, and probe, where Claude may write and commit anything. Spike code can never be pushed or opened as a pull request.

## The commands

In Claude Code, `/aos:run <request>` starts a run or continues the session's active one.

In your terminal:

| Command | What it does |
|---|---|
| `aos approve <run> [stage] [--reason "..."]` | Approve the pending request for the run's current stage. |
| `aos approve <run> [stage] --deny --reason "..."` | Deny it. Claude revises from the reason. |
| `aos status [run] [--json]` | List runs, or show one run's stage, gate, and open gaps after verifying its log. |
| `aos doctor [--pack <dir>]` | Check the toolchain, the pack, its skills, session bindings, and every run's hash chain. |
| `aos run cancel <run> --reason "..."` | End a run and release its sessions, so they go back to pass-through. |

Each takes `--root <path>` when the runs live in another checkout. `aos approve` and `aos run cancel` are human-only: they need an interactive terminal, which Claude's Bash tool does not have, and the Bash guard refuses them outright.

The MCP tools Claude uses are `aos_run_start`, `aos_status`, `aos_gate_check`, `aos_stage_advance`, `aos_task_add`, `aos_task_complete`, `aos_evidence_record`, and `aos_request_approval`. None of them can approve, cancel, lower a tier, or record a test run: evidence recorded through MCP is always marked as claimed, and only the hooks record observed evidence.

## Tiers and what each enforces

The [feature-delivery pack README](../../packs/feature-delivery/README.md) has the full tables: stages, write scopes, gates, bound skills, and which actions each tier allows.

## How the hooks behave

| Hook | Does | When the hook itself fails |
|---|---|---|
| PreToolUse, Bash | Refuses human-only `aos` commands and anything touching `.aos/`; applies the pack's commit, push, PR, and deploy policies. | Fails closed. A crashed or hung hook blocks the command. A kernel error denies push, PR create, and deploy and allows the rest. |
| PreToolUse, Write, Edit, MultiEdit, NotebookEdit | Checks the path against the stage's write scope and refuses `.aos/`. | Fails open, so a hook bug never stops ordinary editing. |
| PostToolUse, PostToolUseFailure | Records test runs, file edits, and skill use as observed evidence. After `aos_run_start`, binds the session to the new run. | Records nothing. |
| SessionStart | Re-injects a short run summary on startup, resume, clear, and compaction. Says so when a run is active but this session is not bound to it. | Says nothing. |
| Stop | While a gap Claude can close remains, blocks the stop and hands the gaps back. Never blocks while only you can act, and at most once per set of gaps per prompt. After 20 blocked stops (the pack's iteration budget) it lets Claude stop. | Allows the stop. |

An allowed tool call prints nothing, so your own permission prompts still apply: AOS never approves a tool call on your behalf. Hook errors go to `.aos/hook-errors.log`, which `aos doctor` reports.

Each hook is a new Bun process. On an M1 Pro laptop with Bun 1.4.0, the PreToolUse guards measure a p95 of 43 to 44 ms, of which about 38 ms is starting Bun and loading the hook's modules. A PostToolUse that records a test run also fingerprints the working tree, and measured a p95 of about 95 ms on a clone of this repository (439 files) while parallel work loaded the machine; that cost grows with the size of the working tree. The target is a p95 under 100 ms per hook. Measure your own machine and repository with `bun run scripts/bench-hook.ts`.

## What AOS does not defend

AOS stops lazy or accidental bypass by an agent that is trying to follow the process. It does not stop an agent that is working against it.

- **Hooks are not a security boundary.** They see the tool calls Claude Code reports to them, and nothing else.
- **An agent with shell access can get around the log.** It can write `.aos/` through a process the hooks cannot see, such as a script or an interpreter, or rebuild the whole hash chain and snapshot. The chain detects edits to a log; it cannot detect a log rewritten end to end. Defending against that needs an anchor outside the agent's reach: host sandboxing, CI verification of exported runs, or signed attestations.
- **Bash writes are not checked against write scopes.** Scopes apply to the file-edit tools only. The tree fingerprint still sees what a shell command changed, so evidence recorded before the change goes stale.
- **The terminal check on human-only commands stops lazy bypass, not a determined one.** A process can allocate a pseudo-terminal. The run log records who decided and why.
- **Test evidence is fingerprinted when the test command finishes.** An edit that a parallel agent makes while the tests run can ride on that run's pass.

## Known limits in this release

- **Payload shapes are partly docs-derived.** The plugin's hook fixtures were shaped from the Claude Code docs, and a capture session has not yet confirmed all of them, notably the response Claude Code passes to PostToolUse for an MCP tool (which session binding reads) and the Bash success shape. The plugin rejects a payload it cannot read rather than guessing, so a changed shape fails safe, but it can stop binding or observing. `tools/README.md` describes how to capture and check real payloads.
- **Subagents may not be gated.** Whether a subagent's tool calls carry the parent session id is unconfirmed. If they do not, a subagent's tool calls are not gated.
- **A new session cannot rejoin a run.** `/clear` or a fork starts a session with a new id, which the run's binding does not cover, and only `aos_run_start` binds a session. SessionStart says so, gates do not apply to that session, and Claude is told not to continue the old run there. Finish the run in the session that started it, or cancel it with `aos run cancel` and start a new one.
- **The pack loads from the checkout** until a later release bundles it.
- **The iteration budget lets Claude stop when it runs out;** it does not block further tool calls.
- **Not in this release:** context packets for subagents, a structured decision tool, waivers, `aos run pause`, budgets beyond iterations (wall time, tool calls, cost), raising the tier mid-run, the architectural tier (a brief that classifies as architectural is refused, with the reason), resuming a run, a status line, an agent reviewer, a `pre-push` git hook backstop, `aos pack add` and a pack lockfile, pack overlays, Codex and Pi hosts, headless runs, and an `aos hook` CLI command.
