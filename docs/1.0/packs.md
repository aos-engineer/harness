# Packs

A pack is the methodology AOS enforces: which tiers exist, which stages each tier runs, what each stage may write, what evidence each gate needs, and when commit, push, pull request creation, and deploy are allowed. A pack is data only. It is a `pack.yaml` file plus one markdown instruction file per stage, and nothing in it ever runs. This page is the reference for the format, the rules the loader enforces, and how to write and load a pack of your own. The reference pack, [`packs/feature-delivery`](../../packs/feature-delivery/), is the worked example throughout.

Packs describe a guardrail for a cooperating agent, not a security boundary. [security.md](security.md) lists what AOS does not defend.

## How a run uses its pack

`aos_run_start` loads and validates the pack, then copies the whole resolved pack (every field below, with defaults filled in, plus the text of every stage instruction file and an integrity hash) into the run's first event. The run uses that copy for its whole life: the guard, the observer, gate evaluation, and stage instructions all read it from the run log, not from disk. Editing a pack changes new runs only.

Where the pack comes from depends on who starts the run:

| Started by | Pack |
|---|---|
| The Claude Code plugin's MCP server | `AOS_PACK`, which the plugin's MCP registration sets to the copy of the reference pack inside the plugin |
| `aos mcp` | `--pack <dir>`, else `AOS_PACK`, else the reference pack shipped with the CLI |

`aos doctor` checks the pack the same way: `--pack <dir>`, else `AOS_PACK`, else the CLI's reference pack.

## Layout

```
my-pack/
  pack.yaml
  stages/
    <tier>/
      <stage>.md        one per stage, for every stage of every tier
  README.md             optional; any other data file is allowed
```

Stage instructions live at exactly `stages/<tier>/<stage>.md`. Stage and role names must match `^[A-Za-z0-9][A-Za-z0-9_-]*$`, because stage names become file paths: no separators, no dots.

## The data-only rules

The loader walks every file under the pack directory and refuses the pack if any of these hold:

- **A script file.** Any file ending in `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`, `.sh`, `.bash`, `.zsh`, `.ps1`, `.bat`, `.cmd`, `.py`, or `.rb` (compared without case).
- **An executable file.** Any file with an execute bit set. Filesystems that report every file as executable, such as some mounted Windows or exFAT volumes, fail this check, so keep packs on a filesystem with real permission bits.
- **A symlink or special file.** Symlinks are never followed, and FIFOs, sockets, and devices are listed and rejected without being read.

Hidden files are pack content: stage instructions can point the agent at any file, so a dotfile is checked and hashed like the rest. Only three names are skipped: `.git`, `node_modules`, and `.DS_Store`.

The kernel never executes pack files. These checks keep packs honest about being data.

**Integrity.** The loader hashes every file (by relative path and content) into one `sha256:<hex>` value, and the run records it. Any added, removed, renamed, or edited file changes it; moving the pack directory does not. Line endings in `.yaml` and `.md` files are normalized from CRLF to LF before hashing and parsing, so a Windows checkout pins the same hash as any other.

**YAML.** `pack.yaml` is parsed with the JSON schema of js-yaml: plain data only, no custom tags. Under that schema, `version: 1` is a number and fails validation; write versions as `1.0.0` or quote them.

## pack.yaml reference

The authoritative schema is [`kernel/schema/pack.schema.json`](../../kernel/schema/pack.schema.json). Every object in it is closed: an unknown key is an error, not a silent no-op.

### Top level

All seven keys are required, and no others are allowed.

| Key | Type | Meaning |
|---|---|---|
| `name` | string, at least 1 character | The pack's name, shown in run summaries as `name@version`. |
| `version` | semantic version string | For example `1.0.0` or `1.1.0-rc.1`. |
| `roles` | map of name to list of strings | Commands that play a role, such as `test`. See [Roles](#roles). |
| `classify` | object | Proposes a tier from the brief. See [Classification](#classification). |
| `budget` | object | `iterations`: an integer of at least 1. See [Budget](#budget). |
| `tiers` | object | At least one of `spike`, `bounded`, `architectural`, each with its stages. |
| `actions` | object | Exactly `commit`, `push`, `pr_create`, and `deploy`, each with patterns and per-tier policies. See [Actions](#actions). |

### Tiers and stages

Each tier is `{ stages: [...] }` with at least one stage, run in the order listed.

| Stage field | Required | Default | Meaning |
|---|---|---|---|
| `name` | yes | | The stage name. Unique within its tier. |
| `writes` | yes | | The write scope for file-edit tools: `any`, or a list of path prefixes. See [Write scopes](#write-scopes). |
| `gate` | yes | | What must be true before the agent can advance past this stage. See [Gates](#gates). |
| `bind` | no | `[]` | Skills the stage instructions direct the agent to use, such as `superpowers:brainstorming`. |
| `model` | no | `null` | A model hint: `reasoning`, `fast`, `script`, or `null`. |

`bind` and `model` are informational in this release. The kernel records them with the run but does not act on them. `aos doctor` checks that each bound skill is installed in Claude Code's plugin cache and warns if one is missing; the stage instructions are what actually tell the agent to use a skill or a kind of model.

### Gates

| Gate field | Required | Default | Meaning |
|---|---|---|---|
| `decider` | yes | | `rule`: the gate passes when its requirements hold. `human`: it also needs an approval a person grants with `aos approve`. |
| `tasks` | no | `none` | `all`: every task the agent added in this stage with `aos_task_add` must be completed. |
| `requires` | no | `[]` | Evidence requirements, below. All must hold. |

A human gate evaluates its `tasks` and `requires` too, so a pack can ask for both evidence and an approval. Only a stage whose decider is `human` accepts `aos_request_approval`; on a rule stage the call fails with `invalid: The <stage> gate is decided by rules, not by a human. Call aos_gate_check to see what it needs.`

The verdict is `pass` when nothing is missing, `fail` when any gap is a failure (a failed test run, a rejected review, a denied approval), and `pending` otherwise. [concepts.md](concepts.md) explains gaps, approvals, and the Stop loop in full.

### Requirements

Every requirement names a `kind` and a minimum `provenance`, and can set `fresh`. Each requirement object is closed to the fields listed for its kind.

| Kind | Fields | Satisfied by |
|---|---|---|
| `command` | `role`, `result: exit_zero`, `provenance`, `fresh` | Command evidence for that role. The newest matching run decides: it must have exited 0 and must not be masked (see [Roles](#roles)). |
| `review` | `status: approved`, `provenance`, `fresh` | Review evidence. The newest matching review decides, and its status must be `approved`. A newer `rejected` or `needs-revision` review fails the gate and quotes its feedback. |
| `artifact` | `provenance`, `fresh`, `match` | Artifact evidence. With `match`, the artifact's path must contain the text. |
| `citation` | `provenance`, `fresh`, `match` | Citation evidence. With `match`, the cited path or the note must contain the text. |
| `skill` | `provenance`, `fresh`, `match` | Skill evidence. With `match`, the skill name must contain the text. |

`match` is a plain substring, not a regular expression, and defaults to `null` (any evidence of the kind). `fresh` defaults to `false`.

**Provenance** ranks `claimed` below `observed` below `attested`, and evidence satisfies a requirement when its provenance is at least the one named. Evidence the agent records through `aos_evidence_record` is always `claimed`. Only the hooks record `observed` evidence: command runs that match a role, and skills invoked through Claude Code's Skill tool. Nothing in this release records `attested` evidence, so a requirement for it cannot be met yet. The agent cannot record command evidence at all, so a `command` requirement is met only by test runs the hooks watched.

**Freshness.** With `fresh: true`, only evidence recorded at the current working tree counts; evidence from an earlier tree shows up as a stale gap that says how many file edits happened since. With `fresh: false`, the newest matching evidence counts wherever it was recorded. In a git repository the tree is the git tree hash of the working tree, untracked files included and ignored files and `.aos/` excluded; outside git it falls back to a weak counter of file-tool edits.

### Actions

`actions` declares the four consequential shell actions. All four are required, and their names are fixed.

| Field | Meaning |
|---|---|
| `patterns` | One or more JavaScript regular expressions, matched case-sensitively against each command the shell would run. Anchor them with `^`. |
| `policy` | One policy per tier the pack defines, keyed by tier name. |

| Policy | Meaning |
|---|---|
| `{ allow: always }` | Allowed in this tier. |
| `{ allow: never }` | Refused in this tier. |
| `{ allow: in_stages, stages: [...] }` | Allowed only while the run is in one of the listed stages, and after the run completes. |
| `{ allow: after_gate, gate: <stage> }` | Allowed only when the named stage's gate passes, evaluated at the moment of the command against the current tree. |

`after_gate` is evaluated live every time: an edit after the gate passed makes fresh evidence stale and blocks the action again, and a gate the run has not reached yet never passes. That stays true after the run completes, so a completed bounded run in the reference pack can push only while its test run and review still match the current tree.

When a command line matches more than one action, the highest-priority one decides, in this order: `deploy`, `pr_create`, `push`, `commit`. `git commit -m x && git push` is judged as a push.

In the reference pack, commit and push patterns accept git's global options before the subcommand (such as `-C <dir>` or `-c key=value`), `pr_create` covers creating a pull request with `gh` (in this release, `gh pr create`, `gh pr new`, and `gh api` calls that create a pull request through REST or GraphQL; a `gh api` read of pull requests stays allowed), and `deploy` covers `vercel`, `netlify`, and `fly` deploys, `kubectl apply` and `rollout`, `terraform apply`, `helm install` and `upgrade`, Dokploy deploy scripts, and `gh workflow run`. The exact expressions are in [`pack.yaml`](../../packs/feature-delivery/pack.yaml).

## What the loader checks

The schema catches shape errors. The loader then checks what a schema cannot express, and collects every problem before failing, so you fix them in one pass:

- every stage has its instruction file at `stages/<tier>/<stage>.md`;
- no tier lists the same stage twice;
- every `command` requirement names a role defined in `roles`;
- every action has a policy for every tier the pack defines;
- every `in_stages` and `after_gate` policy names a stage in that same tier;
- every action pattern and classify pattern compiles as a regular expression (classify patterns with the case-insensitive flag they run with);
- `classify.default` names a tier the pack defines.

A classify rule may name a tier the pack does not define. That is deliberate: it is how the reference pack refuses architectural work in this release (see below).

`aos doctor --pack <dir>` prints every issue. For a pack with a stray script, a missing instruction file, a misspelled role, and a policy naming a stage that does not exist:

```
FAIL pack at /path/to/my-pack does not load. Fix: correct the issues below
       setup.sh: packs are data only, and this is a script file
       tiers.bounded.stages[1]: missing instructions file stages/bounded/build.md
       tiers.bounded.stages[1].gate.requires[0].role: role "tests" is not defined in roles
       actions.push.policy.bounded: after_gate "ship" names no stage in tier "bounded"
       actions.pr_create.policy.bounded: after_gate "ship" names no stage in tier "bounded"
```

Schema errors name the field by path, for example `(root): must have required property 'tiers'` or `version: must be string`.

## Classification

`classify.rules` run in order against the run's brief. Each rule's `any` patterns are JavaScript regular expressions matched case-insensitively, and the first rule with a matching pattern wins, so list the riskiest tier first. With no match, `classify.default` applies.

The proposal carries a reason the agent must pass on to the human:

- a rule match: `matched /\bspike\b/ (spike rule)`;
- no match: `no tier rule matched; pack default is bounded`.

In YAML, write patterns in single quotes so backslashes stay literal: `'\bspike\b'`.

The agent can ask for a higher tier than the one proposed, through the `tier` argument of `aos_run_start`; the reason then ends with `; raised to <tier> on request`. It can never ask for a lower one: `Lowering the proposed tier (bounded: no tier rule matched; pack default is bounded) requires a human.` This release has no command for a human to lower a tier.

A proposed or requested tier that the pack does not define refuses the run instead of running it under a weaker tier:

```
refused: The architectural tier is not available in this version of AOS (proposed because matched /\b(database|db|data)\s+schema\b/ (architectural rule)). Ask the human how to proceed.
```

The reference pack defines no architectural tier, so its architectural rule (database schemas and schema changes, migrations, authentication and authorization, public APIs, new services) stops those briefs from starting. Its rules favor strong signals, because a false architectural match blocks work that should run, while a miss still runs bounded with a design approval, tests, and a review.

## Roles

`roles` maps a role name to the commands that play it. A shell command plays a role when one of the simple commands it runs equals a listed command or starts with it followed by a space: with `test: ["bun test"]`, both `bun test` and `bun test ./src` count, while `bunx vitest` does not. Roles are checked in pack order, and the first match wins.

Before matching, AOS reduces the command line to the simple commands that actually run, in normal form: quotes removed, the command word reduced to its basename (so `/usr/local/bin/bun test` reads as `bun test`), single spaces. It sees through environment assignments (`CI=1 bun test`), `cd dir &&`, grouping, `time`, transparent wrappers (`command`, `exec`, `nohup`, `nice`, `sudo`, `timeout`, `env`), and scripts given to shells or `eval`. `xargs` and `watch` are not unwrapped, because they run the command on their own terms.

A role match after the tool call becomes observed command evidence with its exit code. Some runs do not count as a pass:

- **Masked runs.** When something other than the test command could decide the exit status, the run is recorded as masked and does not satisfy the requirement. That is any command line joined with a pipe, `||`, `;`, `&`, or a newline between commands (a trailing `;` or newline is fine), a test command negated with `!`, or one running inside a `$(...)` substitution. `&&` does not mask, because it keeps a failure of either side: `cd app && bun test` counts. The agent is told to re-run the command on its own.
- **Runs with no exit code.** A backgrounded, interrupted, or timed-out run is not recorded, and the agent is told to run it in the foreground.

## Write scopes

`writes` limits where the file-edit tools (Write, Edit, MultiEdit, NotebookEdit) may write during the stage:

| Value | Meaning |
|---|---|
| `any` | Anywhere in the repository except `.aos/`. |
| `["docs/specs/", "notes/"]` | Only under these prefixes, relative to the repository root. |
| `[]` | No file writes at all. |

Each prefix must end in `/`, use forward slashes, and cannot be absolute, start at `.aos/`, or contain an empty, `.`, or `..` segment. A path matches when its root-relative form starts with the prefix; both sides are compared as physical paths, so a symlinked spelling of the same directory cannot slip past.

A few rules hold whatever the scope says:

- `.aos/` is always refused, because AOS's own records live there. Paths are compared folded (Unicode case folding and NFKC), so `.AOS/` is refused too.
- Paths outside the repository root are not checked: they are not AOS's concern.
- Bash is not checked against write scopes. A shell command can still write anywhere; the tree fingerprint sees what it changed, so fresh evidence recorded before the change goes stale.
- Once a run completes, its write scopes no longer apply. The `.aos/` refusal still does.

## Stage instructions

Each `stages/<tier>/<stage>.md` is plain markdown for the agent. `aos_run_start` returns the first stage's instructions, and every `aos_stage_advance` that enters a stage returns that stage's instructions. Write them as direct instructions: what to do, which skills to use, the write scope, and how to finish (`aos_request_approval` for a human gate, `aos_stage_advance` for a rule gate). The reference pack's files in [`packs/feature-delivery/stages`](../../packs/feature-delivery/stages/) follow one structure: what to do, skills, write scope, model, finish.

## Budget

`budget.iterations` caps how many times the Stop hook sends the agent back to work. Each blocked stop charges one iteration. From four fifths of the budget on, the block message shows the count, and once the budget is used, AOS lets the agent stop and lists the open gaps instead. The budget does not block tool calls, and this release has no command to extend it. The reference pack sets 20.

## The reference pack

[`packs/feature-delivery`](../../packs/feature-delivery/) defines two tiers:

| Tier | Stages | Gates |
|---|---|---|
| `spike` | frame, probe | frame is a human gate with no file writes; probe writes anywhere and has a rule gate with no requirements. Commit is always allowed; push, PR create, and deploy never are. |
| `bounded` | design, build, verify | design writes only under `docs/specs/` and needs your approval; build needs every task done and a fresh observed test run; verify needs a fresh observed test run and a fresh approved review. Commit is allowed in build and verify; push and PR create after the verify gate passes; deploy never. |

Its [README](../../packs/feature-delivery/README.md) has the full tables.

## Write your own pack

This pack has a spike tier with one stage and a bounded tier with a plan stage you approve and a build stage gated on `npm test`. It loads as written.

```yaml
# A minimal pack: a spike tier with one stage, a bounded tier with plan and build.
name: small-team
version: 0.1.0

roles:
  test: ["npm test", "npm run test"]

classify:
  rules:
    - tier: architectural
      any: ['\bmigrations?\b']
    - tier: spike
      any: ['\bspike\b', '\bprototype\b']
  default: bounded

budget:
  iterations: 10

tiers:
  spike:
    stages:
      - name: explore
        writes: any
        gate: { decider: rule }
  bounded:
    stages:
      - name: plan
        writes: ["docs/"]
        gate: { decider: human }
      - name: build
        writes: any
        gate:
          decider: rule
          tasks: all
          requires:
            - { kind: command, role: test, result: exit_zero, provenance: observed, fresh: true }

actions:
  commit:
    patterns: ['^git\s+commit\b']
    policy: { spike: { allow: always }, bounded: { allow: in_stages, stages: [build] } }
  push:
    patterns: ['^git\s+push\b']
    policy: { spike: { allow: never }, bounded: { allow: after_gate, gate: build } }
  pr_create:
    patterns: ['^gh\s+pr\s+(create|new)\b']
    policy: { spike: { allow: never }, bounded: { allow: after_gate, gate: build } }
  deploy:
    patterns: ['^vercel\s+deploy\b']
    policy: { spike: { allow: never }, bounded: { allow: never } }
```

With three instruction files:

```
small-team/
  pack.yaml
  stages/
    spike/explore.md
    bounded/plan.md
    bounded/build.md
```

`stages/bounded/plan.md`, for example:

```markdown
# Bounded: plan

Present a short plan in chat: the approach, the files, and the tests. Writes are allowed only under `docs/`.

Call `aos_request_approval` with the plan, then stop and wait for the human.
```

A few things worth copying from the reference pack rather than this sketch: its git patterns accept global options such as `git -C dir push`, which `^git\s+push\b` does not, and its deploy list is broader. A pattern that misses a spelling lets that spelling through, so test yours against the commands your team actually types.

### Validate it

```bash
aos doctor --pack ./small-team
```

A pack that loads reports `OK   pack small-team@0.1.0 loads from /path/to/small-team`. A pack that does not lists every issue, as shown in [What the loader checks](#what-the-loader-checks). Doctor also checks each skill named in `bind`.

### Using a custom pack with the Claude Code plugin

A run records its resolved pack when `aos_run_start` creates it, and the hooks read the pack from the run, never from disk. So the only place a pack is chosen is the MCP server that starts the run, and the plugin's server takes its pack from `AOS_PACK`, which the plugin's `.mcp.json` pins to the bundled copy in `pack/`. An installed plugin therefore always runs the reference pack.

In this release, a custom pack needs a local copy of the plugin:

1. Copy the `hosts/claude-code` directory from a release (or a checkout) to a directory of your own. It is self-contained: `dist/` holds the bundled entry points and `pack/` the reference pack.
2. In the copy's `.mcp.json`, set `AOS_PACK` to your pack's directory, for example `/path/to/small-team`.
3. Validate the pack with `aos doctor --pack /path/to/small-team`.
4. Start Claude Code with the copy: `claude --plugin-dir /path/to/your-plugin-copy`. Uninstall or disable the marketplace copy of `aos` first, so only one `aos` plugin loads.

Runs started in that session record your pack, and every hook enforces it.

Registering `aos mcp --pack <dir>` as a separate MCP server does not work with the plugin. The plugin's hooks bind a session only after the plugin's own `aos_run_start` tool (`mcp__plugin_aos_aos__aos_run_start` in its hook matcher), so a run started through another server leaves the session unbound and ungated. `aos mcp --pack` is for a host that registers the CLI as its MCP server and does its own binding.

Not in this release: selecting a pack for the installed plugin without copying it, pack overlays (extending a base pack with personal or team bindings), `aos pack add`, and a pack lockfile.
