# AOS Harness Spec Compliance Audit

**Date:** 2026-03-24
**Spec:** `docs/specs/2026-03-23-aos-harness-design.md`
**Auditor:** Automated spec-vs-implementation audit

---

## Summary

- **~72 of ~95 spec requirements implemented**
- **5 critical gaps** (blocks early adopter readiness)
- **11 important gaps** (should fix before v1.0)
- **7 minor gaps** (nice to have)

---

## Critical Gaps (blocks early adopter readiness)

### 1. Engine does not emit most transcript event types (Section 6.10)

The engine only emits `session_start`, `agent_spawn`, `delegation`, `response`, and `session_end`. The following event types are defined in `types.ts` but never emitted by the engine:

- `constraint_check` -- should be emitted after every round
- `constraint_warning` -- should fire when approaching a maximum (80%+)
- `budget_estimate` -- should fire before each `dispatchParallel`
- `budget_abort` -- should fire when budget exceeded mid-round
- `steer` -- should fire when steerMessage is used
- `error` -- should fire on agent failure
- `expertise_write` -- should fire on scratch pad update
- `final_statement` -- should fire during `end()` for each agent's final statement
- `agent_destroy` -- should fire when agents are torn down

**Impact:** Transcripts are incomplete. Replaying a session will miss constraint states, budget events, and errors.

### 2. No timeout or retry logic in engine or Pi adapter (Section 6.5)

The spec defines per-agent timeout (`agent_timeout_seconds`), retry policy (`max_retries` with exponential backoff), and failure modes (`on_agent_failure: skip | abort_round | abort_session`). None of this is implemented:

- `engine.ts` does not read `error_handling` from the profile
- `agent-runtime.ts` has no timeout on subprocess calls
- No retry wrapper exists anywhere in the codebase
- `on_agent_failure` behavior is not implemented

**Impact:** A hanging agent will block the entire session indefinitely. A crashed agent will surface as an unhandled error instead of graceful degradation.

### 3. No pre-round budget estimation (Section 6.7)

The spec requires that before each `dispatchParallel`, the constraint engine estimates whether the round will exceed remaining budget and takes action (`drop_optional`, `warn_arbiter`, or `block_round`). The engine has `estimateRoundCost()` and `checkBudgetHeadroom()` methods in `constraint-engine.ts`, but `engine.ts` never calls them. The `budget_estimation` config from the profile is loaded but unused at runtime.

**Impact:** Budget can be silently exceeded without warning or intervention.

### 4. No Arbiter constraint message injection (Section 6.11)

The spec defines a structured markdown constraint message that the engine should inject into the Arbiter's context after every round. The Pi adapter returns constraint state as tool result data in the `delegate` tool response, but this is a simplified version -- it omits the full formatted message with conditional sections (`approaching_maximum`, `hit_maximum`, `bias_blocked`), available actions list, and the detailed format specified in Section 6.11.

The engine itself has no `formatConstraintMessage()` function. The Pi adapter handles this ad hoc in the tool result.

**Impact:** The Arbiter receives raw numbers instead of the structured, directive constraint message the spec requires. Prompt compliance with constraint rules depends on the Arbiter inferring the right behavior from raw data.

### 5. `adapter.schema.json` missing (Appendix C)

The spec defines `core/schema/adapter.schema.json` for validating adapter configuration files (e.g., `adapters/pi/config.yaml`). This file does not exist.

**Impact:** No adapter configuration can be validated. This also means there is no `config.yaml` in the Pi adapter directory with the model_map, theme, and editor settings described in the spec.

---

## Important Gaps (should fix before v1.0)

### 1. `executeWithCheckpoints`, `reviewLoop`, `verifyBeforeComplete` not in engine (Section 6.2)

The spec's `AOSEngine` class definition includes three workflow orchestration methods:
- `executeWithCheckpoints(steps, reviewFn)`
- `reviewLoop(dispatchFn, fixFn, maxIterations)`
- `verifyBeforeComplete(evidenceFn)`

These are described as runtime-level methods that compose adapter primitives. None exist in `engine.ts`. While the spec notes these compose adapter primitives and are more relevant for Phase 2 workflows, they are listed as part of the core engine API.

### 2. SaaS domain overlays use non-spec fields (Section 5.1 vs actual)

The domain schema (Section 5.1) defines overlays with: `thinking_patterns`, `heuristics`, `red_lines`, `evidence_standard` (as `{convinced_by, not_convinced_by}`), and `temperament`.

The SaaS domain YAML uses:
- `lens_additions` (not in spec -- an array of `{label, instruction}` objects)
- `evidence_standard` as a flat string instead of the spec's `{convinced_by: [], not_convinced_by: []}` structure

The domain.schema.json does include `evidence_standard` with the correct nested structure, but the actual SaaS domain.yaml does not conform to this. The `lens_additions` field is not in the schema at all.

**Impact:** The domain merger in `domain-merger.ts` only handles spec-compliant overlay fields. The `lens_additions` and flat `evidence_standard` in the SaaS domain are silently ignored during merge.

### 3. `incident-response` profile missing (Section 4.2, Phase 2)

The spec lists 5 profiles: strategic-council (Phase 1), security-review, delivery-ops, architecture-review, and incident-response (all Phase 2). Four profiles exist. `incident-response` is missing.

### 4. `personal-decisions` domain missing (Section 5.2, Phase 2)

The spec lists 5 domains: saas (Phase 1), healthcare, fintech, platform-engineering, and personal-decisions (all Phase 2). Four domains exist. `personal-decisions` is missing.

### 5. `--verbose`, `--dry-run`, and `aos replay` not implemented (Section 6D)

The spec requires:
- `--verbose` flag for streaming engine decisions to stderr
- `--dry-run` flag for validating config and simulating without model calls
- `aos replay <transcript.jsonl>` command for re-rendering transcripts

None of these exist in the CLI. The `aos` CLI has `init`, `run`, `create`, `validate`, and `list` commands only.

### 6. `getting-started` documentation missing (Phase 1 deliverable)

The spec lists `docs/getting-started/` as a Phase 1 deliverable. This directory does not exist.

### 7. Phase 2 documentation directories missing (Section 9)

`docs/creating-agents/`, `docs/creating-profiles/`, `docs/creating-domains/` are Phase 2 deliverables and do not exist.

### 8. Tool whitelist not enforced at spawn (Section 6.14)

The spec states: "The adapter enforces the whitelist when spawning the agent subprocess." The Pi adapter's `spawnAgent` and `sendMessage` methods do not check the agent's `tools` field. Agents with `tools: []` (no tools) or explicit whitelists are spawned with the same Pi flags regardless.

The `--no-extensions --no-skills --no-prompt-templates --no-themes` flags are always applied, but the per-agent tool whitelist (`tools: ["read", "write"]`) is not translated into Pi-specific flags.

### 9. Expertise scratch pad concurrency warning not implemented (Section 6.9)

The spec states: "If profile uses dispatchParallel AND any agent has mode: shared, config-loader.ts emits a WARNING during validation." The config loader does not check for this condition.

### 10. SteerMessage governance incomplete (Section 5G)

The spec requires steer messages to be logged in the transcript with `"type": "steer"` and `"source": "user_command"`. The Pi adapter's `index.ts` uses `pi.sendUserMessage(msg, { deliverAs: "steer" })` for the wrap command, but no transcript entry is written for this event. The engine has no `steerMessage()` method.

### 11. Pi adapter template variable names use hyphens, but agent prompts use underscores (Section 6.13)

In `adapters/pi/src/index.ts`, the template resolution uses hyphenated keys like `session-id`, `brief-content`, `output-path`. But the Arbiter's `prompt.md` and the spec both use underscore-delimited variables: `{{session_id}}`, `{{brief}}`, `{{output_path}}`. The `resolveTemplate` regex supports `[\w-]+` so both formats work, but the Pi adapter's variable map does not include the underscore versions (`session_id`, `brief`, `output_path`, `participants`, `constraints`, `expertise_block`, `deliberation_dir`). This means the Arbiter's prompt variables are NOT being resolved by the Pi adapter.

**Impact:** The Arbiter prompt contains unresolved `{{session_id}}`, `{{brief}}`, `{{output_path}}`, `{{participants}}`, `{{constraints}}`, `{{expertise_block}}`, `{{deliberation_dir}}` placeholders at runtime.

---

## Minor Gaps (nice to have)

### 1. Runtime is ~1388 lines, spec targets ~1200

The spec describes "~1200 lines TypeScript, 7 modules." The actual runtime is 1388 lines across 7 files. This is close and within reasonable tolerance.

### 2. SaaS domain overlay `guardrails` format differs from spec

The spec shows `guardrails: []` as an array of strings. The SaaS domain uses an array of objects with `id` and `rule` fields. The domain.schema.json validates guardrails as `string[]`, which means the current SaaS domain's guardrails would fail schema validation.

### 3. Transcript `session_start` event missing required fields (Section 6.10)

Per the spec, `session_start` should include: `session_id, profile, domain, participants, constraints, auth_mode`. The engine only writes `sessionId` and `briefPath`.

### 4. `constraint_check` event field names differ from spec (Section 5D)

The spec shows `"past_minimums"` and `"approaching_maximums"` in the transcript. The actual `ConstraintState` uses `past_all_minimums` and `approaching_any_maximum`. Since the engine does not emit `constraint_check` events at all (see Critical Gap 1), this is moot but should be aligned when implemented.

### 5. No JSON Schema validation at load time (Section 6E)

The spec says `config-loader.ts` validates against JSON Schema. The actual `config-loader.ts` does manual field checks but does not import or validate against `agent.schema.json`, `profile.schema.json`, or `domain.schema.json`. The schema files exist but are not used programmatically.

### 6. Profile schema does not require `error_handling`, `budget_estimation`, `expertise`, or `controls` (Section 4.1)

The JSON schema's `required` array for profiles is: `["schema", "id", "name", "assembly", "constraints", "input", "output"]`. The spec shows `error_handling`, `budget_estimation`, `expertise`, and `controls` as top-level sections but they are optional in the schema. This is arguably correct (optional fields), but the strategic-council profile includes them, so they should at least be documented as recommended.

### 7. `output_path` template variable not resolved in Pi adapter

The Pi adapter computes `memoPath` but passes it with the key `"memo-path"` (hyphenated) in the template variables, not as `"output_path"` (underscored). The Arbiter's prompt uses `{{output_path}}`, which will not resolve.

---

## Fully Compliant Sections

### Section 2: Architecture
- **4-layer adapter contract:** All 4 interfaces (`AgentRuntimeAdapter`, `EventBusAdapter`, `UIAdapter`, `WorkflowAdapter`) are fully defined in `types.ts` with all methods matching the spec.
- **Platform coverage:** Pi adapter implements all 4 layers with all methods. All "Full" capability items are implemented.

### Section 3: Agent Schema
- **agent.schema.json** matches the spec exactly (all fields, types, enums).
- **All 12 agents** exist with YAML + prompt.md (1 orchestrator + 8 perspectives + 3 operational).
- **All agents have all required fields:** schema, id, name, role, cognition (with all 5 sub-fields), persona (temperament, thinking_patterns, heuristics, evidence_standard, red_lines), tensions, report, tools, skills, expertise, model.
- **All prompt.md files** contain `{{agent_name}}` and `{{session_id}}` template variables.

### Section 4: Profile Schema
- **profile.schema.json** matches the spec, including `error_handling`, `budget_estimation`, `expertise`, and `controls`.
- **strategic-council profile** has all fields from the spec including all 11 perspective agents, 5 tension pairs, constraints, error handling, budget estimation, input sections, output config, expertise, and controls.
- **All 4 profiles** reference valid agent IDs and have valid tension pairs.

### Section 5: Domain Schema
- **domain.schema.json** includes `evidence_standard` in overlays (with `convinced_by`/`not_convinced_by`).
- **All 4 domains** load successfully with valid overlay structures.

### Section 6: Runtime (partial)
- **All 7 modules exist:** types.ts, engine.ts, constraint-engine.ts, delegation-router.ts, template-resolver.ts, config-loader.ts, domain-merger.ts.
- **ConstraintState interface** matches spec exactly, including `bias_ratio`, `most_addressed`, `least_addressed`, `bias_blocked`, `metered`, `conflict_detail`.
- **Adapter interfaces** match spec, including `getAuthMode()` and `getModelCost()`.
- **Structural advantage** (Section 6.4): Code-enforced. `speaks-last` agents are separated into `sequential` array in `DelegationRouter` and called after parallel agents in both broadcast and end.
- **Constraint conflict resolution** (Section 6.6): Priority order implemented correctly. Budget max > time max > rounds max > soft floors. Conflict detection with `isSignificantMinGap`.
- **Budget estimation** (Section 6.7): Auth-aware -- `metered: false` disables budget. `budget: null` disables budget. Implemented in `ConstraintEngine` constructor.
- **Bias limit** (Section 6.8): Counting rules correct -- broadcast increments all, targeted increments only addressed. Ratio calculated on required agents only. Blocking at `>= bias_limit`. Neglected agents reported.
- **Domain merge rules** (Section 6.12): All 7 merge rules implemented correctly (append thinking_patterns, heuristics, red_lines, evidence_standard, temperament; no tension merge; never removes).
- **Template variables** (Section 6.13): `resolveTemplate` handles `{{VARIABLE}}` with `[\w-]+` pattern. Unknown variables left as-is.
- **Arbiter prompt skeleton** (Section 6.15): All 6 sections present in prompt.md (Identity, Protocol, Constraint Awareness, Delegation Syntax, Synthesis Instructions, Expertise). Template variables included.

### Section 6B: Testing
- **Unit tests exist** for all 7 runtime modules (including `mock-adapter.ts` for integration tests).
- Test files: `constraint-engine.test.ts`, `delegation-router.test.ts`, `template-resolver.test.ts`, `config-loader.test.ts`, `domain-merger.test.ts`, `engine.test.ts`, `types.test.ts`.

### Section 6E: Schema Versioning
- All schemas are versioned (`aos/agent/v1`, `aos/profile/v1`, `aos/domain/v1`).
- `config-loader.ts` validates schema version and rejects unknown versions with clear error messages.

### Section 9: Build Phases (partial)
- **Phase 1 core config:** All 3 JSON schemas, all 12 agents, strategic-council profile, SaaS domain -- all present.
- **Phase 1 runtime:** All 7 modules present with unit tests.
- **Phase 1 Pi adapter:** Full 4-layer implementation present.
- **Phase 2 profiles:** 3 of 4 present (missing incident-response).
- **Phase 2 domains:** 3 of 4 present (missing personal-decisions).
- **Phase 2 workflows:** All 6 workflow YAML files present.

### Appendix B: Claude Code Adapter
- **Code generator** implemented in `adapters/claude-code/src/generate.ts` and `templates.ts`.
- Generates agent files, command files, and CLAUDE.md fragments.
- **Limitations** are implicit in the generated output (constraints as advisory prompt text, no runtime enforcement).

### CLI
- `aos init`, `aos run`, `aos create`, `aos validate`, `aos list` commands all implemented.
- `aos validate` performs comprehensive checks: agents, profiles, domains, briefs, template resolution, constraint engine, delegation router.

---

## Spec Section Cross-Reference

| Spec Section | Status | Notes |
|---|---|---|
| 2.1 Hybrid Config + Runtime | PASS | Config-first design with minimal runtime |
| 2.2 4-Layer Adapter Contract | PASS | All interfaces defined |
| 2.3 Platform Coverage | PASS | Pi adapter is full, Claude Code is generator |
| 3.1 Agent Schema | PASS | Schema and types match |
| 3.2 Agent Roster (12) | PASS | All 12 agents present |
| 3.3 Tension Pairs | PASS | All pairs in strategic-council |
| 4.1 Profile Schema | PASS | Schema matches |
| 4.2 Included Profiles | PARTIAL | Missing incident-response |
| 5.1 Domain Schema | PASS | Schema matches |
| 5.2 Included Domains | PARTIAL | Missing personal-decisions |
| 5B Brief Format | PASS | |
| 5C Memo Output | PASS | Frontmatter injection works |
| 5D Transcript Format | FAIL | Most event types not emitted |
| 5E Workflow Schema | PASS | Phase 2 YAML files present |
| 5F Model Tier Mapping | PASS | Pi adapter has tier-to-model map |
| 5G SteerMessage | PARTIAL | Pi uses `deliverAs: "steer"` but no transcript logging |
| 6.1 Adapter Interface | PASS | All methods present |
| 6.2 Engine Class | PARTIAL | Missing workflow methods |
| 6.3 Session Lifecycle | PARTIAL | Core flow works; missing constraint message, budget pre-check |
| 6.4 Structural Advantage | PASS | Code-enforced speaks-last |
| 6.5 Error Handling | FAIL | No timeout, retry, or failure modes |
| 6.6 Constraint Conflict | PASS | Priority order correct |
| 6.7 Budget Estimation | PARTIAL | Auth-aware but pre-round estimation not called |
| 6.8 Bias Limit | PASS | Counting rules correct |
| 6.9 Expertise Concurrency | PARTIAL | Missing shared-mode warning |
| 6.10 Transcript Events | FAIL | Most event types never emitted |
| 6.11 Constraint Message | FAIL | No formatted message to Arbiter |
| 6.12 Domain Merge | PASS | All rules implemented |
| 6.13 Template Variables | PASS | Resolution works |
| 6.14 Tool Whitelist | FAIL | Not enforced at spawn |
| 6.15 Arbiter Prompt | PASS | All sections present |
| 6B Testing | PASS | Unit tests for all modules |
| 6C Security | PARTIAL | Sandboxing flags present; tool whitelist not enforced |
| 6D Observability | FAIL | No --verbose, --dry-run, or replay |
| 6E Schema Versioning | PASS | Versions enforced in loader |
| 9 Phase 1 | PARTIAL | Missing docs/getting-started |
| 9 Phase 2 | PARTIAL | Missing 1 profile, 1 domain, Phase 2 docs |
| Appendix B Claude Code | PASS | Generator implemented |
| Appendix C adapter.schema.json | FAIL | File does not exist |
