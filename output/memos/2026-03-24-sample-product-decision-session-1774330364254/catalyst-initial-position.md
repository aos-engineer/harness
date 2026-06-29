# Catalyst — Initial Position Memo
## Meridian Analytics Council | API Platform vs. SaaS Depth
### Session: 2026-03-24 | Round: Initial Positions

---

## Scratch Pad (Working Calculations)

**Cost of delay on $280K at-risk ARR:**
- Both customers churn at renewal. Assuming ~6 months avg remaining contract: $140K walks out the door immediately post-renewal, $280K annualised gone.
- At 108% NRR, losing $280K ARR is equivalent to losing ~$302K forward ARR within 12 months.
- At current blended CAC of $4,800 and ACV of $18K (mid-market), replacing $280K ARR requires acquiring ~15-16 new customers. At current velocity (+$420K QoQ), that's not impossible — but it's not free.

**Option A payback math:**
- $420K cost. Retain $280K ARR = $280K saved (not earned). Net cost of Option A net of retention = $140K.
- To justify the remaining $140K delta on pure retention math, we need: $140K / $45K avg enterprise ACV = 3.1 new enterprise logos in the 6-month window post-launch.
- If we close even 3-4 enterprise deals in Q4/Q1 post-launch, Option A pays back within 6-8 months. That clears my 6-month payback bar with one quarter of slack.
- $2M-$4M TAM expansion: even 5% capture in year one = $100K-$200K incremental ARR. That's upside beyond the base case.

**Option B payback math:**
- $360K cost for AI insights + segmentation depth. No identified revenue attached to these features.
- NRR currently declining (114% → 108%). Option B presumably stabilises or reverses this — but no conversion or expansion data supports a specific dollar figure.
- "AI-assisted insights layer" is unshipped by competitors. First-mover window: unknown. Could be 6 months, could be 18.

**The hybrid (limited export API):**
- Unscoped. Unknown cost. Unknown whether it satisfies the two at-risk customers. Unknown whether it blocks or enables enterprise prospects.
- If it saves $280K ARR at 30-40% of Option A's cost (~$126K-$168K), it's the highest ROI path. But we don't know that yet.

---

## 1. Revenue Opportunity

**The prize is not the API. The prize is $280K ARR not walking out the door and a $2M-$4M enterprise TAM that is actively signalling willingness to buy.**

Three enterprise prospects have already told us they will not purchase without an API. Two existing customers have told us they will churn without one. This is not a hypothetical demand signal. This is customers explicitly stating their price of admission, and we are currently refusing to pay it.

At $3.2M ARR growing at ~8% MoM, Meridian is a healthy self-serve machine. But the NRR trend is the tell: 114% → 108% over six months. That compression is not a coincidence. It is the early signal of a ceiling. The customers who would have expanded are instead asking for APIs and being told no.

The time window on the $280K at-risk ARR is **now**. These customers are not waiting six months for us to decide. They are evaluating alternatives today.

---

## 2. Recommended Path

**Modified Option A — a right-sized API platform, shipped in 16 weeks, not 24.**

Here is what I will not accept: a 6-month, 4-5 engineer full-platform build that attempts to ship a complete developer ecosystem on the first release. That is not a product launch — that is a product architecture project masquerading as revenue generation.

Here is what I will accept: a staged API release structured as follows:

**Stage 1 (Weeks 1-6): Foundation sprint — 2 engineers**
- Extract the attribution engine from the Rails session model (the 4-6 week prerequisite work)
- Implement tenant-level data isolation for EU residency (non-negotiable regulatory requirement; do it once, do it right)
- Auth0-based API key management
- Internal only, no customer access

**Stage 2 (Weeks 7-12): Core API release — 3 engineers**
- REST endpoints for the core analytics queries (attribution reports, channel performance, cohort data)
- Rate limiting, usage logging, sandbox environment
- Ship to the two at-risk customers as a private beta. Get their sign-off. Lock their renewals.
- Ship to the three declined enterprise prospects as an early-access program. Start a sales conversation.

**Stage 3 (Weeks 13-16): Developer surface — 2 engineers**
- Public documentation, webhook support, usage-based billing tier
- General availability announcement
- Enterprise AE conversation can begin with a real product in hand

**Remaining engineering capacity (2-3 engineers throughout):** Do not abandon the self-serve product entirely. Assign a parallel track to the highest-ROI self-serve features — specifically the AI insights layer, which has genuine differentiation potential. You do not need 3-4 engineers to ship an AI insights MVP. You need 2 focused engineers and a clear scope.

This is not Option A or Option B. This is Option A with a scope guillotine applied, and Option B's most valuable piece run in parallel.

**Total cost estimate:** ~$400K (slightly above Option B, below full Option A), primarily because we are compressing the API platform to a focused set of endpoints rather than a complete developer ecosystem in one release.

---

## 3. Trade-offs (in commercial terms)

| Trade-off | Commercial impact |
|---|---|
| Shipping a narrower API (core endpoints only, no webhooks until Stage 3) | Risk: the two at-risk customers may need specific endpoints not in Stage 2. Mitigation: confirm their minimum requirements before Stage 1 begins — this takes one week of CS calls, not six months of engineering. |
| Running two parallel tracks on 8 engineers | Velocity on both tracks is slower than dedicated teams. Acceptable: we are not trying to win a feature-count competition. We are trying to retain $280K ARR and open an enterprise door. |
| 4-6 week architectural prerequisite | This is unavoidable regardless of when we build an API. Every quarter we delay, this cost is still waiting for us. We are paying it now or paying it later — but we are paying it. Pay it now while the at-risk customers are still customers. |
| No enterprise AE in the first 6 months | The three declined prospects were self-qualified — they told us what they need. Our existing AEs can run a consultative close on early-access enterprise deals. It is not ideal. It is what we have. We close two logos, then make the case to hire the enterprise AE. |

---

## 4. Risks (quantified where possible)

**Risk 1: The two at-risk customers churn anyway.**
- Probability: ~20% even if we ship the API (they may have moved on, or the API scope does not satisfy them without a discovery call confirming requirements).
- Dollar impact: $280K ARR lost.
- Mitigation: Customer discovery call this week, before the engineering decision is made. Confirm minimum API requirements. If they will not commit to renewal contingent on API delivery, reassess whether Option A is even for them — and whether the enterprise TAM alone justifies it.

**Risk 2: Enterprise adoption does not materialise in 6 months.**
- Probability: Moderate. Enterprise sales cycles are long. We may ship the API and not close a logo in Q3.
- Dollar impact: $420K cost, $0 new enterprise ARR in the period.
- Mitigation: The API is not wasted if enterprise sales take 9 months instead of 6. The asset has been built. The at-risk ARR has been retained. We have entered a new product category. The failure mode is slow return, not zero return. That is acceptable.

**Risk 3: Competitors ship AI insights before us.**
- Probability: Amplitude and Mixpanel are well-funded and shipping fast. An 18-month window is generous. 9 months may be more realistic.
- Dollar impact: If we are first to market with causal AI insights, estimated 15-20% improvement in new logo win rate in the self-serve segment. At current CAC/ACV economics, that represents $150K-$200K incremental ARR per quarter. Missing the window costs us that.
- Mitigation: This is exactly why we run the parallel AI track with 2 engineers. A focused AI insights MVP — one core insight type, shipped as a beta feature — can be in customers' hands in 8-10 weeks. It does not require 3-4 engineers and 6 months.

---

## 5. Cost of Inaction

Let me be specific about what choosing Option B in its pure form costs us:

**Immediate:**
- $280K ARR churns at renewal. At 108% NRR, this does not kill the company. It does set us back approximately one quarter of net new ARR growth. We spend Q3 recovering ground we did not need to lose.

**6 months:**
- The three enterprise prospects have closed with competitors or built their own solutions. Enterprise pipeline resets to zero. The $2M-$4M TAM expansion is not gone, but the warm leads are.
- We have shipped an AI insights layer with 3-4 engineers. It is differentiated. But it has not been tested against an API-enabled competitor who can also offer AI insights.

**12-18 months:**
- APIs become table-stakes (the brief's own language). We revisit this decision with a monolith that is now 12-18 months older, with the same 4-6 week architectural prerequisite still waiting to be paid, and without the institutional learning of having shipped a developer product.
- We re-enter this exact council with a higher price tag, more technical debt, and no enterprise track record.

The cost of Option B is not $0. The cost of Option B is $280K in churned ARR, $2M-$4M TAM deferred, and 6-18 months of compounding structural disadvantage — plus the architectural prerequisite cost paid again, later, at a higher engineering rate.

Option A, scoped correctly, costs $400K and pays back in 8 months. Option B costs $360K and pays back in... what timeline, exactly? I have not seen a revenue model for the AI insights layer. Until I do, "Option B is cheaper" is not a financial argument. It is an accounting argument.

---

## Single Most Important Consideration

**The $280K at-risk ARR is a forcing function, not a data point.**

These two customers have handed us a deadline. They are not asking us to consider an API. They are telling us they will leave without one. That is a market signal as clean as it gets.

When customers tell you what they will pay for, and you have the engineering capacity to build it, and the payback period is under 12 months, the burden of proof is not on Option A. The burden of proof is on every reason not to ship.

The question is not "API platform or SaaS depth?" The question is: "What is the minimum API that retains these two customers and opens the enterprise door — and can we ship it in 16 weeks?" I believe we can. Let us find out if the Architect agrees.

---

*Catalyst | Meridian Analytics Council | March 24, 2026*
