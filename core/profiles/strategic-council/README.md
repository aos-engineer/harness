# Strategic Council

The Strategic Council is a multi-perspective deliberation profile that assembles 12 agents — one orchestrator and 11 specialists — to analyse a strategic problem from opposing angles, surface hidden tensions, and produce a structured decision memo.

## What it does

A neutral Arbiter orchestrates a structured debate. Each specialist agent applies its own cognitive lens to the submitted brief, challenges other agents' reasoning, and stress-tests assumptions. The Arbiter synthesises the deliberation into a ranked recommendation memo with documented dissent and concrete next actions.

## Agents assembled

**Orchestrator**
- `arbiter` — neutral facilitator; does not advocate; synthesises outputs

**Core perspectives** (always active — these four create the essential tensions)
- `catalyst` — growth and opportunity
- `sentinel` — risk and protection
- `architect` — systems and scalability
- `provocateur` — adversarial challenge; speaks last by structural design

**Extended perspectives** (active by default; can be deactivated)
- `navigator` — market positioning and competitive dynamics
- `advocate` — customer and user impact
- `pathfinder` — innovation and future optionality
- `strategist` — long-horizon competitive sequencing

**Operational agents** (active by default; can be deactivated)
- `operator` — execution feasibility and resourcing
- `steward` — financial discipline and capital efficiency
- `auditor` — compliance, governance, and accountability

## Input format

Submit a brief (Markdown) with these four required sections:

| Section | Guidance |
|---|---|
| `## Situation` | What is happening right now? Facts only, no opinion. |
| `## Stakes` | What is at risk — upside if right, downside if wrong. |
| `## Constraints` | Budget, timeline, team capacity, technical and regulatory limits. |
| `## Key Question` | The single most important question for the council to answer. Be specific. |

You may attach context files (e.g. `product-overview.md`, financial models, prior research). These are passed to all agents verbatim.

## Output

The Arbiter produces a structured memo at `output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md` containing:

- **Ranked recommendations** — ordered by confidence and feasibility
- **Agent stances** — each agent's position summarised
- **Dissent and tensions** — unresolved disagreements explicitly surfaced
- **Tradeoffs and risks** — what each option costs
- **Next actions** — concrete steps with owners
- **Deliberation summary** — how the council reached its conclusions

## Configuration

- Rounds: 2–8 (scales with problem complexity)
- Budget: $1.00–$10.00 per session
- Time: 2–10 minutes
- On agent failure: skip and continue (partial results flagged)

## Usage

```bash
aos run --profile strategic-council --brief core/briefs/sample-product-decision/brief.md
```
