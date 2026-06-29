# Meridian Analytics — Product Overview

> Context file for brief: `brief.md`

---

## Company snapshot

| Field | Value |
|---|---|
| Company | Meridian Analytics, Inc. |
| Founded | 2021 |
| Stage | Series A |
| Headquarters | Austin, TX (remote-first) |
| Team size | 28 FTE (8 engineering, 5 product/design, 6 GTM, 4 CS, 3 ops, 2 leadership) |

---

## Financial metrics (as of end of Q1)

| Metric | Value | Trend |
|---|---|---|
| ARR | $3.2M | +$420K QoQ |
| MRR | $267K | +8% MoM (3-month avg) |
| NRR | 108% | Down from 114% six months ago |
| Gross churn rate | 11% annualised | Flat for 3 quarters |
| CAC (blended) | $4,800 | Improving; was $6,200 12 months ago |
| LTV (blended) | $22,400 | Based on 4.7-year avg customer life |
| LTV:CAC | 4.7x | |
| Payback period | 14 months | Down from 19 months at seed |
| ACV (mid-market) | $18,000 | |
| ACV (enterprise, estimated) | $45,000–$70,000 | No closed enterprise deals yet |

---

## Product

**Name:** Meridian Analytics

**Core value proposition:** Revenue attribution and user behaviour analytics for growth teams that want to understand which channels and actions drive paying customers — not just traffic.

**Primary differentiator:** Meridian's attribution model uses a causal inference engine (proprietary) that accounts for multi-touch journeys and organic vs. paid signal mixing. Customers report 30–40% improvement in attribution accuracy vs. last-touch or linear models.

**Target customer:** Series A–C B2B SaaS companies, 50–500 employees, with a dedicated growth team. Primary buyer is VP of Growth or Head of Marketing.

**Pricing model:**
- Self-serve: $299/mo (up to 10K tracked users), $799/mo (up to 50K), $1,999/mo (up to 200K)
- Mid-market: $1,500–$2,500/mo, annual contract, white-glove onboarding
- Enterprise: Custom — not yet formalised

**Product mode:** SaaS UI only. No API, no embedded SDK beyond a 3-line JS tracking snippet.

---

## Technology stack

| Layer | Technology |
|---|---|
| Backend | Ruby on Rails (monolith) |
| Data pipeline | Apache Kafka + dbt + Snowflake |
| Attribution engine | Python service (internal), called synchronously from Rails |
| Frontend | React + TypeScript |
| Infrastructure | AWS (ECS Fargate, RDS Aurora, S3) |
| Auth | Auth0 |
| Monitoring | Datadog |

**Architecture note:** The attribution engine is the most performance-sensitive component. It currently runs as an internal service but is tightly coupled to the Rails session model. Extracting it as a public API requires reworking auth, rate limiting, and tenant isolation — work that is estimated at 4–6 weeks before any API endpoint can be built on top.

---

## Market position

**Direct competitors:**
- Amplitude (well-funded, broad analytics platform, recently added attribution features)
- Mixpanel (strong in product analytics, weaker in revenue attribution)
- Rockerbox (attribution-focused, similar ICP, no causal inference)
- Triple Whale (ecommerce-heavy, not a direct threat for B2B SaaS)

**Meridian's competitive advantages:**
1. Causal inference attribution accuracy (vs. rules-based competitors)
2. Clean UI praised in reviews; G2 score 4.7/5 (62 reviews)
3. Fast onboarding: median time-to-first-attribution is 4 days

**Competitive weaknesses:**
1. No API — increasingly a blocker for enterprise and data-stack integrations
2. Monolithic architecture slows feature velocity relative to well-funded competitors
3. Brand awareness is low outside the Series A–B SaaS growth community

---

## Customer profile

- 187 paying customers
- Average customer tenure: 2.1 years
- Top 10 customers represent 34% of ARR
- Geographic mix: 72% North America, 21% Europe, 7% other
- Highest-NPS segment: seed-to-series-A SaaS companies using PLG motions
