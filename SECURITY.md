# Security policy

## Supported versions

| Version | Status |
|---|---|
| 1.0 prereleases (`aos-harness` 1.0.0-next.N on the npm `next` tag, and the Claude Code plugin from this repository) | Fixes land on `main` and ship in the next prerelease. |
| 0.11.x (`aos-harness@latest`) | Fixes land on the `release/0.11` branch. |
| Older 0.x | Not supported. |

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go to <https://github.com/aos-engineer/harness/security/advisories/new>. Please do not open a public issue for it.

Include the version, what you ran, what happened, and what you expected. A minimal command line or hook payload that reproduces it helps most.

## What counts

AOS's hooks are a guardrail that keeps an agent on a process, not a security boundary: an agent with shell access can reach `.aos/` through processes the hooks never see, and the shell guards read command text. [docs/1.0/security.md](docs/1.0/security.md) lists what AOS defends and what it does not.

Within that model, these are vulnerabilities we want to hear about:

- AOS itself writing outside the project's `.aos/` directory, or following a link out of it. The expected exceptions come from the tree fingerprint: a temporary copy of the git index under the OS temp directory, removed after use, and the blob and tree objects `git add` and `git write-tree` store in `.git`.
- A credential in a format the redaction list names reaching a command's recorded output tail unmasked. Redaction applies only to command evidence; briefs, summaries, review feedback, and notes are stored as the agent gave them.
- `aos approve` or `aos run cancel` succeeding from an agent's shell without the agent clearing Claude Code's environment and allocating a terminal.
- The MCP server or the hooks accepting input that makes them read or write paths they should not.
- Anything in the published npm package or plugin bundle that differs from the source in this repository.

A way to get a command past a shell guard is worth reporting too, as a regular issue: the guards are best-effort and we extend them as we learn new spellings.
