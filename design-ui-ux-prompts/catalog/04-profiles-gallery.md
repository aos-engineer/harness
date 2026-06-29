# Profiles Gallery

Catalog page listing all 6 AOS orchestration profiles with filtering by type, hero cards for the two primary profiles, and compact list rows for the remaining four.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Profiles Gallery (/profiles/) ===
Top-level catalog page for all 6 AOS orchestration profiles. Two profiles (Strategic Council and CTO Execution) are featured as hero cards. Remaining 4 profiles displayed as compact list rows. Filter tabs switch between All, Deliberation, and Execution types.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Standard nav from design system
- "Profiles" link in active state: #1d1d1f, font-weight 600

SECTION 2 — Page Header
- Background #f5f5f7, padding 64px 0 48px
- Content max-width 1200px centered
- Title: "Orchestration Profiles" — Inter 800, 48px, -0.5px tracking, #1d1d1f
- Subtitle: "6 pre-configured agent assemblies for strategic deliberation, execution planning, security review, and more. Each profile defines who participates, how they interact, and what gets produced." — Inter 400, 17px, #424245, line-height 1.6, max-width 700px, margin-top 12px
- Filter tabs: margin-top 32px, flex row, gap 8px
  - Tab pill style: padding 8px 18px, border-radius 20px, Inter 500, 14px
  - Active tab: background #1d1d1f, color #ffffff
  - Inactive tab: background #ffffff, border 1px solid #e8e8ed, color #86868b
  - Tabs: "All (6)" | "Deliberation (5)" | "Execution (1)"

SECTION 3 — Hero Cards
- Background #ffffff, padding 40px 0
- Content max-width 1200px centered
- 2 hero cards side by side, gap 16px

  Hero Card 1 — Strategic Council:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
  - Left accent bar: 4px wide, #3b82f6 (deliberation blue), border-radius 2px
  - Layout: accent bar left, content right (flex row)
  - Title: "Strategic Council" — Inter 600, 17px, #1d1d1f
  - Description: "Multi-perspective strategic deliberation. Submit a brief describing a strategic problem. A neutral Arbiter orchestrates 11 specialist agents who debate, challenge, and stress-test from opposing perspectives. Output is a structured memo with ranked recommendations, documented dissent, and next actions." — Inter 400, 15px, #424245, line-height 1.6, margin-top 8px
  - Metadata row: margin-top 12px, flex row, gap 16px, Inter 400 13px #86868b
    - "12 agents"
    - "5 tension pairs"
    - "2–8 rounds"
    - "$1–$10 budget"
  - Badge row: margin-top 12px, flex row, gap 8px
    - Badge "deliberation" — background rgba(59,130,246,0.1), color #3b82f6, Inter 600 12px, padding 3px 10px, border-radius 12px
    - Badge "memo" — background rgba(0,0,0,0.05), color #86868b
  - Hover: border-color #d1d1d6, box-shadow 0 4px 20px rgba(0,0,0,0.06)
  - Links to /profiles/strategic-council

  Hero Card 2 — CTO Execution:
  - Same card structure
  - Left accent bar: #10b981 (emerald/execution)
  - Title: "CTO Execution Orchestration"
  - Description: "Receives a feature request or product vision, orchestrates the full product development lifecycle: requirements analysis, architecture design, task breakdown, implementation planning, and quality gates. Produces a complete execution package ready for engineering handoff."
  - Metadata: "7 agents" · "2 tension pairs" · "4–12 rounds" · "5–30 min"
  - Badge row:
    - Badge "execution" — background rgba(16,185,129,0.1), color #10b981
    - Badge "execution-package" — background rgba(0,0,0,0.05), color #86868b
  - Links to /profiles/cto-execution

SECTION 4 — List Rows (Remaining 4 Profiles)
- Background #ffffff, padding 0 0 80px
- Content max-width 1200px centered
- Label above: "MORE PROFILES" — Inter 500, 12px, #86868b, uppercase, tracking 0.5px, margin-top 32px, margin-bottom 12px

  4 List Rows (stacked, gap 8px):
  Each row:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 8px, padding 12px 16px
  - Layout: flex row, space-between, align-center
  - Left: 6px colored dot (blue #3b82f6 for deliberation) + name (Inter 600, 14px, #1d1d1f)
  - Right: metadata items separated by bullets (Inter 400, 12px, #86868b) + chevron →
  - Hover: background #fafafa, border-color #d1d1d6
  - Each links to /profiles/[id]

  Row data:
  1. Blue dot — Security Review — deliberation · 7 agents · 2–6 rounds · $1–$8
  2. Blue dot — Delivery Ops — deliberation · 8 agents · 2–6 rounds · $1–$8
  3. Blue dot — Architecture Review — deliberation · 8 agents · 2–5 rounds · $1–$8
  4. Blue dot — Incident Response — deliberation · 7 agents · 2–4 rounds · $1–$6

SECTION 5 — Footer
- Standard footer from design system

=== MOBILE LAYOUT (375px) ===
- Page header: title 32px, subtitle 15px, filter tabs horizontal scroll
- Hero cards: stack vertically, full width
- Metadata row: wraps to 2 lines if needed
- List rows: full width, metadata wraps below name on small screens
- Side padding: 16px
- Section padding: 48px instead of 80px

=== KEY COMPONENTS ===

1. Profile Hero Card
   - Left accent bar: 4px wide, type color (#3b82f6 deliberation, #10b981 execution)
   - Flex row: accent bar | content
   - Content: title, description, metadata row (agent count, tension pairs, rounds, budget/time), badge row
   - Hover: border-color #d1d1d6, subtle shadow

2. Profile Type Badge
   - "deliberation": background rgba(59,130,246,0.1), color #3b82f6
   - "execution": background rgba(16,185,129,0.1), color #10b981

3. Output Format Badge
   - "memo", "report", "execution-package": background rgba(0,0,0,0.05), color #86868b

4. Profile List Row
   - 6px dot (type color) + name | metadata + chevron
   - Metadata: type · agent count · round range · budget or time range

=== CONTENT ===

Page title: "Orchestration Profiles"
Subtitle: "6 pre-configured agent assemblies for strategic deliberation, execution planning, security review, and more. Each profile defines who participates, how they interact, and what gets produced."
Filter tabs: All (6), Deliberation (5), Execution (1)

Hero cards:
- Strategic Council: deliberation, memo, 12 agents (1 orchestrator + 11 perspectives), 5 tension pairs, 2–8 rounds, $1–$10 budget
- CTO Execution Orchestration: execution, execution-package, 7 agents (1 orchestrator + 6 perspectives), 2 tension pairs, 4–12 rounds, 5–30 min

List rows:
- Security Review: deliberation, 7 agents, 2–6 rounds, $1–$8
- Delivery Ops: deliberation, 8 agents, 2–6 rounds, $1–$8
- Architecture Review: deliberation, 8 agents, 2–5 rounds, $1–$8
- Incident Response: deliberation, 7 agents, 2–4 rounds, $1–$6
```
