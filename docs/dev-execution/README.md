# Dev Execution

Dev Execution is a one-session workflow that takes a feature brief and produces working code. It combines structured planning deliberation with agent-driven code implementation, moving from a raw feature description to committed-ready changes without switching contexts or tools.

The workflow is designed for engineers who want to hand off implementation details to a coordinated agent team while staying in control of the key decisions. You approve at four gates; agents handle the rest.

---

## How It Works

Dev Execution runs nine steps across two phases.

**Planning phase**

1. **Requirements analysis** — Advocate and Strategist read the brief. Advocate extracts user stories and acceptance criteria. Strategist frames the business problem and maps it to the codebase.
2. **Architecture** — Architect produces an architecture decision record covering component boundaries, data flow, and technology choices.
3. **Architecture review** — Sentinel and Provocateur challenge the ADR independently. Gaps, risks, and missed dependencies are surfaced and resolved before any plan is written.
4. **Phase plan** — Strategist and Operator break the work into delivery phases, each with a scope and success condition.
5. **Task breakdown** — Operator decomposes each phase into discrete, assignable tasks with domain labels and dependency order.

**Implementation phase**

6. **Engineering Lead spawns workers** — The engineering-lead agent reads the task breakdown and spawns domain-scoped worker agents, one per task cluster. Workers are assigned only the files and tools relevant to their scope.
7. **Worker implementation** — Each worker executes its assigned tasks and writes code to the working directory. Workers run in dependency order; independent clusters run in parallel.
8. **Sentinel code review** — Sentinel reviews all changed files against the requirements and the architecture decision record. Flagged issues are returned to the responsible worker for revision.
9. **Test verification and synthesis** — Tests run against the written code. The orchestrator assembles a final implementation report covering what was built, what was changed, and what test results look like.

**User approval gates appear at four points:** after requirements analysis, after architecture, after the phase plan, and after the full implementation report.

---

## Usage

```bash
aos run dev-execution --brief feature.md --domain saas
```

The `--brief` flag takes a path to a Markdown file following the brief format described below. The `--domain` flag applies a domain knowledge pack to all agents for the duration of the session.

---

## Writing a Brief

The dev-execution workflow requires four sections in the brief. Missing sections will fail validation before the session starts.

### `## Feature / Change`

Describe what you are building. Be specific about the user-facing behavior or system behavior you want. Do not describe implementation -- that is the agent team's job.

```markdown
## Feature / Change

Add rate limiting to the public API. Each API key should be limited to 1000
requests per hour. Requests that exceed the limit should return HTTP 429 with
a Retry-After header.
```

### `## Context`

Describe the current state of the codebase relevant to this change. List the files, modules, or services that will be affected. If there is existing behavior the change must preserve, note it here.

```markdown
## Context

The public API lives in `src/api/`. Auth middleware is in `src/middleware/auth.ts`.
We use Redis for session storage (client in `src/lib/redis.ts`). No rate limiting
exists today. The API currently returns 401 for auth failures and 400 for
malformed requests -- the new 429 should follow the same error response shape.
```

### `## Constraints`

List hard constraints the implementation must respect. This includes timeline, technical debt limits, dependencies on other work, infrastructure boundaries, and any libraries or patterns that are off-limits.

```markdown
## Constraints

- Must not introduce new infrastructure dependencies (Redis is already available)
- Must not break existing integration tests in `tests/integration/api/`
- Rate limit state must survive a service restart (use Redis, not in-memory)
- No new npm packages -- use the existing `ioredis` client
```

### `## Success Criteria`

Define what done looks like. Include the specific tests that should pass, the behaviors that should be observable, and any non-functional requirements that must be met.

```markdown
## Success Criteria

- `tests/integration/api/rate-limit.test.ts` passes (will be created as part of this work)
- Existing integration tests continue to pass
- A request that exceeds the rate limit receives HTTP 429 with a valid Retry-After header
- Rate limit resets after the window expires
- API key rate limit counts are isolated (one key's usage does not affect another's)
```

---

## The Engineering Lead

The `engineering-lead` agent is the coordinator for the implementation phase. It does not write code directly.

When the planning phase completes, the engineering lead receives the task breakdown produced by the Operator. It reads the dependency graph, groups tasks into domain-scoped clusters (frontend, backend, data, infrastructure, etc.), and spawns a worker agent for each cluster. Each worker is initialized with:

- The tasks assigned to its cluster
- Domain-scoped file and tool permissions (from domain enforcement)
- The relevant artifacts from the planning phase (ADR, requirements, phase plan)

The engineering lead tracks completion across workers. When a dependency exists between clusters, it holds the dependent worker until the upstream cluster reports done. When independent clusters are ready simultaneously, it dispatches them in parallel.

Once all workers report completion, the engineering lead collects their outputs and passes a consolidated change summary to Sentinel for code review.

The engineering lead never touches source files directly. Its role is coordination, dependency sequencing, and result collection.

---

## What You Get

When the session completes, dev execution produces:

- **Implementation report** — A structured summary of what was built, what files were changed, which tasks were completed, and which (if any) were skipped or deferred.
- **Code changes in your working directory** — All files written or modified by worker agents are present in your project. The harness does not stage or commit them.
- **Test results** — Output from the test run triggered at the end of the implementation phase, including pass/fail counts and any failures.
- **Synthesis** — The orchestrator's final assessment of how well the implementation satisfies the brief's success criteria, with notes on anything that diverged from the plan.

Code is written to your working directory. You decide when to review it, when to run additional checks, and when to commit.

---

## Configuration

Dev execution uses the `dev-execution` profile. Default constraints:

| Setting | Default | Notes |
|---|---|---|
| Max duration | 240 minutes | Gate wait time counts against this limit |
| Max rounds | 30 | Applies to each deliberation phase |
| Max test retries | 2 | Per test suite, not per individual test |
| Gate wait | Unlimited | No timeout on user approval gates |

To customize these limits, create a derived profile that extends `dev-execution` and override the `constraints` block:

```yaml
# core/profiles/my-dev-execution/profile.yaml
extends: dev-execution
constraints:
  max_duration_minutes: 120
  max_rounds: 20
```

See [Creating Profiles](../creating-profiles/README.md) for the full profile schema.

---

## Limitations

- **No automatic git commits.** The harness writes files to your working directory and stops. Staging and committing are your responsibility.
- **Max 2 test retries.** If tests fail after two worker revision cycles, the session halts and surfaces the failures in the implementation report. Manual intervention is required.
- **Gate wait counts against session time.** The 240-minute limit includes time spent waiting at approval gates. Long review pauses can exhaust the session budget before implementation completes.
- **Single repo only.** Dev execution operates on a single working directory. Cross-repository changes are not supported.
