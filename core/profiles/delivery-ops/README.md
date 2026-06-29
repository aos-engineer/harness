# Delivery Ops

The Delivery Ops profile assembles a team of agents to plan and sequence product delivery, grounding ambitious timelines in execution reality.

## What it does

A neutral Arbiter orchestrates specialist agents who evaluate what needs to ship, in what order, with what resources, and what could go wrong. The team balances speed against quality, ideal sequencing against operational constraints, and ambition against feasibility. The result is a structured delivery memo with a sequenced plan, risk register, and go/no-go criteria.

## Agents assembled

**Orchestrator**
- `arbiter` — neutral facilitator; drives the planning process and synthesises the delivery plan

**Required agents** (always active)
- `strategist` — sequencing and prioritisation; determines what to build in what order
- `operator` — execution reality; grounds plans in team capacity, dependencies, and delivery risk
- `catalyst` — speed and momentum; pushes for shipping and identifies acceleration opportunities
- `architect` — feasibility; evaluates whether proposed plans are technically sound

**Optional agents** (active by default; can be deactivated)
- `sentinel` — quality protection; ensures speed does not compromise durability
- `advocate` — user impact; ensures delivery sequence maximises user value
- `navigator` — market timing; aligns delivery with competitive and market windows

## Input format

Submit a brief (Markdown) with these four required sections:

| Section | Guidance |
|---|---|
| `## Deliverable` | What needs to be delivered? Describe the feature, product, or milestone in concrete terms. |
| `## Current State` | Where are things now? What has been built, what is in progress, what is blocked. |
| `## Resources` | Team size, skills available, budget, infrastructure, and any hard constraints. |
| `## Key Question` | The single most important delivery question you want the team to answer. Be specific. |

You may attach context files (e.g. roadmaps, sprint boards, technical specs, dependency maps).

## Output

The Arbiter produces a structured memo at `output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md` containing:

- **Delivery plan** — what will be delivered, broken into concrete work packages
- **Sequence and dependencies** — ordered execution plan with dependency mapping
- **Risk register** — identified risks with likelihood, impact, and mitigation strategies
- **Resource allocation** — how team capacity maps to work packages
- **Milestones** — checkpoints with dates and success criteria
- **Go/no-go criteria** — conditions that must be met before proceeding at each gate

## Configuration

- Rounds: 2-6 (focused deliberation)
- Budget: $1.00-$8.00 per session
- Time: 2-8 minutes
- On agent failure: skip and continue (partial results flagged)

## Usage

```bash
aos run --profile delivery-ops --brief path/to/brief.md
```
