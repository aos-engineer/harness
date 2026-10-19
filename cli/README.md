# aos

The human side of AOS 1.0. The agent drives a run through MCP tools inside its host; this CLI is how a person approves a gate, checks a run, diagnoses the setup, and ends a run that has gone wrong.

> This is the 1.0 CLI, which is not published yet. The 0.x CLI (`aos init`, `aos run <profile>`, adapters) is `aos-harness` on npm `latest`, and its source is on the [`release/0.11`](https://github.com/aos-engineer/harness/tree/release/0.11) branch.

## Run it from a checkout

```bash
git clone https://github.com/aos-engineer/harness.git
cd harness && bun install
alias aos="bun $PWD/cli/src/index.ts"
```

It needs Bun 1.3.11 or newer. To use it with Claude Code, see the [plugin README](../hosts/claude-code/README.md).

## Commands

| Command | What it does |
|---|---|
| `aos approve <run> [stage] [--reason "..."]` | Shows the pending approval request for the run's current stage and asks you to type the stage name to approve it. |
| `aos approve <run> [stage] --deny --reason "..."` | Denies the request instead. The agent revises from the reason, so it is required. |
| `aos status [run] [--json]` | Without a run, lists every run as run, status, tier, and stage. With one, verifies its log and prints its stage, gate, and open gaps. |
| `aos doctor [--pack <dir>]` | Checks Bun, git, Claude Code, the pack and its bound skills, session bindings, `.aos/hook-errors.log`, and the hash chain of every run. Exits 1 if any check fails. |
| `aos run cancel <run> --reason "..."` | Ends the run and unbinds its sessions, which go back to pass-through. The log keeps the reason. |
| `aos mcp [--pack <dir>]` | Serves the AOS MCP tools on stdio, for a host that registers the CLI as its MCP server. |

`approve`, `status`, `doctor`, and `run cancel` take `--root <path>` for runs in another checkout; the default is the git top level of the current directory. `aos --help` lists the commands, and `aos <command> --help` shows one command's usage.

## Human-only commands

`aos approve` and `aos run cancel` decide things only a person may decide, so they refuse to run without an interactive terminal. An agent's shell tool has none, which keeps an agent from passing its own gate by accident or by shortcut, and in a Claude Code session bound to a run, the plugin's Bash guard refuses these commands before they run. Sessions that are not bound to a run get no such guard.

Neither check is a security boundary. A determined process can allocate a terminal, and an agent with unrestricted shell access can write the run log directly. AOS hooks and these checks are guardrails for a cooperating agent; they stop lazy bypass, not a determined one. The run log records who decided each gate and why.
