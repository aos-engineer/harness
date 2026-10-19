# AOS Harness: notes for Claude Code sessions

`main` is AOS 1.0 development: a run kernel that lives inside host agents (Claude Code first) through hooks, MCP tools, and skills, and enforces staged gates on observed evidence. The released 0.x line is on `release/0.11` and npm `latest`. Internal planning docs are kept outside this repo: public files (code, comments, tests, docs, commit messages) never reference them.

## Layout

- `kernel/`: `@aos-harness/kernel`. Run log, projection, gates, packs, shell semantics, operations, hook logic. `kernel/src/types.ts` is the shared contract.
- `kernel/src/mcp/`: the MCP server, exported only as `@aos-harness/kernel/mcp`.
- `hosts/claude-code/`: the Claude Code plugin (manifest, hooks, MCP registration, skills) and its entry points in `bin/`.
- `packs/feature-delivery/`: the reference methodology pack. Data only.
- `cli/`: the `aos` CLI (`approve`, `status`, `doctor`, `run cancel`, `mcp`).
- `core/`: 0.x agent, profile, and domain content, kept because the docs site reads it at build time.
- `site/`: the docs site (Astro). Its own package, not a workspace member. `site/bun.lock` is gitignored, so site installs are not pinned.

## Commands

- Install: `bun install`. Inside the Claude Code sandbox: `BUN_TMPDIR="$TMPDIR" BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" bun install`.
- All tests: `bun run test`. One area: `bun test ./kernel/tests/store` (always a `./` path).
- Lint and typecheck: `bun run lint` (the typecheck runs twice: the whole workspace, then `kernel/src` with only Node types).
- The CLI from source: `bun cli/src/index.ts <command>`.
- The plugin, locally: `claude --plugin-dir hosts/claude-code`.

## Rules

- `kernel/src` imports only `node:` built-ins and declared dependencies: no `Bun.*`, no `bun:*`, no `import.meta.dir`. The Pi host loads the kernel in-process under Node, and a test checks that the barrel loads there (Node >= 22.18).
- Relative imports carry `.ts` extensions; type-only imports use `import type`. tsconfig enforces `erasableSyntaxOnly`.
- YAML: js-yaml `load(src, { schema: JSON_SCHEMA })` only. `bun run lint:yaml-safety` checks it.
- Packs are data only: no executable files.
- Tests use `bun:test`, temp dirs from `kernel/tests/helpers.ts`, and no network listeners.
- Never run bare `bun test` at a checkout root: `.worktrees/` may hold other checkouts.
- Dependencies change only in a deliberate commit that also updates the tracked `bun.lock`.
- Hooks are a guardrail, not a security boundary. Never document them as one.
- Writing: no em dashes; comments explain why, not what. Commits follow Conventional Commits.

## Sandbox notes

- Create branches with `git switch --no-track -c`, check `git branch --show-current` before committing, and never pipe git output through `tail`.
- Worktrees live under `.worktrees/` (gitignored). The sandbox blocks writing `site/.vscode/*`, so create them with `git worktree add --no-checkout`, then `git read-tree HEAD`, mark `site/.vscode/*` skip-worktree, and run `git checkout-index -a`.
- Local port binding is blocked, so tests must not listen on ports.

## Deploy

The docs site auto-deploys from `main` through Dokploy. Never deploy from here.
