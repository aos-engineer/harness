# Documentation

The AOS 1.0 documentation lives in [`docs/1.0/`](1.0/). AOS 1.0 is in prerelease: the CLI is published to npm under the `next` tag from 1.0.0-next.0 on (until then `next` still names an old 0.x release candidate), and the Claude Code plugin installs from this repository's marketplace.

## Using AOS

| Page | What it covers |
|---|---|
| [Getting started](1.0/getting-started.md) | Requirements, installing the plugin and the CLI, a first run from brief to push, daily use, cancelling, and uninstalling. |
| [Concepts](1.0/concepts.md) | Runs, tiers, stages, gates, evidence and provenance, freshness, approvals, the Stop loop, the iteration budget, sessions and binding, and the run log. |
| [CLI reference](1.0/cli.md) | Every `aos` command, flag, and exit code. |
| [MCP tools](1.0/mcp-tools.md) | The eight tools the agent uses, their inputs, results, and errors. |
| [Packs](1.0/packs.md) | The pack format, the data-only rules, classification, actions, roles, write scopes, and writing your own pack. |
| [Security model](1.0/security.md) | What AOS enforces, how it fails, what it does not defend, and how to report a vulnerability. |
| [Troubleshooting](1.0/troubleshooting.md) | `aos doctor`, the hook error log, block messages, Bun missing, and unbound sessions. |

## Building AOS

| Page | What it covers |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Setup, tests, lint, building the plugin, conventions, and the pull request flow. |
| [Architecture](1.0/architecture.md) | Modules and their boundaries, the path from hook payload to decision, the event log, gates, the MCP server, the CLI, and packaging. |
| [Releasing](1.0/releasing.md) | The maintainer runbook: versions, the release workflow, verification, and rollback. |

Component READMEs: the [Claude Code plugin](../hosts/claude-code/README.md), the [CLI](../cli/README.md), and the [reference pack](../packs/feature-delivery/README.md).

## The 0.x line

Every other folder and file under `docs/` describes the 0.x line (`aos-harness@latest` on npm) and is kept here for reference. None of it applies to 1.0. The current 0.x docs are on the [`release/0.11`](https://github.com/aos-engineer/harness/tree/release/0.11/docs) branch.
