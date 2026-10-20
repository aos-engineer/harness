# Contributing to AOS

This repository holds AOS 1.0, a run kernel that lives inside coding agents (Claude Code first) through hooks, MCP tools, and skills, and holds an agent's work to staged gates that pass only on observed evidence. `main` is 1.0 development. The released 0.x line lives on the [`release/0.11`](https://github.com/aos-engineer/harness/tree/release/0.11) branch and npm `latest`; 0.11.x fixes go there, not to `main`.

This guide covers setting up, testing, and getting a change merged. For how the pieces fit together, read [docs/1.0/architecture.md](docs/1.0/architecture.md) first.

## Setup

You need:

- [Bun](https://bun.sh) 1.3.11 or later. CI uses 1.4.0.
- Node 22.18 or later, for the test that loads the kernel under Node. CI uses Node 24.
- git.
- Claude Code, to run the plugin against a real session.

```bash
git clone https://github.com/aos-engineer/harness.git
cd harness
bun install
```

Inside the Claude Code sandbox, point Bun's temp and cache directories somewhere writable:

```bash
BUN_TMPDIR="$TMPDIR" BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" bun install
```

## Layout

| Path | What it holds |
|---|---|
| `kernel/` | `@aos-harness/kernel`: the run log, projection, gates, packs, shell semantics, operations, and hook logic. `kernel/src/types.ts` is the shared contract. |
| `kernel/src/mcp/` | The MCP server, exported only as `@aos-harness/kernel/mcp`. |
| `hosts/claude-code/` | The Claude Code plugin: manifest, hooks, MCP registration, the `/aos:run` skill, and its entry points in `bin/`. `dist/` and `pack/` are built from source and committed. |
| `packs/feature-delivery/` | The reference methodology pack. Data only. |
| `cli/` | The `aos` CLI: `approve`, `status`, `doctor`, `run cancel`, `mcp`. |
| `tests/e2e/` | Bounded and spike runs driven through the real MCP server and hook command. |
| `scripts/` | The plugin build, the YAML safety lint, the hook benchmark, and the release scripts. |
| `core/` | 0.x agent, profile, and domain content, kept because the docs site reads it at build time. |
| `site/` | The docs site (Astro). Its own package, not a workspace member. |

## Tests

```bash
bun run test                       # every suite: kernel, hosts, cli, tests
bun test ./kernel/tests/store      # one area: always a ./ path
```

Never run a bare `bun test` at a checkout root. Worktrees live under `.worktrees/`, and Bun would pick up the tests of every other checkout in there too.

Test rules:

- Use `bun:test`.
- Create temp directories and git repositories with the helpers in `kernel/tests/helpers.ts`. They resolve real paths and keep your own git configuration out of the result.
- Do not open network listeners or bind ports. The sandbox blocks local port binding, and nothing in AOS needs one.
- The end-to-end suite in `tests/e2e/` runs a bounded and a spike run against a scratch repository, with MCP calls going to the real server and every hook running the plugin's real entry point as a child process.
- `kernel/tests/golden/` replays sanitized logs of those runs and checks that every recorded gate verdict comes out the same. A change that alters a verdict fails there, so make it deliberately and regenerate the logs with `AOS_GOLDEN_WRITE=1 bun test ./tests/e2e`.

## Lint and typecheck

```bash
bun run lint
```

This runs the YAML safety check (`bun run lint:yaml-safety`), then the typecheck twice: once for the whole workspace, and once for `kernel/src` with only Node's types, which catches a Bun API creeping into the kernel.

## Kernel rules

A host can load the kernel in-process under Node (the Pi host will, in a later release), and a test checks that the kernel barrel loads there. So in `kernel/src`:

- Import only `node:` built-ins and declared dependencies. No `Bun.*`, no `bun:*` modules, no `import.meta.dir`.
- Give relative imports a `.ts` extension, and use `import type` for type-only imports. The tsconfig enforces `erasableSyntaxOnly`, so no enums, namespaces, or parameter properties.
- Parse YAML only with js-yaml `load(src, { schema: JSON_SCHEMA })`. The YAML safety lint flags any load call without a safe schema.

The MCP server and the hooks act for the agent, so they must never import the human operations in `kernel/src/ops/human.ts`. A test reads their sources and fails if they do.

## Packs

Packs are data only: `pack.yaml` plus markdown instructions. The loader rejects script files, executable files, and symlinks, and so should review. See [docs/1.0/packs.md](docs/1.0/packs.md) for the format.

## The Claude Code plugin

A marketplace install copies only `hosts/claude-code` into Claude Code's cache, so the plugin cannot reach this workspace's `node_modules` or `packs/`. `bun run build:plugin` bundles the hook and MCP entry points into `hosts/claude-code/dist` and copies the reference pack into `hosts/claude-code/pack`. Both are committed, because the marketplace installs straight from git.

After changing anything the plugin bundles (the kernel, `hosts/claude-code/bin` or `src`, or the reference pack), rebuild and commit the output in the same change:

```bash
bun run build:plugin
```

CI runs `bun run build:plugin:check`, which fails when the committed files differ from a fresh build.

To run the plugin against a real session:

```bash
claude --plugin-dir hosts/claude-code               # runs the committed bundles in dist/
AOS_PLUGIN_SOURCE=1 claude --plugin-dir hosts/claude-code   # runs bin/*.ts from source instead
bun cli/src/index.ts <command>                      # the CLI from source
```

`AOS_PLUGIN_SOURCE=1` works only in a full checkout, where the sources can resolve the workspace packages.

### After a Claude Code upgrade

The host's contract tests run against captured hook payloads. Re-capture them after a Claude Code version bump, because a changed payload shape breaks the plugin without failing a test that still uses the old fixtures. [hosts/claude-code/tools/README.md](hosts/claude-code/tools/README.md) walks through a capture session and sanitizing the result. Setting `AOS_HOOK_CAPTURE_DIR` also makes the real hook entry point save every payload it receives to that directory, without changing its decision.

### Hook latency

Claude Code runs the hook entry point as a new process before and after every tool call, so its time adds to every tool call. Measure it with:

```bash
bun run scripts/bench-hook.ts
```

The target is a p95 under 100 ms per hook. The script reports p50, p95, and max per scenario and always exits 0.

## Dependencies

Dependencies change only in a deliberate commit that also updates the tracked `bun.lock`. Do not let a dependency change ride along with an unrelated fix. `site/` is its own package and not a workspace member, so its installs are not pinned by the root lockfile.

## Conventions

- **Commits** follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope][!]: <description>`, with types `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Write the description in the imperative, and explain the why in the body when it is not obvious. Breaking changes use `!` or a `BREAKING CHANGE:` footer.
- **No em dashes** in code, comments, docs, or commit messages.
- **Comments explain why, not what.** The code says what it does; a comment earns its place by saying why it does it that way.
- **Hooks are a guardrail, not a security boundary.** Never describe them as one in code, docs, or commit messages. [docs/1.0/security.md](docs/1.0/security.md) says what AOS does and does not defend.

## Pull requests

`main` is protected: every change lands through a pull request, and CI (lint, tests, and the plugin bundle check) must pass.

1. Branch from `main`.
2. Make the change, with tests for the behavior it adds or fixes.
3. Run `bun run lint` and `bun run test`, and `bun run build:plugin:check` if you touched anything the plugin bundles.
4. Open a PR against `main` that states the problem, the approach, the tradeoffs you weighed, and how you verified it.

## Public files stand on their own

This repository is public. Code, comments, tests, docs, and commit messages must make sense to someone who has only this repository: never reference planning documents, notes, or trackers kept outside it. If a decision matters, write the reasoning where the code is.

## Reporting a vulnerability

Do not open a public issue. Follow [docs/1.0/security.md](docs/1.0/security.md), which uses GitHub's private vulnerability reporting.

## Documentation

- [docs/README.md](docs/README.md): the index of everything under `docs/`.
- [Getting started](docs/1.0/getting-started.md)
- [Concepts](docs/1.0/concepts.md)
- [CLI reference](docs/1.0/cli.md)
- [MCP tools](docs/1.0/mcp-tools.md)
- [Packs](docs/1.0/packs.md)
- [Security model](docs/1.0/security.md)
- [Troubleshooting](docs/1.0/troubleshooting.md)
- [Architecture](docs/1.0/architecture.md)
- [Releasing](docs/1.0/releasing.md)
