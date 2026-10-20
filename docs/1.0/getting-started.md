# Getting started

This guide installs AOS 1.0 into Claude Code, walks through a first run from brief to push, and covers daily use, cancelling a run, and uninstalling. AOS 1.0 is in prerelease: the CLI is `aos-harness@next` on npm (`1.0.0-next.0` at the time of writing), and the plugin installs from this repository's marketplace.

AOS has two halves. The **plugin** lives inside Claude Code: hooks that check and observe tool calls, an MCP server the agent uses to drive the run, and the `/aos:run` skill. The **`aos` CLI** is for you, the human: it approves gates, shows run status, checks the setup, and cancels runs. You need both.

## Requirements

| Requirement | Why |
|---|---|
| Claude Code 2.1.295 or later | The Bash guard is registered with `onFailure: "block"`, which needs 2.1.295, so a crashed hook process blocks the command instead of letting it run. `aos doctor` warns on older versions. |
| [Bun](https://bun.sh) 1.3.11 or later, on `PATH` | The plugin's hooks and MCP server run under Bun, and the `aos` CLI is a Bun script even when npm installs it. |
| git | Freshness is measured against the git working tree. Outside git, AOS falls back to a weaker edit counter and `aos doctor` warns. |
| The [superpowers](https://github.com/obra/superpowers) plugin (recommended) | The reference pack's stages name its skills. Without it, `aos doctor` warns and the agent follows each stage's written instructions instead. |

If Bun is missing, the plugin steps aside rather than breaking your session: hooks let every tool call through, and each new session tells the agent that AOS is off and why. See [troubleshooting](troubleshooting.md#bun-is-not-on-path).

## Install the plugin

In Claude Code, one step (needs 2.1.275 or later):

```
/plugin install aos --marketplace aos-engineer/harness
```

Or in two steps:

```
/plugin marketplace add aos-engineer/harness
/plugin install aos@aos-harness
```

From a shell, the same two steps:

```bash
claude plugin marketplace add aos-engineer/harness
claude plugin install aos@aos-harness --scope user
```

The marketplace is named `aos-harness` and the plugin `aos`. To pin a release instead of following `main`, add the marketplace as `aos-engineer/harness#v1.0.0-next.0`. Start a new Claude Code session after installing so the hooks and the MCP server load.

## Install the CLI

```bash
npm install -g aos-harness@next
# or
bun add -g aos-harness@next

aos --version
```

`aos-harness@latest` on npm is still the 0.x CLI. Installing `@next` globally replaces a global 0.x `aos`.

## Prepare a project

AOS keeps each run under `.aos/` in the repository. Those are AOS's records, not your project's, so ignore them, then check the setup:

```bash
cd /path/to/greeter
echo ".aos/" >> .gitignore
aos doctor
```

A healthy setup looks like this (versions and paths vary):

```
AOS doctor: /path/to/greeter
OK   bun 1.4.0
OK   git version 2.55.0
OK   Claude Code 2.1.304
OK   inside a git repository
OK   .aos/ is gitignored
OK   pack feature-delivery@1.0.0 loads from <install dir>/pack
OK   bound skill superpowers:brainstorming is installed
OK   bound skill superpowers:test-driven-development is installed
OK   bound skill superpowers:verification-before-completion is installed
OK   bound skill superpowers:requesting-code-review is installed
OK   no runs under /path/to/greeter
OK   no hook errors logged
0 FAIL, 0 WARN, 12 OK.
```

`aos doctor` exits 1 if any line says FAIL. [The CLI reference](cli.md#aos-doctor) lists every check.

## Your first run

This walk-through follows a bounded run that was checked end to end in a live Claude Code 2.1.304 session. The messages are the ones AOS prints; run and request ids are shortened examples.

### 1. Start the run

In Claude Code:

```
/aos:run add a --shout flag to greet
```

Claude calls `aos_run_start`. The pack proposes a tier from the brief, and Claude tells you which and why. This brief matches no spike or architectural rule, so it runs as `bounded`, with three stages: design, build, verify.

```
AOS run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z started as bounded (no tier rule matched; pack default is bounded).
AOS: this session is bound to run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z (bounded). Gates apply from now on.
```

From here on, this session is gated. Other sessions are not; see [sessions and binding](concepts.md#sessions-and-binding).

### 2. Design

Claude reads the code and presents a short design in chat. In this stage it may write only under `docs/specs/`. An edit anywhere else is refused before it happens:

```
AOS: stage "design" allows writes only under docs/specs/. Pass its gate with aos_stage_advance first.
```

A push this early is refused with the full list of what is missing:

```
AOS: push blocked: verify gate pending.
- The run is at design; the verify stage has not been reached. Pass the design gate and call aos_stage_advance.
- No observed "test" run at the current tree. Run one of: bun test, bun run test, npm test, npm run test, pnpm test, yarn test, pytest, go test, cargo test. Run it as its own command, not piped or chained with |, ||, ; or &.
- No approved review at the current tree. Review the change and record it with aos_evidence_record (kind "review").
```

When the design is ready, Claude calls `aos_request_approval`, gives you the exact command to run, and stops. If Claude tries to stop before it has asked, the Stop hook sends it back once: `Approval not requested. Present the design to the human, then call aos_request_approval.`

### 3. Approve in your own terminal

Run the command Claude gave you. It shows what Claude submitted and asks you to type the stage name:

```
$ aos approve 01JB2Q4X7N5K8M3R6T9V0W1Y2Z design --root "/path/to/greeter"
Run:     01JB2Q4X7N5K8M3R6T9V0W1Y2Z (bounded, feature-delivery@1.0.0)
Brief:   add a --shout flag to greet
Stage:   design (1/3)
Request: 01JB2Q7C3D4E5F6G7H8J9K0M1N
Summary from the agent:
Add an optional shout flag to greet that upper-cases the greeting. Test it in greet.test.ts.
End of the agent's summary.

You are approving request 01JB2Q7C3D4E5F6G7H8J9K0M1N for stage "design" of run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z.
Type the stage name ("design") to approve: design
Approved design for run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z. The agent can advance the stage.
```

Then tell Claude to continue. To send the design back instead, add `--deny --reason "..."`; Claude sees your reason and revises. `aos approve` works only in a real terminal: Claude's Bash tool cannot run it, and in a gated session the guard refuses it outright.

### 4. Build

Claude calls `aos_stage_advance` and gets the build instructions: test first, then the change. AOS records the exit code of every test command Claude runs. Claude cannot record test runs itself. A failing run holds the gate:

```
The last observed "test" run exited 1. Fix the failures and re-run it.
```

A test run piped or chained so its exit code is hidden does not count:

```
AOS: this test run's exit status was hidden by a pipe or chain, so it does not count as evidence. Re-run the test command on its own.
```

Evidence belongs to the tree it was taken at. After an edit, the last run is stale:

```
The last observed "test" run predates the current tree (1 file edit since, plus any shell changes). Re-run it.
```

Once `bun test` passes at the current tree, the build gate passes. Commits are allowed from this stage. Push is still blocked, now with a shorter list:

```
AOS: push blocked: verify gate pending.
- The run is at build; the verify stage has not been reached. Pass the build gate and call aos_stage_advance.
- No approved review at the current tree. Review the change and record it with aos_evidence_record (kind "review").
```

### 5. Verify

Claude advances to verify, gets a code review of the whole change (for example from a reviewer subagent), and records it with `aos_evidence_record`, kind `review`. The verify gate needs a passing test run and an approved review, both at the current tree. When it passes, `aos_stage_advance` completes the run.

### 6. Push

With the verify gate passing at the current tree, `git push` and `gh pr create` go through. Any later edit makes the evidence stale and blocks them again until the tests and the review are redone. Deploy commands are never allowed inside a run.

Check the result from your terminal:

```
$ aos status 01JB2Q4X7N5K8M3R6T9V0W1Y2Z
AOS run 01JB2Q4X7N5K8M3R6T9V0W1Y2Z (bounded, feature-delivery@1.0.0), completed. This is its final state; no work remains.
Final stage 3/3: verify. Final gate result: pass.
Stages: design (passed), build (passed), verify (final)
Iterations: 2/20.
```

## Spikes and architectural work

A brief with a spike signal ("spike", "feasibility", "prototype", "throwaway", "is it possible") runs as a spike:

```
/aos:run spike: can we parse the config with a streaming reader?
```

A spike has two stages. In **frame**, Claude writes no files; it states the question and the cheapest probe that answers it, and you approve them with `aos approve`. In **probe**, Claude may write and commit anything. Spike code can never be pushed or opened as a pull request:

```
AOS: push is not allowed in a spike run. Spike code is throwaway by design; start a bounded run to build it for real.
```

A brief that mentions a database schema or schema change, a migration, authentication or authorization, a public API, or a new service classifies as architectural. This release has no architectural tier, so the run is refused with the reason, and Claude asks you how to proceed. Claude will not reword the brief to get a lower tier, and it cannot lower a tier at all. You can do that work outside a run, or split off a piece that is genuinely bounded.

## Daily use

- **One run per piece of work.** Start each with `/aos:run <request>`. If the session already has an active run, the skill continues it instead of starting another.
- **Watch for approval requests.** Claude stops and gives you the exact `aos approve` command. Nothing moves until you run it.
- **Check where things stand** with `aos status` (every run) or `aos status <run>` (one run's stage, gate, and open gaps). Claude uses the `aos_status` tool for the same view.
- **Read block messages.** Every refusal lists what is missing. Claude is told to close those gaps rather than work around them, and so should you.
- **Run tests on their own.** `bun test`, not `bun test | tail`. `cd app && bun test` is fine: `&&` keeps the test's failure.
- **Compaction and resume are safe.** After `/compact` or `claude --resume`, the SessionStart hook re-injects the run's stage, gate, and open gaps.
- **`/clear` and forks start a new, ungated session.** The new session is not bound to the run. Claude says so, does not continue the old run, and asks whether you want to cancel it and start a new run here.
- **Subagents are gated.** Their tool calls carry the parent session, so the same scopes and policies apply to them.
- **A completed run still guards push.** The session stays bound after the run completes, and push and PR create keep checking the verify gate at the current tree. For more work, start a new run.

## Cancel or pause a run

To end a run, run this in your own terminal and type `cancel` when asked:

```bash
aos run cancel 01JB2Q4X7N5K8M3R6T9V0W1Y2Z --reason "superseded by a smaller change"
```

Cancelling records the reason in the run log and unbinds every session bound to the run, so they go back to normal Claude Code behavior. It works even when the run's log is damaged.

There is no pause command in this release. A run waits on disk indefinitely: nothing times out, and the iteration budget is only spent when Claude tries to stop with work left. To pause, stop prompting. To pick the run up later in the same gated session, use `claude --resume`.

## Update

```bash
claude plugin update aos@aos-harness
npm install -g aos-harness@next    # or: bun add -g aos-harness@next
aos doctor
```

## Uninstall

1. Cancel any active runs you no longer want (`aos status` lists them). Without the plugin, nothing enforces them anyway, but cancelling records why they ended.
2. Remove the plugin and its marketplace:

   ```bash
   claude plugin uninstall aos@aos-harness
   claude plugin marketplace remove aos-harness
   ```

   Pass `--scope project` or `--scope local` to the uninstall if you installed at that scope.
3. Remove the CLI: `npm uninstall -g aos-harness` or `bun remove -g aos-harness`.
4. Delete `.aos/` from a project when you no longer want its run history. It holds only AOS's records.

## Next

- [Concepts](concepts.md): runs, tiers, gates, evidence, freshness, the Stop loop, and the run log.
- [CLI reference](cli.md) and [MCP tools](mcp-tools.md).
- [Packs](packs.md): what the reference pack enforces, and how to write your own.
- [Security model](security.md): what AOS defends and what it does not.
- [Troubleshooting](troubleshooting.md).
