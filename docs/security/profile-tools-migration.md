# Profile Tools Migration (0.7.0)

Before 0.7.0 every profile could call `executeCode` (bash/python/node/bun-eval) unconditionally. 0.7.0 introduces a policy: tools default to denied; profiles opt in with a `tools:` block in `profile.yaml`.

## Migrating an existing profile

No migration is required for profiles that do not use `executeCode`. The tools default to enabled for `read_file`, `write_file`, `list_directory`, `grep`, `invoke_skill` — matching pre-0.7.0 behavior.

Profiles that DO use `executeCode` must add:

    tools:
      execute_code:
        enabled: true
        languages: [python, bash]   # subset of: bash, typescript, python, javascript
        max_timeout_ms: 60000        # optional; hard ceiling for per-call timeout

## Narrowing per session

Use `--allow-code-execution=python` (narrow to a subset), `--allow-code-execution=none` (force deny), or `--allow-code-execution` bare (use the profile's full allowlist). The CLI flag can only narrow — never widen — the profile's policy.

## Related

- Spec: `docs/superpowers/specs/2026-04-14-adapter-trust-model-design.md` (D3)
- Findings: `docs/security-scan-report-2026-04-14.md` (RCE-002)
