# Brief: API Platform vs. SaaS Product

**Context files:** `product-overview.md`

---

## Situation

Meridian Analytics is a B2B SaaS product that helps growth teams analyse user behaviour and attribute revenue to acquisition channels. The product currently operates as a self-serve SaaS application: customers log in, configure their workspace, and interact via the UI.

Over the past two quarters, three enterprise prospects have declined to purchase because Meridian does not expose its analytics engine via API. All three are building internal data platforms and need to embed analytics programmatically — they will not adopt another UI-based tool. Additionally, two existing customers ($280K combined ARR) have escalated requests for API access; both have indicated they will churn at renewal if API access is not available.

The engineering team has scoped two options:

**Option A — Build a full developer API platform.** Expose all core analytics capabilities via REST and webhook APIs. Add developer documentation, API key management, usage-based billing tier, and a sandbox environment. Estimated: 4–5 engineers for 6 months, $420K fully loaded cost.

**Option B — Maintain SaaS-only and invest in UI depth.** Decline API development. Invest the equivalent budget in expanding the self-serve product: advanced segmentation, cohort comparison, and an AI-assisted insights layer. Estimated: 3–4 engineers for 6 months, $360K fully loaded cost.

A third path — a limited "export API" that only supports data extraction without full programmatic control — has been informally discussed but not formally scoped.

---

## Stakes

**Upside if we choose Option A (API platform):**
- Unlock the enterprise segment, which represents an estimated $2M–$4M TAM expansion within current ICP
- Retain the two at-risk customers ($280K ARR)
- Create a platform moat: API-first products command higher switching costs and enterprise contract values
- Potential to build a developer ecosystem and partner integrations

**Downside if we choose Option A:**
- 6-month development window creates an opportunity cost: the self-serve product stalls while competitors (notably Amplitude, Mixpanel) continue shipping
- API platform complexity increases support and operational burden per customer
- If enterprise adoption does not materialise, we have spent $420K with no ARR return

**Upside if we choose Option B (SaaS depth):**
- Compounds competitive advantage in the self-serve segment, where we have strong NPS and word-of-mouth
- Faster feature velocity maintains momentum with existing customers and prospects
- AI-assisted insights layer is a differentiation angle no direct competitor has shipped yet

**Downside if we choose Option B:**
- Near-certain loss of $280K ARR from the two escalating customers
- Continued exclusion from enterprise deals; ceiling on ACV growth
- Risk that enterprise API expectations become table-stakes across the market within 12–18 months, leaving us structurally behind

---

## Constraints

- **Budget:** Engineering headcount is fixed at 8 engineers total. No budget for net new hires in H1. Either option must be staffed from current team.
- **Timeline:** Board has requested a product strategy decision by end of Q2. Any initiative approved must begin in Q3.
- **Technical:** Current architecture is a monolithic Rails application. API-ifying the core would require extracting the analytics engine as a service — the team estimates this adds 4–6 weeks to Option A.
- **Go-to-market:** Sales team (3 AEs) is optimised for self-serve assist and mid-market. Enterprise motion would require at minimum one enterprise AE and a solutions engineer; headcount approval not yet secured.
- **Regulatory:** Two EU-based customers require data residency controls. Any API must support tenant-level data isolation from day one.

---

## Key Question

Should Meridian invest its next 6-month engineering cycle in building a full API platform (unlocking enterprise and retaining at-risk customers), or double down on UI/product depth in the self-serve segment — and what conditions would change that answer?
