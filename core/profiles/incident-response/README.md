# Incident Response

The Incident Response profile assembles a focused team of agents to perform rapid root cause analysis, identify contributing factors, and produce a prevention plan.

## What it does

A neutral Arbiter orchestrates specialist agents who analyze system architecture for failure points, probe failure modes and assumptions, evaluate operational response, and assess safety and prevention measures. The result is a structured incident report with root cause analysis, timeline reconstruction, and actionable prevention steps.

## Agents assembled

**Orchestrator**
- `arbiter` — neutral facilitator; drives the analysis process and synthesises findings

**Required agents** (always active)
- `architect` — system analysis; maps architecture, components, and failure points
- `provocateur` — failure mode analysis; probes weaknesses, challenges assumptions, and stress-tests explanations; speaks last
- `operator` — ops reality; grounds analysis in operational constraints, response timelines, and implementation feasibility
- `sentinel` — safety and prevention; evaluates defensive posture, identifies gaps, and proposes safeguards

**Optional agents** (active by default; can be deactivated)
- `steward` — compliance lens; maps findings to regulatory and governance requirements
- `auditor` — historical patterns; identifies recurring themes and systemic issues from prior incidents

## Input format

Submit a brief (Markdown) with these four required sections:

| Section | Guidance |
|---|---|
| `## Incident Description` | What happened? Describe the incident in factual terms — what failed, what was affected, and how it was detected. |
| `## Impact` | What is the business, customer, and technical impact? Quantify where possible — downtime duration, users affected, revenue impact. |
| `## Timeline` | Chronological sequence of events from first signal to current state. Include timestamps where available. |
| `## Key Question` | The single most important question you want the incident response team to answer. Be specific. |

You may attach context files (e.g. monitoring dashboards, log excerpts, architecture diagrams, prior post-mortems).

## Output

The Arbiter produces a structured report at `output/reports/{{date}}-{{brief_slug}}-{{session_id}}/report.md` containing:

- **Root cause analysis** — primary and contributing root causes with supporting evidence
- **Contributing factors** — systemic, process, and human factors that enabled the incident
- **Immediate actions** — urgent steps to prevent recurrence before the full prevention plan is executed
- **Prevention plan** — ordered list of preventive measures ranked by impact and feasibility
- **Timeline reconstruction** — validated chronological sequence with causal links between events

## Configuration

- Rounds: 2-4 (focused, rapid analysis)
- Budget: $1.00-$6.00 per session
- Time: 2-6 minutes
- Tension pairs: [architect, provocateur] (design vs failure), [operator, sentinel] (quick fix vs safe fix)
- On agent failure: skip and continue (partial results flagged)

## Usage

```bash
aos run --profile incident-response --brief path/to/brief.md
```
