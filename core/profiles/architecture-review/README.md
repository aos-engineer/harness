# Architecture Review

The Architecture Review profile assembles a team of agents to evaluate technical architecture decisions against feasibility, scalability, operational reality, and long-term maintainability.

## What it does

A neutral Arbiter orchestrates specialist agents who assess system design from structural, adversarial, operational, and forward-looking perspectives. The architect evaluates current feasibility, the provocateur stress-tests for failure modes, the operator grounds decisions in ops reality, and the pathfinder challenges the team to think about future scale. The result is a structured report with an architecture assessment, scalability analysis, and recommended migration path.

## Agents assembled

**Orchestrator**
- `arbiter` — neutral facilitator; drives the review process and synthesises findings

**Required agents** (always active)
- `architect` — primary evaluator; assesses structural soundness, component design, and integration patterns
- `provocateur` — stress-testing; probes for failure modes, edge cases, and hidden assumptions; speaks last
- `operator` — ops reality; evaluates deployability, observability, and operational burden
- `pathfinder` — future scalability; challenges the team to think beyond current requirements

**Optional agents** (active by default; can be deactivated)
- `catalyst` — time-to-market impact; evaluates how architecture choices affect delivery speed
- `sentinel` — reliability; assesses durability, fault tolerance, and data integrity
- `steward` — compliance implications; flags regulatory or governance concerns in the design

## Input format

Submit a brief (Markdown) with these four required sections:

| Section | Guidance |
|---|---|
| `## Architecture` | Describe the current or proposed architecture — components, data flows, integration points, technology choices. |
| `## Scale Requirements` | Current and projected scale — users, requests, data volume, geographic distribution. |
| `## Constraints` | Technical, budgetary, team, and timeline constraints that bound the solution space. |
| `## Key Question` | The single most important architecture question you want the review to answer. Be specific. |

You may attach context files (e.g. architecture diagrams, ADRs, performance benchmarks, infrastructure configs).

## Output

The Arbiter produces a structured report at `output/reports/{{date}}-{{brief_slug}}-{{session_id}}/report.md` containing:

- **Architecture assessment** — evaluation of structural soundness, component design, and integration quality
- **Scalability analysis** — how the architecture handles growth across key dimensions
- **Technical debt risks** — areas where current shortcuts will compound into future problems
- **Recommended changes** — prioritised list of architectural improvements
- **Migration path** — sequenced plan for implementing recommended changes with minimal disruption

## Configuration

- Rounds: 2-5 (focused deliberation)
- Budget: $1.00-$8.00 per session
- Time: 2-8 minutes
- On agent failure: skip and continue (partial results flagged)

## Usage

```bash
aos run --profile architecture-review --brief path/to/brief.md
```
