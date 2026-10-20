# Security model

AOS is a guardrail for a cooperating agent. It stops lazy or accidental bypass by an agent that is trying to follow the process: skipping tests, pushing early, approving its own work, editing outside the stage's scope. It does not stop an agent that is working against it. Hooks are not a security boundary, and nothing in AOS should be relied on as one. This page says what AOS enforces, how it fails, where it stops, and how to report a vulnerability.

## What AOS enforces

In a session bound to a run:

- **Consequential commands wait for gates.** Commit, push, PR create, and deploy are checked against the pack's policy for the tier and stage before the command runs. In the reference pack, push and PR create need the verify gate passing at the current tree, spike runs can never push or open a PR, and deploy is never allowed inside a run.
- **Test evidence is observed, not claimed.** Only the hooks record command evidence, from the tool calls they see. No MCP tool accepts a provenance field or a command kind, so the agent cannot record a test run.
- **Evidence goes stale.** Requirements marked fresh count only evidence taken at the current git tree, so an edit after the tests or the review blocks push again.
- **Only a human decides a human gate.** `aos approve` refuses, before prompting, when `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CLAUDE_CODE_SESSION_ID` is set (Claude Code sets them in every command its agent runs, even under a wrapper that fakes a terminal) and refuses without an interactive terminal. It then verifies the run's hash chain, shows the agent's summary with control and bidirectional characters escaped, makes you type the stage name, and pins the decision to the request you saw. The kernel counts only decisions whose actor is a human, and the MCP server and hooks never import the operations that record them; a test keeps it that way.
- **Write scopes hold for the file-edit tools.** Write, Edit, MultiEdit, and NotebookEdit are checked against the stage's scope, using the physical path the write would land on.
- **`.aos/` is off limits to the agent.** File-edit tools are refused under `.aos/`, and so is any Bash command that names it, including `cd` targets, redirects, and assignments. Names are compared folded (Unicode case folding, NFKC, default-ignorable code points dropped), so `.AOS` and `.aoſ` count. The shell guard expands brace lists and matches globs the way bash does: `.a*`, `.ao?`, `.[a]os`, `.*`, and `.{aos,git}` are refused, while `*` and `dist/*` are not, because bash needs a literal leading dot unless the command turns on `dotglob`.
- **AOS does not write through symlinks under `.aos/`.** Every write the kernel makes refuses when `.aos` or any existing path component below it is a symlink, so a link planted there cannot redirect the run's records.
- **The human-only commands are refused** in a gated session, however they are spelled: the installed `aos`, a package runner such as `npx aos-harness`, or the source entry point, run directly, through a terminal wrapper (`script`, `expect`, `unbuffer`, `socat`), or from inline interpreter code (`python -c`, `perl`, `ruby`, `node`, or `bun -e`, `deno eval`).
- **Edits that break the run log's chain are detected.** Every event is hash-chained to the one before. `aos approve`, `aos run cancel`, `aos status`, and `aos doctor` verify the whole chain and refuse or report a log that fails. The chain is not signed; see the limits below.

## How AOS fails

| Failure | Behavior |
|---|---|
| The Bash hook process crashes, hangs past its 15-second timeout, or cannot start | Claude Code blocks the command (`onFailure: "block"`, Claude Code 2.1.295 or later). |
| The kernel throws while judging a Bash command | Push, PR create, and deploy commands are denied with `AOS error, run \`aos doctor\`: <cause>`. Other commands are allowed. Matching here is deliberately crude, so a commit message that mentions "push" is denied too. |
| A hook payload cannot be parsed | Fails closed for those same commands only where a `.aos/` directory exists at or above the session's directory. Elsewhere it allows, so a change in Claude Code's payload format never blocks pushes in projects that do not use AOS. |
| A file-edit hook fails | Allows the edit, so a hook bug never stops ordinary editing. |
| A PostToolUse, SessionStart, or Stop hook fails | Records nothing, says nothing, or allows the stop. |
| Bun is not on `PATH` | The plugin steps aside: hooks allow everything, SessionStart tells the agent AOS is off, and the MCP server exits with the reason. |
| Something under `.aos/` is a symlink | The write is refused with `AOS refuses to write through the symlink <path>; remove it and rerun`. In a hook this is a kernel error, so push, PR create, and deploy are denied; the CLI prints it as `aos: ...` and exits 1. |

Every hook failure is appended to `.aos/hook-errors.log`, which `aos doctor` reports.

## What AOS does not defend

- **Hooks are not a security boundary.** They see only the tool calls Claude Code reports to them.
- **An agent with shell access can get around the log.** It can write `.aos/` through a process the hooks cannot see, such as a script or an interpreter one-liner, and it can rewrite the log. The chain detects edits that break it, but it is not signed, so a process that rewrites the whole log consistently, recomputing every hash and the snapshot, is not detected. Defending against that needs an anchor outside the agent's reach, such as host sandboxing, CI verification of exported runs, or signed attestations.
- **Hooks and appends trust the snapshot.** On every tool call, hooks read `state.json` when it matches the log's last event, and appends build on it, without replaying the chain. An edit to an earlier line is caught only by the commands that verify the full chain (`aos approve`, `aos run cancel`, `aos status`, and `aos doctor`), not by the next tool call.
- **Bash writes are not checked against write scopes.** Scopes apply to the file-edit tools only. The tree fingerprint still sees what a shell command changed, so evidence taken before the change goes stale.
- **The shell guards are best-effort text analysis.** AOS splits a command line the way a shell would and does not expand variables or run anything. For push, PR create, and deploy it follows `bash -c` and `eval`; scripts a shell reads from a heredoc, a herestring, or a pipe from `echo`, `printf`, or `cat` (bash, sh, zsh, dash, ksh, mksh, ash, fish, csh, and tcsh); substitutions in an unquoted heredoc body; common wrappers; substitutions; and aliases defined on the same command line with `git -c alias.NAME=...`, including chained and `!` aliases. A command word or git subcommand that comes from a variable, substitution, glob, or brace list is judged by the words around it. It recognizes `gh pr create`, `gh pr new`, and `gh api` calls that create a pull request (REST with fields, `--input`, or a non-GET method; GraphQL `createPullRequest`), while a plain `gh api` read of pull requests is allowed. It cannot see aliases saved earlier with `git config`, `--config-env` aliases, interpreter one-liners that push, or a script file that pushes. For the human-only commands, code that assembles the command from separate fields, such as an options object, is not recognized.
- **The human-only checks stop lazy bypass, not a determined one.** A process can clear the environment variables `aos approve` and `aos run cancel` check and allocate a pseudo-terminal. The run log records who decided each gate and why.
- **The symlink check has a window.** A link swapped in between the check and the write is not caught.
- **Redaction is best-effort by format.** Command evidence keeps a digest of the full output and only the last 4,096 bytes, redacted. Redaction recognizes private key blocks; OpenAI-style, AWS, GitHub, npm, Slack, GitLab, and SendGrid tokens; Stripe secret, restricted, and webhook keys; Google API keys; JWTs; bearer tokens; the user and password in a URL; `name = value` pairs whose name looks like a credential; and emails, card-like digit runs, and US social security numbers. A secret in any other format is kept as printed.
- **Test evidence is fingerprinted when the test command finishes.** An edit that a parallel agent makes while the tests run can ride on that run's pass.
- **Review evidence is claimed by the agent.** AOS records who the agent says reviewed the change and what they said. It does not verify that a review happened.
- **Only the starting session is gated.** Calling `aos_run_start` binds the calling session, and nothing else binds one. Subagents of that session are gated, because their tool calls carry its session. A second terminal, or a session after `/clear` or a fork, is not gated: write scopes, action policies, the human-only refusal, and the `.aos/` guard do not apply there. SessionStart in such a session names the active run.
- **The iteration budget is not a cap on work.** When it runs out, the Stop hook lets the agent stop; it does not block further tool calls.
- **Deploy patterns are a list.** The reference pack names common deploy commands. A deploy through a tool it does not name is not recognized as one.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting for this repository: open [Report a vulnerability](https://github.com/aos-engineer/harness/security/advisories/new) on the repository's Security tab. Please do not open a public issue for a vulnerability.

A useful report includes the AOS and Claude Code versions (`aos --version`, `claude --version`), the command or tool call involved, and what happened against what you expected. A way around a guard that this page already lists as not defended is still worth reporting if you see a practical fix, but it is a known limit, not a vulnerability.
