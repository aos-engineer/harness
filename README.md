# AOS Harness

> **`main` is AOS 1.0 development.** 1.0 prereleases publish on the npm `next` tag. The released 0.x line (npm `latest`) lives on the `release/0.11` branch and tag `v0.11.0`.

[![CI](https://github.com/aos-engineer/harness/actions/workflows/ci.yml/badge.svg)](https://github.com/aos-engineer/harness/actions/workflows/ci.yml)

## AOS 1.0 on `main`

AOS 1.0 runs inside the coding agent you already use. A run splits one piece of work into stages (for a bounded change: design, build, verify), and each stage ends at a gate that passes only on evidence: test runs AOS observed itself, reviews the agent records, and approvals only a person can give from their own terminal. Push and pull request creation wait for the last gate, and deploys are never allowed inside a run. Every run is an append-only, hash-chained log under `.aos/runs/`, so edits to it are detectable and its gate verdicts can be re-derived from the log.

Claude Code is the first host, and 1.0 is in prerelease. AOS is a guardrail for a cooperating agent, not a security boundary; [the security model](docs/1.0/security.md) says what it does not defend.

### Install

You need Claude Code 2.1.295 or later, [Bun](https://bun.sh) 1.3.11 or later on `PATH`, and git. Install the plugin in Claude Code:

```
/plugin install aos --marketplace aos-engineer/harness
```

Then install the CLI, which is how you approve gates and check runs:

```bash
npm install -g aos-harness@next    # or: bun add -g aos-harness@next
```

Start a run with `/aos:run <your request>`. [Getting started](docs/1.0/getting-started.md) walks through a first run, the two-step plugin install, pinning a release, and uninstalling.

### Documentation

- [Getting started](docs/1.0/getting-started.md), [concepts](docs/1.0/concepts.md), and [troubleshooting](docs/1.0/troubleshooting.md)
- Reference: [CLI](docs/1.0/cli.md), [MCP tools](docs/1.0/mcp-tools.md), [packs](docs/1.0/packs.md), and the [security model](docs/1.0/security.md)
- For contributors: [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/1.0/architecture.md), and [releasing](docs/1.0/releasing.md)
- [The docs index](docs/README.md), which also explains the 0.x material under `docs/`

### Repository layout

```
kernel/                  @aos-harness/kernel: run log, projection, gates, packs, shell semantics, hook logic
  src/mcp/               the MCP server, exported as @aos-harness/kernel/mcp
hosts/claude-code/       the Claude Code plugin: manifest, hooks, MCP registration, the /aos:run skill
packs/feature-delivery/  the reference methodology pack (data only)
cli/                     the aos CLI: approve, status, doctor, run cancel, mcp
tests/e2e/               bounded and spike runs driven through the MCP tools and the real hook command
core/                    0.x agent, profile, and domain content, still read by the docs site
site/                    the docs site (Astro)
```

### Development

```bash
bun install
bun run test                    # every test suite
bun run lint                    # YAML safety check and typecheck
bun run scripts/bench-hook.ts   # hook latency benchmark
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the full setup, the rules tests and kernel code follow, and the pull request flow.

---

## AOS 0.x

> Everything below documents the 0.x line published on npm as `aos-harness@latest`. Its source, including `runtime/`, `adapters/`, and `plugins/aos-harness/`, is on the [`release/0.11`](https://github.com/aos-engineer/harness/tree/release/0.11) branch.

**Agentic Orchestration System.** Assemble specialized AI agents into deliberation and execution teams.

## What It Is

AOS Harness is a language-agnostic orchestration system for multi-agent AI workflows. It supports two orchestration patterns:

- **Deliberation** — Agents debate a strategic question, the Arbiter synthesizes ranked recommendations with documented dissent. Output: structured memo.
- **Execution** — A CTO/CIO/CEO orchestrator delegates production work to agents who produce architecture, task breakdowns, security reviews, and implementation plans. Output: execution package.

The harness ships with:

- 15 agent personas with distinct cognitive biases and reasoning frameworks
- 9 orchestration profiles, including strategic-council, cto-execution, security-review, delivery-ops, architecture-review, incident-response, dev-execution, design-variations, and paperclip-worker (the Paperclip control-plane seam)
- 5 domain packs (SaaS, healthcare, fintech, platform-engineering, personal-decisions)
- 6 skill definitions (code-review, security-scan, task-decomposition, mempalace-read-write, mempalace-admin, graphify-query)
- Platform adapters for Pi CLI, Claude Code, Codex, Gemini, and other compatible runtimes

---

## Quick Start

> **0.6.0 migration note:** adapters are no longer bundled with the CLI. Install the adapter(s) for the AI CLI(s) you want to drive. See [CHANGELOG](./CHANGELOG.md#060).

### Prerequisites

- [Bun](https://bun.sh) 1.0+

### Install the CLI

Global install:

```bash
bun add -g aos-harness
# or: npm i -g aos-harness
```

Project-local install:

```bash
bun add aos-harness
# or: npm install aos-harness
```

### Install at least one adapter

Before you do this, make sure you already have the matching vendor CLI installed and authenticated. AOS adapters augment the CLI you already use:

- `claude` CLI + `@aos-harness/claude-code-adapter`
- `codex` CLI + `@aos-harness/codex-adapter`
- `gemini` CLI + `@aos-harness/gemini-adapter`
- `pi` CLI + `@aos-harness/pi-adapter`

Adapters ship as separate packages. Pin to the same version as the CLI (they publish lockstep):

```bash
bun add -g @aos-harness/claude-code-adapter   # Anthropic's Claude Code
bun add -g @aos-harness/gemini-adapter         # Google's Gemini CLI
bun add -g @aos-harness/codex-adapter          # OpenAI's Codex CLI
bun add -g @aos-harness/pi-adapter             # Pi (https://pi.dev)
```

Project-local adapter install:

```bash
bun add @aos-harness/codex-adapter
# or: npm install @aos-harness/codex-adapter
```

### Optional host-native installs

Adapters remain the runtime boundary. This repo also ships thin host-native install surfaces on top:

- `Codex`: [plugins/aos-harness](https://github.com/aos-engineer/harness/tree/release/0.11/plugins/aos-harness) local plugin bundle, on the `release/0.11` branch
- `Claude Code`: [plugins/aos-harness/claude-code](https://github.com/aos-engineer/harness/tree/release/0.11/plugins/aos-harness/claude-code) project command pack, on the `release/0.11` branch
- `Pi`: `aos init --adapter pi` writes `.pi/extensions/aos-harness.ts` so `/aos-run` is available when you open `pi` in that project

For Pi across all AOS projects, install the global shim once:

```bash
aos setup-pi --global
```

### Initialize a project

```bash
cd your-project
aos init
# local install: bunx aos init
# local install with npm: npx aos init
```

Release line:

- Current repo version: `0.10.0`
- npm latest is published separately via the tag-driven release workflow
- Site image tag: `novashock/aos-harness-site:0.10.0`

`aos init` prints the adapter install commands at the end as a reminder.
It also scans vendor CLI readiness, writes v2 `.aos/config.yaml`, creates a project-local Pi extension shim when Pi is enabled, and supports:

```bash
aos init --apply                 # install missing adapter packages
aos init --non-interactive       # scan only, write .aos/scan.json
aos init --non-interactive --adapter codex
```

The generated Pi shim imports `@aos-harness/pi-adapter` and is ignored via `.gitignore`. Re-run `aos init --adapter pi` to regenerate the project shim.

Model selection rules:

- `pi` keeps explicit tier models in config by default.
- `codex`, `claude-code`, and `gemini` now default to the vendor CLI's default model unless you pin tier models explicitly.
- Adapter-scoped runtime settings live under `.aos/config.yaml` `adapter_defaults`.
- Legacy `.aos/adapter.yaml` still works for adapter-specific overrides.
- Existing v2 configs are backfilled automatically on `aos run` if `adapter_defaults` is missing.

### Run a deliberation

```bash
aos run strategic-council --brief core/briefs/sample-product-decision/brief.md
```

### Run an execution profile

```bash
aos run cto-execution --brief core/briefs/sample-cto-execution/brief.md
```

### Author a brief

If you do not know the brief format, scaffold one interactively:

```bash
aos create brief
aos create brief my-decision --kind deliberation --idea "We need to decide between X and Y by Q3."
```

Or use the `/aos-create-brief` skill inside Claude Code, Codex, or Gemini. The host agent will conduct the conversation and validate the result through `aos brief save`.

```bash
aos brief validate ./briefs/my-decision/brief.md
aos run strategic-council --brief ./briefs/my-decision/brief.md
```

### CLI commands

```bash
aos init                          # Initialize AOS in the current project
aos setup-pi --global             # Make /aos-run available in Pi globally
aos run [profile]                 # Run a deliberation or execution session
aos run cto-execution --brief ... # Run the CTO execution workflow
aos create brief [slug]           # Author a deliberation or execution brief
aos brief validate <path>         # Validate a brief shape
aos create agent <name>           # Scaffold a new agent
aos create profile <name>         # Scaffold a new profile
aos create domain <name>          # Scaffold a new domain
aos create skill <name>           # Scaffold a new skill
aos validate                      # Validate all configs
aos list                          # List all agents, profiles, domains, skills
aos replay <transcript.jsonl>     # Replay a session transcript
```

**Requirements:** [Bun](https://bun.sh) (v1.0+), plus at least one supported vendor CLI already installed.

---

## Orchestration Patterns

### Deliberation (strategic-council)

Submit a brief with a strategic question. 11 agents debate under time and budget constraints. The Arbiter synthesizes a memo with ranked recommendations, agent stances, dissent, and next actions.

```
Brief → Arbiter frames question → Agents debate (broadcast + targeted rounds)
→ Provocateur stress-tests (speaks last) → Arbiter synthesizes → Memo output
```

### Execution (cto-execution)

Submit a feature request. The CTO orchestrator drives an 8-step workflow with 3 review gates, producing a complete execution package.

```
Brief → Requirements (Advocate + Strategist) → Architecture (Architect)
→ Architecture Review (Architect vs Operator) → Phase Planning (Strategist + Operator)
→ Task Breakdown (Operator) → Security Review (Sentinel)
→ Stress Test (Provocateur) → Final Assembly → Execution Package output
```

---

## Agent Roster

| Agent | Category | Role | Core Bias |
|---|---|---|---|
| **Arbiter** | Orchestrator | Session chair, synthesis | Neutral facilitation |
| **CTO Orchestrator** | Orchestrator | Execution leader | Execution quality |
| **Catalyst** | Perspective | Acceleration, monetization | Speed |
| **Sentinel** | Perspective | Protection, sustainability | Trust |
| **Architect** | Perspective | Systems design, feasibility | System durability |
| **Provocateur** | Perspective | Stress-testing (speaks last) | Truth-seeking |
| **Navigator** | Perspective | Market positioning, timing | Positioning |
| **Advocate** | Perspective | User voice, behavior reality | User behavior |
| **Pathfinder** | Perspective | 10x thinking, asymmetric bets | Asymmetric upside |
| **Strategist** | Perspective | Problem selection, sequencing | Impact per effort |
| **Operator** | Operational | Execution reality, capacity | Execution |
| **Steward** | Operational | Ethics, compliance, governance | Compliance |
| **Auditor** | Operational | Retrospective, institutional memory | Learning |
| **Engineering Lead** | Operational | Domain-scoped implementation orchestration | Delivery throughput |
| **Artifact Renderer** | Perspective | Output shaping, packaging, presentation quality | Communication fidelity |

---

## Architecture

The 0.x engine (`runtime/`), its adapters (`adapters/pi`, `claude-code`, `codex`, `gemini`), and the 0.x CLI are on the [`release/0.11`](https://github.com/aos-engineer/harness/tree/release/0.11) branch. Its agent, profile, domain, and skill content is still in `core/` on `main`. For the 1.0 layout, see [Repository layout](#repository-layout).

### 4-Layer Adapter Contract

| Layer | Purpose | Methods |
|---|---|---|
| L1: Agent Runtime | Agent lifecycle | spawnAgent, sendMessage, destroyAgent |
| L2: Event Bus | Hooks and interception | onSessionStart, onToolCall, onMessageEnd |
| L3: User Interface | Rendering and interaction | registerCommand, renderAgentResponse, promptConfirm |
| L4: Workflow Engine | Process orchestration | dispatchParallel, executeCode, invokeSkill, createArtifact |

---

## Enhanced Capabilities

AOS Harness includes advanced features for production orchestration:

| Capability | Description | Guide |
|---|---|---|
| [Dev Execution](docs/dev-execution/README.md) | Brief to working code in one session | Planning + hierarchical implementation |
| [Domain Enforcement](docs/domain-enforcement/README.md) | Structural file/tool permission boundaries per agent | Path matching, tool allowlists, bash restrictions |
| [Hierarchical Delegation](docs/hierarchical-delegation/README.md) | Agents spawn and manage sub-agents in Lead→Worker chains | Depth limits, domain inheritance |
| [Memory System](docs/persistent-expertise/README.md) | Pluggable memory: MemPalace, Graphify knowledge-graph, and built-in expertise | Orchestrator-gated recall, session curation, MCP integration |
| [Event Summarization](docs/event-summarization/README.md) | Template summaries plus LLM-needed classification | Platform LLM batching is planned |
| [Session Checkpointing](docs/session-resumption/README.md) | Pause checkpoints with conversation tails | Full automatic resume is planned |

---

## Platform (Enterprise Tier)

The harness is fully functional standalone — every session writes a local JSONL transcript you can replay with `aos replay`. For teams that want live, multi-session observability, AOS also streams session events to an optional **hosted Platform** (a separate commercial offering). The open-source harness in this repository is complete on its own and never requires it.

When a platform endpoint is configured, each adapter batches transcript events to it in real time, providing:

- **Live observability dashboard** — watch deliberations and executions stream in as they happen, across every session.
- **Session timeline & history** — a searchable record of agent stances, dissent, costs, and artifacts.
- **Team management** — shared projects, roles, and access control.
- **Analytics** — spend, round counts, and outcome tracking across runs.

Connect the open-source harness to a platform with a URL and an ingest token:

```bash
export AOS_PLATFORM_TOKEN=...            # issued by your platform
aos run strategic-council \
  --brief ./briefs/my-decision/brief.md \
  --platform-url https://platform.example.com
```

Adapters advertise `transcript_streaming: "local+platform"`: events always land in the local transcript, and additionally stream to the platform when `--platform-url` (or `AOS_PLATFORM_URL`) is set. No platform, no problem — the harness runs identically without one.

---

## Documentation

- **Specs:** `docs/specs/2026-03-23-aos-harness-design.md` (core framework)
- **Execution Profiles:** `docs/specs/2026-03-24-aos-execution-profiles/` (4-document spec suite)
- **Getting Started:** `docs/getting-started/README.md`
- **Creating Agents:** `docs/creating-agents/README.md`
- **Creating Profiles:** `docs/creating-profiles/README.md`
- **Creating Workflows:** `docs/creating-workflows/README.md`
- **Creating Skills:** `docs/creating-skills/README.md`
- **Domain Enforcement:** `docs/domain-enforcement/README.md`
- **Hierarchical Delegation:** `docs/hierarchical-delegation/README.md`
- **Memory System:** `docs/persistent-expertise/README.md`
- **Event Summarization:** `docs/event-summarization/README.md`
- **Session Checkpointing:** `docs/session-resumption/README.md`
- **Release Readiness:** `docs/testing/release-readiness-checklist.md`

---

## License

MIT
