# MCP tools

The agent drives a run through eight tools served by the AOS MCP server. They are the agent's only way to change run state, and by design none of them can approve a gate, cancel a run, lower a tier, extend a budget, or record a test run: those belong to the human and to the hooks. This page lists each tool's inputs, results, and errors.

In Claude Code the plugin registers the server as `aos`, so the tools appear as `mcp__plugin_aos_aos__<tool>`, for example `mcp__plugin_aos_aos__aos_run_start`. Outside the plugin, `aos mcp` serves the same tools over stdio; see the [CLI reference](cli.md#aos-mcp).

| Tool | Purpose | Changes the run |
|---|---|---|
| [`aos_run_start`](#aos_run_start) | Start a run for one piece of work | creates it |
| [`aos_status`](#aos_status) | Show stage, gate, gaps, and budget | no |
| [`aos_gate_check`](#aos_gate_check) | Evaluate the current gate now | logs the evaluation |
| [`aos_stage_advance`](#aos_stage_advance) | Pass the gate and enter the next stage | yes |
| [`aos_task_add`](#aos_task_add) | Add a task to the current stage | yes |
| [`aos_task_complete`](#aos_task_complete) | Close a task | yes |
| [`aos_evidence_record`](#aos_evidence_record) | Record claimed evidence | yes |
| [`aos_request_approval`](#aos_request_approval) | Ask the human to decide a human gate | yes |

## Conventions

**`runId` is optional.** Every tool except `aos_run_start` takes a `runId`, and it defaults to the run this server started. Each host session runs its own server, so that is the session's run. An explicit `runId` always wins. A server that has not started a run in its lifetime (for example after Claude Code restarts and resumes a session) has no default, and a call without `runId` fails with:

```
invalid: no run was started in this session, so pass the runId that aos_run_start returned (a session-start note also names it).
```

The SessionStart hook names the run id after a resume, so the agent can pass it.

**Arguments are validated** against each tool's JSON Schema before anything runs. Unknown fields are rejected. Text fields are trimmed, and length limits apply after trimming.

**Results** come back as JSON, both as a text content block and as `structuredContent`.

**Errors** come back as tool errors (`isError: true`) whose text starts with a code:

| Code | Meaning |
|---|---|
| `invalid:` | The arguments are wrong: schema violations, unknown task or evidence ids, a line that does not exist, a request on a rule gate. Fix the call. |
| `not_found:` | No run with that id under the repository. |
| `refused:` | The call is well formed but not allowed: lowering a tier, a tier the pack does not define, evidence from outside the repository or under `.aos/`, any change to a completed or cancelled run, or a run that kept changing while the call ran. |
| `internal:` | Something else failed, such as a pack that does not load or git failing. `aos doctor` usually explains it. |

A completed or cancelled run accepts only `aos_status`. Any other call is refused with `Run <id> is <status>; only aos_status works on it. Start a new run with aos_run_start for further work.`

Writes are safe against concurrent writers (a hook observing an edit, the human's CLI, another tool call). Each call re-checks its plan under the run's lock and re-plans up to three times. A run that keeps moving is refused with `The run changed while this call ran; call aos_status and try again.`

## aos_run_start

Start a run. The pack proposes a tier from the brief; the agent should tell the human the tier and the reason before starting work.

| Input | Type | Required | Notes |
|---|---|---|---|
| `brief` | string | yes | The user's request in their words, 1 to 8,000 characters. |
| `tier` | `spike`, `bounded`, or `architectural` | no | Ask for a higher tier than proposed. A request can raise the tier, never lower it. |

| Result field | Meaning |
|---|---|
| `runId` | The new run's id (a ULID). |
| `tier`, `tierReason` | The tier and why, for example `no tier rule matched; pack default is bounded`. |
| `stages` | The tier's stage names, in order. |
| `stage` | The first stage. |
| `instructions` | The first stage's instructions (markdown). |
| `notice` | A line for the agent: the tier and reason, and that the session binds when the call returns. |

The session is bound to the run by the PostToolUse hook after this call returns, not by the server; see [sessions and binding](concepts.md#sessions-and-binding).

Refusals:

- `refused: Lowering the proposed tier (<tier>: <reason>) requires a human.`
- `refused: The <tier> tier is not available in this version of AOS (<why>). Ask the human how to proceed.`

## aos_status

Read-only. Works on active, completed, and cancelled runs.

| Input | Type | Required |
|---|---|---|
| `runId` | string | no |

| Result field | Meaning |
|---|---|
| `runId`, `status`, `tier`, `stage`, `stages` | Where the run stands. |
| `gate` | The current stage's gate evaluated now: `stage`, `verdict` (`pending`, `pass`, or `fail`), `gaps`, `fingerprint`, `weakFreshness`. |
| `iterations` | `{ used, limit }` for the Stop loop's budget. |
| `summary` | A short text summary, the same one the SessionStart hook injects. |

Each gap has `kind` (`missing`, `stale`, or `failed`), `who` (`agent` or `human`), `requirement` (for example `command:test`, `review`, `approval`, `tasks:t2`, `stage:verify`), and `text`, an instruction to act on.

## aos_gate_check

Evaluate the current stage's gate now and record the evaluation in the log.

| Input | Type | Required |
|---|---|---|
| `runId` | string | no |

| Result field | Meaning |
|---|---|
| `gate` | The gate result, as in `aos_status`. |
| `message` | `null` when the gate passes; otherwise the gaps as text, starting `AOS: advance blocked: <stage> gate <verdict>.` |

## aos_stage_advance

Pass the current gate and enter the next stage. If the gate does not pass, nothing moves and the gaps come back. The evaluation and the move land in one append, re-checked under the lock, so a task or request added meanwhile cannot be skipped.

| Input | Type | Required |
|---|---|---|
| `runId` | string | no |

| Result field | Meaning |
|---|---|
| `advanced` | `true` if the run moved on or completed. |
| `completed` | `true` if that was the last stage and the run is now complete. |
| `gate` | The gate result for the stage that was evaluated. |
| `stage` | The run's stage after the call: the next stage, or the same one if it did not move. |
| `instructions` | The new stage's instructions, or `null` if it did not move or the run completed. |
| `message` | `null` on success; otherwise the gaps as text, starting `AOS: advance blocked:`. |

## aos_task_add

Add a task to the current stage. A gate with `tasks: all` stays open until every task in its stage is completed.

| Input | Type | Required | Notes |
|---|---|---|---|
| `runId` | string | no | |
| `title` | string | yes | What the task delivers, 1 to 500 characters. |

Result: `{ task, stage }`, where `task` is an id such as `t1`. Ids count across the whole run.

## aos_task_complete

Mark a task in the current stage completed.

| Input | Type | Required | Notes |
|---|---|---|---|
| `runId` | string | no | |
| `task` | string | yes | The id from `aos_task_add`. |
| `evidence` | string array | no | Up to 50 evidence ids from `aos_evidence_record` that back the task. Every id must exist in the run. |

Result: `{ task, open }`, where `open` is how many other tasks in the stage are still open.

Errors (`invalid`): no such task, the task is already completed, the task belongs to another stage, or an evidence id is unknown.

## aos_evidence_record

Record **claimed** evidence: the agent's own account, kept in the log. Provenance is always `claimed` here; there is no provenance input. Test runs cannot be recorded through this tool: the hooks observe them.

| Input | Type | Required for | Notes |
|---|---|---|---|
| `runId` | string | | |
| `kind` | `artifact`, `citation`, `review`, or `skill` | every kind | Each kind accepts exactly its own fields. |
| `path` | string | artifact, citation | A file inside the repository, outside `.aos/` and `.git/`. Symlinks are resolved before the check. |
| `line` | integer, 1 or more | citation | Must exist in the file. |
| `note` | string | citation (optional) | What the cited line shows, up to 2,000 characters. |
| `status` | `approved`, `rejected`, or `needs-revision` | review | The reviewer's verdict, reported honestly. |
| `feedback` | string | review | The reviewer's feedback, 1 to 8,000 characters. Required even for an approval. |
| `reviewer` | string | review | Who reviewed, such as a reviewing subagent's name, up to 200 characters. |
| `skill` | string | skill | The skill's name, such as `superpowers:brainstorming`, up to 200 characters. |

Result: `{ evidenceId, fingerprint }`. The fingerprint is the tree the evidence belongs to; any change to the tree makes it stale for requirements with `fresh: true`.

An artifact records the file's SHA-256. Files under 1 MiB are also copied into the run's `artifacts/` directory, unless git ignores them: an ignored file is often a secret, and a copy would outlive it. When git cannot confirm a file is not ignored, it is treated as ignored.

Refusals and errors include `refused: <path> is outside the repository at <root>; evidence must come from inside it.`, `refused: <path> is under .aos/, which holds AOS's own records and cannot be evidence.`, and `invalid: <path> has <n> lines; line <line> does not exist`.

## aos_request_approval

Ask the human to approve the current stage. The agent should present the design, or the spike's question and probe, in chat first, then call this, pass on the returned instructions, and end its turn.

| Input | Type | Required | Notes |
|---|---|---|---|
| `runId` | string | no | |
| `summary` | string | yes | What the human is approving, 1 to 4,000 characters. `aos approve` shows it to the human. |

| Result field | Meaning |
|---|---|
| `request` | The request id the human's decision will be pinned to. |
| `stage` | The stage being decided. |
| `instructions` | For the agent to relay, for example: `Ask the human to run, in their own terminal: aos approve <run> design --root "/path/to/greeter". Then stop and wait; do not run it yourself.` |

A new request replaces any earlier undecided one for the stage; only the latest request since the stage was entered can be decided. On a rule gate the call fails with `invalid: The <stage> gate is decided by rules, not by a human. Call aos_gate_check to see what it needs.`
