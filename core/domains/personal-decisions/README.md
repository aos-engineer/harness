# Personal Decisions Domain Pack

The Personal Decisions domain pack strips business metrics and adds life-stage context, emotional impact assessment, and personal values alignment. Apply it when the brief concerns career changes, major purchases, relationship decisions, relocations, or other life-defining choices.

## What it adds

**Shared lexicon** — all agents share consistent definitions for life satisfaction, financial runway, career growth, relationship quality, health metrics, and optionality score. Frameworks cover regret minimization, optionality preservation, values alignment, opportunity cost, and reversibility testing. Stages map the life lifecycle from exploring through retiring.

**Agent overlays** — six agents receive additional thinking patterns, heuristics, and evidence standards that sharpen their analysis for personal decision context:

| Agent | Overlay focus |
|---|---|
| `catalyst` | Personal momentum, career velocity |
| `sentinel` | Life balance, relationship preservation, burnout prevention |
| `provocateur` | Sunk cost fallacy, status quo bias, fear-based decisions |
| `pathfinder` | Life-changing asymmetric bets, career pivots, regret minimization |
| `advocate` | Family/relationship impact, quality of life |
| `operator` | Practical execution (finances, logistics, timeline) |

**Additional input section** — briefs submitted with this domain should include a `## Life Context` section covering current life stage, key relationships, financial situation, health status, and personal values.

**Additional output section** — the memo's personal impact section projects the effect of each recommendation on life satisfaction, relationships, health, financial runway, and career trajectory, with emotional impact assessed alongside rational analysis.

**Guardrails** — three hard rules enforced during deliberation:
1. Emotional impact must be assessed alongside rational analysis
2. Reversibility must be evaluated for every recommendation
3. Family and relationship impact must be explicitly addressed for every major recommendation

## Usage

```bash
aos run --profile strategic-council --domain personal-decisions --brief path/to/brief.md
```
