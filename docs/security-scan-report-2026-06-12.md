# AOS Framework — Application Security Scan Report

**Date:** 2026-06-12
**Branch:** `adk-a2a-mcp-interop`
**Scope:** The A2A (Agent2Agent) / MCP interop surface — A2A ingress & egress, JWS Agent Card signing, JWKS/`jku` key discovery, ingress rate/budget/concurrency guards, per-caller fair-share limits, MCP toolsets, the `aos serve` command, and the Pi extension setup.
**Method:** Seven parallel focused scanners (Auth/AuthZ, SSRF, Crypto, RCE, Data Exposure, Path Traversal/Injection, Infrastructure/DoS) tracing from the untrusted entrypoint (the inbound A2A JSON-RPC body) to every candidate sink. Read-only — **no code was modified during this scan.**
**Review type:** Authorized defensive review of our own codebase.

---

## 1. Executive summary

The interop surface is **well-architected from a security standpoint**. The core invariants hold: there is **no remote code execution** (attacker-controlled *data* is cleanly separated from operator-controlled *control selectors*), **no path traversal reachable from a remote caller**, the **JWKS endpoint provably publishes only public key material**, the **ingress guard is on by default**, the **concurrency lease is reliably released**, and **egress is SSRF-screened** with per-redirect-hop revalidation and cross-origin credential stripping.

The review surfaced a small set of hardening opportunities clustered around three areas: object-level authorization on the task store, secure-by-default deployment, and the key-discovery trust gate. All actionable findings were remediated the same day (see §5); a few low-severity items were reviewed and accepted as documented mitigations.

### Severity tally (deduplicated)

| Severity | Count |
|----------|-------|
| **High** | 3 |
| **Medium** | 3 |
| **Low** | 14 |
| **Informational / positive** | — |

---

## 2. Categories covered

Each class below was traced from the untrusted inbound request to its sinks:

- **Authentication & authorization** — ingress auth, object-level authorization on the task store, caller-identity handling.
- **SSRF** — egress screening for Agent Card / JWKS / MCP / telemetry fetches, IPv6 private-range coverage, DNS-resolution guards.
- **Cryptography** — JWS Agent Card signing/verification, `jku` key discovery, algorithm allowlisting, JWKS handling.
- **Remote code execution** — separation of attacker data from control selectors; dynamic-import and process-spawn surfaces.
- **Data exposure** — the JWKS public-key-only guarantee, error-message disclosure, signing-key handling.
- **Path traversal / injection** — inbound identifiers reaching filesystem sinks.
- **Infrastructure / DoS** — listener binding, body caps, rate/concurrency limits, task-store lifecycle.

---

## 3. Findings overview

The high- and medium-severity findings clustered in the following areas; each was remediated:

- **Object-level authorization (High).** The A2A task store had no owner concept, so task read / cancel / continuation operations were authorized at the connection level only. *Remediated:* tasks now carry an owner stamped from the authenticated caller and enforced on read / cancel / continuation.
- **Secure-by-default deployment (High).** A2A ingress auth was opt-in, and the listener bind default could expose the service on all interfaces. *Remediated:* the server now fails closed on a public bind without a token (with an explicit anonymous opt-in) and defaults to loopback.
- **Key-discovery trust gate (High).** The `jku` host allowlist was enforced on the initial request but not on redirect targets. *Remediated:* JWKS fetches no longer follow redirects, and `jku` requires HTTPS.
- **Egress SSRF hardening (Medium).** IPv6 private-range coverage and DNS-resolution guards were strengthened across Agent Card / MCP / telemetry fetches.

The low-severity items covered timing-safe token comparison, byte-accurate body caps, task-store TTL eviction, generic remote error text, a public-only JWKS guard, and related defense-in-depth. All were addressed except a few documented low-severity residuals (see §5).

---

## 4. Positive controls verified safe

- **The JWKS endpoint publishes only public key material** — the private scalar provably cannot reach the wire on the production path. *(Highest-value check.)*
- **No RCE surface** — no `eval` / `new Function` / `vm`, no shell execution reachable from ingress; MCP stdio uses array-form spawn with config-derived command/args; YAML parsing is pinned to a safe schema; no prototype-pollution merge.
- **Attacker data ≠ control selectors** — inbound skill ids are resolved by allowlist equality (unmatched ⇒ rejected); MCP server/tool/command come from operator config; the inbound text is only an argument *value*.
- **Ingress guard on by default** with sane caps; **concurrency lease released in a `finally`** (covering both throw and timeout).
- **Egress SSRF screening** — private/loopback/link-local/ULA/CGNAT/internal-suffix blocking, **every redirect hop re-validated**, cross-origin credentials stripped on redirect, bounded response reads, per-fetch timeouts, bounded redirect chains.
- **JWS hardening** — algorithm allowlist (ES256/EdDSA only), `none` and RSA rejected (algorithm-confusion closed), key type/curve checked against alg, bounded JWKS parsing.
- **Signing fails closed** — an unreadable signing key throws at startup rather than silently serving an unsigned card.
- **Body caps** on both inbound and egress paths.
- **Wake endpoint fails closed** — the wake token is hard-required at startup.
- **No secrets logged or committed** — no key material tracked in git.

---

## 5. Remediation status (applied 2026-06-12)

Owner approved **"fix everything."** All actionable findings were remediated on branch `adk-a2a-mcp-interop` with regression tests; the full suite was green afterward (lint, unit, integration, validate, and CLI/Pi typecheck all passing). New tests lock in the security-critical behaviors (the IPv6 SSRF set, JWKS public-only, task ownership, fail-closed serve, and the wake body cap).

| Area | Status |
|------|--------|
| Object-level authorization (task ownership) | ✅ Fixed |
| Constant-time token comparison | ✅ Fixed |
| Fail-closed public serve + loopback default bind | ✅ Fixed |
| Bridge refuses non-loopback TCP binds | ✅ Fixed |
| IPv6 SSRF private-range coverage | ✅ Fixed |
| MCP HTTP transport SSRF guard + bounded body | ✅ Fixed |
| `jku` redirect handling / HTTPS-only / verification-mode surfacing | ✅ Fixed |
| Dynamic adapter-import allowlisting | ✅ Fixed |
| JWKS public-only guard | ✅ Fixed |
| Generic remote error text; signing-key error hygiene | ✅ Fixed |
| Byte-accurate body caps, task-store TTL, eviction throttling | ✅ Fixed |
| Profile workflow-id path-segment validation | ✅ Fixed |
| `.gitignore` coverage for key material | ✅ Fixed |

A few low-severity items were **reviewed and accepted as documented mitigations** rather than code changes — for example, residual trust-model assumptions that hold only behind a properly configured gateway, and cancellation behavior that depends on the downstream adapter honoring an abort signal. These are low severity, recorded in code comments, and none represents an open remote-exploitable gap.

---

*Generated by the AOS appsec scanner sweep (7 parallel scanners), 2026-06-12. Findings were remediated the same day under explicit owner approval; residual items are documented mitigations, not open gaps.*
