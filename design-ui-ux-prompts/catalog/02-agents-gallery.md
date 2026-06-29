# Agents Gallery

Catalog page listing all 13 AOS agents with filtering by category, hero cards for orchestrators, and compact list rows for perspective and operational agents.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Agents Gallery (/agents/) ===
Top-level catalog page for all 13 AOS agents. Two orchestrators are featured as hero cards. Remaining 11 agents displayed as compact list rows. Filter tabs allow switching between All, Orchestrators, Perspectives, and Operational categories.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Standard nav from design system (see 00-design-system.md)
- "Agents" link in active state: #1d1d1f, font-weight 600

SECTION 2 — Page Header
- Background #f5f5f7, padding 64px 0 48px
- Content max-width 1200px centered
- No breadcrumb (top-level page)
- Title: "Agent Roster" — Inter 800, 48px, -0.5px tracking, #1d1d1f
- Subtitle: "13 cognitive agents, each with a distinct objective function, bias, and evidence standard. Assembled into councils by orchestration profiles." — Inter 400, 17px, #424245, line-height 1.6, max-width 640px, margin-top 12px
- Filter tabs: margin-top 32px, flex row, gap 8px
  - Tab pill style: padding 8px 18px, border-radius 20px, Inter 500, 14px, cursor pointer
  - Active tab: background #1d1d1f, color #ffffff
  - Inactive tab: background #ffffff, border 1px solid #e8e8ed, color #86868b, hover color #1d1d1f hover background #fafafa
  - Tabs: "All (13)" | "Orchestrators (2)" | "Perspectives (8)" | "Operational (3)"

SECTION 3 — Hero Cards (Orchestrators)
- Background #ffffff, padding 40px 0
- Content max-width 1200px centered
- Label above: "ORCHESTRATORS" — Inter 500, 12px, #86868b, uppercase, tracking 0.5px, margin-bottom 16px
- 2 hero cards side by side, gap 16px

  Hero Card 1 — Arbiter:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 20px 24px
  - Left accent bar: 4px wide, #f59e0b (amber), border-radius 2px
  - Layout: accent bar left, content right (flex row)
  - Title: "Arbiter" — Inter 600, 17px, #1d1d1f
  - Role: "Neutral decision synthesizer. Frames strategic questions, drives multi-perspective debate, and synthesizes competing viewpoints into actionable, ranked recommendations with documented dissent." — Inter 400, 15px, #424245, line-height 1.6, margin-top 8px
  - Core bias: "neutrality" — Inter 400, 13px, #86868b, margin-top 8px
  - Badge row: margin-top 12px, flex row, gap 8px
    - Badge "orchestrator" — background rgba(245,158,11,0.1), color #f59e0b, Inter 600 12px, padding 3px 10px, border-radius 12px
    - Badge "premium" — background rgba(0,0,0,0.05), color #86868b, same styling
  - Hover: border-color #d1d1d6, box-shadow 0 4px 20px rgba(0,0,0,0.06)
  - Links to /agents/arbiter

  Hero Card 2 — CTO Orchestrator:
  - Same card structure
  - Left accent bar: #f59e0b (amber)
  - Title: "CTO Orchestrator"
  - Role: "Execution leader. Drives the product development lifecycle from feature request to engineering handoff."
  - Core bias: "execution-quality"
  - Badges: "orchestrator" (amber), "premium" (gray)
  - Links to /agents/cto-orchestrator

SECTION 4 — List Rows (Remaining 11 Agents)
- Background #ffffff, padding 0 0 80px
- Content max-width 1200px centered
- Label above: "PERSPECTIVES" — Inter 500, 12px, #86868b, uppercase, tracking 0.5px, margin-top 32px, margin-bottom 12px

  8 Perspective Agent Rows (stacked, gap 8px):
  Each row:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 8px, padding 12px 16px
  - Layout: flex row, space-between, align-center
  - Left group: 6px dot (#0071e3 blue) + name (Inter 600, 14px, #1d1d1f) + core_bias (Inter 400, 13px, #86868b, in parentheses)
  - Right group: "Perspective" label (Inter 400, 12px, #86868b) + bullet + model tier (Inter 400, 12px, #86868b) + chevron →
  - Hover: background #fafafa, border-color #d1d1d6
  - Each links to /agents/[id]

  Row data:
  1. Catalyst — (speed-and-monetization) — Perspective · standard
  2. Sentinel — (sustainability-and-trust) — Perspective · standard
  3. Architect — (system-durability) — Perspective · standard
  4. Provocateur — (truth-seeking) — Perspective · standard
  5. Navigator — (positioning-and-timing) — Perspective · standard
  6. Advocate — (user-behavior-reality) — Perspective · standard
  7. Pathfinder — (asymmetric-upside) — Perspective · standard
  8. Strategist — (impact-per-effort) — Perspective · standard

- Label: "OPERATIONAL" — same style as above, margin-top 32px, margin-bottom 12px

  3 Operational Agent Rows (stacked, gap 8px):
  Each row: same structure, dot color #34c759 (green)

  Row data:
  1. Operator — (execution-reality) — Operational · standard
  2. Steward — (compliance-and-ethics) — Operational · standard
  3. Auditor — (learning-from-history) — Operational · standard

SECTION 5 — Footer
- Standard footer from design system

=== MOBILE LAYOUT (375px) ===
- Page header: title 32px, subtitle 15px, filter tabs horizontal scroll
- Hero cards: stack vertically, full width
- List rows: full width, right-side metadata may wrap below name on very small screens
- Section padding: 48px instead of 80px
- Side padding: 16px

=== KEY COMPONENTS ===

1. Filter Tab
   - Pill shape: padding 8px 18px, border-radius 20px
   - Active: background #1d1d1f, color #ffffff
   - Inactive: background #ffffff, border 1px solid #e8e8ed, color #86868b
   - Counts in parentheses

2. Agent Hero Card
   - Left accent bar: 4px wide, category color (#f59e0b amber for orchestrators)
   - Flex row: accent bar | content block
   - Content: title, role description, core_bias line, badge row
   - Hover: border-color #d1d1d6, subtle shadow

3. Agent List Row
   - Flex row, space-between
   - Left: 6px colored dot + name (Inter 600 14px) + core_bias in parens (Inter 400 13px #86868b)
   - Right: category label + bullet + model tier + chevron
   - Dot colors: #f59e0b (orchestrator), #0071e3 (perspective), #34c759 (operational)

4. Category Section Label
   - Inter 500, 12px, #86868b, uppercase, tracking 0.5px
   - Margin-bottom 12px

=== CONTENT ===

Page title: "Agent Roster"
Subtitle: "13 cognitive agents, each with a distinct objective function, bias, and evidence standard. Assembled into councils by orchestration profiles."
Filter tabs: All (13), Orchestrators (2), Perspectives (8), Operational (3)

Hero cards:
- Arbiter: orchestrator, premium, neutrality, "Neutral decision synthesizer. Frames strategic questions, drives multi-perspective debate, and synthesizes competing viewpoints into actionable, ranked recommendations with documented dissent."
- CTO Orchestrator: orchestrator, premium, execution-quality, "Execution leader. Drives the product development lifecycle from feature request to engineering handoff."

Perspective agents (blue dot):
- Catalyst: speed-and-monetization, standard
- Sentinel: sustainability-and-trust, standard
- Architect: system-durability, standard
- Provocateur: truth-seeking, standard
- Navigator: positioning-and-timing, standard
- Advocate: user-behavior-reality, standard
- Pathfinder: asymmetric-upside, standard
- Strategist: impact-per-effort, standard

Operational agents (green dot):
- Operator: execution-reality, standard
- Steward: compliance-and-ethics, standard
- Auditor: learning-from-history, standard
```
