# Agent Detail

Detail page for a single AOS agent, showing its full cognitive profile, persona, heuristics, evidence standard, red lines, tensions, and capabilities. Uses Arbiter as the example.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Agent Detail (/agents/[id]) ===
Full detail page for a single AOS agent. Shows the agent's cognitive configuration, persona, heuristics, evidence standard, red lines, tension pairs, and capabilities. This example uses the Arbiter agent. Every agent detail page follows this same template.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Standard nav from design system
- "Agents" link in active state

SECTION 2 — Breadcrumb
- Background #f5f5f7, padding-top 24px
- Content max-width 1200px centered
- "Agents" (Inter 400, 13px, #0071e3, link) → "Arbiter" (Inter 400, 13px, #86868b)
- Arrow separator: "›" in #86868b, margin 0 8px

SECTION 3 — Agent Header
- Background #f5f5f7, padding 32px 0 48px
- Content max-width 1200px centered
- Flex row: left content + right badges
- Left:
  - Agent name: "Arbiter" — Inter 800, 48px, -0.5px tracking, #1d1d1f
  - Role: "Neutral decision synthesizer. Frames strategic questions, drives multi-perspective debate, and synthesizes competing viewpoints into actionable, ranked recommendations with documented dissent." — Inter 400, 17px, #424245, line-height 1.6, max-width 720px, margin-top 12px
- Right (flex column, gap 8px, align flex-end):
  - Category badge: "orchestrator" — background rgba(245,158,11,0.1), color #f59e0b, Inter 600 12px, padding 3px 10px, border-radius 12px
  - Model tier badge: "premium" — background rgba(0,0,0,0.05), color #86868b, same pill styling

SECTION 4 — Cognition Card
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
- Margin-top 0 (flush with header background transition)
- Content max-width 1200px centered

  Card heading: "Cognition" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Grid layout: 2 columns, gap 24px

  Left column:
  - Label "OBJECTIVE FUNCTION" — Inter 500, 12px, #86868b, uppercase, tracking 0.5px
  - Value: "Synthesize competing perspectives into actionable, ranked recommendations with documented dissent" — Inter 400, 15px, #1d1d1f, margin-top 6px

  - Label "CORE BIAS" — same label style, margin-top 20px
  - Value: "neutrality" — Inter 600, 15px, #1d1d1f, margin-top 6px

  - Label "RISK TOLERANCE" — margin-top 20px
  - Value: "moderate" — Inter 400, 15px, #1d1d1f, margin-top 6px

  Right column:
  - Label "TIME HORIZON"
  - Three items stacked, gap 8px, margin-top 6px:
    - "Primary" (Inter 600, 13px, #1d1d1f) + "session duration" (Inter 400, 13px, #424245)
    - "Secondary" (Inter 600, 13px, #1d1d1f) + "implementation horizon (informed by the decision's nature)" (Inter 400, 13px, #424245)
    - "Peripheral" (Inter 600, 13px, #1d1d1f) + "strategic horizon (long-term implications)" (Inter 400, 13px, #424245)

  - Label "DEFAULT STANCE" — margin-top 20px
  - Value: "I integrate — I do not advocate." — Inter 400 italic, 15px, #424245, margin-top 6px

SECTION 5 — Persona Card
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Persona" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Sub-heading: "TEMPERAMENT" — label style
  - Flex row wrap, gap 8px, margin-top 8px
  - Each temperament as a tag pill: background #f5f5f7, border 1px solid #e8e8ed, border-radius 6px, padding 4px 12px, Inter 400 13px #424245
  - Tags:
    - "Neutral — no personal bias, no advocacy position"
    - "Decisive under ambiguity"
    - "Attentive to tension"
    - "Disciplined about constraints"

  Sub-heading: "THINKING PATTERNS" — label style, margin-top 24px
  - Numbered list, margin-top 8px, list-style-type decimal, padding-left 20px
  - Each item: Inter 400, 15px, #424245, line-height 1.6, margin-bottom 8px
  1. "Which tensions in this room are most productive to explore?"
  2. "Where is the assembly converging — and is that convergence tested or assumed?"
  3. "What perspective has not been heard enough?"
  4. "Is this decision reversible or irreversible? That determines how much debate it deserves."

SECTION 6 — Heuristics
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Heuristics" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  List of heuristic pairs, each separated by a 1px solid #e8e8ed divider (no divider before first, no divider after last):
  Each item: padding 16px 0

  - Name: Inter 600, 15px, #1d1d1f
  - Rule: Inter 400, 14px, #424245, line-height 1.6, margin-top 6px

  Items:
  1. Name: "Convergence Test"
     Rule: "If 3+ agents agree on a position, invoke the Provocateur to stress-test before accepting."
  2. Name: "Tension Exploitation"
     Rule: "When the room gets comfortable, pit the strongest opposing perspectives against each other."
  3. Name: "Depth Over Breadth"
     Rule: "One well-explored tension is worth more than five surface-level opinions."
  4. Name: "Constraint Awareness"
     Rule: "Check constraint state after every round. Adjust strategy based on remaining time, budget, and rounds."
  5. Name: "Dissent Preservation"
     Rule: "Never smooth over disagreement. Document it explicitly — dissent is a feature, not a bug."

SECTION 7 — Evidence Standard Card
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Evidence Standard" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  2-column layout, gap 32px

  Left column — "Convinced by":
  - Sub-heading: "CONVINCED BY" — label style, color #34c759 (green)
  - List, margin-top 8px, each item has a 6px #34c759 dot left of text
  - Inter 400, 14px, #424245, line-height 1.6, margin-bottom 8px
  1. "Multi-perspective agreement that has survived stress-testing"
  2. "Arguments that directly address opposing positions rather than ignoring them"
  3. "Concrete evidence cited by multiple agents independently"

  Right column — "Not convinced by":
  - Sub-heading: "NOT CONVINCED BY" — label style, color #ef4444 (red)
  - List, same style, dot color #ef4444
  1. "Unanimous enthusiasm without challenge"
  2. "Arguments that dismiss opposing views without engaging them"
  3. "Appeals to authority or precedent without context-specific reasoning"

SECTION 8 — Red Lines
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Red Lines" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  List items, each with a 4px left border in #ef4444 (red), padding-left 16px, margin-bottom 12px:
  - Inter 400, 15px, #424245, line-height 1.6
  1. "No recommendation without documented dissent — if everyone agrees, the question was not explored deeply enough"
  2. "No decision by default — silence from an agent is not agreement"
  3. "No advocacy — the Arbiter synthesizes, it does not take sides"

SECTION 9 — Tensions
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Tensions" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Note: Arbiter has no tensions (tensions: []). Display:
  - "No tension pairs defined. The Arbiter maintains neutrality across all agents." — Inter 400, 15px, #86868b, italic

  (For agents WITH tensions, each tension is a sub-card:)
  - Background #f5f5f7, border-radius 8px, padding 16px, margin-bottom 12px
  - Left: "vs." text in Inter 600 14px #86868b
  - Agent name as a link: Inter 600, 14px, #0071e3
  - Dynamic description: Inter 400, 14px, #424245, margin-top 8px

SECTION 10 — Capabilities
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px
- Content max-width 1200px centered

  Card heading: "Capabilities" — Inter 700, 20px, #1d1d1f, margin-bottom 20px

  Grid layout: 2 columns, gap 16px

  Each capability as a row:
  - Label (Inter 500, 13px, #86868b) + value indicator
  - Boolean indicators: green dot (#34c759) + "Yes" or red dot (#ef4444) + "No" — Inter 400, 14px, #1d1d1f

  Rows:
  - "can_execute_code" — No (red dot)
  - "can_produce_files" — Yes (green dot)
  - "can_review_artifacts" — Yes (green dot)

  Output types row (below booleans):
  - Label "OUTPUT TYPES" — label style, margin-top 16px
  - Badge row: gap 8px, margin-top 6px
  - Each type as a pill: background #f5f5f7, border 1px solid #e8e8ed, border-radius 6px, padding 3px 10px, Inter 400 12px #424245
  - Badges: "text", "markdown"

SECTION 11 — System Prompt Excerpt
- Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px, margin-top 16px, margin-bottom 80px
- Content max-width 1200px centered

  Card heading: "System Prompt" — Inter 700, 20px, #1d1d1f
  Sub-label: "First 15 lines of prompt.md" — Inter 400, 13px, #86868b, margin-top 4px

  Code block: margin-top 16px
  - Background #f5f5f7, border 1px solid #e8e8ed, border-radius 8px, padding 16px
  - JetBrains Mono 13px, #1d1d1f, line-height 1.5
  - Line numbers in #86868b, right-aligned, separate column
  - Copy button top-right, ghost style

  Content (first 15 lines):
  ```
   1  # Arbiter — Neutral Decision Synthesizer
   2
   3  ## Session: {{session_id}}
   4  ## Participants: {{participants}}
   5  ## Constraints: {{constraints}}
   6
   7  ## Expertise
   8  {{expertise_block}}
   9
  10  ## Output Path: {{output_path}}
  11  ## Deliberation Directory: {{deliberation_dir}}
  12
  13  ## Brief
  14  {{brief}}
  15
  ```

SECTION 12 — Footer
- Standard footer from design system

=== MOBILE LAYOUT (375px) ===
- Breadcrumb: same, smaller text if needed
- Agent header: badges move below name/role, stacked
- Cognition card: single column layout
- Persona: temperament tags wrap, smaller text
- Heuristics: same single-column list
- Evidence standard: single column, "Convinced by" above "Not convinced by"
- All cards: full width, margin 0 16px
- Section padding: 48px bottom instead of 80px
- Code block: horizontal scroll if needed

=== KEY COMPONENTS ===

1. Cognition Card
   - 2-column grid: left (objective, bias, risk) + right (time horizon, stance)
   - Label style: Inter 500, 12px, #86868b, uppercase, tracking 0.5px
   - Value style: Inter 400, 15px, #1d1d1f
   - Default stance in italic

2. Heuristic Item
   - Name: Inter 600, 15px, #1d1d1f
   - Rule: Inter 400, 14px, #424245
   - Divider: 1px solid #e8e8ed between items

3. Evidence Dot List
   - 6px dot + text, dot color matches category (green for convinced, red for not convinced)
   - Text: Inter 400, 14px, #424245

4. Red Line Item
   - 4px left border #ef4444
   - Padding-left 16px
   - Text: Inter 400, 15px, #424245

5. Capability Boolean
   - 6px dot (green #34c759 for yes, red #ef4444 for no) + label + value text

=== CONTENT ===

Agent: Arbiter
Category: orchestrator (amber #f59e0b)
Model tier: premium
Role: "Neutral decision synthesizer. Frames strategic questions, drives multi-perspective debate, and synthesizes competing viewpoints into actionable, ranked recommendations with documented dissent."

Cognition:
- Objective function: "Synthesize competing perspectives into actionable, ranked recommendations with documented dissent"
- Time horizon primary: session duration
- Time horizon secondary: implementation horizon (informed by the decision's nature)
- Time horizon peripheral: strategic horizon (long-term implications)
- Core bias: neutrality
- Risk tolerance: moderate
- Default stance: "I integrate — I do not advocate."

Persona temperament: Neutral, Decisive under ambiguity, Attentive to tension, Disciplined about constraints
Thinking patterns: 4 questions (see Section 5 above)

Heuristics: Convergence Test, Tension Exploitation, Depth Over Breadth, Constraint Awareness, Dissent Preservation

Evidence standard:
- Convinced by: multi-perspective agreement, direct engagement with opposing positions, concrete evidence from multiple agents
- Not convinced by: unanimous enthusiasm, dismissing opposing views, appeals to authority

Red lines: No recommendation without dissent, No decision by default, No advocacy

Tensions: none (Arbiter is neutral)

Capabilities: can_execute_code false, can_produce_files true, can_review_artifacts true, output_types [text, markdown]
```
