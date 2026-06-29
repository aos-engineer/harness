# Domains Gallery

Catalog page listing all 5 AOS domain packs with card layout showing each domain's description, agent overlay count, and key metrics/frameworks.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Domains Gallery (/domains/) ===
Catalog page for all 5 AOS domain packs. Card grid layout. Each card shows the domain's name, description, how many agents it enhances with overlays, and key metrics and frameworks injected by the domain.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Standard nav from design system
- "Domains" link in active state: #1d1d1f, font-weight 600

SECTION 2 — Page Header
- Background #f5f5f7, padding 64px 0 48px
- Content max-width 1200px centered
- Title: "Domain Packs" — Inter 800, 48px, -0.5px tracking, #1d1d1f
- Subtitle: "Domain-specific overlays that sharpen agent analysis for your industry. Each pack injects specialized lexicon, metrics, frameworks, and agent-level heuristic overlays. Activate a domain when creating a deliberation to ground every perspective in your context." — Inter 400, 17px, #424245, line-height 1.6, max-width 700px, margin-top 12px

SECTION 3 — Domain Cards
- Background #ffffff, padding 40px 0 80px
- Content max-width 1200px centered
- Grid: 3 columns first row, 2 columns second row (centered), gap 16px
- Alternative: 2 columns for all 5 cards (3 + 2 layout), or 3 + 2 if it looks better

  CARD 1 — SaaS:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
  - Title: "SaaS" — Inter 600, 17px, #1d1d1f
  - Full name below: "SaaS Business Context" — Inter 400, 13px, #86868b, margin-top 2px
  - Description: "Domain pack for B2B and B2C SaaS businesses. Injects SaaS-specific lexicon, metrics standards, and agent overlays that sharpen each perspective's analysis for subscription-based software decisions." — Inter 400, 15px, #424245, line-height 1.6, margin-top 12px

  - Overlay count badge: margin-top 16px
    - "7 agent overlays" — background rgba(0,113,227,0.1), color #0071e3, Inter 600 12px, padding 3px 10px, border-radius 12px

  - Sub-heading: "KEY METRICS" — Inter 500, 12px, #86868b, uppercase, tracking 0.5px, margin-top 20px
  - Compact list, margin-top 6px, Inter 400 13px #424245:
    - ARR, MRR, NRR, CAC, LTV, churn_rate, expansion_revenue, payback_period

  - Sub-heading: "FRAMEWORKS" — same label style, margin-top 12px
  - Compact list, margin-top 6px, Inter 400 13px #424245:
    - PLG, sales_led, hybrid_motion, land_and_expand

  - Hover: border-color #d1d1d6, box-shadow 0 4px 20px rgba(0,0,0,0.06)

  CARD 2 — Healthcare:
  - Same card structure
  - Title: "Healthcare"
  - Full name: "Healthcare & Life Sciences Context"
  - Description: "Domain pack for clinical decision support, patient safety, and regulatory compliance. Injects healthcare-specific lexicon, evidence standards, and agent overlays that sharpen each perspective's analysis for decisions involving patient care, clinical operations, and life sciences regulatory pathways (HIPAA, FDA, IRB)."
  - Overlay count: "7 agent overlays"
  - Key metrics: patient_outcomes, readmission_rates, adverse_event_rates, clinical_trial_enrollment, time_to_diagnosis, care_pathway_adherence, mortality_rates, infection_rates
  - Frameworks: EBM, CDS, VBC, PHM

  CARD 3 — Fintech:
  - Title: "Fintech"
  - Full name: "Fintech & Financial Services Context"
  - Description: "Domain pack for financial services, payments, lending, and investment platforms. Injects fintech-specific lexicon, compliance standards, and agent overlays that sharpen each perspective's analysis for decisions involving money movement, customer funds, regulatory compliance, and financial product design."
  - Overlay count: "7 agent overlays"
  - Key metrics: AUM, transaction_volume, default_rate, approval_rate, fraud_rate, cost_per_transaction, net_interest_margin, regulatory_capital_ratio
  - Frameworks: embedded_finance, open_banking, defi_integration, regtech, core_banking_modernization

  CARD 4 — Platform Engineering:
  - Title: "Platform Engineering"
  - Full name: "Platform Engineering Context"
  - Description: "Domain pack for internal developer platforms, infrastructure, and SRE practices. Injects platform-engineering-specific lexicon, reliability standards, and agent overlays that sharpen each perspective's analysis for decisions involving developer experience, infrastructure investment, and operational excellence."
  - Overlay count: "7 agent overlays"
  - Key metrics: deployment_frequency, lead_time_for_changes, MTTR, change_failure_rate, developer_satisfaction, platform_adoption_rate, infrastructure_cost_per_developer
  - Frameworks: platform_as_product, golden_path, self_service_infrastructure, GitOps, SRE_practices

  CARD 5 — Personal Decisions:
  - Title: "Personal Decisions"
  - Full name: "Personal Decisions"
  - Description: "Domain pack for personal and life decisions. Strips business metrics and adds life-stage context, emotional impact assessment, and personal values alignment. Sharpens each agent's analysis for career changes, major purchases, relationship decisions, relocations, and other life-defining choices."
  - Overlay count: "6 agent overlays"
  - Key metrics: life_satisfaction, financial_runway, career_growth, relationship_quality, health_metrics, optionality_score
  - Frameworks: regret_minimization, optionality_preservation, values_alignment, opportunity_cost, reversibility_test

SECTION 4 — Footer
- Standard footer from design system

=== MOBILE LAYOUT (375px) ===
- Page header: title 32px, subtitle 15px
- Domain cards: stack vertically, full width, single column
- Metrics and frameworks lists: wrap naturally
- Side padding: 16px
- Section padding: 48px instead of 80px

=== KEY COMPONENTS ===

1. Domain Card
   - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
   - Title (Inter 600, 17px) + full name (Inter 400, 13px, #86868b) + description
   - Overlay count badge
   - Metrics list and frameworks list as compact inline text
   - Hover: border-color #d1d1d6, subtle shadow

2. Overlay Count Badge
   - Pill: background rgba(0,113,227,0.1), color #0071e3
   - Inter 600 12px, padding 3px 10px, border-radius 12px

3. Metrics List
   - Compact inline format: metrics separated by commas or displayed as small pills
   - JetBrains Mono 12px for metric names (they are code-like identifiers)
   - Or Inter 400 13px if displayed as readable text
   - Keep compact — this is metadata, not primary content

4. Frameworks List
   - Same compact format as metrics
   - Each framework name in JetBrains Mono 12px or Inter 400 13px

=== CONTENT ===

Page title: "Domain Packs"
Subtitle: "Domain-specific overlays that sharpen agent analysis for your industry. Each pack injects specialized lexicon, metrics, frameworks, and agent-level heuristic overlays. Activate a domain when creating a deliberation to ground every perspective in your context."

Domain 1 — SaaS:
- Full name: SaaS Business Context
- 7 agent overlays (catalyst, sentinel, architect, provocateur, navigator, advocate, strategist)
- Key metrics: ARR, MRR, NRR, CAC, LTV, churn_rate, expansion_revenue, payback_period
- Frameworks: PLG, sales_led, hybrid_motion, land_and_expand

Domain 2 — Healthcare:
- Full name: Healthcare & Life Sciences Context
- 7 agent overlays (catalyst, sentinel, architect, provocateur, steward, advocate, operator)
- Key metrics: patient_outcomes, readmission_rates, adverse_event_rates, clinical_trial_enrollment, time_to_diagnosis, care_pathway_adherence, mortality_rates, infection_rates
- Frameworks: EBM, CDS, VBC, PHM

Domain 3 — Fintech:
- Full name: Fintech & Financial Services Context
- 7 agent overlays (catalyst, sentinel, architect, provocateur, steward, navigator, strategist)
- Key metrics: AUM, transaction_volume, default_rate, approval_rate, fraud_rate, cost_per_transaction, net_interest_margin, regulatory_capital_ratio
- Frameworks: embedded_finance, open_banking, defi_integration, regtech, core_banking_modernization

Domain 4 — Platform Engineering:
- Full name: Platform Engineering Context
- 7 agent overlays (catalyst, sentinel, architect, provocateur, operator, advocate, pathfinder)
- Key metrics: deployment_frequency, lead_time_for_changes, MTTR, change_failure_rate, developer_satisfaction, platform_adoption_rate, infrastructure_cost_per_developer
- Frameworks: platform_as_product, golden_path, self_service_infrastructure, GitOps, SRE_practices

Domain 5 — Personal Decisions:
- Full name: Personal Decisions
- 6 agent overlays (catalyst, sentinel, provocateur, pathfinder, advocate, operator)
- Key metrics: life_satisfaction, financial_runway, career_growth, relationship_quality, health_metrics, optionality_score
- Frameworks: regret_minimization, optionality_preservation, values_alignment, opportunity_cost, reversibility_test
```
