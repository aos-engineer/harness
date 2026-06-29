# Enhancing AOS with ADK 2.0 + A2A + MCP — The Connector Ring

> **Status**: Proposed (design + roadmap)
> **Date**: 2026-06-07
> **Scope**: Make AOS agents talk to each other and to external agents/tools across process, host, and
> org boundaries — without breaking the config-first promise, the 4-layer adapter contract, or the
> language-agnostic adapter model.
> **Branch context**: builds directly on the Paperclip seam networked-service work.

---

## 0. Implementation status

**Phases 0–4 are implemented**, including a **skill-routed `aos serve` A2A entrypoint**, **JWS Agent Card
signing**, and an **ingress rate/budget/concurrency guard**, on branch `adk-a2a-mcp-interop` (866 tests pass;
runtime + cli typecheck clean; phases 1 & 3, the card-signing crypto, and the ingress guard each reviewed by
adversarial workflows with all confirmed findings fixed — incl. a high-severity redirect-SSRF, an A2A
"unknown"-state poll-storm, a cross-impl card-canonicalization mismatch, and a hung-executor slot leak). The
full ADK/A2A/MCP interop ring — MCP-inside, the CompositeRuntime seam, and A2A egress + ingress — is in place.

**Ingress guard — done:** `runtime/src/ingress-guard.ts` (`IngressGuard`) enforces **concurrency** (in-flight
semaphore), **rate** (accepted requests / rolling window), and **budget** (cumulative cost / window) on the
expensive `message/send` path; reads are not gated. Rejections surface as a JSON-RPC `-32000` error with
`reason` + `retryAfterMs`. `A2aServer` gates the executor with an **execution timeout** (`AbortSignal` + slot
always released, so a hung executor can't exhaust the pool); `aos serve` builds it on-by-default from
`AOS_A2A_{MAX_CONCURRENT,RATE_PER_MIN,BUDGET_PER_MIN,EXEC_TIMEOUT_MS}`. Adversarially reviewed (5 findings
fixed: hung-executor slot leak, budget cost-loss past the window, monotonic clock, retry off-by-one). Known
accepted limits: the guard is global (not per-caller) and cheap reads rely on the auth token + a reverse proxy.

**JWS Agent Card signing — done:** `runtime/src/jws.ts` (detached JWS ES256/EdDSA + canonicalization, alg
allowlisted) + `runtime/src/agent-card-signer.ts` (`signAgentCard`/`verifyAgentCard`; **trusted** mode =
anti-spoofing, **integrity** mode = tamper-only). `A2aServer` signs the card when configured; `A2aClient`
verifies on `fetchAgentCard` (trustedKeys / `require`); `aos serve` loads the key from `AOS_A2A_SIGNING_KEY`
(fail-closed). Reviewed adversarially (8 findings fixed): the canonicalization is now **byte-for-byte
identical to the a2a-python SDK** (`_clean_empty` + `ensure_ascii` + sorted/compact — verified against actual
Python), so AOS↔a2a-sdk/ADK cards interoperate; alg is curve-bound (ES256⇒P-256); a mistyped signing key fails
closed (never silently unsigned); `require` needs `trustedKeys`; hostile/non-array signatures fail safely.
Follow-up: `jku`/JWKS key discovery (the `kid` is an RFC 7638 thumbprint today; trust is via out-of-band keys).

**Skill-routed ingress serve (Phase 4 +) — done:** `runtime/src/a2a-skill-router.ts` routes each inbound A2A
request to ONE AOS skill (focused execution, not the full assembly = excellent performance; a skill with an
`mcp_binding` resolves to a native MCP tool call, no LLM round-trip). `cli/src/serve/a2a-serve.ts` derives the
Agent Card `skills[]` from `core/skills/`, serves via the Paperclip handler, and reuses a WARM workflow+handle
across requests (`skillRunnerFromWorkflow`). Skill selection follows the spec: an explicit `metadata.skillId`
fast-path (AOS↔AOS), falling back to a default skill for generic clients (incl. ADK `RemoteA2aAgent`) since
A2A has no standard skill-selector on `message/send`. Agent Card skills carry the required `tags` field
(verified against the a2a-builder skill). Tested e2e (client routes by skill → server → runner → artifact).
The `import.meta.main` warm-runtime bootstrap (vendor adapter + worker) is the one live-only piece.

- **Phase 0 (carrying capacity):** `runtime/src/schema-validator.ts` (ajv over `core/schema/*.json`, strict
  for new kinds / warn-only for legacy / no-op if schemas absent); new `types.ts` interfaces + `mcp_*`
  transcript events; additive schema fields (`agent.mcp_servers`, `skill.mcp_binding`).
- **Phase 1 (MCP-inside):** `core/schema/mcp.schema.json` (`aos/mcp/v1`) + `loadMcp()` /
  `discoverMcpRegistries()`; `runtime/src/mcp-client-v2.ts` (real handshake + stdio & Streamable-HTTP
  transports, redirect-revalidation, protocol-version header); `runtime/src/mcp-toolset-manager.ts`
  (`{start,shutdown}`, discovery, allowlist); `runtime/src/egress-policy.ts` (`MeshEgressPolicy` SSRF guard);
  `adapters/shared/src/base-workflow.ts` `invokeSkill` → `mcp_binding` native call (LLM fallback);
  `cli/src/mcp-session.ts` + `adapter-session.ts` wiring (+ transcript persistence).

**Usage:** declare `core/mcp/<name>/mcp.yaml` (`schema: aos/mcp/v1`) listing servers; bind a skill with
`mcp_binding: { server, tools }` (or grant an agent `mcp_servers: [...]`). Egress to http/sse servers is
blocked to private/loopback hosts unless `AOS_MCP_EGRESS_ALLOWLIST=host[:port],…` (or `AOS_MCP_ALLOW_PRIVATE=1`).

**Phase 4 (A2A ingress) — done:** an AOS assembly can be exposed *as* an A2A agent on the existing Paperclip
`Bun.serve` seam. New: `runtime/src/a2a-server.ts` (`A2aServer` — a pure JSON-RPC handler: `agentCard()` +
`message/send`/`tasks/get`/`tasks/cancel`, wrapping an injected `AgentExecutor` that runs the AOS pass);
`runtime/src/a2a-task-store.ts` (the 9-state task lifecycle, FIFO-bounded vs DoS); `cli/src/paperclip/http.ts`
gains structural A2A routes (`/.well-known/agent-card.json` + the JSON-RPC endpoint) with out-of-band bearer
auth + a 1 MiB inbound body cap; `cli/src/paperclip/a2a-ingress.ts` adapts `A2aServer` → `ServerDeps.a2a` and a
`passExecutor` helper; `profile.runtime_requirements.a2a_serve` flag (default OFF). **Proven e2e:** the Phase-3
egress client drives the Phase-4 ingress server through the real Paperclip handler and gets the artifact back —
an AOS↔AOS **federation** round-trip. *Deployment wiring left:* a `serve`-style entrypoint that mounts the
server with a real engine-backed executor + ingress rate/budget guard, and JWS/JCS Agent Card signing.

**Phase 3 (A2A egress + ADK-as-peer) — done:** AOS can now call an external A2A agent (incl. an ADK 2.0
graph exposed via `to_a2a()`) as a normal deliberation member. New: `aos/remote-agent/v1` kind +
`loadRemoteAgent`/`discoverRemoteAgents` + `AgentConfig.remote_ref`; `runtime/src/a2a-client.ts` — a minimal
fetch-based A2A v1.0 client (card resolution + `message/send` + `tasks/get` polling) built on a SSRF-safe
`egressFetch` (per-hop egress re-validation, DNS-rebinding guard, bounded body reads, cross-origin credential
stripping) — **deliberately not `@a2a-js/sdk`** (kept the runtime dependency-light + testable; the SDK can be
swapped behind the interface); `runtime/src/task-mapper.ts` (pure 9-state → `AgentResponse`);
`runtime/src/a2a-connector.ts` — a `Connector` registered into the `CompositeRuntime` (remote cost 0/unmetered).
`adapter-session` discovers `core/remote-agents/` and wires `resolveKind: remote_ref → "a2a"`. The engine only
ever calls `spawnAgent`/`sendMessage`/`destroyAgent` on members, so a remote member's `UnsupportedError` on
extended methods never fires in normal rounds. Proven e2e: a mixed local+remote roster partitions through ONE
`dispatchParallel`, the remote leg going over A2A to a mock peer. Adversarially reviewed (14 findings fixed).

**Phase 2 (CompositeRuntime) — done (pure refactor):** `adapters/shared/src/composite-runtime.ts` — a
dispatch-by-handle `AgentRuntimeAdapter` implementation, injected in `adapter-session` where the bare vendor
runtime used to go (the raw runtime is retained only for vendor MCP wiring). With just the `local` connector
registered, behavior is byte-identical (773 tests pass). Added `Connector` (narrowed contract) + optional
`AgentHandle.connectorKind` in `types.ts`. Proven: one `dispatchParallel` call partitions a mixed roster by
`connectorKind`; remote-incapable methods throw `UnsupportedError`. Reversible by a 2-line swap. This is the
seam Phase 3 plugs the A2A connector into — no engine/DelegationRouter change required.

**Tier 2 (CLI-vendor wiring) — done:** all three vendor adapters (`claude-code`, `codex`, `gemini`)
additively register the session's declared external MCP servers into their own MCP config
(`McpToolsetManager.getVendorServerSpecs()` → `buildMcpArgs`/`writeMcpSettings`), so the vendor-CLI arbiter
can call those tools directly. Output is byte-identical when no servers are declared. claude-code carries
stdio+http; codex/gemini carry stdio (http goes via claude-code or the skill `mcp_binding` path).
Note: the vendor arbiter is a single process, so external servers are exposed at **session** scope —
per-agent `agent.mcp_servers` enforcement is still future work (it belongs to the pi/per-agent path).

**`aos serve --a2a` command — done:** `cli/src/commands/serve.ts` maps flags → the serve bootstrap
(`runA2aServe` in `cli/src/serve/a2a-serve.ts`) and is wired into the `cli/src/index.ts` dispatcher (verified:
`aos serve --help` runs through the real router). NOTE: the 3-line `index.ts` registration is committed to the
working tree but **left uncommitted** here because that file also carries unrelated `setup-pi` WIP that
references uncommitted files — committing `index.ts` as-is would make a broken commit. The committable parts
(`serve.ts`, `runA2aServe`) are pushed; commit the `index.ts` registration alongside the `setup-pi` work.

**Follow-ups — DONE (4 commits, 896 tests):**
- **Execution-mode A2A workflow STEP** (`a7aba67`): `workflow-runner` intercepts `action: a2a-delegate` /
  `adk-graph` (no schema change) → new `DelegationDelegate.delegateDirect` (engine; bypasses the bias
  router, lazy-loads a remote agent that need not be an assembly perspective) → CompositeRuntime →
  A2aConnector. Response text ingested as the step's output artifact. (Deliberation-member path was already
  done; this is the Execution-mode path.)
- **AbortSignal propagation into `invokeSkill`** (`c218e6e`): the ingress executor deadline now threads
  end-to-end — A2aServer → SkillRunInput.signal → `invokeSkill(…, {signal})` → BOTH the MCP `callTool`
  (Transport.request/HttpTransport/StdioTransport honor it) and the LLM `sendMessage`. Timed-out work is
  cancelled, not orphaned; early-abort short-circuit if the signal is already tripped.
- **Per-caller ingress fair-share** (`27d6e4e`): `PerCallerGuard` (composes the reviewed `IngressGuard`)
  gives each caller key its own bucket behind a global backstop; rollback on partial acquire; memory bounded
  (idle eviction + shared overflow bucket vs a distinct-key flood). Opt-in via `AOS_A2A_CALLER_KEY_HEADER`;
  caller key derived from a trusted gateway header in `http.ts`.
- **`jku`/JWKS card-key discovery** (`28caca8`): sign with `jku`, serve `/.well-known/jwks.json`, and
  client-side resolve a signature's `jku` (operator host allowlist + SSRF egress gate) → trust anchor by
  `kid`/thumbprint. Configuring `jku` forces trusted mode (no silent integrity downgrade). New jws helpers
  `buildJwks`/`keysFromJwks`.

**Still not built:** per-agent `mcp_servers` enforcement (belongs to the pi/per-agent path — entangled with
unrelated WIP); Phase 5 (optional: capability addressing + a local ADK sidecar). The 3-line `index.ts`
registration for `aos serve` remains uncommitted here (that file carries unrelated `setup-pi` WIP) — commit
it alongside the `setup-pi` work.

---

## 1. One-paragraph thesis

AOS is already a powerful *local* orchestration harness: a config-first runtime (YAML + TS) with a
4-layer adapter contract, hierarchical delegation, pluggable memory, artifact-driven execution, and —
since the Paperclip seam — a real `Bun.serve` networked surface. The missing dimension is **interop**:
today an "agent" can only be a local vendor-CLI subprocess, and "tools" are a single hardcoded `aos`
MCP bridge. This plan adds three capabilities along **one coherent seam** — a `Connector` abstraction
that is a deliberate *narrowing* of the existing L1 adapter — sequenced as **three reversible rings**:
**(1) MCP-inside** (declarative external toolsets + a real MCP client, all-TS), **(2) A2A-egress** (call
any external agent, including a Python ADK graph, as a normal named member), and **(3) A2A-ingress**
(expose an AOS assembly as a first-class A2A agent on the Paperclip server). The governing rule —
**"A2A on the outside, MCP on the inside, agents are not tools"** — is enforced as a *compile-time type
invariant*, not a doc convention.

This document is the output of a multi-agent design workflow: **8 parallel readers** dossiered the AOS
subsystems against the source, **4 competing integration architectures** were generated, a **12-judge
panel** (3 lenses × 4 designs) scored them, and a synthesis grafted the best verified ideas from each.
The winning sequencing (MCP-First Ratchet, grain-fit 9/10, incrementality 9.3/10) was fused with the
critical *dispatch-by-handle CompositeRuntime* insight from the A2A-Seam design and the *type-enforced
agents-vs-tools* keystone from the Interop-Mesh design. Every load-bearing claim below cites a verified
`file:line`.

---

## 2. Verified ground truth (what the plan rests on)

These were confirmed by reading the source, not assumed. They are the reason the design takes the shape
it does.

| # | Fact | Evidence | Consequence for the design |
|---|------|----------|----------------------------|
| G1 | The engine holds **one** adapter and broadcasts via **one** `dispatchParallel` call. | `engine.ts:52` `private adapter`; `engine.ts:513` single `this.adapter.dispatchParallel(parallelHandles…)`; spawn at `:481/:689`, send at `:553/:698`. | A mixed local+remote round **cannot** be served by branching `spawnAgent`. The partition must live inside a single **CompositeRuntime**. |
| G2 | The MCP client never does an `initialize` handshake. | `mcp-client.ts` jumps straight to `tools/list` (`:142`); no `initialize` / `notifications/initialized` anywhere; stdio-only transport. | "Finish MCP" is real, scoped work: a proper handshake + HTTP/SSE transport. |
| G3 | The only external MCP server actually spawned is **mempalace**, hardwired. | `memory-provider-factory.ts:21-60` spawns `python -m mempalace.mcp_server` with a `{provider, shutdown}` lifecycle. | This is the **template** for a config-declared MCP registry — and proof the only acceptable Python boundary is a subprocess endpoint. |
| G4 | The `aos` MCP bridge allowlist is **hardcoded independently in each adapter** (no shared source of truth). | claude-code `agent-runtime.ts:208` `--allowedTools mcp__aos__delegate mcp__aos__end`; codex `:168` `enabled_tools=["delegate","end"]` — each vendor pins its own literal list. | Centralizing these into one reconciled allowlist removes drift risk *and* becomes the external-toolset injection seam. |
| G5 | `config-loader.ts` does **not** validate against the JSON Schemas. | Only checks `schema:` const + a hardcoded required-list + id-regex (`^[a-z][a-z0-9-]*$`); `yaml.JSON_SCHEMA` parse mode. | A field absent from the **TS interface** is silently dropped. New fields need `types.ts` + loader default-fill, and Phase 0 should wire real ajv validation. |
| G6 | `invokeSkill` is effectively a **no-op** that ignores `platform_bindings`. | `base-workflow.ts:386-426` sends the skill's `prompt.md` as an LLM prompt; `platform_bindings` read only by config defaults + tests. | The cleanest seam to carry an **MCP toolset binding** — dead config we can make load-bearing. |
| G7 | AOS already runs an HTTP server with a clean, engine-free injection seam. | `cli/src/paperclip/server.ts` `Bun.serve`; `cli/src/paperclip/http.ts:14` `ServerDeps` injection; routes `/healthz`, `/paperclip/wake`; `pass-runner.ts:87` `createEnginePass`. | **A2A ingress is not greenfield** — mount route factories + a signed Agent Card on the existing server; wrap `createEnginePass` as an `AgentExecutor`. |
| G8 | `validatePlatformUrl` is too weak for general egress. | `cli/src/utils.ts:285` blocks only `169.254/16` + non-loopback http; leaves all RFC1918/ULA/`.local` reachable over https; has `AOS_ALLOW_INSECURE_PLATFORM_URL=1` bypass. | Outbound egress (introduced in Phase 1, not Phase 3) is a **net-new SSRF surface**; harden this **first**. |
| G9 | `enforceToolAccess` has **no egress model**; `confinedResolve` guards file paths. | `base-workflow.ts:428` checks tool/path/command access only; `utils.ts:269` `confinedResolve`. | Network egress needs a new `MeshEgressPolicy`; inbound artifact writes reuse `confinedResolve`. |
| G10 | `profile.runtime_requirements` is a latent **networked-profile** flag the engine ignores, and it is `additionalProperties:false`. | `profile.schema.json:120-128` `serve/channels/mempalace`; no engine consumer. | Natural anchor for `a2a_serve` — but the object must be **edited**, not extended. |
| G11 | The workflow `executeStep` action is **free-text** with a default **passthrough**. | `workflow-runner.ts:291` switch special-cases only `targeted-delegation` / `tension-pair` / `orchestrator-synthesis` / `execute-with-tools`; `default:` (`:304-306`) returns `{stepId, action, inputs}` unmodified. | An `adk-graph` / `a2a-delegate` step type is **non-breaking** and needs **zero schema change** (it can intercept before the default or replace it). |
| G12 | Remote cost is unpriceable from the local table; budget gating keys on `metered`. | `ConstraintEngine` prices rounds from a local `ModelCost` table (`engine.ts:447`); `constraint-engine.ts:25` `budgetEnabled` keys on metered. | Remote spend must be **unmetered-and-flagged**, never silently zeroed — and unmetered members fall out of headroom math cleanly. |

---

## 3. The core design — Connector + CompositeRuntime

### 3.1 `Connector`: a narrowing of the L1 adapter

The existing `AgentRuntimeAdapter` (`types.ts:624`) has 13 methods, but the engine only calls a handful
on a *member*. We introduce a minimal cross-boundary contract:

```ts
// runtime/src/types.ts
export interface Connector {
  spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle>;
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
  destroyAgent(handle: AgentHandle): Promise<void>;
  getAuthMode(): AuthMode;
  getModelCost(tier: ModelTier): ModelCost;
}
```

Remote and ADK members implement **`Connector`**, *not* the full adapter and *never* the CLI-shaped
`BaseAgentRuntime`. The unsupported methods on a remote handle (`spawnSubAgent`, `injectContext`,
`getContextUsage`, `setModel`) throw a named `UnsupportedError` — remote hierarchy is a *deliberate,
documented* deferral (see Risk R4), not an accidental gap.

### 3.2 `CompositeRuntime`: dispatch-by-handle (the keystone)

`CompositeRuntime` implements the **full** `AOSAdapter` and is injected **exactly where today's single
`this.adapter` is built** (`adapter-session.ts` `composeAdapter`). It carries a registry of
`Connector`s keyed by `handle.connectorKind` and partitions every call:

- `spawnAgent(config)` → routes by config kind (local CLI vs `aos/remote-agent/v1`), stamps
  `handle.connectorKind`.
- `dispatchParallel(handles, …)` → **partitions `handles` by `connectorKind`**, fans the local subset
  to `LocalCliConnector.dispatchParallel` and each remote handle to `A2aConnector.sendMessage`, then
  merges `AgentResponse[]` back in original order.
- `sendMessage` / `destroyAgent` → forwarded to the owning connector.

This is **why** `DelegationRouter`, `ChildAgentManager`, `ConstraintEngine`, and the engine round loop
need **zero changes**: they are all name-keyed over `Set<string>` and address-space-agnostic (G1). The
mixed-roster broadcast — the one thing a naive `spawnAgent` branch cannot serve — has exactly one clean
home.

### 3.3 Type-enforced "agents are not tools"

Two resolvers, two types, no crossover:

- `CapabilityRegistry` / member roster resolves **only agents** (`Connector`s).
- `McpToolsetManager` resolves **only tools**.
- Neither can return the other. `delegate` stays **one** MCP tool whose `to:` target the engine resolves
  to *local-spawn-vs-A2A* underneath — so a remote peer is **addressed as an agent**, never registered
  as a tool. The mantra becomes a compiler invariant rather than a code-review reminder.

---

## 4. How each technology fits

### MCP — the inside tool/data plane (ships first, all-TS)
- New config kind **`aos/mcp/v1`**: a registry of external MCP servers `{ id, transport: stdio|http|sse,
  command+args|url, auth_ref (env-only), tool_allowlist?[] }`. Generalizes the mempalace pattern (G3).
- New **`McpToolsetManager`** (modeled on `memory-provider-factory`'s `{provider, shutdown}` lifecycle)
  spawns each server through a **repaired `mcp-client`** (real `initialize → notifications/initialized →
  tools/list` handshake + Streamable-HTTP/SSE transport beside stdio — G2), discovers tools, and feeds
  **one** unified registry to **both** consumers: the CLI `buildMcpArgs` path **and** the pi
  `registerTool` path.
- Wires the no-op `invokeSkill` (G6) to resolve a skill's `mcp_binding` to a **native tool call** —
  opt-in per skill, so existing skills are byte-identical.
- MCP **never** crosses a boundary as an agent and a peer is **never** registered as an MCP tool.

### A2A — the only cross-boundary agent transport (both directions)
- **Egress (Phase 3):** a single **`A2aConnector`** implements `Connector` directly using
  `@a2a-js/sdk` (v1.0 pinned, `use_legacy` fallback for v0.x cards). `spawnAgent` = `A2ACardResolver`
  (card cached, JWS/JCS verified, URL through the hardened egress gate); `sendMessage` = `create_client`
  + send `Message`, drive the **9-state Task** to a terminal state, collapse final `Message`/`Artifact` +
  reported usage into `AgentResponse`. A single **`task-mapper.ts`** is the *only* place the 9 states map
  onto AOS's request/response model; `input-required`/`auth-required` map onto the existing
  `UIAdapter.promptInput` + continue-same-task surface.
- **Ingress (Phase 4):** A2A JSON-RPC/REST/SSE route factories + a signed `/.well-known/agent-card.json`
  mounted into the Paperclip `Bun.serve` via the `ServerDeps` seam (G7); `AgentExecutor.execute` wraps
  `createEnginePass`; an **`A2aTaskStore`** under `.aos/` (path-guarded by `confinedResolve`) persists the
  9-state lifecycle for get/cancel/resubscribe — the stateful piece the fire-and-forget wake server lacks.
  Auth is out-of-band in HTTP headers, never in payload.

### ADK 2.0 — consumed over the wire, never linked into the TS core
- ADK is **never** linked into the TS/Bun core (no FFI, no in-process call) — consistent with the
  TS↔Python boundary mempalace already proves (G3). A Python ADK graph runs `to_a2a(root_agent, port=…)`
  and is registered in AOS as an `aos/remote-agent/v1` record; the `A2aConnector` reaches it identically
  to any other A2A peer. ADK's internal `sub_agents` / `Workflow(edges)` orchestration runs server-side
  and is invisible to AOS — AOS sees exactly **one named member**.
- Two supported shapes: **(a) Deliberation member** — an ADK `LlmAgent` as one perspective; **(b)
  Execution step** — an ADK `Workflow` graph as an opaque `action: adk-graph` workflow step (the
  *preferred* shape, via the free-text `executeStep` seam — G11).
- ADK reliability idioms map onto AOS grain: *yield-don't-append* ≈ fire-and-forget `onTranscriptEvent`;
  *idempotent-nodes* ≈ idempotent A2A Task submission keyed by `contextId`; *let-exceptions-propagate* ≈
  A2A `failed`/`rejected` surfaced as `AgentResponse.status='failed'`.
- An in-tree `platform: adk` adapter + local Python sidecar is an **explicitly optional Phase 5 escape
  hatch**, not the default.

---

## 5. New schema (additive-only, so all 30+ existing YAML files load unchanged)

| Kind / field | Where | Phase | Shape |
|---|---|---|---|
| **`aos/mcp/v1`** (new kind) | `core/schema/mcp.schema.json` + loader | 1 | `{ id, transport, command+args\|url, auth_ref, tool_allowlist? }` |
| `mcp_binding` | `skill.schema.json` + `SkillConfig` | 1 | `{ server, tools[] }` — makes the dead `invokeSkill` path live |
| `mcp_servers: string[]` | `agent.schema.json` + `AgentConfig` | 1 | references `aos/mcp/v1` ids |
| **`aos/remote-agent/v1`** (new kind) | `core/schema/remote-agent.schema.json` + loader | 3 | `{ id, kind: a2a, agent_card_url, transport?, auth_ref?, cost: metered\|unmetered (default unmetered), capabilities?[] }` |
| `remote_ref?: string` | `agent.schema.json` + `AgentConfig` | 3 | references an `aos/remote-agent/v1` id |
| `a2a_serve: boolean` (default `false`) | `profile.runtime_requirements` (**edit** the `additionalProperties:false` object — G10) | 4 | turns ingress on |
| `action: adk-graph` / `a2a-delegate` | workflow step (**no schema change** — G11) | 3 | convention value on free-text `action` |

`aos/remote-agent/v1` is a **distinct kind**, not an `agent.yaml` flag and not an MCP tool, precisely so
the loader's kind-dispatch enforces agents-are-not-tools structurally.

---

## 6. New runtime components

| Component | Layer | Responsibility |
|---|---|---|
| **`Connector`** (interface) | L1 (narrowing of `AgentRuntimeAdapter`) | Minimal member contract; remote/ADK implement this. Unsupported remote ops throw `UnsupportedError`. |
| **`CompositeRuntime`** | L1 (implements full `AOSAdapter`) | Injected where today's `this.adapter` lives. Partitions handles by `connectorKind`; splits the single `dispatchParallel` across local + A2A subsets. The seam that keeps the engine core untouched. |
| **`McpToolsetManager`** | Runtime (beside `memory-provider-factory`) | Reads `aos/mcp/v1`, spawns servers via the repaired client, exposes one tool registry to both CLI `buildMcpArgs` and pi `registerTool`. Owns `{start, shutdown}`. |
| **`A2aConnector`** | L1 (implements `Connector`) | `@a2a-js/sdk` client; card resolve+verify+cache; send Message; drive Task to terminal; `onStream` for SSE; cost flagged unmetered unless the card declares a metered contract. |
| **`task-mapper`** | Runtime (single module) | The one place the 9-state lifecycle collapses onto `AgentResponse{text,status,cost}`; emits `a2a_task_status` transcript events; maps input/auth-required onto `promptInput`. |
| **`A2aServer` + `AgentExecutor` + `A2aTaskStore`** | Service (mounted in Paperclip `Bun.serve`) | Ingress: signed Agent Card + route factories via `ServerDeps`; `AgentExecutor` wraps `createEnginePass`; `A2aTaskStore` persists the 9-state lifecycle (`confinedResolve`-guarded). Default OFF. |
| **`ConnectorManager` + `MeshEgressPolicy`** | Runtime (lifecycle owner) | Single owner of all connector/MCP/A2A lifecycles, torn down in the `adapter-session` finally block beside `closeBridge` + `memory.shutdown`. `MeshEgressPolicy` is the outbound gate: hardened SSRF check + per-profile allowlist + narrow-only ToolPolicy invariant. |
| **`CapabilityRegistry`** (optional, late) | Runtime (feeds `DelegationRouter.memberNames`) | **Optional Phase 5**: resolve delegation targets by capability/skill tag (from A2A card `skills[]`). Type-enforced agents-only. Name-based routing works without it. |

---

## 7. End-to-end "agent X talks to agent Y" flows

**P1 · MCP consume (skill path — closes the verified no-op):** workflow step → `invokeSkill('code-review')`
→ `base-workflow` resolves the skill's `mcp_binding {server:'sonar', tools:['analyze']}` →
`McpToolsetManager.callTool` → result becomes the skill output instead of an LLM prompt.

**P1 · MCP consume (CLI + pi parity):** claude-code arbiter / pi agent → its MCP client (or in-process
`registerTool` backed by `McpToolsetManager`) → repaired `mcp-client` → external MCP server (e.g. github)
declared in `aos/mcp/v1` and granted via `agent.mcp_servers` → `enforceToolAccess` + `MeshEgressPolicy`
gate → result. Tools/data only; no agent crosses a boundary.

**P2 · Composite no-op proof:** every existing local round runs through `CompositeRuntime`, which sees
`connectorKind='local'` on every handle and forwards 100% to the unchanged `LocalCliConnector`. Pure
refactor, byte-identical — the reversibility gate for Phase 3.

**P3 · A2A egress to an ADK graph:** arbiter calls `mcp__aos__delegate(to='research-peer')` →
`bridge-server` → `engine.delegateMessage` → `DelegationRouter` picks `research-peer` **by name** →
`CompositeRuntime` sees `connectorKind='a2a'` → `A2aConnector` resolves+verifies the card of a Python ADK
agent (`to_a2a()`) → `create_client` + send → `task-mapper` drives the 9-state Task to `completed` →
final Artifact collapsed to `AgentResponse`, cost flagged unmetered → recorded via `a2a_task_status`
events. ADK's internal `sub_agents` stay a black box; AOS sees one member; `delegate` is still one MCP tool.

**P3 · Mixed local+remote broadcast in ONE round (the partition the alternatives glossed):**
`delegateMessage('all', msg)` → `DelegationRouter` splits into `parallel[]` names →
`CompositeRuntime.dispatchParallel` partitions handles: local subset → `LocalCliConnector.dispatchParallel`,
A2A subset → `A2aConnector` per-handle send → both return `AgentResponse[]`. `bias_limit`/speaks-last
accounting is intact (both are named members); remote cost flagged unmetered so budget headroom math
(`engine.ts:447-471`) stays sound.

**P3 · Execution mode, ADK graph as a workflow STEP (preferred):** CTO orchestrator → `WorkflowRunner`
hits `action='adk-graph'` → `executeAdkWorkflow` → `A2aConnector` sends step input as a Task to the ADK
`Workflow(edges)` card → ADK walks its graph server-side, streaming `TaskStatus/ArtifactUpdate` over SSE
→ `onStream` surfaces node progress as `adk_node_yield` events → final Artifact ingested via
`ArtifactManager` (sanitized id, `a2a_artifact_id`+mime in metadata) as the step output → local
`review_gate` runs.

**P4 · A2A ingress (external → AOS):** an ADK `RemoteA2aAgent` or any A2A client → `GET
/.well-known/agent-card.json` on Paperclip `Bun.serve` (JWS-signed) → `POST message/send` →
`AgentExecutor.execute` authenticates out-of-band, wraps `createEnginePass` → runs one execution-mode AOS
workflow → package emitted as an A2A Artifact, cost into Task metadata, 9-state lifecycle in
`A2aTaskStore`, progress streamed over SSE. AOS is now a first-class A2A agent. `a2a_serve:false` by default.

**P4 · AOS↔AOS federation (first-class acceptance test):** one deployment's arbiter delegates to a remote
AOS assembly published by another deployment's Phase-4 ingress — same `A2aConnector` egress hitting the
other's `AgentExecutor`. Proves egress + ingress compose AOS into a federation primitive.

---

## 8. Phased roadmap

Each phase ships independently, is reversible by config, and never forces Python into the TS/Bun core.

### Phase 0 — Carrying capacity (no behavior change)
*Make the config-first promise survive five new field kinds before any of them land.*
- Wire **ajv** to run the actual JSON Schemas in `config-loader.ts` (today: required-list + `validateId`
  only — G5). Enforce **new** kinds strictly; run legacy schemas **warn-only** first (migration safety).
- Add all new optional fields to `types.ts` interfaces + default-fill in the loader (absent-from-type =
  silently dropped — G5).
- Add new `TranscriptEventType` members (`a2a_task_status`, `adk_node_yield`, `a2a_artifact_received`) so
  the sink/replay/summarizer pick them up automatically.
- **Exit:** all 30+ existing YAML files load unchanged; a malformed new block fails fast; zero runtime
  behavior change.

### Phase 1 — MCP-inside (all-TS; ships the verified bug fixes)
*Config-declared external toolsets reachable by both CLI and pi; close the dead-config gaps.*
- `aos/mcp/v1` registry + `McpToolsetManager` (mempalace-lifecycle template — G3).
- Repair `mcp-client` `initialize` handshake (G2) + add HTTP/SSE transport. **Decision pending:** in-place
  flag vs `McpClientV2` (§10 — recommendation: `McpClientV2`, keeps mempalace byte-identical).
- Wire `invokeSkill` to resolve `mcp_binding` → native tool calls, opt-in per skill (G6).
- Drive `buildMcpArgs` from the registry; **centralize the per-vendor `aos`-bridge allowlists** into one
  reconciled source of truth (today each adapter pins its own literal list — G4).
- **Harden `validatePlatformUrl` (G8)** + extend `enforceToolAccess` with a network-egress allowlist (G9).
  *This is a Phase-1 deliverable — Phase 1 is where outbound egress is actually introduced.*
- **Exit:** a skill resolves a real external MCP tool call; an agent reaches a declared server from both a
  CLI vendor and pi; mempalace path byte-identical; egress gated. Reversible by removing the `mcp` block.

### Phase 2 — CompositeRuntime (pure refactor; reversibility gate)
*Introduce the dispatch-by-handle seam with zero behavior change, proving the partition before any remote
member exists.*
- `Connector` interface in `types.ts`; `CompositeRuntime` implementing the full adapter, wrapping today's
  `BaseAgentRuntime` as `LocalCliConnector`; `ConnectorManager` lifecycle in the `adapter-session` finally
  teardown.
- **Exit:** full existing test suite passes **byte-identical** with `CompositeRuntime` injected; every
  handle is `connectorKind='local'`; the mixed-partition path is unit-tested with a stub. Revert = swap
  `CompositeRuntime` back for the composed adapter.

### Phase 3 — A2A egress + ADK-as-peer (no inbound port)
*Call any A2A agent — including a `to_a2a()`-exposed ADK graph — as a normal member, in both run patterns.*
- `aos/remote-agent/v1` distinct kind + loader; `A2aConnector` (direct `Connector`, `@a2a-js/sdk` v1.0 +
  `use_legacy` fallback); `task-mapper.ts` single 9-state→`AgentResponse` module; `executeStep`
  `adk-graph`/`a2a-delegate` actions (G11); remote cost flagged unmetered + surfaced (G12); AOS↔AOS-over-A2A
  composition test against a stub.
- **Exit:** a mixed local+remote broadcast round completes; an ADK graph runs as one named member *and* as
  a workflow step; budget gating remains sound. Reversible by removing remote-agent records.

### Phase 4 — A2A ingress on the Paperclip seam (default OFF)
*Expose an AOS assembly as a first-class A2A agent, reusing the existing `Bun.serve`.*
- A2A route factories + signed `agent-card.json` via `ServerDeps` in `http.ts` (G7); `AgentExecutor`
  wrapping `createEnginePass`; `A2aTaskStore` (9-state, `confinedResolve`-guarded) for
  get/cancel/resubscribe; JWS/JCS card signing + out-of-band caller auth + ingress
  rate/budget/concurrency guard; `profile.runtime_requirements.a2a_serve` flag (G10).
- **Exit:** an external A2A client (and a remote AOS deployment) drives one AOS session via `message/send`
  and gets an Artifact back; `a2a_serve:false` by default; remote-triggered spend is budget-gated at
  ingress.

### Phase 5 — Optional: capability addressing + ADK local sidecar (late, cuttable)
*Only if demand warrants.*
- `CapabilityRegistry` feeding `DelegationRouter.memberNames` (type-enforced agents-only); optional
  `adapters/adk` package + `platform: adk` enum value + Python sidecar (the mempalace-style subprocess
  boundary).
- **Exit:** targets resolvable by capability tag; an ADK `LlmAgent` runs as a local L1 member. Both
  additive and individually droppable — this phase exists to be **cut** if Phase 3's A2A-peer path already
  meets the need.

> **Shippable products along the way:** Phases 0–1 are a standalone MCP win (no network ingress). Phases
> 0–3 are a coherent **no-inbound-port** interop product (AOS calls out to any agent/tool). Phase 4 makes
> AOS a federation node. Phase 5 is pure optionality.

---

## 9. Risks & mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Egress is a net-new attack surface that Phase 1 opens** — `enforceToolAccess` has no egress model and `validatePlatformUrl` only blocks `169.254` with a bypass (G8/G9). | Harden `validatePlatformUrl` **first** in Phase 1 (block all RFC1918/loopback/ULA/`.local`; drop the bypass for A2A/MCP endpoints); make `MeshEgressPolicy` a per-profile allowlist; route every outbound card/server URL through it. Not deferred. |
| R2 | **Remote cost is opaque** — `ConstraintEngine` prices from a local table (G12); trusting self-reported cost weakens budget gating. | Default remote cost **unmetered + flagged** in `ConstraintState` + transcript + UI (never silently zeroed). `budgetEnabled` keys on metered, so unmetered members drop out of headroom cleanly. A metered Agent-Card cost contract is opt-in, never trusted by default. |
| R3 | **Sync round model vs A2A's long-lived 9-state Task** — `delegateMessage` is a blocking, timeout-bounded Promise; a minutes-long Task blocks co-runners or gets SIGTERM-killed. | Phase 3 ships poll-to-completion inside `A2aConnector` with a relaxed timeout for task-bearing handles, **documented as a round-timing behavior change**. `A2aTaskStore` + `onStream` lay groundwork for a future resumable mode; thread `onStream` (defined but unused at the orchestration layer) so partials are visible. |
| R4 | **Remote hierarchy** (Lead→Worker over A2A) clashes with the "all comms through parent" law and has no implementation (`messageChild` unimplemented). | **Explicitly defer.** `Connector.spawnSubAgent` throws `UnsupportedError` on remote handles in Phase 3. Resolve proxy-through-parent vs peer as a first-class gate **before** any remote spawn (§10), defaulting to proxy-through-parent to preserve the trust model. |
| R5 | **Lossy collapse** of A2A multi-Artifact/FilePart Tasks into a flat `AgentResponse{text}` — matters more for Execution than Deliberation. | Round-trip non-text Parts through `ArtifactManifest.metadata` (`a2a_artifact_id`, `mime_type`); ingest FileParts via `ArtifactManager` with sanitized ids; coerce unknown MIME to a binary-passthrough format so the exhaustive format map doesn't throw. Full fidelity for Execution; accept text collapse for Deliberation. |
| R6 | **Lockstep 7-package release** — every additive field crosses runtime + 4 adapters + cli. | Phases 0–1 touch only runtime + adapters' `buildMcpArgs` (no contract change). The `Connector`/`CompositeRuntime` change (Phase 2) is a single coordinated bump gated behind a byte-identical test. Remote/ingress fields are additive-optional, so adapters that don't implement them still compile. |
| R7 | **Ingress adds the first stateful store + inbound listener + signed-card verification + remote-triggered spend** onto a one-shot wake seam. | `a2a_serve:false` by default; JWS/JCS verification + out-of-band auth + ingress rate/budget/concurrency guard as **Phase 4 exit criteria**; reuse env-only-secrets + `redactConfig` for signing keys. Phase 4 is fully optional. |

---

## 10. Open decisions for you (recommended defaults in **bold**)

These are genuine forks. The roadmap above assumes the recommended default for each; changing one mostly
shifts a single phase.

1. **Python ADK sidecar** — ship Phase 5's in-tree `platform: adk` adapter + local Python sidecar
   (model-agnostic local ADK members, but a second operational surface), or stay **A2A-peer-only forever**
   (ADK reached only over the wire via `to_a2a()`)? → **A2A-peer-only**; sidecar is a cuttable Phase 5.
2. **Remote hierarchy comms** — when a Lead spawns a remote Worker, preserve "all communication flows
   through the parent" (proxy every remote child call) or relax to A2A peer semantics? → **proxy-through-
   parent** (and the whole capability is deferred until needed).
3. **Remote cost trust** — all remote spend **unmetered-and-flagged** (safe; budget gating non-authoritative
   for remotes), or honor a self-reported/Agent-Card cost contract (authoritative but trusts a remote
   signal)? → **unmetered-by-default**, opt-in metered contract.
4. **`mcp-client` repair strategy** — mutate the shared `McpClient` behind a handshake flag (one class, two
   modes), or add a clean **`McpClientV2`** leaving the mempalace path byte-identical? → **`McpClientV2`**.
5. **Agent Card identity for ingress** — one card for the whole deployment (single endpoint, path-per-
   profile), or **one card per profile** (multiple routers under the single Host)? → drives whether the
   Phase 4 router is path-multiplexed or multi-service; lean **one-card-per-profile** for clean capability
   advertisement.
6. **ajv enforcement scope** — turn **all** existing schemas enforcing in Phase 0 (may reject today's
   loosely-validated configs), or enforce only the **new** kinds and keep legacy advisory? → **enforce new
   kinds strictly, legacy warn-only first.**
7. **CapabilityRegistry timing** — ship capability-addressed delegation early, or keep YAML-roster
   addressing and treat capability resolution as the **optional late Phase 5 ring**? → **late/optional**;
   name-based routing works without it.

---

## 11. Appendix — design alternatives considered (and why this synthesis wins)

Four architectures were generated and scored by a 12-judge panel (lenses: grain-fit, power-upside,
feasibility-risk). Overall scores (1–10):

| Rank | Architecture | Overall | grain | power | feas | incr | risk |
|---|---|---|---|---|---|---|---|
| 1 | **MCP-First Ratchet** (three reversible rings) | **8.07** | 9 | 8 | 7 | 9.3 | 7 |
| 2 | A2A as the Network Seam (single-runtime, `@a2a-js`, no Python) | 7.67 | 9 | 7.3 | 7 | 8.7 | 6.3 |
| 3 | ADK 2.0 as an A2A-bridged co-runtime adapter (`adk` L1 + sidecar) | 7.6 | 9 | 8.7 | 5.7 | 8.7 | 6 |
| 4 | Unified Interop Mesh (capability-addressed agent node) | 7.4 | 9 | 9 | 6 | 7.7 | 5.3 |

**What was grafted into the recommendation:**
- **From #1 (winner):** the three-reversible-rings sequencing; `aos/remote-agent/v1` as a *distinct kind*;
  Phase 0 "carrying capacity"; centralizing the per-vendor MCP-bridge allowlists as a standalone win.
- **From #2 (the critical graft):** the **dispatch-by-handle `CompositeRuntime`** — verified *necessary*
  because the engine holds one adapter and one `dispatchParallel` call (G1); plus "delegate stays one MCP
  tool whose target resolves local-vs-remote underneath."
- **From #3:** the reframe that *the A2A-client L1 is the prize and the ADK adapter is incidental* (sidecar
  → optional Phase 5); the single `task-mapper.ts`; ADK-graph-as-workflow-STEP as the preferred Execution
  shape; input/auth-required → `promptInput`.
- **From #4:** `Connector` as a *narrowing* of `AgentRuntimeAdapter`; **type-enforced agents-vs-tools** as a
  compile-time invariant; harden `validatePlatformUrl` before reuse; `A2aTaskStore` as the stateful
  primitive the wake server lacks.

**Cross-judge convergence baked in as load-bearing commitments:** implement the remote runtime as a
*direct* `Connector` (never subclass `BaseAgentRuntime`); treat remote cost as unmetered-and-flagged;
reuse the Paperclip `Bun.serve` + `createEnginePass` for ingress; pin `@a2a-js/sdk` v1.0 with a
`use_legacy` fallback; make AOS↔AOS-over-A2A a first-class composition acceptance test.
