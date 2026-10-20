# Capturing Claude Code hook payloads

The host contract tests in `../tests` run against hook payload fixtures. A fixture tagged `"_source": "docs"` was shaped from the Claude Code docs; one tagged `"_source": "captured"` came from a real session through the two tools here. Re-capture after every Claude Code version bump, because a changed payload shape breaks the plugin without failing any test that still uses the old fixtures.

- `capture-plugin/` is a plugin named `aos-capture`. Every hook it registers saves the raw payload to `$AOS_CAPTURE_DIR` and exits 0, so it never changes what the session does.
- `sanitize-fixture.ts` turns those payloads into fixtures safe to commit to a public repo.

## 1. Run a capture session

Use a scratch repo, never a real project: the payloads record commands, file contents, and paths.

```bash
export AOS_CAPTURE_DIR="$(mktemp -d)"
scratch="$(mktemp -d)" && cd "$scratch" && git init -q
printf 'one\n' > a && printf 'two\n' > b
printf 'import { test, expect } from "bun:test";\ntest("adds", () => expect(1 + 1).toBe(3));\n' > fail.test.ts
claude --plugin-dir /path/to/harness/hosts/claude-code/tools/capture-plugin
```

Send one prompt per turn:

1. Run `true`.
2. Run `exit 3`.
3. Run `bun test`. (It fails on purpose.)
4. Run `sleep 2; false` in the background. (Shows what PostToolUse carries before a backgrounded command finishes.)
5. Create a.txt with hello.
6. Edit a.txt to say bye.
7. Run `grep zzz a.txt`. (A non-zero exit the Bash tool reports as a normal result.)
8. Run `test -f missing`.
9. Run `diff a b`.
10. Use MultiEdit on a.txt if that tool exists.
11. Create n.ipynb and edit a cell with NotebookEdit.
12. Invoke the superpowers:brainstorming skill, then stop.
13. Spawn a subagent that runs `true`. (Check its first message for any SubagentStart context.)
14. `/compact`
15. Exit, then `claude --resume` the session once.

To capture an MCP tool payload as well, load the aos plugin alongside with a second `--plugin-dir /path/to/harness/hosts/claude-code` and add a prompt that starts an aos run.

## 2. Sanitize

From the repo root:

```bash
bun hosts/claude-code/tools/sanitize-fixture.ts "$AOS_CAPTURE_DIR" "$TMPDIR/aos-fixtures" \
  --repo "$scratch" --also "Your Name" --also you@example.com
```

It replaces your home path with `/home/user`, the scratch repo with `/repo`, session, prompt, agent, and tool-use ids with stable placeholders, and each `--also` value with `REDACTED-<n>`. It writes nothing if your home path, the repo path, your username, or an `--also` value is still present in any payload, ignoring case.

## 3. Review and replace

Read every output file before committing it. Rename each one from `<event>-<tool or source>-<n>.json` to a case name, for example `post-tool-use-failure-bash-exit3.json`, replace the matching docs fixture in `../tests/fixtures/`, and run `bun test ./hosts/claude-code/tests`.
