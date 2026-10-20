# Architecture

This page is for contributors. It maps the modules and their boundaries, follows a hook payload from Claude Code to a decision, and explains the run log, gate evaluation, the MCP server, the CLI, and how the plugin and the npm package are built. Read it with [`kernel/src/types.ts`](../../kernel/src/types.ts) open: that file is the shared contract every module codes against. For setup, tests, and conventions, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

AOS is a guardrail for a cooperating agent, not a security boundary. The design choices below make bypass hard to do by accident or by shortcut; [security.md](security.md) says where they stop.

## The shape of the system

```
 Claude Code session
   |                                           |
   | hook payload (JSON on stdin)              | MCP tool call (stdio)
   v                                           v
 sh bin/aos.sh hook <event>                 sh bin/aos.sh mcp
   bun dist/aos-hook.js                       bun dist/aos-mcp.js
     normalize   -> HookInput                   kernel/src/mcp: validate arguments
     handleHook  -> HookDecision                kernel/src/ops/agent.ts
     render      -> hook JSON (stdout)                 |
   |                                                   |
   +-------------------+   +---------------------------+
                       v   v
            kernel/src/store: .aos/runs/<run>/log.jsonl, state.json
                              .aos/sessions/<binding>.json
                       ^
                       |
            aos approve, aos run cancel     (kernel/src/ops/human.ts)
            aos status, aos doctor          (read and verify only)
```

Three kinds of process write to a run, and none of them is long-lived except the MCP server: a fresh hook process for every hook event, the MCP server for the session, and the CLI when a person runs it. They coordinate only through files under `.aos/`, behind a per-run lock.

## Modules and boundaries

| Path | Owns |
|---|---|
| `kernel/src/types.ts` | The contract: tiers, provenance, packs, evidence, gates, run state, the event types and their data, and the host-agnostic hook interface (`HookInput`, `HookDecision`). |
| `kernel/src/store/` | The run log, the `state.json` snapshot, the cross-process lock, content-addressed artifacts, and session bindings. |
| `kernel/src/projection.ts` | The pure reducer from events to `RunState`. |
| `kernel/src/gates/` | `evaluateGate`, a pure function of run state and the tree, and the text the agent sees (`formatGate`, `renderSummary`). |
| `kernel/src/pack/` | Loading, validating, and hashing packs; tier classification. |
| `kernel/src/shell/` | Shell command semantics: a quote-aware lexer, the reduction to the simple commands that actually run, matching against roles, actions, human-only commands, and `.aos/`, and output redaction. |
| `kernel/src/tree/` | The working-tree fingerprint and the git runner with its deadline. |
| `kernel/src/ops/` | Operations: `agent.ts` for what the agent may do through MCP, `human.ts` for what only a person may do (approve, deny, cancel), and `context.ts` for where an operation runs. |
| `kernel/src/hooks/` | The host-agnostic hook logic: binding, the guard, the observer, the Stop loop, SessionStart, and the fail-safe policy. |
| `kernel/src/mcp/` | The MCP server and its tool catalog, exported only as `@aos-harness/kernel/mcp`. |
| `kernel/src/util/` | ULIDs, hashing, typed errors, the lazy ajv loader and the side-effect module bundles use to supply ajv (`ajv-static.ts`), and the name folding behind every `.aos` check (`fold.ts`). |
| `hosts/claude-code/` | The Claude Code plugin: manifest, `hooks/hooks.json`, MCP registration in `.mcp.json`, the `/aos:run` skill, the launcher, and the entry points in `bin/`. `src/` translates Claude Code payloads into `HookInput` and `HookDecision` back into Claude Code's hook JSON. |
| `cli/` | The `aos` CLI, the human side. |
| `packs/feature-delivery/` | The reference pack. Data only. |

The boundaries that matter:

- **Hosts translate; the kernel decides.** A host normalizes its payload into `HookInput` and renders a `HookDecision`. Every policy decision lives in the kernel, so a second host reuses all of it.
- **The kernel is portable.** `kernel/src` imports only `node:` built-ins and its declared dependencies (`@modelcontextprotocol/sdk`, `ajv`, `js-yaml`): no `Bun.*`, no `bun:*`, no `import.meta.dir`. A host can load the kernel in-process under Node 22.18 or later, and the tests check that the barrel loads there and that the source uses no Bun-only APIs.
- **The MCP SDK stays out of the barrel.** `@aos-harness/kernel` does not export the server; `@aos-harness/kernel/mcp` does, so a host that loads the kernel in-process does not pull in the SDK.
- **The agent side never reaches the human operations.** `approve`, `deny`, and `cancelRun` refuse a non-human actor, but a caller that passes a human actor is believed, and `humanActor` builds one from the OS account for anyone who calls it. So the kernel's MCP server and hook code, which act for the agent, must never import them, and [`kernel/tests/ops-human/imports.test.ts`](../../kernel/tests/ops-human/imports.test.ts) reads every source under `kernel/src/mcp` and `kernel/src/hooks` and fails if one does. It does not scan the host's own code in `hosts/claude-code`.
- **No tool can produce observed evidence.** No MCP schema has a provenance field, and `command` is not an evidence kind the agent can record. Observed evidence comes only from the hooks.

## From hook payload to decision

### Registration and launch

`hosts/claude-code/hooks/hooks.json` registers one command for five events, each running `sh "${CLAUDE_PLUGIN_ROOT}/bin/aos.sh" hook <event>`:

| Event | Matcher | Timeout | On a crashed process |
|---|---|---|---|
| PreToolUse | `Bash` | 15 s | `onFailure: "block"`: Claude Code blocks the command |
| PreToolUse | `Write\|Edit\|MultiEdit\|NotebookEdit` | 15 s | fails open |
| PostToolUse | `Bash\|Write\|Edit\|MultiEdit\|NotebookEdit\|Skill\|mcp__plugin_aos_aos__aos_run_start` | 15 s | fails open |
| PostToolUseFailure | `Bash` | 15 s | fails open |
| SessionStart | all | 15 s | fails open |
| Stop | all | 30 s | fails open |

`bin/aos.sh` runs `dist/aos-hook.js` under Bun (or `bin/aos-hook.ts` with `AOS_PLUGIN_SOURCE=1`). When Bun is missing it steps aside instead of failing: the Bash hook is registered to fail closed, so a failing launcher would block every Bash call in every session, run or no run. Hooks drain their payload and exit 0, SessionStart tells the model that AOS is off and why, and the MCP server exits 1 with the reason on stderr.

### The entry point

`bin/aos-hook.ts` reads the payload, then `respond()`:

1. maps the CLI argument to a Claude Code event (`pre-tool-use` to `PreToolUse`, and so on);
2. parses the JSON and calls `normalize()` (`src/payload.ts`) to build a `HookInput`;
3. calls the kernel's `handleHook()` with `CLAUDE_PROJECT_DIR` as the project directory, since Claude Code exports the session's starting directory to hooks and it does not follow the agent's `cd`;
4. renders the decision with `render()` (`src/render.ts`) and prints it.

The process always exits 0 and speaks only through JSON on stdout, because Claude Code parses hook JSON only from a zero exit. A non-zero exit is left to mean a runtime that died, which is exactly what the Bash guard's `onFailure: "block"` catches.

`normalize()` rejects anything the kernel would otherwise have to guess about, with a `PayloadError`: an unknown event, a payload whose `hook_event_name` disagrees with the registered event, a missing `session_id` or `cwd`, a relative `cwd`, a tool event without `tool_name` or a `tool_input` object, or a Bash PostToolUse without a `tool_response`. It classifies the tool (`bash`, `write`, `skill`, `aos-mcp`, `other`), resolves a file path against `cwd`, and recognizes AOS MCP tools by suffix (`mcp__<server>__aos_<tool>`). It is deliberately strict about exit codes: a Bash PostToolUse counts as exit 0 only in the plain foreground shape, and a PostToolUseFailure reads its code only from the leading `Exit code N` of the error text. Backgrounded, interrupted, and reinterpreted results get no exit code rather than a guessed one.

### handleHook

[`kernel/src/hooks/handle.ts`](../../kernel/src/hooks/handle.ts) never throws. In order:

1. **Bind on run start.** For the PostToolUse of `aos_run_start`, `bindOnRunStart` finds the new run id in the serialized tool response, locates its `.aos/runs/<run>` under the session's repository root (from `cwd`, then the project directory), and, if the run is active, writes the session binding and appends `session.bound`. The MCP server never sees the host's session id, so this hook is where the session and the run meet.
2. **Look up the binding.** `findBinding` walks up from a directory to the filesystem root looking for `.aos/sessions/<host>-<session>-<hash>.json`. `lookupBinding` tries the payload's `cwd`, then the project directory, then (for a file tool) the real directory of the file being written, skipping a walk an earlier one already covered. With no binding the hook allows and says nothing, except that SessionStart names any active run that this session is not bound to, found in `.aos/runs` of the session's directory and of the project directory (not their parents). An unbound session pays for one lookup per hook.
3. **Load the run.** `loadState` verifies the whole log and replays it in memory on every call; the contents of `state.json` are never used, though the snapshot must still pin the log's end. A broken chain throws `ChainError`, which reaches the fail-safe path. A cancelled run passes everything through.
4. **Dispatch.** `pre-tool` goes to the guard, `post-tool` and `post-tool-failure` to the observer, `stop` to the Stop loop, and `session-start` to the summary.

| Handler | What it does |
|---|---|
| `guard.ts` (PreToolUse) | For file tools: refuses `.aos/`, then checks the stage's write scope. For Bash: refuses human-only `aos` commands, refuses commands that name `.aos/`, then matches the pack's actions and applies the tier's policy. Each deny appends `action.blocked`; each allowed guarded action appends `action.allowed`. |
| `observe.ts` (PostToolUse, PostToolUseFailure) | Bash commands that match a role become observed command evidence with a redacted output tail and an output digest; file writes become `worktree.changed`; Skill calls become observed skill evidence. It runs on completed runs too, so a test run after completion can still block or re-open a push. |
| `stop.ts` (Stop) | The retry loop: blocks the stop while the agent has gaps it can close, keyed on the prompt id and the gap set, of which only the last is remembered, so the same gaps are never nudged twice in a row within a prompt; it charges the iteration budget, which caps the total. |
| `session-start.ts` (SessionStart) | Re-injects a capped run summary whenever a bound session starts, which in practice means resume and compaction, so compaction never loses the run. After startup, `/clear`, or a fork the session id is new, so the session is unbound and gets the unbound notice instead (`unbound.ts`). |

### Rendering

`render()` maps a decision onto Claude Code's hook JSON:

| Decision | Output |
|---|---|
| allow, no notice | nothing; an allow never prints `permissionDecision: "allow"`, which would skip the user's own permission prompt |
| allow with a notice | `hookSpecificOutput.additionalContext` for PostToolUse, PostToolUseFailure, and SessionStart (it reaches the model); `systemMessage` for Stop and PreToolUse |
| deny | `hookSpecificOutput` with `permissionDecision: "deny"` and the reason (PreToolUse only) |
| block-stop | `{ "decision": "block", "reason": ... }` (Stop only) |

### Fail-safe layers

Consequential actions fail closed; everything else fails open, so a kernel bug never breaks an ordinary session.

1. **Kernel error.** Any throw inside `handleHook` is logged to `.aos/hook-errors.log` (the bound run's root, else the nearest existing `.aos` above the project directory or `cwd`) and answered by `failsafeDecision`: a PreToolUse whose raw command text matches a short list of consequential patterns (push, PR creation, deploy commands) is denied with `AOS error, run \`aos doctor\`: <message>`; everything else is allowed. The patterns are deliberately crude, because the pack itself may be what failed.
2. **Recording failure.** If appending `action.allowed` fails, the throw reaches the fail-safe path, which denies push, PR create, and deploy commands; a commit goes through unrecorded. A failure to record a deny is only logged; the deny stands.
3. **Unreadable payload.** A payload that does not parse or normalize goes to `payloadFailsafe`, which applies the same decision only when a `.aos` directory exists at or above the payload's `cwd` or the project directory, and logs only there. Anywhere else a change in the host's payload format must not block a push, and nothing is written.
4. **A failed process.** Only the Bash matcher has `onFailure: "block"`, so a hook process that fails, for example by crashing, blocks the Bash command and lets file edits through. This needs Claude Code 2.1.295 or later, which `aos doctor` checks.

## The event log and projection

### Layout

```
.aos/
  runs/<run>/
    log.jsonl        append-only, hash-chained events: the source of truth
    state.json       { v, seq, head, state }: a snapshot of the projection
    log.lock         present only while a writer holds the run
    artifacts/<hex>  content-addressed copies (small artifact evidence, repaired log tails)
  sessions/
    <host>-<session>-<hash>.json   { host, session, run, root, boundAt }
  hook-errors.log
```

Run ids are ULIDs. Run ids from agent input are checked against `^[A-Za-z0-9_-]+$` before they become paths, and session ids are reduced to safe characters plus a hash of the exact pair, so nothing in a payload steers a path.

### Events

Each line of `log.jsonl` is one envelope, serialized with a fixed key order because the line is what gets hashed:

| Field | Meaning |
|---|---|
| `v` | Envelope version, `1`. |
| `seq` | 1, 2, 3, ... with no gaps. |
| `id` | A ULID for the event. |
| `run` | The run id. |
| `ts` | ISO timestamp. |
| `actor` | `{ kind, id, agent }`: `agent` (`mcp:<tool>`), `hook` (`claude-code:<event>`, with the kernel's event name: `pre-tool`, `post-tool`, `post-tool-failure`, `stop`, or `session-start`), `human` (the OS account), or `kernel` (`store`). `agent` carries a subagent's id when the host reports one. |
| `type` | One of the event types in `EventDataMap`, such as `run.started`, `evidence.recorded`, `approval.granted`, `action.blocked`. |
| `data` | The type's payload. |
| `prev` | `sha256:<hex>` of the previous line; the first event's `prev` is `GENESIS_PREV`, `sha256:` followed by 64 zeros. |

`state.json` pins the log: its `seq` and `head` (the hash of the line at that seq) must match the log. That pin is what catches an edited or removed last event, which no later `prev` covers. `verifyChain` replays the whole chain and checks the pin; it detects edits, deletions, and truncation that break the chain. The chain is not signed, so a log and snapshot rewritten consistently end to end are not detected. Every reader runs this check: hooks, MCP operations, and appends on every call, and `aos status`, `aos approve`, `aos run cancel`, and `aos doctor`. Given a projector, `verifyChain` also replays the events the snapshot reflects and reports a snapshot whose contents differ, which `aos doctor` shows as a WARN; that leaves the chain `ok`, because nothing trusts those contents and another AOS version can project the same events differently.

### Writing

`appendEvents` takes the run's lock, then:

1. reads the snapshot and the log's tail (a window that grows until it holds the last two whole lines), which it needs to repair a torn tail;
2. verifies and replays the full log for the base state, never taking it from the snapshot, and throws `ChainError` on any break so a tampered run fails closed;
3. runs the caller's **precondition** against that base state, then projects the new events. Either can throw, and a throw leaves the log untouched;
4. writes the whole batch in one write and fsyncs it, then writes `state.json` through a temporary file and a rename.

The snapshot is a convenience copy that no decision reads. A failed snapshot write is traced to `hook-errors.log` and never reported as a failed append, because the events are already durable and a retry would duplicate them; the next reader rebuilds it.

**The lock** is `log.lock`, created exclusively and holding `{ pid, host, ts, nonce }`. A waiter retries with jitter for up to 3 s, then fails with `LockTimeoutError`. A lock is stale when it is older than 30 s or its pid is dead on the same host; breakers serialize on a short-lived marker and re-check that the lock is still the one they judged stale. A holder suspended past the stale age (a laptop asleep) re-checks that it still holds the lock and that the log has not grown before it writes, and gives up rather than fork the chain.

**Preconditions and retries.** Another writer can land between an operation's read and its append: a hook observing an edit, the human's CLI, a second tool call. Agent operations (`change()` in `ops/agent.ts`) plan against a read, then append with a precondition that the run is still active and that what they planned against still holds, such as the same stage and the same edit count. A plan that went stale is re-planned from a fresh read, up to 3 attempts, then refused with `The run changed while this call ran; call aos_status and try again.` A run that ended is final and is never retried. The human operations re-check under the lock in the same way, so an approval is never recorded against a request the agent replaced while the person typed.

**Crash repair.** Only the last line can be the casualty of an interrupted write. On the next append, a torn tail is saved as an artifact, truncated away, and recorded as a `log.repaired` event (with the dropped byte count and digest) ahead of the new events. A last event that is whole but lost its newline gets the newline back instead.

**Run creation** makes the run directory with an exclusive `mkdir`, so two starts can never share a run, and removes it if the first append fails.

**Symlinks.** Writes under `.aos/` (`refuseSymlinks` in `store/fs-internal.ts`) first refuse when `.aos` or any existing path component below it is a symlink, with an `UnsafePathError`: `AOS refuses to write through the symlink <path>; remove it and rerun`. The log, the lock (checked before it is taken, so a linked run directory cannot move the lock and every event elsewhere), artifacts, and session bindings are checked this way; a `hook-errors.log` line is skipped quietly instead. The temporary file behind each rename is created exclusively, so a planted file or link at that name is refused, and the rename replaces a link at the target rather than writing through it. A link swapped in between the check and the write is not caught.

### Projection

`applyEvent` in [`kernel/src/projection.ts`](../../kernel/src/projection.ts) is a pure fold: it never mutates its input and never shares structure with an event, so a state loaded from `state.json` and advanced one event at a time always equals a full replay. The first event must be `run.started`, and a second one is treated as a corrupt log. Unknown event types, from a newer kernel, advance `seq` and nothing else.

## Gates

`evaluateGate(state, stage, tree)` in [`kernel/src/gates/evaluate.ts`](../../kernel/src/gates/evaluate.ts) is a pure function. For the stage's gate it collects gaps, each with a kind (`missing`, `stale`, `failed`), who can close it (`agent` or `human`), a requirement label, and the text handed straight to the agent:

1. A stage the run has not reached gets a gap, so an action policy that waits on a later gate (push after verify) can never pass early on evidence alone.
2. Each requirement selects evidence of its kind at or above its provenance; with `fresh`, only evidence at the current tree fingerprint counts. The newest candidate decides: a masked command run is missing, a non-zero exit is failed, a review whose status is not `approved` is failed.
3. With `tasks: all`, every open task in the stage is a gap.
4. A human gate looks only at the latest approval request made since the stage was entered, and only at a decision whose actor is a human. A decision logged by any other actor counts as no decision.

The verdict is `fail` if any gap failed, `pending` if any gap remains, and `pass` otherwise.

`gapKey` names a gate's state for the Stop loop as the verdict plus the sorted `requirement:kind:who` of each gap. It leaves the text out on purpose: the stale text embeds an edit count that grows with every edit, and that must not look like progress. `who` is in the key because an approval gap moving from the agent (not requested) to the human (waiting) is progress.

The golden logs in `kernel/tests/golden/` are sanitized logs of the end-to-end bounded and spike runs. Replaying them re-evaluates every recorded gate verdict from the events before it, so a change that alters any verdict fails there and has to be deliberate (regenerate them with `AOS_GOLDEN_WRITE=1 bun test ./tests/e2e`).

The tree fingerprint (`kernel/src/tree/fingerprint.ts`) stages everything into a copy of the git index and writes a tree from it, so the user's own staging is untouched: `git:<tree hash>` over tracked and untracked files, minus ignored files and `.aos/`. Outside git it is `counter:<n>`, a weak count of file-tool edits. Every git call has a 10 s deadline, so a hung git fails with a `TreeError` instead of stalling a hook.

## Shell analysis

The guard and the observer judge Bash commands by text. `kernel/src/shell/` lexes a command line without expanding or running anything, never splitting inside quotes, substitutions, or heredoc bodies, then reduces it to the simple commands that actually run, unwrapping environment assignments, `cd`, grouping, transparent wrappers, and scripts handed to a shell or `eval`, to a bounded depth. Each such command is matched in a normal form (quotes removed, the command word reduced to its basename and lowercased, whitespace inside a word shown as `␣`, single spaces) against the pack's roles and action patterns and the human-only command list, and every word of every segment is checked for a path into `.aos/`. A command whose word bash would rewrite before running it cannot be classified from its text, so the guard reads the surrounding words conservatively. This is best-effort text analysis of a language it does not fully parse; [security.md](security.md) lists its limits.

Command evidence keeps a sha256 of the full output and only the last 4096 bytes after redaction, which replaces common credential and personal-data formats with `[REDACTED]`. Redaction is best-effort by format.

## The MCP server

[`kernel/src/mcp/server.ts`](../../kernel/src/mcp/server.ts) serves the eight tools in [`tools.ts`](../../kernel/src/mcp/tools.ts) over stdio. [mcp-tools.md](mcp-tools.md) documents each one.

- **One process per session.** Claude Code spawns a server for each session, so the run a server started is that session's run. Calls that omit `runId` default to it; an explicit `runId` always wins. The server does not know the host's session id; binding happens in the hook (above).
- **Context on first use.** The git root lookup runs on the first call, so a lookup that fails surfaces as a tool error the agent can report instead of a server that never starts. Runs live at the repository top level, so a server started in a subdirectory finds runs a hook started from the root.
- **Validation.** Every call is checked with ajv against the tool's schema before anything runs. `aos_evidence_record` advertises a flat schema, because some model APIs reject a top-level `oneOf`, and is validated against a stricter per-kind schema that admits exactly each kind's fields.
- **Errors.** A failure never takes the server down; it becomes a tool error whose text starts with the class: `invalid:`, `not_found:`, or `refused:` from an `OpError`, and `internal:` for anything else.
- **Shutdown.** The server closes itself when stdin ends, since the SDK transport ignores end of input.

The plugin's entry point, `bin/aos-mcp.ts`, takes the project from `CLAUDE_PROJECT_DIR` (falling back to the working directory when it is empty or an unexpanded `${...}` placeholder), the pack from `AOS_PACK` (which the plugin's `.mcp.json` points at the plugin's own `pack/`), and the host name from `AOS_HOST`. `aos mcp` serves the same server from the CLI.

## The CLI

[`cli/src/dispatch.ts`](../../cli/src/dispatch.ts) maps the first argument to a command and imports it lazily, so each invocation loads only what it runs. Commands get a `CliIO` (argv, cwd, env, TTY flag, output, prompt) injected, so tests drive them without a terminal. A thrown error becomes one `aos: <message>` line and exit 1; a usage error is exit 2. [cli.md](cli.md) lists every command, flag, and exit code.

- **Human-only commands.** `requireHuman()` in [`cli/src/commands/shared.ts`](../../cli/src/commands/shared.ts) runs before any prompt or run read. It refuses (exit 2) when `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CLAUDE_CODE_SESSION_ID` is set to a non-empty value, which marks a shell an agent started even when a wrapper fakes a terminal, then refuses without an interactive terminal. Both checks stop an agent from passing its own gate by accident or shortcut; neither is a security boundary, since a process can clear the variables and allocate a terminal. Both commands verify the full hash chain before showing anything, and `aos approve` pins the decision to the request id it displayed.
- **Printable output.** Text from a run log or an agent is passed through `printable()` before a person sees it: control characters, format characters (bidi overrides and isolates, zero-width characters, the byte order mark), and the line and paragraph separators are shown as visible `\uXXXX` escapes, so a summary cannot repaint the terminal or reorder what is really being approved.
- **Roots.** Commands find runs under `--root`, else the git top level of the working directory, else the directory itself.

## Packaging and bundling

### The plugin

A marketplace install copies only the plugin directory into Claude Code's cache, so the plugin cannot reach the workspace's `node_modules` or the repository's `packs/`. [`scripts/build-plugin.ts`](../../scripts/build-plugin.ts) (`bun run build:plugin`) makes it self-contained:

- It bundles `bin/aos-hook.ts` and `bin/aos-mcp.ts`, with the kernel, the MCP SDK, ajv, and js-yaml inlined, into `hosts/claude-code/dist/aos-hook.js` and `dist/aos-mcp.js` (Bun target, ESM, whitespace and syntax minification only, so identifiers stay readable in `hook-errors.log` stack traces).
- It copies `packs/feature-delivery` into `hosts/claude-code/pack`, leaving out the pack's workspace `package.json`.
- Both outputs are committed, because the marketplace installs straight from git. `bun run build:plugin:check` rebuilds into a temporary directory and fails if any committed file differs or is extra. CI and the release workflow both run it, then run the end-to-end suite with `AOS_E2E_HOOK=bundle`, so every hook goes through the launcher and the committed bundle the way a marketplace install does.
- `bun run validate:configs` ([`scripts/validate-configs.ts`](../../scripts/validate-configs.ts)) checks what a release ships on every pull request: one version across the manifests in [`scripts/release/versioned.ts`](../../scripts/release/versioned.ts), every pack (the sources and the plugin's copy) loading as a valid data-only pack, every marketplace entry pointing inside the repository at a plugin of the same name, and a non-empty `CHANGELOG.md` section for the version, read the way the release workflow reads it. It is a required check on `main`, alongside `test`.

**ajv and bundling.** The kernel loads ajv lazily through `createRequire`, because importing it costs tens of milliseconds and a hook process imports the kernel on every tool call without validating anything. A bundler cannot follow that runtime require, so bundled entry points that validate (the MCP server and the CLI) import `@aos-harness/kernel/ajv-static`, which imports ajv statically and hands it to the loader. The hook entry point must not import it: it never validates, and loading ajv would slow every tool call.

### The npm package

The workspace CLI imports `@aos-harness/kernel` from source, and that package is not published. [`scripts/release/pack-cli.ts`](../../scripts/release/pack-cli.ts) builds the `aos-harness` package as a bundle instead: `dist/aos.js` (the CLI with the kernel and its dependencies inlined), `pack/` (the reference pack, without its `package.json`), the README, the license, and a manifest with no runtime dependencies. The bin is a Bun script, so Bun must be on PATH even when the package is installed with npm.

`defaultPackDir()` in [`cli/src/pack-path.ts`](../../cli/src/pack-path.ts) finds the reference pack in both layouts: `pack/` next to the package root (the published bundle), else `../packs/feature-delivery` (a source checkout). [releasing.md](releasing.md) covers the release workflow.

### Running from source

`AOS_PLUGIN_SOURCE=1` makes the launcher run `bin/*.ts` instead of `dist/*.js`, for working on the plugin from a checkout with `claude --plugin-dir hosts/claude-code`. The CLI runs from source as `bun cli/src/index.ts <command>`.

## Performance

Every hook is a fresh Bun process, and its wall time is added to the tool call. The plugin README records the measurements of the shipped bundle: on an Apple Silicon laptop with Bun 1.4.0, the PreToolUse guards measure a median of about 50 ms and a p95 of 54 to 60 ms, about 45 ms of which is starting Bun and loading the bundle; a PostToolUse that records a test run also fingerprints the working tree, and measured a median of 107 ms and a p95 of 123 ms on a clone of this repository, over the target. That cost grows with the size of the working tree. The target is a p95 under 100 ms per hook. Measure your own machine and repository with (`--bundle` times the shipped bundle; without it the sources are timed, which also pays for transpiling them):

```bash
bun run scripts/bench-hook.ts --bundle
```

This is why the hook path avoids ajv, computes the tree fingerprint at most once per call, and pays only one binding lookup in an unbound session. It does replay the run's log on every call, which measured about 1.3 ms at p95 for 200 events and 3.5 ms for 1,000, because trusting the snapshot let an edited `state.json` change what AOS enforced.

## Tests

| Path | Covers |
|---|---|
| `kernel/tests/` | The kernel by module: store (including concurrency and property tests), projection, gates, packs, shell, tree, operations, hooks, the MCP server, portability under Node, and golden log replays. |
| `hosts/claude-code/tests/` | Payload normalization and rendering against Claude Code hook fixtures (docs-derived and captured), the entry point, the launcher, and the plugin files. |
| `cli/tests/` | Each command through an injected `CliIO`. |
| `tests/e2e/` | Bounded and spike runs end to end through the real MCP server and the plugin's real hook command, in scratch git repositories. |

[CONTRIBUTING.md](../../CONTRIBUTING.md) has the commands and the rules tests follow.
