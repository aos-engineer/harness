# feature-delivery

The reference methodology pack for AOS. It turns "build this feature" into staged work with gates: the agent cannot push, open a pull request, or deploy until the evidence the pack asks for exists.

The pack is data only. `pack.yaml` declares tiers, stages, gates, write scopes, and action policies, and `stages/<tier>/<stage>.md` holds the instructions the agent sees in each stage. Nothing in a pack runs code, and the loader rejects script files, executable files, and symlinks. Hidden files are pack content too; only `.git`, `node_modules`, and `.DS_Store` are left out. Filesystems that report every file as executable, such as some mounted Windows or exFAT volumes, fail the executable check, so keep packs on a filesystem with real permission bits. The full format is the JSON Schema in `kernel/schema/pack.schema.json`.

These rules are guardrails for a cooperating agent, not a security boundary.

## What it enforces

A run starts in a tier. The `classify` rules propose one from the brief, and a person can raise it.

| Tier | Stages | Gates | Human approvals |
|---|---|---|---|
| `spike` | frame, probe | The human approves the question and the probe before any file is written. Spike code can be committed, but never pushed or opened as a pull request. | 1 |
| `bounded` | design, build, verify | The human approves a short design. Build passes on an observed test run at the current tree with every task done. Verify adds an approved code review recorded after the last edit. | 1 |

Briefs that mention a database schema or schema change, a migration, authentication or authorization (OAuth, Auth0, SSO), a public API, or a new service classify as `architectural`. This version of the pack defines no architectural tier, so a run cannot start under it. Briefs that match no rule are `bounded`. The rules favor strong signals ("schema docs" and "the auth helper" stay bounded): a false architectural match stops work that should run, while a miss still gets a design approval, tests, and a review.

| Stage | Writes | Bound skills | Model hint |
|---|---|---|---|
| spike/frame | none | superpowers:brainstorming | reasoning |
| spike/probe | anywhere except `.aos/` | none | fast |
| bounded/design | `docs/specs/` only | superpowers:brainstorming | reasoning |
| bounded/build | anywhere except `.aos/` | superpowers:test-driven-development | fast |
| bounded/verify | anywhere except `.aos/` | superpowers:verification-before-completion, superpowers:requesting-code-review | reasoning |

| Action | spike | bounded |
|---|---|---|
| commit | always | in build and verify |
| push | never | after the verify gate passes |
| PR create | never | after the verify gate passes |
| deploy | never | never |

## The fields

- **`writes`** is a stage's write scope for file-edit tools: `any` (anywhere except `.aos/`), or a list of path prefixes that end in `/`. An empty list allows no file writes. Shell commands are not scope-checked; the tree fingerprint still sees what they change, so evidence recorded before such a change goes stale.
- **`actions`** names the consequential shell commands (commit, push, PR create, deploy) with regular expressions, and gives each tier a policy: `always`, `never`, `in_stages` (only in the listed stages), or `after_gate` (only once the named stage's gate has passed). Every action needs a policy for every tier the pack defines.
- **`roles`** maps a role name to the commands that play it. A gate asks for "an observed `test` run that exited zero", and any listed test command counts. The command has to run by itself: a pipe, `|| true`, or a chained command masks the exit status, and a masked run does not count as a pass.
- **`classify`** rules run in order, matched case-insensitively against the brief. The first match wins.
- **`budget.iterations`** limits blocked stops: each time the agent tries to stop with a gate still open and AOS sends it back to work, that is one iteration. Once the budget is spent, AOS lets the agent stop. Stage retries are not charged in this release.

Keywords, roles, deploy patterns, and the budget are starting values. They will be tuned from real runs, not measured thresholds yet.

## Personal and team skills

This pack binds only public skills from the superpowers plugin, so it works for anyone. Personal or team bindings, such as your own review or security skills, belong in an overlay pack that extends this one, not in this pack. Overlays are not supported yet.
