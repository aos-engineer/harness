# aos

The human side of AOS 1.0. The agent drives a run through MCP tools inside its host; this CLI is how a person approves a gate, checks a run, diagnoses the setup, and ends a run that has gone wrong.

> This is the 1.0 prerelease, on the npm `next` tag. `aos-harness@latest` is still the 0.x CLI (`aos init`, `aos run <profile>`, adapters), whose source is on the [`release/0.11`](https://github.com/aos-engineer/harness/tree/release/0.11) branch. Installing `@next` globally replaces a global 0.x `aos`.

## Install

```bash
npm install -g aos-harness@next
# or
bun add -g aos-harness@next

aos --version
```

The CLI needs [Bun](https://bun.sh) 1.3.11 or later on `PATH`, even when npm installs it: the `aos` binary is a Bun script. To use it with Claude Code, install the AOS plugin too; [Getting started](https://github.com/aos-engineer/harness/blob/main/docs/1.0/getting-started.md) covers both.

## Commands

| Command | What it does |
|---|---|
| `aos approve <run> [stage] [--reason "..."]` | Shows the pending approval request for the run's current stage and asks you to type the stage name to approve it. |
| `aos approve <run> [stage] --deny --reason "..."` | Denies the request instead. The agent revises from the reason, so it is required. |
| `aos status [run] [--json]` | Without a run, lists every run as run, status, tier, and stage. With one, verifies its log and prints its stage, gate, and open gaps. |
| `aos doctor [--pack <dir>]` | Checks Bun, git, Claude Code, the pack and its bound skills, session bindings, `.aos/hook-errors.log`, and the hash chain of every run. Exits 1 if any check fails. |
| `aos run cancel <run> --reason "..."` | Ends the run and unbinds its sessions, which go back to pass-through. The log keeps the reason. |
| `aos mcp [--pack <dir>]` | Serves the AOS MCP tools on stdio, for a host that registers the CLI as its MCP server. The Claude Code plugin runs its own server and does not need this. |

`approve`, `status`, `doctor`, and `run cancel` take `--root <path>` for runs in another checkout; the default is the git top level of the current directory. `aos --help` lists the commands, and `aos <command> --help` shows one command's usage. Exit codes: 0 on success, 1 when the command ran and failed, 2 for a usage error. The [CLI reference](https://github.com/aos-engineer/harness/blob/main/docs/1.0/cli.md) lists every flag, message, and exit code.

## Human-only commands

`aos approve` and `aos run cancel` decide things only a person may decide. Before prompting, they refuse with exit 2 when the environment shows an agent's shell started them (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CLAUDE_CODE_SESSION_ID` is set to a non-empty value, which Claude Code does for every command its agent runs), and they refuse without an interactive terminal. Run them from a terminal outside Claude Code. In a Claude Code session bound to a run, the plugin's Bash guard also refuses them before they run, including through wrappers such as `script` and inline interpreter code. Sessions that are not bound to a run get no such guard.

None of these checks is a security boundary. A determined process can allocate a terminal and clear its environment, and an agent with unrestricted shell access can write the run log directly. AOS hooks and these checks are guardrails for a cooperating agent; they stop lazy bypass, not a determined one. The run log records who decided each gate and why. The [security model](https://github.com/aos-engineer/harness/blob/main/docs/1.0/security.md) says what AOS does and does not defend.

## Run it from a checkout

```bash
git clone https://github.com/aos-engineer/harness.git
cd harness && bun install
alias aos="bun $PWD/cli/src/index.ts"
```
