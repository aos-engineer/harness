# Security Review

The Security Review profile assembles a focused team of agents to assess system security posture, identify vulnerabilities, and produce a prioritized remediation plan.

## What it does

A neutral Arbiter orchestrates specialist agents who analyze system architecture, probe attack surfaces, evaluate compliance posture, and stress-test defensive assumptions. The result is a structured security report with a risk matrix and actionable remediation priorities.

## Agents assembled

**Orchestrator**
- `arbiter` — neutral facilitator; drives the review process and synthesises findings

**Required agents** (always active)
- `architect` — system analysis; maps architecture, components, and trust boundaries
- `sentinel` — protection focus; evaluates defensive posture and resilience
- `provocateur` — attack surface thinking; probes weaknesses and challenges assumptions; speaks last
- `steward` — compliance lens; maps findings to regulatory and governance requirements

**Optional agents** (active by default; can be deactivated)
- `operator` — implementation reality; grounds remediation in operational feasibility
- `navigator` — competitive security landscape; benchmarks against industry posture

## Input format

Submit a brief (Markdown) with these four required sections:

| Section | Guidance |
|---|---|
| `## System Description` | Describe the system under review — architecture, components, data flows, trust boundaries. |
| `## Known Threats` | List known or suspected threats, recent incidents, or areas of concern. |
| `## Compliance Requirements` | Regulatory frameworks, industry standards, or internal policies (e.g., SOC 2, GDPR, PCI-DSS). |
| `## Key Question` | The single most important security question you want the review to answer. Be specific. |

You may attach context files (e.g. architecture diagrams, prior audit reports, threat models).

## Output

The Arbiter produces a structured report at `output/reports/{{date}}-{{brief_slug}}-{{session_id}}/report.md` containing:

- **Vulnerability assessment** — identified vulnerabilities with severity and exploitability ratings
- **Risk matrix** — likelihood vs. impact mapping of identified risks
- **Remediation priorities** — ordered list of fixes ranked by risk reduction per effort
- **Compliance gaps** — where the system falls short of stated compliance requirements
- **Immediate actions** — urgent steps to take before the full remediation plan is executed

## Configuration

- Rounds: 2-6 (focused deliberation)
- Budget: $1.00-$8.00 per session
- Time: 2-8 minutes
- On agent failure: skip and continue (partial results flagged)

## Usage

```bash
aos run --profile security-review --brief path/to/brief.md
```
