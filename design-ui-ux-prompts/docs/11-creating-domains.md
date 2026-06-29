# Creating Domains

Stitch UI prompt for the Creating Domains documentation page at /docs/creating-domains.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Creating Domains ===
Documentation page for creating domain packs — industry-specific knowledge overlays that enhance agents without replacing their base definitions. Covers the domain.yaml schema, lexicon, overlays, merge rules, and a full SaaS domain walkthrough. Developers should leave this page able to create a domain pack for any industry vertical.

=== DESKTOP LAYOUT (1200px) ===
- Max content width: 1200px centered
- Left sidebar: 220px wide, sticky (top: 80px), contains section navigation links
- Main content: single column, max-width 720px, left-aligned next to sidebar with 48px gap
- Breadcrumb at top of main content area
- Sections flow vertically with 48px gap between them

Sidebar navigation:
- Title: "On this page" in Label style (12px, 500 weight, uppercase, #86868b)
- Links: What Domains Do, Domain Schema, Lexicon, Overlays, Merge Rules, Example
- Active link: #1d1d1f, font-weight 600, 2px left border in Signal Blue (#0071e3)

=== MOBILE LAYOUT (375px) ===
- Sidebar collapses into a horizontal scrollable pill bar at top (below breadcrumb)
- Pills: 13px Inter 500, #86868b, padding 6px 12px, border-radius 12px, border 1px solid #e8e8ed
- Active pill: background #1d1d1f, color white
- Main content: full width, 16px horizontal padding
- Tables: horizontal scroll wrapper
- Section gap reduces to 32px

=== KEY COMPONENTS ===

Breadcrumb:
- Body Small (13px, #86868b)
- "Docs > Creating Domains"
- "Docs" is a text link (#0071e3)

Page header:
- H1: "Creating Domains" — 48px desktop / 32px mobile, Inter 800, #1d1d1f
- Subtitle: "Add industry-specific knowledge overlays to sharpen agent analysis" — Body (15px, #424245), 8px below

Section headers:
- H2: 28px desktop / 22px mobile, Inter 700, #1d1d1f
- Thin border-top divider 48px above each H2

Code blocks:
- Background: #f5f5f7, border: 1px solid #e8e8ed, border-radius: 8px, padding: 16px
- JetBrains Mono 13px, #1d1d1f
- YAML syntax highlighting

Tables:
- Full width within 720px column
- Header row: background #f5f5f7, Inter 600 13px uppercase
- Body rows: Inter 400 14px #424245
- Borders: 1px solid #e8e8ed

Callout box:
- Background: #f5f5f7, border-left: 4px solid #0071e3, border-radius: 0 8px 8px 0, padding: 16px 20px

Overlay diagram:
- Visual showing base agent + domain overlay = enhanced agent
- Three boxes in a horizontal row (desktop) / vertical stack (mobile)
- Box 1: "Base Agent" — #ffffff border, agent content
- Plus sign between boxes: 24px, #86868b
- Box 2: "Domain Overlay" — #ffffff border, overlay content
- Equals sign between boxes: 24px, #86868b
- Box 3: "Enhanced Agent" — #ffffff border, Signal Blue left accent bar, merged content

=== CONTENT ===

--- Breadcrumb ---
Docs > Creating Domains

--- Page Header ---
# Creating Domains
Add industry-specific knowledge overlays to sharpen agent analysis

--- Section: What Domains Do ---
## What Domains Do

Body text:
Domains are **knowledge overlays** that enhance agents with industry-specific vocabulary, metrics, frameworks, and reasoning patterns. They do not replace agent definitions — they extend them.

Body text:
When you activate a domain (e.g., `--domain saas`), the runtime merges domain-specific enhancements into each agent before the session starts. The Catalyst still thinks like the Catalyst, but now it also knows about ARR, churn rate, and CAC payback periods.

Overlay diagram (visual):
- Box 1 "Base Catalyst": thinking_patterns: ["Who will pay for this?", "What is the fastest path to revenue?"]
- Plus sign
- Box 2 "SaaS Domain Overlay": thinking_patterns: ["Quantify impact on ARR or MRR", "Challenge CAC payback > 18 months"]
- Equals sign
- Box 3 "Enhanced Catalyst": thinking_patterns: ["Who will pay for this?", "What is the fastest path to revenue?", "Quantify impact on ARR or MRR", "Challenge CAC payback > 18 months"]

Callout box (KEY CONCEPT):
Domain values are always **appended**, never replaced. The agent's base thinking patterns, heuristics, evidence standards, and red lines remain intact. The domain adds to them.

--- Section: Domain Schema ---
## Domain Schema

A complete domain.yaml:

```yaml
schema: aos/domain/v1                   # Required. Schema identifier.
id: saas                                # Unique domain ID.
name: SaaS Business Context             # Display name.
description: >                          # What this domain adds.
  Domain pack for B2B and B2C SaaS
  businesses. Injects SaaS-specific
  lexicon, metrics, and agent overlays
  for subscription-based software.
version: 1.0.0

lexicon:                                # Industry vocabulary.
  metrics:                              # Standard metrics and definitions.
    - "ARR — Annual Recurring Revenue"
    - "MRR — Monthly Recurring Revenue"
    - "NRR — Net Revenue Retention"
    - "CAC — Customer Acquisition Cost"
    - "LTV — Lifetime Value"
    - "churn_rate — % customers or revenue lost per period"
  frameworks:                           # Industry frameworks and models.
    - "PLG — Product-Led Growth"
    - "sales_led — Enterprise sales motion"
    - "land_and_expand — Start narrow, expand over time"
  stages:                               # Business lifecycle stages.
    - "pre_seed — Pre-PMF, team and hypothesis"
    - "seed — Early traction, proving PMF"
    - "series_a — Scaling GTM, $1M-$10M ARR"
    - "growth — Scaling revenue efficiently"
    - "scale — Optimizing unit economics at scale"

overlays:                               # Per-agent enhancements.
  catalyst:
    thinking_patterns:
      - "Quantify impact on ARR or MRR for every opportunity"
      - "Challenge any initiative where CAC payback > 18 months"
    heuristics:
      - name: SaaS Revenue Test
        rule: "Quantify direct impact on ARR or MRR expansion."
      - name: Payback Obsession
        rule: "Challenge any initiative where CAC payback > 18 months."
    evidence_standard:
      convinced_by:
        - "Revenue claims with conversion rate, ACV, and time-to-close"
      not_convinced_by:
        - "Revenue claims without conversion rate assumptions"

  sentinel:
    thinking_patterns:
      - "Treat NRR below 100% as existential"
      - "Assess whether decisions increase or decrease switching costs"
    heuristics:
      - name: NRR Focus
        rule: "Treat NRR below 100% as existential. Flag churn-accelerating decisions."
      - name: Switching Costs
        rule: "Assess impact on customer switching costs."

  architect:
    thinking_patterns:
      - "Evaluate against 10x customer base with same team"
      - "Track ops cost per customer — must decline at scale"
    heuristics:
      - name: Multi-Tenant Scale
        rule: "Evaluate against 10x customers with the same team."

  provocateur:
    thinking_patterns:
      - "Challenge growth projections against SaaS benchmarks"
      - "Model competitor counterfactual for every strategic move"
    heuristics:
      - name: SaaS Base Rate Check
        rule: "Require published benchmark comparison for growth projections."

additional_input_sections:              # Extra brief sections for this domain.
  - heading: "## Metrics"
    guidance: >
      Current ARR, MRR, NRR, churn rate,
      CAC, LTV, payback period. Include
      3-month trend where available.

additional_output_sections:             # Extra output sections.
  - section: financial_impact
    description: >
      Projected impact on ARR, churn,
      and unit economics for each path.

guardrails:                             # Domain-specific validation rules.
  - "Revenue projections must state conversion rate, ACV, volume, and time horizon"
  - "Recommendations with churn risk must include churn impact assessment"
  - "Initiatives with CAC payback > 24 months require CFO-level justification"
```

--- Section: Lexicon ---
## Lexicon

The `lexicon` block defines the shared vocabulary that all agents in the session will understand. It has three sub-sections.

Body text:
**metrics** — Standard measurements and their definitions. Agents reference these consistently when discussing quantitative data.

Body text:
**frameworks** — Industry models and strategies. Agents can reference these by name (e.g., "this is a PLG motion") and all participants share the same definition.

Body text:
**stages** — Business lifecycle stages. Agents calibrate their advice based on the company's current stage. A recommendation for a seed-stage company differs from one for a growth-stage company.

Callout box (TIP):
Use the `--domain` flag when running a session to activate a domain:

```bash
aos run strategic-council --brief brief.md --domain saas
```

Multiple domains can be activated simultaneously:

```bash
aos run strategic-council --brief brief.md --domain saas --domain fintech
```

--- Section: Overlays ---
## Overlays

The `overlays` block defines per-agent enhancements. Each key is an agent ID, and the value contains the fields to merge.

Body text:
Overlay-able fields (any or all can be specified per agent):

Bulleted list:
- **thinking_patterns** — Additional questions the agent asks itself
- **heuristics** — Additional named decision rules
- **evidence_standard.convinced_by** — Additional evidence the agent accepts
- **evidence_standard.not_convinced_by** — Additional evidence the agent rejects
- **red_lines** — Additional hard limits

Body text:
You only need to define overlays for agents that benefit from domain-specific enhancement. If an agent does not have an overlay entry, it participates with its base definition unchanged.

```yaml
overlays:
  catalyst:
    thinking_patterns:
      - "Quantify impact on ARR or MRR for every opportunity"
    heuristics:
      - name: SaaS Revenue Test
        rule: "Quantify direct impact on ARR or MRR expansion."
    evidence_standard:
      convinced_by:
        - "Revenue claims with conversion rate, ACV, and time-to-close"
      not_convinced_by:
        - "Revenue claims without conversion rate assumptions"
```

--- Section: Merge Rules ---
## Merge Rules

When a domain is activated, the runtime merges overlay values into agent definitions using these rules:

Table:
| Field | Merge Behavior | Example |
|-------|---------------|---------|
| `thinking_patterns` | Appended to base list | Base has 3 patterns + domain adds 2 = agent has 5 patterns |
| `heuristics` | Appended to base list | Base has 4 heuristics + domain adds 2 = agent has 6 heuristics |
| `evidence_standard.convinced_by` | Appended to base list | Base accepts 3 evidence types + domain adds 1 = 4 total |
| `evidence_standard.not_convinced_by` | Appended to base list | Base rejects 3 evidence types + domain adds 1 = 4 total |
| `red_lines` | Appended to base list | Base has 3 red lines + domain adds 1 = 4 red lines |

Callout box (KEY RULE):
Domain values are **always appended, never replaced**. This is a core design principle. An agent's base identity is inviolable — domains enhance, they do not override.

Body text:
When multiple domains are active, overlays from all domains are appended in the order the domains are specified. If both `saas` and `fintech` domains define thinking_patterns for the Catalyst, the Catalyst gets both sets appended to its base patterns.

--- Section: Example ---
## Example

Body text:
Walk through creating a SaaS domain pack from scratch.

H3: Step 1 — Create the directory

```bash
mkdir -p core/domains/saas
```

H3: Step 2 — Define the lexicon

Body text:
Start with the metrics your agents need to speak fluently:

```yaml
lexicon:
  metrics:
    - "ARR — Annual Recurring Revenue: annualized subscription contracts"
    - "MRR — Monthly Recurring Revenue: monthly subscription revenue"
    - "NRR — Net Revenue Retention: retained + expanded revenue from existing customers"
    - "CAC — Customer Acquisition Cost: fully loaded cost to acquire one customer"
    - "LTV — Lifetime Value: projected total revenue from a customer"
    - "churn_rate — % of customers or revenue lost per period"
    - "expansion_revenue — Additional revenue from upsell, cross-sell, seat growth"
    - "payback_period — Months of gross margin to recover CAC"
  frameworks:
    - "PLG — Product-Led Growth: product drives acquisition and expansion"
    - "sales_led — Enterprise sales motion drives acquisition"
    - "hybrid_motion — PLG for SMB + sales-led for enterprise"
    - "land_and_expand — Narrow beachhead, expand over time"
  stages:
    - "pre_seed — Pre-PMF; team and hypothesis"
    - "seed — Early traction; proving PMF with a cohort"
    - "series_a — Scaling GTM; $1M-$10M ARR"
    - "growth — Scaling revenue efficiently; building category"
    - "scale — Optimizing unit economics; preparing for IPO/M&A"
```

H3: Step 3 — Add agent overlays

Body text:
Think about what each agent needs to know about SaaS. The Catalyst needs revenue metrics. The Sentinel needs churn and retention signals. The Architect needs scalability heuristics.

```yaml
overlays:
  catalyst:
    thinking_patterns:
      - "For every opportunity, quantify its direct impact on ARR or MRR expansion"
      - "Challenge any initiative where CAC payback exceeds 18 months"
    heuristics:
      - name: SaaS Revenue Test
        rule: "Quantify direct impact on ARR or MRR expansion for every opportunity."
      - name: Payback Obsession
        rule: "Challenge any initiative where CAC payback exceeds 18 months."

  sentinel:
    thinking_patterns:
      - "Treat NRR below 100% as an existential signal"
      - "Assess whether the decision increases or decreases customer switching costs"
    heuristics:
      - name: NRR Focus
        rule: "Treat NRR below 100% as existential. Flag churn-accelerating decisions."
      - name: Switching Costs
        rule: "Assess whether the decision increases or decreases switching costs."
```

H3: Step 4 — Add guardrails

Body text:
Guardrails are validation rules that apply to the entire session. The runtime flags outputs that violate them.

```yaml
guardrails:
  - "Revenue projections must state assumptions on conversion rate, ACV, volume, and time horizon"
  - "Recommendations with material churn risk must include a churn impact assessment"
  - "Initiatives projecting CAC payback beyond 24 months require CFO-level justification"
```

H3: Step 5 — Validate

```bash
aos validate domain core/domains/saas/domain.yaml
```

Body text:
The validator checks:

Bulleted list:
- Schema version is `aos/domain/v1`
- All required fields present (id, name, lexicon)
- Overlay agent IDs reference agents that exist
- Overlay fields use valid merge-able field names
- Guardrails are non-empty strings

H3: Step 6 — Use it

```bash
aos run strategic-council --brief brief.md --domain saas
```

Body text:
Every agent in the session now has SaaS-specific vocabulary, thinking patterns, and heuristics merged into their base definitions. The Catalyst will quantify ARR impact. The Sentinel will flag NRR risks. The Provocateur will demand SaaS benchmark comparisons.
```
