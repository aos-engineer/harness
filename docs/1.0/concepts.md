# Concepts

AOS turns one piece of agent work into a **run**: an ordered set of **stages**, each ending at a **gate** that passes only on **evidence**. This page explains each idea and the rules behind it. The rules come from a **pack**; the examples here use the reference pack, `feature-delivery`, described in full in [packs](packs.md).

## Runs

A run is one piece of work under AOS, started when the agent calls `aos_run_start` with a brief: the user's request in their words. It gets a ULID as its id, a tier, the tier's stages, and a directory at `.aos/runs/<id>/` in the repository's top level.

A run is in one of three states:

| Status | Meaning |
|---|---|
| `active` | Work is under way at the current stage. |
| `completed` | The agent passed the last stage's gate and advanced. Push and PR create still check their gate. |
| `cancelled` | A human ended it with `aos run cancel`. Its sessions are unbound and AOS stops enforcing it. |

Completed and cancelled are final. A finished run answers `aos_status` and nothing else; more work means a new run.

## Tiers

The tier scales the process to the risk. The pack's `classify` rules propose one from the brief: rules run in order, each a list of case-insensitive regular expressions, and the first rule with a match wins. A brief that matches no rule gets the pack's default.

| Tier | Reference pack stages | Proposed when the brief |
|---|---|---|
| `spike` | frame, probe | says spike, feasibility, prototype, throwaway, or "is it possible" |
| `bounded` | design, build, verify | matches no rule (the default) |
| `architectural` | none in this release | mentions a database schema or schema change, a migration, authentication or authorization (OAuth, Auth0, SSO), a public API, or a new service |

The reason is recorded with the run and shown to the human, for example `matched /\bspike\b/ (spike rule)` or `no tier rule matched; pack default is bounded`.

The agent may ask for a **higher** tier than proposed, and the reason then says `raised to <tier> on request`. It may never ask for a lower one: lowering a tier weakens the gates, and `aos_run_start` refuses with `Lowering the proposed tier (...) requires a human.` This release has no command for a human to lower a tier either.

A tier the pack does not define is refused, never quietly run under a weaker one. The reference pack defines no architectural tier, so an architectural brief cannot start a run in this release.

## Stages

Each tier is an ordered list of stages. A run starts in the first and moves forward one stage at a time when the agent calls `aos_stage_advance` and the current gate passes. Advancing past the last stage completes the run. There is no going back.

Every stage has:

- **Instructions**: a markdown file in the pack that the agent receives when it enters the stage.
- **A write scope** for the file-edit tools (Write, Edit, MultiEdit, NotebookEdit): `any`, or a list of path prefixes. In the reference pack, spike frame allows no writes, bounded design allows only `docs/specs/`, and every other stage allows anything. `.aos/` is refused in every stage. Bash commands are not checked against write scopes; see [security](security.md#what-aos-does-not-defend).
- **A gate**, described next.
- **Hints**: skills the instructions name (`bind`) and a model hint (`reasoning`, `fast`, or `script`). They are informational in this release; `aos doctor` checks that bound skills are installed.

**Tasks** let the agent split a stage's work. `aos_task_add` adds one to the current stage, `aos_task_complete` closes it, and a gate with `tasks: all` stays open while any task in its stage is open. Task ids (`t1`, `t2`, ...) count across the whole run.

## Gates

A gate is a set of requirements evaluated against the run's evidence and the current tree. Each gate has a **decider**:

- **`rule`**: passes when every requirement is met.
- **`human`**: also needs a person's approval, given with `aos approve` in their own terminal.

Evaluation returns a **verdict** and a list of **gaps**:

| Verdict | Meaning |
|---|---|
| `pass` | Nothing is missing. |
| `pending` | Something is missing or stale, and nothing has failed. |
| `fail` | At least one requirement failed: the last test run exited non-zero, the latest review was not approved, or the human denied approval. |

Each gap says what is needed, in words the agent can act on, and who can close it: the **agent** or the **human**. A gap of kind `missing` names evidence that does not exist, `stale` names evidence taken at an older tree, and `failed` names evidence that exists and says no. Agent gaps are always listed first.

A gate for a stage the run has not reached never passes. Action policies evaluate later gates (push waits on verify), and this rule keeps evidence alone from skipping the stages before.

The reference pack's gates:

| Stage | Decider | Requires |
|---|---|---|
| spike/frame | human | approval |
| spike/probe | rule | nothing |
| bounded/design | human | approval |
| bounded/build | rule | every task done; an observed passing `test` run at the current tree |
| bounded/verify | rule | an observed passing `test` run and an approved review, both at the current tree |

## Evidence and provenance

Evidence is what a gate counts. Every piece is recorded with the stage it was taken in and the **fingerprint** of the tree at that moment.

| Kind | What it is | Recorded by |
|---|---|---|
| `command` | A shell command that plays a pack role, such as `test`: the command (redacted), its exit code, a digest of its output, and the last 4096 bytes of output after redaction. Redaction is best-effort by format; see [security](security.md#what-aos-does-not-defend). | The hooks only, from the tool calls they observe. |
| `skill` | A skill the agent invoked. | The hooks, when the Skill tool runs; or the agent, through `aos_evidence_record`. |
| `review` | A code review's verdict (`approved`, `rejected`, or `needs-revision`), feedback, and reviewer. | The agent, through `aos_evidence_record`. |
| `artifact` | A file the agent produced: its path and SHA-256. Files under 1 MiB that git does not ignore are also copied into the run's `artifacts/` directory. | The agent. |
| `citation` | A file and line that supports a claim, with a note. | The agent. |

**Provenance** says how much to trust a piece of evidence:

- **`observed`**: recorded by a hook watching a tool call happen. The agent cannot produce it; no MCP tool accepts a provenance field or a `command` kind.
- **`claimed`**: recorded by the agent through `aos_evidence_record`. The agent's word, kept in the log for anyone to weigh later.
- **`attested`**: defined in the pack format and ranked above observed, but nothing records attested evidence in this release.

A requirement names the lowest provenance it accepts, and higher provenance also satisfies it. The reference pack asks for observed test runs and accepts a claimed review.

Evidence paths must be inside the repository, outside `.aos/` and `.git/`, and are resolved through symlinks before that check, so a link cannot pass off another file as evidence.

## Freshness

Evidence is only as good as the tree it describes. A requirement with `fresh: true` counts only evidence recorded at the **current tree**, so any change after the evidence was taken makes it **stale**.

In a git repository, the fingerprint is a git tree hash of the whole working tree: tracked files, untracked files that are not ignored, and nothing under `.aos/`. AOS builds it from a temporary copy of the index, so your own staging is never touched. Because it hashes the tree itself, it sees changes from every source: the agent's file edits, shell commands, a formatter, or you.

Outside git, the fingerprint is a counter of file-tool edits (`counter:<n>`). It cannot see shell changes, so freshness is weaker there, and the gate result says so (`weakFreshness: true`). `aos doctor` warns when a project is not in git.

A stale gap counts file-tool edits since the evidence, "plus any shell changes", because shell changes are visible to the fingerprint but not countable.

Test evidence is fingerprinted when the test command finishes. An edit that lands while the tests run, for example from a parallel agent, is not distinguished from the tree the tests saw.

## Test runs: what counts

A shell command plays a role when one of its commands starts with one of the role's prefixes. The reference pack's `test` role lists `bun test`, `bun run test`, `npm test`, `npm run test`, `pnpm test`, `yarn test`, `pytest`, `go test`, and `cargo test`.

AOS reads the command line the way a shell would split it, finds the commands that actually run (past `cd`, environment assignments, wrappers such as `sudo`, `timeout 60`, or `env`, and inside `bash -c` and `$(...)`), and checks each one. A quoted mention, such as a commit message that says "bun test", is not a call.

The exit code has to be the test command's own:

- **Masked runs do not count.** In a pipe (`bun test | tail`), after `||`, `;`, or `&`, behind `!`, or inside a substitution, some other command decides the exit status. AOS records the run as masked, tells the agent, and the gate asks for a clean run. `&&` is fine, because it keeps the test's failure.
- **Runs without an exit code are skipped.** A backgrounded, interrupted, or timed-out run has no status to judge, so AOS records nothing and tells the agent to run it in the foreground.

A failing run is recorded too. The gate then reports `fail` until a newer passing run replaces it: the newest matching evidence decides.

## Approvals

A human gate passes only on a decision recorded by a human.

1. The agent presents its work in chat, then calls `aos_request_approval` with a summary. It gets back the exact command for the human and stops.
2. The human runs `aos approve <run> <stage>` in their own terminal. It shows the run, the brief, the stage, the request id, and the agent's summary, then asks the human to type the stage name, so a stray Enter or a pasted command cannot approve by itself.
3. The decision is appended to the log with the human's OS account name as the actor.

The rules behind it:

- Only the **latest request made since the stage was entered** counts. An older or superseded request is never pending.
- The approval is pinned to the request id the human saw. If the agent files a newer request while the human is typing, the approval is refused and the human is asked to look again.
- Only decisions whose actor is a human count. A decision logged by any other actor is treated as no decision.
- A **denial** needs a reason. The gate then fails with `The human denied approval: <reason>. Revise, then request approval again.`, and the agent needs a new request and a new decision.
- Approvals carry no freshness requirement: an approved design stays approved if `docs/specs/` changes afterwards.
- Before showing anything, `aos approve` verifies the run's whole hash chain. It refuses a run whose log was edited.

`aos approve` and `aos run cancel` refuse, before prompting, when the environment shows an agent's shell started them (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CLAUDE_CODE_SESSION_ID` is set to a non-empty value), and they refuse without an interactive terminal. In a gated session the Bash guard also refuses them before they run. These checks stop lazy or accidental bypass, not a determined one: a process can clear the variables and allocate a terminal. See [security](security.md).

## Actions

Actions are the consequential shell commands a pack names with regular expressions: `commit`, `push`, `pr_create`, and `deploy`. Each tier gives each action a policy:

| Policy | Allows the action |
|---|---|
| `always` | always |
| `never` | never |
| `in_stages` | only in the listed stages, and after the run completes |
| `after_gate` | only while the named stage's gate passes, evaluated live at the current tree |

The reference pack:

| Action | spike | bounded |
|---|---|---|
| commit | always | in build and verify |
| push | never | after the verify gate passes |
| PR create | never | after the verify gate passes |
| deploy | never | never |

When one command line holds several actions, the most consequential decides: deploy, then PR create, then push, then commit. Every refusal is logged as `action.blocked`, and every allowed action as `action.allowed`.

Because `after_gate` is evaluated live, an edit after verify passed blocks push again until fresh tests and a fresh review exist. This holds after the run completes, too.

The Bash guard also refuses, in every stage: the human-only `aos` commands (`approve`, `run cancel`, and subcommands reserved for later releases), however they are invoked, including through terminal wrappers such as `script` and inline interpreter code such as `python -c`; and any command that names `.aos/`, including `cd` targets, redirects, assignments, and globs or brace lists that would expand to it. Names are compared folded (Unicode case folding and NFKC), so `.AOS` counts too.

## The Stop loop

When the agent tries to end its turn, the Stop hook evaluates the current gate.

- If the agent can close a gap, the stop is **blocked** and the gaps come back as its next instruction, ending with `Keep working on the gaps above.`
- If the gate passes and a later stage exists, the agent is told to call `aos_stage_advance`.
- If only the human can act, for example an approval is waiting, the agent may stop. The user sees `AOS: waiting on the human.` with the command to run.
- If the same gaps were already sent back during this prompt, the agent may stop, and the user sees `AOS: no progress on these gaps since the last nudge, so handing back to you:` with the list. A new prompt, or any change in the gaps, allows one more nudge.
- When the iteration budget is used up, the agent may stop, with the open gaps listed.

So the loop can never trap a session: it nudges at most once per distinct set of gaps per prompt, and never while only a human can act.

## The iteration budget

Each blocked stop costs one **iteration**. The reference pack allows 20 per run. When 80 percent is used (16 of 20), each block message adds `Iteration budget: <used>/<limit> used.` Once the budget is spent, the Stop hook lets the agent stop and lists the open gaps instead of blocking.

The budget limits only the Stop loop. It does not block tool calls, it is not charged for stage retries in this release, and it cannot be extended in this release.

## Sessions and binding

A host session is **bound** to a run when it starts the run: after `aos_run_start` succeeds, the PostToolUse hook reads the run id from the tool's response and writes a binding under `.aos/sessions/`. The hook then tells the agent `Gates apply from now on.` If the hook cannot find the new run under the session's directory or the directory the session started in (for example, because the MCP server runs from somewhere else), it binds nothing and tells the agent that AOS gates do not apply to this session.

Only bound sessions are gated, and only the session that started a run is bound to it:

- **Subagents are gated.** Their tool calls carry the parent's session, which was confirmed in a live session, and their evidence records which agent produced it.
- **A second terminal, a new window, or a new session after `/clear` or a fork, is not gated.** It has a different session id, and it cannot rejoin the run in this release. Its SessionStart hook names any active run in the project and says AOS gates do not apply to this session. The reference skill then tells the user rather than continuing the old run.
- **A resumed or compacted session stays bound.** `/compact`, `claude --resume`, and `claude --continue` keep the session id, so the binding still applies, and the SessionStart hook re-injects a short summary of the run: tier, stage, gate, open gaps, and iterations. What this release does not support is rejoining a run from a new session.
- **Starting another run** in a bound session rebinds the session to the new run.
- **Cancelling** a run unbinds every session bound to it. A completed run keeps its sessions bound, so push and PR create stay guarded.

An unbound session costs one binding lookup per hook call and is otherwise untouched.

## The run log

Each run lives in `.aos/runs/<id>/`:

| File | Purpose |
|---|---|
| `log.jsonl` | The source of truth: one JSON event per line, append-only. |
| `state.json` | A snapshot of the state the log projects to, so hooks need not replay the log on every tool call. Always rebuildable from the log. |
| `log.lock` | A lock file held while one process appends. Hooks, the MCP server, and the CLI are separate processes. |
| `artifacts/` | Content-addressed copies of artifact evidence, and any torn log tail saved during repair. |

Alongside the runs, `.aos/sessions/` holds the session bindings and `.aos/hook-errors.log` collects hook and store failures.

Every event carries a sequence number, a timestamp, an actor (`agent`, `hook`, `human`, or `kernel`, with an id such as `mcp:aos_stage_advance` or `claude-code:pre-tool`), a type, its data, and `prev`: the SHA-256 of the previous line. The chain detects an edit, deletion, or truncation that breaks it. It is not signed, so a process that rewrites the whole log consistently, recomputing every hash and the snapshot, is not detected; see [security](security.md).

The event types are `run.started`, `stage.entered`, `run.completed`, `run.cancelled`, `task.added`, `task.completed`, `evidence.recorded`, `gate.evaluated`, `approval.requested`, `approval.granted`, `approval.denied`, `budget.charged`, `budget.warning`, `budget.exceeded`, `action.blocked`, `action.allowed`, `worktree.changed`, `session.bound`, and `log.repaired`.

Run state is a pure fold over these events, so a gate verdict can always be re-derived from the log.

Not every reader verifies the chain:

- **Hooks and appends trust `state.json`** when it matches the log's last event (same sequence number and hash). They replay and verify the log only when it does not, so an edit to an earlier line is not caught by the next tool call.
- **`aos approve`, `aos run cancel`, `aos status <run>`, and `aos doctor` verify the full chain** every time, and refuse or report a log that fails.
- **Plain `aos status`** lists runs from their snapshots and does not verify them.

Every write AOS makes under `.aos/` refuses to go through a symlink: if `.aos` or any existing path component below it is a link, the write fails with `AOS refuses to write through the symlink <path>; remove it and rerun`, so a planted link cannot redirect the run's records.

A crash mid-append can leave a torn last line. The next append saves the torn bytes as an artifact, drops them, and records `log.repaired`; `aos doctor` reports torn bytes as a warning, not tampering.
