# Security Scan Report — aos-harness

**Date:** 2026-04-14
**Scanner Version:** appsec-scanner v1.0 (scoped pass)
**Project:** Bun/TypeScript monorepo — CLI + adapters + npm publish pipeline
**Scope:** `cli/`, `adapters/`, `scripts/`, workspace `package.json` files, `.github/workflows/`, `docker-compose.yml`. DAST skipped (no running instance).
**Focus:** adapter loading, publish/lockstep release, secret handling, prompt-injection surfaces.

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 2 |
| Moderate | 4 |
| Low      | 6 |
| Info     | 3 |

**Overall Security Posture:** HIGH

The scan reviewed adapter loading, the publish/release pipeline, secret handling, and prompt-injection surfaces. The most significant findings concerned adapter-loading trust in the local CLI (resolving an adapter named in workspace configuration) and integrity of the publish pipeline. No hardcoded secrets were found, there are no `postinstall` lifecycle hooks, and the bridge uses a Unix domain socket rather than TCP. Actionable findings were addressed in subsequent hardening; a few low-severity items inherent to the local-CLI trust model were reviewed and accepted.

## Findings (summary)

> Detailed exploit reproductions, CVSS vectors, and exact source locations have been omitted from this published copy. Findings are summarized by theme below.

### Adapter loading & code execution (High)
The CLI resolved an adapter name from workspace configuration and could prefer project-local adapter source over the bundled implementation, and a code-execution helper lacked a default access gate. **Disposition:** adapter names are validated against an allowlist and project-local adapter code requires explicit opt-in; code execution is gated behind explicit operator consent. Residual trust in a locally-cloned workspace is inherent to a local developer CLI and is documented.

### Publish / supply-chain integrity (Moderate)
The release pipeline lacked some integrity controls — lint/typecheck gating on the release path, publish provenance, CI-based (rather than developer-machine) publishing, and an AST-based YAML-safety check instead of a grep-based one. **Disposition:** the recommended controls were adopted — lint/typecheck gating, provenance via CI publishing with environment approval, and stricter YAML-safety enforcement.

### Path confinement & URL validation (Low)
A few CLI path inputs and one outbound URL were not confined to the project root or validated against internal addresses. **Disposition:** path-confinement helpers and URL scheme/host validation were added for values sourced from configuration or adapter output.

### Release-script & CI hardening (Low)
Minor robustness items in the publish scripts and a missing CI top-level `permissions` block. **Disposition:** addressed as defense-in-depth.

### Informational
- The adapter session loader already uses an allowlist for dynamic imports — a good pattern, since propagated to the other entry points.
- The bridge server uses a Unix domain socket (no network exposure); a bearer token would be required only if the transport ever moved to TCP.
- NPM token handling is clean — never read, logged, or printed.
- All published packages declare a `files:` whitelist; the root package is private.

## Positive Security Controls Observed

- Allowlist gating for dynamic adapter imports.
- Filesystem operations confined to the project root in the base workflow.
- Bridge server uses a Unix domain socket (not TCP) — no network exposure.
- No hardcoded secrets anywhere in scope; `.gitignore` correctly excludes `.env*`.
- NPM publish token handling is clean — never logged or interpolated.
- All published packages declare a `files:` whitelist; no `postinstall` / `prepare` lifecycle scripts (no consumer-install RCE).
- YAML parsed with a safe schema throughout (blocks code-object tags).
- Subprocess spawning uses argv arrays without a shell — no shell interpolation.
- Init command enforces an adapter allowlist (pattern propagated across commands).
- `pull_request` (not `pull_request_target`) in CI — safe default for untrusted PR code.

## What Was Checked

| # | Pattern | Checked |
|---|---------|---------|
| 1 | Broken Auth via Headers | N/A — local CLI, no HTTP auth |
| 2 | Path Traversal | Yes |
| 3 | RCE / Code Injection | Yes |
| 4 | SSRF | Yes |
| 5 | Sensitive Data Exposure | Yes |
| 6 | Network Segmentation | Yes (Unix socket) |
| 7 | Content Injection | Not in scope (no frontend rendering surface) |
| 8 | Container Privileges | Not in scope (dev CLI, no prod containers) |
| 9 | Broken Access Control | N/A — local CLI |
| + | Supply Chain / Publish | Yes |
