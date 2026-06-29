---
title: "Deliberation Memo"
date: 2026-03-24
duration: 16.2 minutes
budget_used: $2.93
participants:
  - catalyst
  - sentinel
  - architect
  - provocateur
  - navigator
  - advocate
  - pathfinder
  - strategist
  - operator
  - steward
  - auditor
brief_path: core/briefs/sample-product-decision/brief.md
transcript_path: .aos/sessions/session-1774330364254/transcript.jsonl
---

# Arbiter Synthesis Memo: Meridian Analytics API Platform vs. SaaS Depth

## Ranked Recommendations

**1. Option B + Scoped Export API Diagnostic (Primary Recommendation)**
Execute Option B (SaaS depth and AI insights layer) as the core engineering priority with 7 engineers. Allocate 1 engineer for a tightly time-boxed (8-week) read-only Export API designed exclusively for the two at-risk customers. 
*Why it wins:* It resolves the immediate $280K ARR retention threat without paying the 4-6 week monolith extraction tax or requiring an enterprise GTM motion we do not have.
*Condition for failure:* This recommendation must be aborted if an immediate discovery call reveals the at-risk customers strictly require full programmatic control (REST API, write access) rather than data portability.
*Support/Opposition:* Supported by the vast majority (Strategist, Operator, Auditor, Navigator, Architect) as a pragmatic bridge. Opposed by Sentinel (who prefers pure Option B) and Pathfinder (who views it as an incremental trap).

**2. Option B + Embeddable NL Query Spike (The 10x Alternative)**
If the required discovery call invalidates the Export API (i.e., customers need programmatic query control), execute a 3-week "NL Query Spike" to test an LLM-powered embeddable analytics layer before committing to any API extraction.
*Why it outranks pure Option B:* It offers a potential asymmetric upside ($8M-$15M TAM in embeddable analytics) and satisfies enterprise needs without the multi-quarter architectural penalty of traditional API extraction.
*Support/Opposition:* Championed by Pathfinder as a category-creating move. Opposed implicitly by Steward/Architect until EU compliance is proven for the semantic layer.

**3. Pure Option B — Accept the $280K ARR Loss**
If neither the Export API nor the NL Query Spike satisfies the at-risk accounts, abandon the API effort entirely, accept the churn, and put all 8 engineers on self-serve UI depth and AI insights.
*Why it outranks Option A:* The council universally agreed that building a full API platform without the GTM infrastructure (Enterprise AE, Solutions Engineer) to sell it is a fatal strategic error. A $280K ARR loss is recoverable; a stalled core product and $420K wasted on unmonetizable infrastructure is not.
*Support/Opposition:* Sentinel's primary choice. Supported by Operator, Strategist, and Provocateur as the necessary fallback if validation fails. Catalyst strongly opposes giving up the revenue.

---

## Agent Stances Table

| Agent | Position (1-2 sentences) | Core Reasoning | Key Concern |
|-------|--------------------------|----------------|-------------|
| **Catalyst** | Scoped Export API as a private beta. | Retain the $280K ARR and use the beta to validate enterprise demand before scaling GTM. | Abandoning known, declared revenue out of fear of scaling sales. |
| **Sentinel** | Pure Option B. Accept the $280K churn cleanly. | APIs create irreversible architectural and support obligations that degrade our core self-serve velocity. | Unseen self-serve churn due to 6 months of feature stagnation. |
| **Architect** | Option B + Export API (no extraction). | Avoids the 4-6 week monolith extraction and limits the blast radius of new architecture. | EU data residency isolation must be proven before any data moves. |
| **Provocateur** | Export API only if retention is pre-signed. | An API built ahead of verified demand is just a smaller gamble. Demand must be contractual. | The GTM mismatch vetoes any platform ambition right now. |
| **Navigator** | Option B + Export API as a market test. | AI insights is an open, defensible lane. The API simply tests enterprise demand signal. | Missing the window to own causal AI before Amplitude/Mixpanel. |
| **Advocate** | Behavioral discovery sprint, then decide. | We are retrofitting architecture to sales conversations without knowing actual workflow needs. | Building an API that developers don't use due to lack of dev experience. |
| **Pathfinder** | Reject the Export API; run an NL Query Spike. | LLM query layers skip the extraction tax and create a 10x embeddable analytics category. | The Export API is an "incremental trap" that satisfies nobody. |
| **Strategist** | Option B + Time-boxed Export API. | Defers the platform ambition until GTM and pipeline are validated, preserving optionality. | Scope creep turns the limited export API into a bloated platform. |
| **Operator** | Option B + Export API (contingent on validation). | The GTM gap cannot be solved by engineering. Isolate the API to 1 engineer for 8 weeks max. | Hidden integration support costs destroying the engineering timeline. |
| **Steward** | Conditional Export API. | Any API must legally serve EU customers or it fails its retention mandate. | Proceeding without a verified GDPR DPA and data isolation model. |
| **Auditor** | Export API as the sole API commitment. | The historical record shows APIs without concurrent GTM infrastructure generate overhead, not revenue. | Proceeding without confirming customers will accept a read-only export. |

---

## Dissent & Unresolved Tensions

**1. The True Nature of the Customer Demand**
*The Tension:* We are on the verge of building an Export API without explicitly confirming if it solves the two at-risk customers' problems. Do they need simple data portability (Export API), or do they need programmatic querying/write access (Full Platform)?
*Why it matters:* If they require a full platform, the Export API will not save the $280K ARR, making the effort wasted.
*Positions:* Advocate, Operator, and Auditor demand immediate behavioral validation. Catalyst assumes the staged API will suffice. 

**2. Scope Creep: Retention Tool vs. Platform Stage 1**
*The Tension:* Catalyst views the Export API as "Stage 1" of a private beta that will eventually lead to a full platform (Option A). Strategist and Operator view the Export API as a strict, hard-capped retention tool that must never become a platform without board-approved GTM headcount.
*Why it matters:* Without rigid alignment, the 1-engineer export project will organically absorb more engineering capacity as "design partners" demand more features, slowly starving Option B.

**3. The Pathfinder's Embeddable Alternative**
*The Tension:* While the room converged on the Export API as a pragmatic compromise, the Pathfinder wholly rejected it as an "incremental trap", arguing that an LLM-native embeddable analytics layer is technically cheaper (no monolith extraction) and commercially more valuable.
*Why it matters:* If the Pathfinder is correct, the entire council's compromise is anchored to a 2022-era API paradigm rather than a 2026-era semantic layer.

---

## Trade-offs & Risks

| Recommendation | What You Gain | What You Lose | Key Risk | Mitigation |
|----------------|---------------|---------------|----------|------------|
| **1. Option B + Export API Diagnostic** | Saves $280K ARR; preserves self-serve momentum; limits architectural debt. | 1 engineer's bandwidth for 8 weeks; delays full enterprise TAM entry. | Support overhead from the 2 at-risk accounts derails the core engineering team. | Strict CS support model defined pre-launch; explicit 8-week timebox. |
| **2. Embeddable NL Query Spike** | Potential to bypass monolith extraction entirely; creates new 10x product category. | Predictability of standard REST API; requires LLM dependency. | Embeddable AI fails EU data residency compliance audits. | Dedicate legal/architect sprint to validate GDPR compliance of semantic layer. |
| **3. Pure Option B (SaaS Depth)** | Maximum feature velocity; compounds existing moat; lowest operational complexity. | Near-certain loss of $280K ARR and immediate exclusion from programmatic deals. | Enterprise APIs become market table-stakes within 12 months. | Revisit API strategy in H1 2027 after GTM headcount is secured. |

---

## Next Actions

1. **Customer Validation Call**
   - **Owner:** Customer Success Lead & Product Manager
   - **Deliverable:** Written confirmation of whether the two at-risk customers will accept a read-only, rate-limited Export API (or if they strictly require full programmatic control).
   - **Deadline:** End of Week 1 (Before Q3 Engineering Kickoff).

2. **EU Data Residency & Compliance Gate**
   - **Owner:** Architect & General Counsel (Steward function)
   - **Deliverable:** A documented data isolation model for the Export API and a drafted GDPR Article 28 DPA template. Zero API code ships without this sign-off.
   - **Deadline:** End of Week 2.

3. **Private Beta Support Model Definition**
   - **Owner:** CS Lead & Engineering Manager (Operator function)
   - **Deliverable:** A formal SLA and escalation path for the Export API beta, naming the specific CS owner and bounding the engineering interruption hours.
   - **Deadline:** Prior to granting any customer API access.

4. **NL Query Spike Assessment**
   - **Owner:** Pathfinder/Engineering R&D
   - **Deliverable:** A brief technical spike evaluating if an LLM-powered semantic layer can bypass the monolith extraction tax while maintaining EU compliance.
   - **Deadline:** End of Week 3 (to serve as pivot option if Export API is rejected by customers).

---

## Deliberation Summary

The deliberation opened with a stark binary: commit to a 6-month, $420K API platform to save $280K ARR and chase enterprise TAM, or double down on our self-serve SaaS moat. The assembly immediately dismantled Option A. The Provocateur, Strategist, and Operator identified a fatal flaw: Meridian lacks the Go-To-Market infrastructure (Enterprise AEs, Solutions Engineers) to monetize a platform. Building an enterprise capability without an enterprise sales motion would result in expensive shelfware and an unmanageable support burden. Furthermore, the Architect and Steward exposed massive hidden costs in Option A, specifically a 4-6 week monolith extraction tax and severe EU data residency compliance blockers.

Faced with this veto, the Catalyst aggressively narrowed the proposal. Instead of a full platform, they advocated for a 16-week "private beta" staged API for just five warm accounts, arguing that our existing AEs could handle consultative closes for existing relationships. The Strategist and Operator conceded this narrow point but maintained that supporting even a small beta would silently drain engineering resources without strict operational boundaries. 

The council subsequently converged on a powerful synthesis: **Option B (AI Insights) coupled with a heavily constrained "Export API Diagnostic."** This hybrid isolates the API effort to 1 engineer for 8 weeks strictly as a retention mechanism, preserving the vast majority of resources for compounding the self-serve advantage. However, the deliberation closed with a stark warning from the Auditor and Advocate: this entire compromise relies on the unverified assumption that a limited export tool will actually satisfy the at-risk customers. If it doesn't, the API effort must be killed immediately in favor of pure Option B, or pivoted to the Pathfinder's visionary (but untested) LLM-embeddable layer. The path forward is clear, but strictly gated by immediate customer validation.