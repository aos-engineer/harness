# Auditor Scratch Pad — Meridian Analytics Product Strategy
## Session: session-1774330364240 | Round: Initial Position

---

## DECISION UNDER REVIEW
Option A: Full Developer API Platform ($420K, 4-5 engineers, 6 months)
Option B: SaaS Depth + AI Insights Layer ($360K, 3-4 engineers, 6 months)
Option C (informal): Limited Export API (not formally scoped)

---

## HISTORICAL PATTERN ANALYSIS

### Pattern 1: "Two At-Risk Customers" as Justification for Architectural Pivots
This is one of the most recognizable patterns in B2B SaaS decision-making history.
- The framing: "We will lose $280K ARR if we don't build this."
- The historical record across the analytics/SaaS industry: Customer-driven architectural pivots 
  based on 1-2 accounts routinely produce systems that satisfy those accounts but fail to generate 
  the broader adoption they were designed to prove.
- Reference cases: Baremetrics (API expansion for 2 enterprise accounts, 2019), Kissmetrics 
  (enterprise pivot 2013-2015 that stalled self-serve product and contributed to eventual decline),
  ChartMogul (resisted API-first for years, built it only when >20% of pipeline required it).
- KEY QUESTION: Are these two customers representative of a real demand cohort, or are they 
  outliers whose needs diverge from our ICP?

### Pattern 2: "Three Prospects Lost" as Market Signal
- Three enterprise prospects declined due to no API. But: what was their ACV? Did they fit ICP 
  (Series A-C B2B SaaS, 50-500 employees)?
- Enterprise prospects shopping for API-first analytics tools often have different buyer profiles 
  than Meridian's current sweet spot (VP Growth/Head of Marketing at PLG companies).
- Historical analog: Multiple analytics companies have chased "enterprise prospects" who 
  requested APIs, built them, and then watched those same prospects choose Snowflake-native 
  solutions or Amplitude anyway. The prospect conversation ≠ the closed deal.

### Pattern 3: The Platform Pivot from Monolith — The 4-6 Week Estimate Problem
- The estimate of 4-6 weeks for extraction is almost certainly underestimated.
- Industry pattern: Monolith extraction projects routinely run 2-3x initial estimates.
- The Meridian tech stack makes this particularly risky: the attribution engine is "tightly 
  coupled to the Rails session model." This is not a clean service boundary — it's an embedded 
  dependency. The auth, rate limiting, and tenant isolation rework is foundational.
- EU data residency compliance from day one adds additional non-negotiable scope.
- Historical base rate: A 4-6 week extraction estimate on a tightly coupled Python service 
  embedded in a Rails monolith, with GDPR compliance requirements, is closer to 10-16 weeks 
  in actual delivery.
- If extraction slips to 12 weeks, the remaining API build time is 12 weeks — not 24.

### Pattern 4: Go-to-Market Readiness Mismatch
- This is the pattern that kills the most "technically successful" API launches.
- Meridian's sales team: 3 AEs optimized for self-serve assist and mid-market.
- Enterprise motion requires: at minimum 1 enterprise AE + 1 solutions engineer.
- Historical record: Analytics companies that built APIs without enterprise GTM capability 
  consistently report that the API goes underutilized because no one is selling it.
- The brief explicitly notes: "headcount approval not yet secured."
- This is not a product risk — it is a GTM execution gap that cannot be closed in Q3 without 
  a hiring decision that has not been made.

### Pattern 5: The "Platform Moat" Narrative
- "API-first products command higher switching costs" — this is true once adoption exists.
- The assumption embedded in Option A: that building the API will generate adoption.
- The assumption archaeology question: What evidence does Meridian have that its enterprise 
  prospects will choose a new API platform from a Series A analytics vendor over established 
  alternatives (Amplitude API, Mixpanel API, Snowflake-native solutions)?
- This assumption has failed repeatedly for smaller analytics vendors trying to enter enterprise.

### Pattern 6: The NRR Signal
- NRR has declined from 114% to 108% over 6 months. This is a warning indicator.
- Declining NRR in the existing customer base while pursuing an expensive new capability 
  is a historically dangerous combination: it suggests the core product has gaps that need 
  closing, not new segments that need opening.
- Historical analog: Companies that pursue TAM expansion while NRR is declining often find 
  that they've spread engineering thin enough that NRR continues to fall, eroding the base 
  they were trying to protect.

---

## ASSUMPTION ARCHAEOLOGY

Assumptions embedded in Option A and their historical validity:

1. "Enterprise prospects will close if we build the API" — NOT PROVEN. Lost prospects ≠ 
   committed pipeline. The assumption that building generates closing has failed in many 
   comparable cases.

2. "4-5 engineers can deliver a full API platform in 6 months from a Rails monolith" — 
   HIGH RISK. The technical complexity here (extraction, auth rework, rate limiting, tenant 
   isolation, EU compliance, docs, sandbox) routinely exceeds estimates by 2-3x.

3. "The sales team can sell enterprise API contracts with existing headcount" — FALSE by 
   the brief's own admission. Enterprise AE + SE headcount is not approved.

4. "The two at-risk customers are representative of a larger cohort" — UNVERIFIED.

5. "$2M-$4M TAM expansion is accessible within 12 months of API launch" — OPTIMISTIC. 
   Enterprise sales cycles for analytics platforms typically run 6-12 months post-product 
   readiness.

---

## RECURRENCE DETECTION

This deliberation is a classic instance of what I would call the "Capability-Market Mismatch 
Pivot." It recurs in analytics SaaS companies at the Series A-B stage when:
- Self-serve is working (NPS high, CAC improving)
- Enterprise signal appears from 2-3 accounts
- The organization debates whether to pivot to serve that signal

Historical outcomes of this pattern depend entirely on whether enterprise GTM infrastructure 
exists before the product is built — not after. When GTM lags product, the API launches and 
generates support burden but not revenue.

---

## INSTITUTIONAL RECOMMENDATION (PRELIMINARY)

Lean toward Option B with structured enterprise optionality, NOT Option A.

Rationale:
1. The GTM gap is not solvable within the same Q3 timeline as the API build.
2. The technical estimates for Option A are likely 50-100% understated.
3. The two at-risk customers may be outliers from ICP, not harbingers of a larger cohort.
4. Declining NRR (114% → 108%) suggests the core product needs attention.
5. The limited export API (Option C) deserves formal scoping — it may satisfy the two 
   at-risk customers without the full architectural commitment.

The single most important consideration: The GTM mismatch. An API without enterprise 
sales infrastructure is a product looking for a buyer.

---

## QUESTIONS TO SURFACE IN DELIBERATION

1. What were the ACVs and ICP fit of the three lost prospects? Were they in Meridian's 
   current ICP or aspirational ICP?
2. Has either at-risk customer confirmed they would stay with a limited export API vs. 
   full programmatic API?
3. What is causing the NRR decline from 114% to 108%? Is this churn risk in the core 
   base that should take priority?
4. Has anyone done a detailed engineering estimate review — not just the summary — to 
   pressure-test the 4-6 week extraction timeline?
5. What is the actual timeline for enterprise AE/SE headcount approval?

