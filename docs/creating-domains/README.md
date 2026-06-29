# Creating Domains

Domains are overlay packs that sharpen agent analysis for a specific industry or context. When a domain is applied, it injects industry-specific vocabulary, modifies agent personas with specialized heuristics, and adds guardrails -- all without changing the base agent definitions.

## Domain Structure

Each domain lives in its own directory under `core/domains/`:

```
core/domains/my-domain/
  domain.yaml    # Domain configuration with overlays
```

### domain.yaml

```yaml
schema: aos/domain/v1
id: my-domain                     # Unique, kebab-case identifier
name: My Domain                   # Human-readable display name
description: "When and why to use this domain pack."
version: 1.0.0

lexicon:
  metrics:
    - "METRIC_NAME -- Definition of the metric"
  frameworks:
    - "FRAMEWORK_NAME -- Description of the analytical framework"
  stages:
    - "stage_name -- What this stage represents"

overlays:
  agent-id:                       # Must match an existing agent's id
    thinking_patterns:
      - "Domain-specific question this agent should ask"
    heuristics:
      - name: Domain Rule Name
        rule: "Domain-specific decision shortcut"
    red_lines:
      - "Domain-specific hard limit"
    evidence_standard:
      convinced_by:
        - "Domain-specific evidence type"
      not_convinced_by:
        - "Domain-specific weak argument"
    temperament:
      - "Domain-specific behavioral trait"

additional_input_sections:
  - heading: Domain Context
    guidance: "Domain-specific information the brief should include"

additional_output_sections:
  - section: domain-analysis
    description: "Domain-specific analysis section in the memo"

guardrails:
  - "Global rule that applies to all agents in this domain context"
```

## Overlay Mechanics

When a domain is applied to a session, the `domain-merger` module processes each overlay against matching agents. Understanding what gets merged and how is critical for effective domain design.

### What Gets Appended

The following fields are **appended** (added to the end of the agent's existing arrays):

| Field | Merge behavior |
|---|---|
| `thinking_patterns` | Domain patterns added after base patterns |
| `heuristics` | Domain heuristics added after base heuristics |
| `red_lines` | Domain red lines added after base red lines |
| `evidence_standard.convinced_by` | Domain entries appended |
| `evidence_standard.not_convinced_by` | Domain entries appended |
| `temperament` | Domain traits added after base traits |

### What Does Not Merge

- **Tensions**: Domain overlays cannot modify tension pairs. Tensions are defined in the profile, not the agent or domain.
- **Cognition**: The agent's objective function, time horizon, core bias, and risk tolerance are never modified by a domain. These are fundamental to the agent's identity.
- **Model configuration**: Tier and thinking mode are not affected by domains.
- **Tools and skills**: Tool whitelists are not modified by domains.

### Merge Safety

The domain merger uses `structuredClone()` to deep-copy agent configurations before applying overlays. The original agent definitions are never mutated. If an agent referenced in the overlay does not exist in the session, the overlay for that agent is silently skipped.

## Lexicon Design

The lexicon defines the shared vocabulary for the domain. It is injected into agent contexts so they use consistent terminology:

### Metrics

Industry-standard metrics that agents should reference when analyzing proposals:

```yaml
metrics:
  - "ARR -- Annual Recurring Revenue: annualised value of subscription contracts"
  - "CAC -- Customer Acquisition Cost: fully loaded cost to acquire one new customer"
```

Use the format `ABBREVIATION -- Full Name: definition`. This makes metrics scannable and self-documenting.

### Frameworks

Analytical frameworks and strategic models relevant to the domain:

```yaml
frameworks:
  - "PLG -- Product-Led Growth: product drives acquisition without a traditional sales motion"
  - "DORA metrics -- DevOps Research and Assessment: deployment frequency, lead time, MTTR, change failure rate"
```

### Stages

Lifecycle stages or maturity levels that provide context for recommendations:

```yaml
stages:
  - "seed -- Early traction; proving product-market fit with a cohort"
  - "growth -- Scaling revenue efficiently; building category leadership"
```

## Guardrails

Guardrails are global rules that apply to all agents when the domain is active. They constrain the solution space:

```yaml
guardrails:
  - "All recommendations must consider data residency requirements for the target market"
  - "Cost projections must account for infrastructure scaling patterns typical of this domain"
  - "Security recommendations must reference the relevant compliance framework (SOC2, HIPAA, PCI-DSS)"
```

Guardrails should be specific and actionable. Avoid vague statements like "be careful about security" in favor of concrete requirements.

## Example: Creating an "E-commerce" Domain

### 1. Create the directory

```bash
bun run cli/src/index.ts create domain ecommerce
```

Or manually:

```bash
mkdir -p core/domains/ecommerce
```

### 2. Write domain.yaml

```yaml
schema: aos/domain/v1
id: ecommerce
name: E-commerce Business Context
description: "Domain pack for e-commerce businesses (B2C and D2C). Injects e-commerce-specific lexicon, conversion-focused metrics, and agent overlays for online retail decisions."
version: 1.0.0

lexicon:
  metrics:
    - "GMV -- Gross Merchandise Value: total value of goods sold through the platform"
    - "AOV -- Average Order Value: average revenue per transaction"
    - "conversion_rate -- Percentage of site visitors who complete a purchase"
    - "cart_abandonment_rate -- Percentage of shopping carts that do not convert to orders"
    - "COGS -- Cost of Goods Sold: direct costs of producing goods sold"
    - "fulfillment_cost -- Per-order cost of picking, packing, and shipping"
    - "return_rate -- Percentage of orders returned by customers"
    - "repeat_purchase_rate -- Percentage of customers who make a second purchase within 12 months"
    - "ROAS -- Return on Ad Spend: revenue generated per dollar of advertising spend"
  frameworks:
    - "marketplace -- Multi-sided platform connecting buyers and sellers; platform takes a commission"
    - "d2c -- Direct-to-Consumer: brand sells directly without intermediaries"
    - "omnichannel -- Integrated online and offline retail experience"
    - "dropship -- Seller does not hold inventory; orders fulfilled by third-party suppliers"
  stages:
    - "pre_launch -- Building product catalog, supply chain, and initial marketing"
    - "launch -- First customers; validating product-market fit and unit economics"
    - "growth -- Scaling traffic and conversion; expanding product catalog"
    - "scale -- Optimizing margins, logistics, and customer lifetime value"

overlays:
  catalyst:
    thinking_patterns:
      - "What is the conversion rate impact of this initiative?"
      - "How does this affect average order value and repeat purchase rate?"
    heuristics:
      - name: Conversion First
        rule: "Any initiative must demonstrate a clear path to improving conversion rate or AOV. If neither, it is a cost center."
      - name: Seasonal Awareness
        rule: "All timelines must account for peak seasons (Black Friday, holiday). Never launch major changes within 30 days of peak."
    evidence_standard:
      convinced_by:
        - "A/B test results with statistical significance on conversion or AOV"
        - "Cohort analysis showing repeat purchase rate improvement"
      not_convinced_by:
        - "Traffic projections without conversion rate assumptions"

  sentinel:
    thinking_patterns:
      - "What happens to fulfillment capacity if this succeeds beyond projections?"
      - "How does this affect return rate and customer satisfaction?"
    heuristics:
      - name: Supply Chain Buffer
        rule: "Never commit to a promotion without confirming 2x inventory buffer for projected demand."
    red_lines:
      - "Never approve a launch timeline that does not include fulfillment capacity validation"
    evidence_standard:
      convinced_by:
        - "Fulfillment partner SLAs with penalty clauses"
        - "Historical data on return rates for similar product categories"
      not_convinced_by:
        - "Optimistic demand forecasts without downside scenarios"

  architect:
    thinking_patterns:
      - "Does the platform architecture support this at 10x current transaction volume?"
      - "How does this integrate with existing payment, inventory, and shipping systems?"
    heuristics:
      - name: Peak Load Design
        rule: "All architecture decisions must be validated against 5x normal peak load. E-commerce traffic is bursty."

additional_input_sections:
  - heading: Product Category
    guidance: "Describe the product category, price range, and typical customer profile"
  - heading: Current Metrics
    guidance: "Include current GMV, conversion rate, AOV, and repeat purchase rate if available"

additional_output_sections:
  - section: conversion-impact
    description: "Projected impact on conversion rate, AOV, and customer lifetime value"
  - section: fulfillment-assessment
    description: "Assessment of fulfillment and logistics implications"

guardrails:
  - "All revenue projections must include conversion rate and AOV assumptions, not just traffic estimates"
  - "Pricing recommendations must account for COGS, fulfillment costs, and return rate"
  - "Customer experience changes must include mobile conversion rate impact (mobile typically 50%+ of traffic)"
  - "Any initiative with inventory implications must include a demand forecast with confidence intervals"
```

This domain sharpens agent analysis for e-commerce decisions by injecting retail-specific metrics, seasonal awareness, and fulfillment considerations into the relevant agents' cognitive frameworks.
