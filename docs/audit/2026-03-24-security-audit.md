# AOS Harness Security Audit

**Date:** 2026-03-24
**Scope:** runtime/src/, adapters/pi/src/, adapters/claude-code/src/, cli/src/
**Auditor:** Automated security review

---

## Summary

- **2** critical vulnerabilities
- **5** high-risk issues
- **6** medium-risk issues
- **8** low-risk / hardening recommendations

This was the project's initial security audit. Detailed exploit reproductions, CVSS vectors, and exact source locations have been omitted from this published copy; findings are summarized by theme below. The actionable items drove a subsequent hardening pass; a small number of low-severity or inherent items were reviewed and accepted.

---

## Critical (must fix before any deployment)

- **Configuration deserialization.** YAML configuration was parsed without an explicit safe-schema assertion, leaving a theoretical code-execution path if a vulnerable parser version were ever resolved. **Disposition:** parsing pinned to a safe schema with a modern parser version and post-parse validation.
- **Unrestricted file write via the workflow adapter.** The adapter's file-write path was not confined to a project boundary. **Disposition:** filesystem reads/writes are confined to the project root.

## High Risk

- **Environment passthrough to agent subprocesses.** The full parent environment was copied into spawned agents. **Disposition:** spawn with a minimal, allowlisted environment.
- **No subprocess timeout enforcement.** A per-agent timeout existed in config but was not enforced. **Disposition:** the configured timeout is wired into agent execution with a sane default.
- **Identifier / state-key / config-path traversal.** Several identifiers read from YAML or agent-controlled state were used to build filesystem paths without validation. **Disposition:** strict identifier validation and path confinement.
- **Editor-launch argument handling.** The configurable editor binary and its path argument were not constrained. **Disposition:** the editor binary is allowlisted and the path argument is guarded.

## Medium Risk

- **Prompt-injection mitigations.** Brief content was interpolated into prompts without delimiting or size limits. **Disposition:** data/instruction delimiting, length caps, and documented guidance.
- **Session isolation & predictable IDs.** Session directories used predictable IDs and lacked access controls. **Disposition:** cryptographically-random IDs and restrictive permissions.
- **Tamper-evident transcripts.** Transcripts had no integrity protection. **Disposition:** append-only writing plus a hash chain for audit integrity.
- **Symlink handling in the flat-agents directory.** Symlink targets were not validated. **Disposition:** validate targets and use `lstat`-based checks.
- **Resource-exhaustion limits.** No caps on parallel agents, brief size, or response size. **Disposition:** configurable limits enforced before dispatch.
- **Type-safety holes.** `as any` casts in adapter composition reduced auditability. **Disposition:** replaced with proper interface types.

## Low Risk / Hardening

A set of defense-in-depth recommendations were recorded, including: structured audit logging; pre-dispatch budget-headroom checks; sanitizing internal filesystem paths out of error messages; session cleanup / TTL; input-length validation on tool parameters; context-file path validation; applying the safe-YAML pattern uniformly; and documenting TLS expectations for API communication. These were addressed or accepted as low-severity hardening items.

---

## What's Done Well

1. **Subprocess sandboxing flags** — agent subprocesses run with extensions, skills, prompt-templates, and themes disabled, significantly reducing attack surface.
2. **Shell-injection prevention** — all subprocess spawns use argv arrays without a shell; arguments are never concatenated into shell strings.
3. **Immutable domain merging** — domain overlays deep-copy agent configs before merging, preventing accidental mutation of shared state.
4. **Abort-signal support** — graceful SIGTERM followed by SIGKILL after a grace period.
5. **Bias protection** — the delegation router detects and blocks single-agent domination of a deliberation.
6. **Constraint-conflict detection** — structural min/max tensions are surfaced clearly.
7. **Graceful parallel dispatch** — one agent's failure does not crash the round.
8. **Safe template resolution** — only word-character placeholders are matched, preventing arbitrary template expansion.
9. **Config schema validation** — schema versions and required fields are validated across config types.
10. **Transcript persistence on shutdown** — transcripts are saved even during abnormal termination.
