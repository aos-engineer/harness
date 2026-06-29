# Profile Detail

Detail page for a single AOS orchestration profile, showing its agent assembly, execution workflow, constraints, tension pairs, and delegation rules. Uses CTO Execution as the example.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Profile Detail (/profiles/[id]) ===
Full detail page for a single AOS orchestration profile. Shows the agent assembly, workflow steps (for execution profiles), constraints, tension pairs, and delegation rules. This example uses the CTO Execution Orchestration profile. Every profile detail page follows this same template.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Standard nav from design system
- "Profiles" link in active state

SECTION 2 — Breadcrumb
- Background #f5f5f7, padding-top 24px
- Content max-width 1200px centered
- "Profiles" (Inter 400, 13px, #0071e3, link) → "CTO Execution Orchestration" (Inter 400, 13px, #86868b)
- Arrow separator: "›" in #86868b, margin 0 8px

SECTION 3 — Profile Header
- Background #f5f5f7, padding 32px 0 48px
- Content max-width 1200px centered
- Flex row: left content + right badges
- Left:
  - Profile name: "CTO Execution Orchestration" — Inter 800, 48px, -0.5px tracking, #1d1d1f
  - Description: "Receives a feature request or product vision, orchestrates the full product development lifecycle: requirements analysis, architecture design, task breakdown, implementation planning, and quality gates. Produces a complete execution package ready for engineering handoff." — Inter 400, 17px, #424245, line-height 1.6, max-width 720px, margin-top 12px
- Right (flex column, gap 8px, align flex-end):
  - Type badge: "execution" — background rgba(16,185,129,0.1), color #10b981, Inter 600 12px, padding 3px 10px, border-radius 12px
  - Output badge: "execution-package" — background rgba(0,0,0,0.05), color #86868b, same pill styling

SECTION 4 — Assembly
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 0
- Content max-width 1200px centered

  Card heading: "Assembly" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Orchestrator row:
  - Background #f5f5f7, border-radius 8px, padding 14px 16px, margin-bottom 16px
  - Layout: flex row, align-center
  - Left: 6px dot #f59e0b (amber) + "CTO Orchestrator" (Inter 600, 15px, #1d1d1f, link to /agents/cto-orchestrator)
  - Right: "ORCHESTRATOR" label — Inter 500, 11px, #f59e0b, uppercase, tracking 0.5px

  Perspective rows (stacked, gap 8px):
  Each row:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 8px, padding 12px 16px
  - Layout: flex row, space-between, align-center
  - Left: agent name (Inter 600, 14px, #0071e3, link to agent detail) + role_override in italic (Inter 400, 13px, #86868b, margin-left 12px)
  - Right: required/optional badge + dot color indicator
  - Required badge: "required" — background rgba(16,185,129,0.1), color #10b981, Inter 600 11px, padding 2px 8px, border-radius 10px
  - Optional badge: "optional" — background rgba(0,0,0,0.05), color #86868b, same style

  Row data:
  1. Architect — "Produce architecture decision records and system design docs" — required
  2. Strategist — "Sequence the work into phases with dependency mapping" — required
  3. Operator — "Break phases into concrete engineering tasks with effort estimates" — required
  4. Advocate — "Write user stories and acceptance criteria from the user perspective" — required
  5. Sentinel — "Review all outputs for security, reliability, and maintainability risks" — required
  6. Provocateur — "Stress-test the plan. Find the gaps. Challenge the timeline." — optional

SECTION 5 — Execution Workflow
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered
- Only displayed for execution-type profiles

  Card heading: "Execution Workflow" — Inter 700, 20px, #1d1d1f
  Sub-label: "8 steps from feature request to engineering handoff" — Inter 400, 13px, #86868b, margin-top 4px, margin-bottom 24px

  Numbered step pipeline — vertical timeline layout:
  Each step is a card in a vertical sequence connected by a thin vertical line (2px wide, #e8e8ed) on the left

  Each step card:
  - Padding-left 32px (offset from timeline line)
  - Step number: 20px circle on the timeline line, background #ffffff, border 2px solid #e8e8ed, centered number Inter 600 11px #86868b
  - Active/current step circle: background #0071e3, color white
  - Step name: Inter 600, 15px, #1d1d1f
  - Action type badge: pill, margin-left 8px, Inter 500 11px
    - "targeted-delegation" — background rgba(59,130,246,0.1), color #3b82f6
    - "tension-pair" — background rgba(245,158,11,0.1), color #f59e0b
    - "orchestrator-synthesis" — background rgba(16,185,129,0.1), color #10b981
  - Agents involved: Inter 400, 13px, #86868b, margin-top 4px
  - Review gate indicator (if true): small green checkmark icon + "User review gate" — Inter 500, 12px, #34c759, margin-top 6px

  Steps:
  1. "Requirements Analysis" — targeted-delegation — Advocate, Strategist — Review gate
  2. "Architecture & Design" — targeted-delegation — Architect — Review gate
  3. "Architecture Review" — tension-pair — Architect, Operator — No gate
  4. "Phase Planning" — targeted-delegation — Strategist, Operator — Review gate
  5. "Task Breakdown" — targeted-delegation — Operator — No gate
  6. "Security & Risk Review" — targeted-delegation — Sentinel — No gate
  7. "Final Stress Test" — targeted-delegation — Provocateur — No gate
  8. "Execution Package Assembly" — orchestrator-synthesis — CTO Orchestrator — No gate

SECTION 6 — Constraints
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Constraints" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  3 constraint cards in a row, gap 16px:
  Each card:
  - Background #f5f5f7, border-radius 8px, padding 20px
  - Label: Inter 500, 12px, #86868b, uppercase, tracking 0.5px
  - Value: Inter 700, 22px, #1d1d1f, margin-top 8px
  - Detail: Inter 400, 13px, #424245, margin-top 4px

  Card 1 — Time:
  - Label: "TIME"
  - Value: "5–30 min"
  - Detail: "Execution planning requires more time than deliberation"

  Card 2 — Budget:
  - Label: "BUDGET"
  - Value: "No limit"
  - Detail: "Typically subscription mode for execution work"

  Card 3 — Rounds:
  - Label: "ROUNDS"
  - Value: "4–12"
  - Detail: "Minimum: requirements, architecture, tasks, review"

SECTION 7 — Tension Pairs
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Tension Pairs" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Each tension pair as a row:
  - Background #f5f5f7, border-radius 8px, padding 14px 16px, margin-bottom 8px
  - Layout: flex row, align-center, gap 12px
  - Agent A name: Inter 600, 14px, #0071e3 (link)
  - Bidirectional arrow: "⟷" — Inter 400, 16px, #86868b
  - Agent B name: Inter 600, 14px, #0071e3 (link)
  - Description below: Inter 400, 13px, #424245, margin-top 4px (only if available from context)

  Pairs:
  1. Architect ⟷ Operator — "ideal design" vs "what we can actually build"
  2. Strategist ⟷ Advocate — "optimal sequence" vs "what users need first"

SECTION 8 — Delegation Rules
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px, margin-bottom 80px
- Content max-width 1200px centered

  Card heading: "Delegation Rules" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Grid layout: 3 columns, gap 24px

  Item 1:
  - Label: "DEFAULT MODE" — label style
  - Value: "targeted" — Inter 600, 15px, #1d1d1f, margin-top 6px
  - Detail: "CTO delegates to specific agents, not broadcast" — Inter 400, 13px, #86868b, margin-top 4px

  Item 2:
  - Label: "BIAS LIMIT"
  - Value: "3" — Inter 600, 15px, #1d1d1f
  - Detail: "Tighter than strategic-council. Every agent must contribute." — Inter 400, 13px, #86868b

  Item 3:
  - Label: "OPENING ROUNDS"
  - Value: "0" — Inter 600, 15px, #1d1d1f
  - Detail: "No broadcast needed. CTO knows who to ask." — Inter 400, 13px, #86868b

SECTION 9 — Footer
- Standard footer from design system

=== MOBILE LAYOUT (375px) ===
- Breadcrumb: same, text may truncate on small screens
- Profile header: badges move below description, stacked
- Assembly: role_override text wraps below agent name, required/optional badge on separate line
- Execution workflow: vertical timeline remains, cards stack naturally
- Constraints: 3 cards stack vertically
- Tension pairs: agent names may wrap
- Delegation rules: single column
- Side padding: 16px
- Section padding: 48px bottom

=== KEY COMPONENTS ===

1. Assembly Orchestrator Row
   - Background #f5f5f7, amber dot, agent name link, "ORCHESTRATOR" label right
   - Visually distinct from perspective rows

2. Assembly Perspective Row
   - White background, border, agent name link + italic role_override
   - required (green) or optional (gray) badge on right

3. Workflow Step Card
   - Vertical timeline with numbered circles
   - Step name + action type badge on same line
   - Agent names below
   - Review gate indicator (green checkmark) when present

4. Constraint Card
   - Background #f5f5f7, label/value/detail stack
   - Value in Inter 700, 22px for visual hierarchy

5. Tension Pair Row
   - Agent A ⟷ Agent B with bidirectional arrow
   - Background #f5f5f7, names as links

=== CONTENT ===

Profile: CTO Execution Orchestration
Type: execution (emerald #10b981)
Output format: execution-package
Description: "Receives a feature request or product vision, orchestrates the full product development lifecycle: requirements analysis, architecture design, task breakdown, implementation planning, and quality gates. Produces a complete execution package ready for engineering handoff."

Assembly:
- Orchestrator: CTO Orchestrator
- Perspectives: Architect (required), Strategist (required), Operator (required), Advocate (required), Sentinel (required), Provocateur (optional, speaks-last)

Workflow steps:
1. Requirements Analysis — targeted-delegation — Advocate, Strategist — review gate
2. Architecture & Design — targeted-delegation — Architect — review gate
3. Architecture Review — tension-pair — Architect, Operator
4. Phase Planning — targeted-delegation — Strategist, Operator — review gate
5. Task Breakdown — targeted-delegation — Operator
6. Security & Risk Review — targeted-delegation — Sentinel
7. Final Stress Test — targeted-delegation — Provocateur
8. Execution Package Assembly — orchestrator-synthesis — CTO Orchestrator

Constraints: Time 5–30 min, Budget null (no limit), Rounds 4–12
Tension pairs: Architect ⟷ Operator, Strategist ⟷ Advocate
Delegation: default targeted, bias_limit 3, opening_rounds 0
```
