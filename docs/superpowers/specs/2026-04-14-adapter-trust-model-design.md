# Adapter Trust Model & Tool-Access Gating Design

**Date:** 2026-04-14
**Status:** Draft — awaiting review
**Scope:** Security remediation for workspace-trust RCE and unrestricted `executeCode`, plus path/URL confinement polish. Partner spec: `2026-04-14-publish-pipeline-hardening-design.md` (covers publish-pipeline findings).
**Related report:** `docs/security-scan-report-2026-04-14.md` (RCE-001, RCE-002, RCE-003, PATH-002, PATH-003, NET-002).

## Goal

Close the two workspace-trust gaps that let a hostile repo or a prompt-injected agent execute arbitrary code on a developer's machine.

1. **Adapter loading must go through the npm trust boundary only.** Cloning a repo and running `aos run` must not execute TypeScript that lives inside that repo.
2. **`executeCode` must be off by default.** Enabling it must require a deliberate, out-of-band decision (profile YAML committed by the profile author), not anything the agent can say or produce.

## Why

- Post-0.6.0 the CLI no longer bundles adapters — the install-time trust boundary is npm (`@aos-harness/<name>-adapter`). However `cli/src/commands/run.ts:326-328` still prefers `<project-root>/adapters/<name>/src/index.ts` over the npm-resolved package. A hostile repo with `core/agents/` (so `getHarnessRoot()` treats it as a project root) plus `adapters/pi/src/index.ts` gets `Bun.spawn(["pi","-e", <that file>])` on `aos run`. This is the "VS Code workspace trust" class of RCE, and 0.6.0's adapter-resolution cleanup makes the fix a one-function change instead of a feature.
- `adapters/shared/src/base-workflow.ts` exposes `executeCode` that runs `bash -c` / `bun eval` / `python3 -c` / `node -e` with caller-supplied strings. `enforceToolAccess` currently returns `{ allowed: true }` unconditionally. Any prompt-injection path that reaches `executeCode` → RCE. The sandbox (env-filtering in `buildSafeEnv`) is not a security boundary; it is a reproducibility control.
- We're between releases (0.6.0 just shipped, 0.7.0 not cut). Both changes are source-compatible for end users — nobody has a hostile workspace today, and nobody's profile relies on `enforceToolAccess` returning `allowed: true` because no one has written authorization logic against it yet.

## Non-Goals

- Real sandboxing (bwrap / firejail / nsjail / container). `executeCode` will still run with the user's full privileges; the gate is a *trust* decision (the profile author opted in), not an *isolation* boundary. A separate spec will cover isolation if and when it's needed.
- A trusted-workspaces UI (`aos trust` command, persisted allowlist). The simpler fix — drop the project-local adapter override entirely — removes the need for one. Adapter developers use `npm link` or a prerelease tag.
- Restructuring the tool-call plumbing between adapter and workflow. `enforceToolAccess` keeps its current signature; only the body changes.
- Rewriting `toKebabCase` callers across the CLI. Only `cli/src/commands/create.ts` is in scope.

## Decisions

### D1 — Drop the project-local adapter override

Delete `cli/src/commands/run.ts:325-328`'s `existsSync(join(root, "adapters", adapterName, ...))` branch. Adapter resolution becomes a single call to `getAdapterDir(adapterName)`, which internally checks:

1. The monorepo dev layout rooted at the **CLI's own** `import.meta.dir` (only hits when running from an `aos-harness` checkout, never from an end user's repo).
2. The installed `@aos-harness/<name>-adapter` via `import.meta.resolve`.

That's the complete trust surface. Adapter authors working against the main repo are unaffected (monorepo path still works). Adapter authors in a third-party repo use `npm link @aos-harness/my-adapter` — the link is opt-in, created with `sudo`-equivalent intent, and outside the cloned-repo attack surface.

**Side effect:** the per-project `adapters/` override was undocumented and, as far as we know, unused outside the monorepo. Removing it is source-compatible for every documented workflow. The 0.6.0 CHANGELOG did not promise it.

**`import.meta.dir` + `npm link` verification:** The monorepo-detection path depends on `import.meta.dir` pointing into the real CLI install, not the symlinked mirror. Bun 1.3 follows symlinks when computing `import.meta.dir` (verified empirically), meaning `npm link aos-harness` from an `aos-harness` checkout makes `import.meta.dir` resolve to the source checkout — so monorepo detection still triggers, as intended. However this behavior has drifted across Bun versions. **Before landing this change, run a one-shot verification test** (added to the plan): link the CLI from the monorepo into a sibling empty project, `aos run` from the empty project, assert the monorepo `adapters/` is reached. Pin the minimum Bun version in `cli/package.json` engines if we discover the behavior regresses on a supported Bun version.

### D2 — Validate `adapter` against an allowlist at entry

Immediately after reading `adapter` from `.aos/config.yaml` / `--adapter`:

```ts
const ADAPTER_ALLOWLIST = ["pi", "claude-code", "codex", "gemini"] as const;
if (!ADAPTER_ALLOWLIST.includes(adapter as any)) {
  console.error(c.red(`Unknown adapter: ${adapter}`));
  console.error(c.dim(`Allowed: ${ADAPTER_ALLOWLIST.join(", ")}`));
  process.exit(2);
}
```

Reuse `VALID_ADAPTERS` from `cli/src/commands/init.ts` — promote it to `cli/src/utils.ts` as `ADAPTER_ALLOWLIST` so both commands share one source of truth. Also applied in `cli/src/adapter-session.ts`'s `loadAdapterRuntime` as a defense-in-depth check (it already has `ADAPTER_MAP` which is effectively an allowlist; explicit `throw` on unknown platform stays).

**This allowlist is a security boundary, not a convenience list.** Adding a new adapter (e.g., OpenCode in 0.8.0) deliberately requires a CLI release that adds the name to the allowlist. That is a feature, not a limitation — it ensures every adapter name the CLI will load has been reviewed by a CLI maintainer, which is the guarantee an allowlist buys you. Runtime-extensible allowlists (env var, config file) are explicitly rejected for this reason.

### D3 — Profile-authoritative `enforceToolAccess` with CLI narrowing

Two layers:

#### D3.1 Profile declares what's allowed

Extend the profile schema (runtime-side) with an optional `tools` block:

```yaml
# core/profiles/<name>/profile.yaml
id: execution-code-reviewer
tools:
  execute_code:
    enabled: true
    languages: [python, bash]   # subset of: bash, typescript, python, javascript
    max_timeout_ms: 60000        # hard ceiling; per-call timeout must be ≤ this
  read_file: { enabled: true }
  # Unlisted tools default to enabled: false
```

- Default (no `tools` block): every tool listed in the schema defaults to `enabled: false` **except** `readFile` / `writeFile` / `listDirectory` / `grep` / `invokeSkill`, which default to `enabled: true`. Those are the tools existing profiles rely on today; flipping them would break every deliberation profile.
- `executeCode` defaults to **`enabled: false`** even without a `tools` block. This is the breaking change, scoped to a tool no profile currently exercises.
- Schema lives in `runtime/src/profile-schema.ts` (or wherever profile-loader validates). Validation runs at profile load time — a typo in `languages` fails loading, not at tool-call time.

**Known over-broad default — `writeFile` for deliberation profiles.** Deliberation profiles don't legitimately need `writeFile`; only execution profiles do. Tightening the default to read-only-by-default would shrink the attack surface further. We are **not** tightening it in this spec because (a) it breaks every existing deliberation profile that happens to call `writeFile` incidentally (e.g., saving intermediate notes) and we have no survey of which profiles do, and (b) this spec's remit is closing the RCE gap in `executeCode`, not a full tool-policy audit. **Recorded as a 1.0 follow-up**: split defaults by profile type (`type: deliberation` → read-only default, `type: execution` → read+write default), with a deprecation warning shipped in the minor before 1.0 for any profile whose actual tool usage wouldn't be allowed under the tightened default.

**Worker-agent policy inheritance.** Hierarchical delegation (Engineering-Lead → workers, etc.) must not become a policy-escape hatch. **Workers inherit the session-level frozen `ToolPolicy` and cannot widen it.** Concretely:

- `BaseWorkflow.toolPolicy` is set once, at engine-start, from `(rootProfile, cliFlags)`.
- When a parent agent spawns a worker, the worker's spawn config may specify a `tools` subset (narrowing), but any attempt to set `enabled: true` on a tool the session policy has `enabled: false` is rejected at spawn time with `UnsupportedError`.
- The narrowing semantics mirror the domain-inheritance rules (children only narrow parents). An engineering lead whose own profile denies `executeCode` cannot spawn a worker that uses `executeCode`, even if the worker's config requests it.
- `enforceToolAccess` performs the lookup against the session policy, not the worker's declared tools. The worker's declared tools are used only to *further* narrow what that specific worker is allowed to do; they never participate in the authorization decision in a widening direction.

This is a single extra check in the worker-spawn path plus one test per narrowing invariant. Non-blocking to ship the rest of D3.

#### D3.2 CLI flag can only narrow

```
aos run --allow-code-execution=python       # intersect profile's allowlist with {python}
aos run --allow-code-execution=none         # disable even if profile allows
aos run --allow-code-execution              # bare flag = enable all the profile allows (no-op vs profile)
```

Never widens. If a profile did not set `tools.execute_code.enabled: true`, the flag is rejected with an error (explicit, not silent) — we won't accept a CLI flag that turns on a capability the profile's author did not sign off on.

#### D3.3 `enforceToolAccess` implementation

`BaseWorkflow` holds a frozen `ToolPolicy` object built once from `(profile, cliFlags)` at engine-start time and never mutated. `enforceToolAccess` becomes a pure lookup:

```ts
async enforceToolAccess(agentId, { tool, command }): Promise<{ allowed: boolean; reason?: string }> {
  const policy = this.toolPolicy;         // frozen
  const entry = policy[tool];
  if (!entry?.enabled) {
    return { allowed: false, reason: `tool "${tool}" is not enabled in profile` };
  }
  if (tool === "execute_code" && command) {
    const lang = command.language ?? "bash";
    if (!entry.languages.includes(lang)) {
      return { allowed: false, reason: `language "${lang}" not in profile allowlist` };
    }
  }
  return { allowed: true };
}
```

`executeCode` must call `enforceToolAccess` first and throw `UnsupportedError` (existing type) on deny. Other tools that already enforce access (`readFile` via `validatePath`, etc.) keep their current checks — `enforceToolAccess` is an **additional** gate, not a replacement.

### D4 — Path confinement for CLI-consumed paths from config/adapter output

Introduce a `confinedResolve(base: string, rel: string): string` helper in `cli/src/utils.ts`:

```ts
import { resolve, sep, normalize } from "node:path";

export function confinedResolve(base: string, rel: string): string {
  const absBase = normalize(resolve(base));
  const absTarget = normalize(resolve(absBase, rel));
  if (absTarget !== absBase && !absTarget.startsWith(absBase + sep)) {
    throw new Error(`Path escapes base directory: ${rel}`);
  }
  return absTarget;
}
```

`path.normalize` collapses mixed separators (Windows can produce `C:/foo\bar` from `resolve()` when inputs mix styles), `path.sep` is the platform-native separator. The `absTarget !== absBase` check allows `rel === ""` / `rel === "."` (resolves exactly to base). Verify on Bun (macOS + Linux at minimum; Windows is best-effort — `bun-windows-path-quirks.test.ts` in the plan) that `resolve()` output is idempotent under `normalize()`. Bun is the only supported runtime, so we're not chasing Node/Deno variants.

Apply it to:

- **PATH-002** — `cli/src/commands/run.ts` `--workflow-dir`, `--brief`, and `cli/src/commands/replay.ts` `<path>` **only when the value comes from `.aos/config.yaml` or an adapter response**, not when the user typed it directly on the CLI. Direct CLI args stay unconfined (user is already trusted at the CLI trust boundary). To tell them apart: the CLI parses flags; config-sourced values never reach those flags.
- **PATH-003** — `cli/src/commands/create.ts` validates the post-`toKebabCase` name against `/^[a-z0-9][a-z0-9-]*$/` before any `join(root, "core", ..., id)`. Fail with a clear error listing the invalid characters. No `confinedResolve` needed; the regex is the guard.

### D5 — URL validation for `platformUrl`

New helper `validatePlatformUrl(url: string): URL` in `cli/src/utils.ts`:

- Parse with `new URL(url)`; reject if parse fails.
- Enforce scheme `https:` **unless** hostname is `localhost` or `127.0.0.1` (then `http:` is allowed for local development).
- Resolve the hostname once; reject if it resolves to a link-local (`169.254.0.0/16`), loopback (outside the `localhost` exception), or metadata-service address.
- Add a bypass: `AOS_ALLOW_INSECURE_PLATFORM_URL=1` skips the checks (for internal testing only, undocumented in public README, documented in `docs/security.md`).

Called once at `run.ts:318` when `platformUrl` is set. A bad URL exits `2` before any fetch is issued.

**Known limitation — DNS rebinding / TOCTOU.** This validator resolves the hostname once; the actual `fetch()` may resolve it again and get a different answer. An attacker who controls the DNS for a hostname the user puts in `.aos/config.yaml` could return a safe IP on validation and a metadata-service IP on the real request. This is the canonical DNS-rebinding pattern. We accept this risk because:

1. The attacker must already control a hostname the user willingly configured — this is not a drive-by attack.
2. True mitigation requires pinning the resolved IP into the connection (custom `Agent` in Node / `tls.connect({servername})` separation) which is out of scope for a CLI telemetry feature.
3. The user's workstation is a far less interesting SSRF target than a cloud server (no IAM metadata service on a laptop).

The validator is still load-bearing against the much more common case: a typo, a misconfigured `platform.url`, or an adapter-influenced URL pointed at `169.254.169.254` / `file:///` directly. Full DNS-rebinding hardening is explicitly deferred.

### D6 — Error taxonomy

Two distinct failure classes, kept rigorously separate:

**Startup-time failures** exit the process with a non-zero code. These fire before the engine starts and include every invalid-input case that can be detected up front:

| Cause | Exit code | Example stderr line |
|---|---|---|
| Unknown adapter | 2 | `Unknown adapter: foo. Allowed: pi, claude-code, codex, gemini` |
| Invalid create name | 2 | `Invalid name "../evil": must match /^[a-z0-9][a-z0-9-]*$/` |
| Invalid platform URL | 2 | `platform.url rejected: scheme "file" not allowed` |
| Malformed `tools` block in profile | 3 | `profile "x" tools.execute_code.languages: unknown value "ruby"` |
| Flag widens profile (e.g. `--allow-code-execution` on a deny-profile) | 3 | `flag --allow-code-execution cannot widen profile "x" (execute_code not enabled)` |

**Runtime (mid-session) denials** are **not** process exits. An agent that calls a disallowed tool gets an `UnsupportedError` returned as a normal tool-result error; the model reads the error and decides what to do (typically: try a different approach). The session continues, the transcript records the denial (see D7 / open question 2), and the top-level exit code is whatever the session's natural outcome is.

The distinction is load-bearing:

- **Startup** = the operator mis-configured something; fail fast and loudly.
- **Runtime denial** = policy is doing its job in the middle of a live deliberation; killing the session would be a denial-of-service to the operator for an event that is *expected* under a tightened policy.

Exit `3` (policy validation failure at startup) is new; document it in `cli/README.md` and the profile-authoring guide. Exit `2` stays the catch-all for user-input validation failures.

## Architecture

Three edit sites, clean boundaries:

```
cli/
├── src/
│   ├── utils.ts                    ← add ADAPTER_ALLOWLIST, confinedResolve, validatePlatformUrl
│   ├── commands/
│   │   ├── run.ts                  ← adapter allowlist check; drop project-local override;
│   │   │                             platformUrl validation; wire ToolPolicy into session
│   │   ├── replay.ts               ← confinedResolve for config-sourced paths
│   │   └── create.ts               ← regex validation on sanitized name
│   └── adapter-session.ts          ← pass ToolPolicy through to BaseWorkflow constructor
│
adapters/shared/
└── src/
    └── base-workflow.ts            ← enforceToolAccess: lookup against frozen policy;
                                      executeCode calls enforceToolAccess first
│
runtime/
└── src/
    ├── profile-schema.ts           ← new `tools` block in profile YAML schema
    └── profile-loader.ts           ← parse + validate tools block, default to denied for execute_code
```

No cross-layer surprises. The runtime owns the schema (it already owns profiles). The CLI owns the flag and the entry-point checks. `BaseWorkflow` owns the enforcement. No new persisted state, no new commands, no IPC changes.

## Data Flow

### Adapter load (post-change)

```
.aos/config.yaml or --adapter
  ↓
  ADAPTER_ALLOWLIST check ────────── reject → exit 2
  ↓ (passed)
  getAdapterDir(name)
    ↓ monorepo path at CLI's import.meta.dir (dev only)
    ↓ else @aos-harness/<name>-adapter via import.meta.resolve
  ↓
  adapter-session.ts loadAdapterRuntime (ADAPTER_MAP, npm import())
  ↓
  RuntimeClass instantiated
```

### Tool access (post-change)

```
profile.yaml (tools block)  ─┐
                             ├──> ToolPolicy.from(profile, cliFlags)  (frozen)
CLI --allow-code-execution  ─┘                         │
                                                       ↓
                                  BaseWorkflow constructed with policy
                                                       │
agent calls executeCode ──────────────────────────────→│
                                   enforceToolAccess(...)
                                     ├── allowed → spawn()
                                     └── denied  → throw UnsupportedError (exit 3)
```

## Error Handling

- **Unknown adapter / bad platform URL / bad create name** exit `2` with a single-line stderr + a `dim` hint on the allowlist or format. No stack trace. Startup-time.
- **Profile with invalid `tools` block** fails at profile-load time with a Zod-style validation error citing the bad field. Exit `3`. The runtime already does this kind of validation for other profile fields; we extend the same mechanism.
- **Flag-widens-profile** (e.g. `--allow-code-execution=ruby` against a profile that denies `execute_code`) exits `3` at startup with `flag --allow-code-execution cannot widen profile "<name>"`.
- **Mid-session tool denial** throws `UnsupportedError` (existing type) from `enforceToolAccess`; the agent runtime converts that into a tool-result error and lets the model decide what to do. Deliberation continues; session does not crash. **This never produces a non-zero exit code.** Denials are recorded in `transcript.jsonl` as `tool-denied` events (see D7.1 below) for post-hoc audit.
- **Worker spawn that tries to widen session policy** throws `UnsupportedError` from the spawn call (also mid-session); parent agent sees a failed spawn and reacts like any other spawn failure. No process exit.

## Testing

All new behavior is testable without network, without real LLMs, and without spawning real `bash`/`python`. One test file per edit site.

### CLI (Bun test against a temp workspace)

- `tests/cli/adapter-allowlist.test.ts`
  - `adapter: ../../evil` in config → exits 2
  - `--adapter banana` → exits 2, stderr lists the allowlist
  - `--adapter pi` with no `@aos-harness/pi-adapter` installed → hits existing missing-adapter path (not our new allowlist)
- `tests/cli/no-project-local-adapters.test.ts`
  - Temp project with `core/agents/` + `adapters/pi/src/index.ts` containing `process.exit(99)` → CLI must NOT spawn that file. Expect exit from the real adapter resolution path (or exit 2 missing-adapter), never exit 99.
- `tests/cli/platform-url-validation.test.ts`
  - `platform.url: http://169.254.169.254/` → exit 2
  - `platform.url: file:///etc/passwd` → exit 2
  - `platform.url: https://api.example.com` → accepted (no fetch in test; just validation)
  - `platform.url: http://localhost:8080` → accepted
  - With `AOS_ALLOW_INSECURE_PLATFORM_URL=1`, `http://10.0.0.1` → accepted
- `tests/cli/create-name-validation.test.ts`
  - `aos create agent ../evil` → exit 2
  - `aos create agent "A New Agent"` → kebab-cased to `a-new-agent`, accepted
  - `aos create agent my.agent` → exit 2 (dot rejected)

### Runtime (profile schema)

- `tests/runtime/profile-tools-schema.test.ts`
  - Profile without `tools` block → `ToolPolicy.execute_code.enabled === false`, `readFile.enabled === true`
  - Profile with `tools.execute_code: { enabled: true, languages: [python] }` → policy allows python, rejects bash
  - Profile with `tools.execute_code.max_timeout_ms: 5000` + per-call `timeout_ms: 10000` → rejected with clear error
  - Unknown language in allowlist → profile load fails at validation time (not tool-call time)

### Workflow (pure unit)

- `tests/adapters-shared/enforce-tool-access.test.ts`
  - Default policy: `executeCode({code,language:"bash"})` → `UnsupportedError("tool \"execute_code\" is not enabled")`, child process never spawned
  - Policy allows `["python"]`: bash call denied, python call allowed (assert `spawn` is called with `python3`; mock `spawn`)
  - CLI narrowing: policy from profile `[python, bash]` + flag `python` → bash denied
  - Flag widens profile: construction throws (startup-time exit 3)
  - Denial appends a `tool-denied` event to the configured transcript path (D7.1) — assert via fs read after a denied call
  - `listEnabledTools()` returns the frozen policy shape and throws on mutation attempts (D7.2)
- `tests/adapters-shared/worker-policy-inheritance.test.ts`
  - Parent session denies `execute_code`; worker spawn config sets `tools.execute_code.enabled: true` → spawn throws `UnsupportedError`
  - Parent session allows `[python, bash]`; worker narrows to `[python]` → worker can call python, bash call denied at the worker level
  - Worker spawn with no `tools` block inherits parent session policy verbatim

### Runtime verification (one-shot, gated)

- `tests/cli/import-meta-dir-symlink.test.ts` — run once in the plan's Step 1 to verify D1's Bun symlink assumption:
  1. Create a temp `aos-harness-like` checkout (minimal fixture: `package.json` + `cli/src/commands/run.ts` stub that logs `import.meta.dir`).
  2. `npm link` it from a sibling empty project.
  3. Run the stub under Bun. Assert `import.meta.dir` points into the checkout, not the global `node_modules/aos-harness` path.
  4. If the assertion fails on the current Bun version, halt the plan and surface a blocker. Pin `engines.bun` accordingly before proceeding.

### Integration sanity

- Existing `tests/integration/validate-config.ts` stays green (it doesn't exercise `executeCode`).
- One new integration: a deliberation profile runs end-to-end with the default-denied `executeCode` and produces the same memo as today. If it doesn't, some real profile is secretly using `executeCode` and we need to know.

## Migration

- **User-visible breaking change:** any profile that wanted `executeCode` now needs `tools.execute_code.enabled: true`. CHANGELOG entry under 0.7.0 with a one-paragraph migration note and a link to the profile-authoring guide update.
- **Deprecation window:** none. Flipping from "silently allowed, never used" to "must opt in" is safer to do as a hard cutover — there's no fleet of profiles out there that will break quietly.
- **Monorepo contributors:** no change. Monorepo `adapters/` path still works because `getAdapterDir` checks the CLI's own `import.meta.dir`, not the user's `getHarnessRoot()`.
- **Adapter authors outside the monorepo:** `npm link @aos-harness/my-adapter` (documented in `docs/adapter-authoring.md` — new section; 6 lines of prose).

## Rollout

This spec plus its implementation plan fit inside one release (0.7.0). No feature flag gymnastics, no dual-write, no telemetry. The changes are small enough and testable enough that a pre-release candidate to `npm` with a 48-hour soak is the whole rollout strategy. Regression test (cloned hostile repo scenario) is automated; no manual QA gate.

### D7 — Settled follow-ons (previously "open questions")

#### D7.1 Tool-denied transcript events (ship it)

`enforceToolAccess` denials append a line to the session's `transcript.jsonl`:

```jsonl
{"ts":"2026-04-14T12:34:56.789Z","type":"tool-denied","agent":"arbiter","tool":"execute_code","reason":"tool \"execute_code\" is not enabled in profile","detail":{"language":"bash"}}
```

Auditability for security controls is not optional. If we don't ship it with the enforcement, it will never get added — the most useful time to have these events is the first time a denial fires in anger (profile misconfiguration, unexpected agent behavior, or actual prompt-injection attempt). Cost: one `appendFileSync` inside the already-existing deny path. ~8 lines in `BaseWorkflow`, ~5 lines of test.

#### D7.2 `listEnabledTools()` on `BaseWorkflow` (ship it)

Read-only method returning the frozen policy as a plain object:

```ts
listEnabledTools(): Readonly<{ [tool: string]: { enabled: boolean; [k: string]: unknown } }>;
```

Agents (via the runtime) can query this to know what's available before attempting a call. Prevents wasted rounds on denied calls. Trivially safe because the underlying object is already frozen. ~3 lines in `BaseWorkflow`, exposed through the existing adapter-to-workflow surface.

Both ship with the main implementation, not as follow-ups.
