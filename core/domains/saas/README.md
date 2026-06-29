# SaaS Domain Pack

The SaaS domain pack injects subscription-software business context into the Strategic Council deliberation. Apply it when the brief concerns a B2B or B2C SaaS product, pricing, go-to-market, or platform decision.

## What it adds

**Shared lexicon** — all agents share consistent definitions for ARR, MRR, NRR, CAC, LTV, churn rate, expansion revenue, payback period, PLG, sales-led motion, and standard funding stages. This eliminates ambiguity when agents debate tradeoffs.

**Agent overlays** — seven agents receive additional lens instructions and evidence standards that sharpen their analysis for SaaS context:

| Agent | Overlay focus |
|---|---|
| `catalyst` | ARR/MRR impact test; CAC payback ceiling |
| `sentinel` | NRR as existential signal; switching cost erosion |
| `architect` | Multi-tenant scale efficiency; ops burden per customer |
| `provocateur` | SaaS base rate benchmarks; competitor counterfactual |
| `navigator` | Category positioning; distribution channel efficiency |
| `advocate` | Time-to-value; activation metric centrality |
| `strategist` | Wedge-to-platform sequencing; pricing power trajectory |

**Additional input section** — briefs submitted with this domain should include a `## Metrics` section covering current ARR, MRR, NRR, churn rate, CAC, LTV, and payback period with recent trend data.

**Additional output section** — the memo's financial impact section projects the effect of each recommendation on ARR, churn, and unit economics, with all assumptions stated.

**Guardrails** — three hard rules enforced during deliberation:
1. Revenue projections must state assumptions (conversion rate, ACV, volume, time horizon)
2. Any recommendation with material churn risk must include a churn impact assessment
3. Initiatives with CAC payback beyond 24 months require explicit justification

## Usage

```bash
aos run --profile strategic-council --domain saas --brief core/briefs/sample-product-decision/brief.md
```
