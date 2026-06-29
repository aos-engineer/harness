# Homepage

Landing page for AOS.engineer — introduces the harness, showcases the two orchestration patterns, previews the agent roster, and drives visitors to get started.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Homepage ===
The primary landing page for AOS.engineer. Establishes the product identity, explains the two orchestration patterns (deliberation and execution), previews the 13-agent roster, highlights multi-platform support, and funnels visitors toward getting started.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Height: 52px, background #ffffff, border-bottom 1px solid #e8e8ed, position sticky top 0, z-index 100
- Left: "AOS" in Inter 800 #1d1d1f + ".engineer" in Inter 800 #0071e3, no space between
- Right: Agents | Profiles | Skills | Domains | Docs | GitHub (external icon)
- Nav links: Inter 500, 14px, #86868b, hover #1d1d1f, active #1d1d1f weight 600

SECTION 2 — Hero
- Full-width background #f5f5f7, padding 120px top 80px bottom
- Content centered, max-width 800px
- Display heading: "Agentic Orchestration System" — Inter 800, 56px, -0.5px tracking, #1d1d1f, line-height 1.1
- Subtitle: "A config-driven framework that assembles specialized AI agents into deliberation councils and execution teams. No code. Just YAML, a brief, and a question worth debating." — Inter 400, 19px, #424245, line-height 1.6, max-width 640px, margin-top 20px
- CTA row: margin-top 32px, flex row, gap 12px, centered
  - Primary button: "Get Started" — background #0071e3, color white, padding 12px 28px, border-radius 8px, Inter 600 15px
  - Secondary button: "Explore Agents" — background transparent, border 1px solid #e8e8ed, color #1d1d1f, padding 12px 28px, border-radius 8px, Inter 600 15px
- Code snippet: margin-top 48px, max-width 480px, centered
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 8px, padding 16px 20px
  - Content in JetBrains Mono 14px #1d1d1f:
    $ aos run strategic-council
  - Muted comment below in JetBrains Mono 12px #86868b:
    # 13 agents. 6 profiles. One deliberation.

SECTION 3 — Stats Bar
- Background #ffffff, border-top 1px solid #e8e8ed, border-bottom 1px solid #e8e8ed
- Padding 40px 0
- Content max-width 1200px, flex row, justify space-evenly
- 4 stat items, each centered column:
  - Number: Inter 800, 36px, #1d1d1f
  - Label: Inter 500, 13px, #86868b, uppercase, 0.5px tracking, margin-top 4px
- Stats:
  - "13" / "AGENTS"
  - "6" / "PROFILES"
  - "5" / "DOMAINS"
  - "3" / "SKILLS"

SECTION 4 — Two Orchestration Patterns
- Background #f5f5f7, padding 80px 0
- Section heading: "Two Orchestration Patterns" — Inter 700, 28px, #1d1d1f, centered
- Subtitle: "Every decision is either a debate or a build. AOS handles both." — Inter 400, 15px, #424245, centered, margin-top 12px
- Two cards side by side, gap 16px, margin-top 48px, max-width 1200px centered

  CARD 1 — Deliberation:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 32px
  - Top: Badge pill "deliberation" — background rgba(59,130,246,0.1), color #3b82f6, Inter 600 12px, padding 3px 10px, border-radius 12px
  - Heading: "Deliberation" — Inter 700, 22px, #1d1d1f, margin-top 16px
  - Description: "A neutral Arbiter frames the question. Specialist agents debate from opposing perspectives. The Provocateur stress-tests consensus. Output: a structured memo with ranked recommendations and documented dissent." — Inter 400, 15px, #424245, line-height 1.6, margin-top 12px
  - Flow diagram (text-based): margin-top 24px
    Brief → Arbiter → Broadcast → Tension Pairs → Provocateur → Synthesis → Memo
    Each step as a small pill, connected by arrows (→), Inter 500, 13px, #86868b
  - Example profile: "Strategic Council, Security Review, Architecture Review" — Inter 400, 13px, #86868b, margin-top 16px

  CARD 2 — Execution:
  - Same structure as Card 1
  - Badge pill "execution" — background rgba(16,185,129,0.1), color #10b981
  - Heading: "Execution"
  - Description: "A CTO Orchestrator drives the product lifecycle. Agents produce artifacts in sequence — requirements, architecture, tasks, security review. Each phase feeds the next. Output: a complete execution package ready for engineering handoff."
  - Flow diagram:
    Brief → CTO → Requirements → Architecture → Tasks → Security → Stress Test → Package
  - Example profile: "CTO Execution Orchestration"

SECTION 5 — The Agents (Preview)
- Background #ffffff, padding 80px 0
- Section heading: "The Agents" — Inter 700, 28px, #1d1d1f
- Subtitle: "13 cognitive agents, each with a distinct bias, temperament, and evidence standard." — Inter 400, 15px, #424245, margin-top 8px

  2 Hero Cards (side by side, gap 16px, margin-top 32px):

  Hero Card 1 — Arbiter:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 20px 24px
  - Left accent bar: 4px wide, #f59e0b (amber/orchestrator), border-radius 2px
  - Layout: accent bar left, content right (flex row)
  - Title: "Arbiter" — Inter 600, 17px, #1d1d1f
  - Description: "Neutral decision synthesizer. Frames strategic questions, drives multi-perspective debate, and synthesizes competing viewpoints into actionable, ranked recommendations with documented dissent." — Inter 400, 15px, #424245
  - Badge row: margin-top 12px
    - Badge "orchestrator" — amber style (rgba(245,158,11,0.1), color #f59e0b)
    - Badge "premium" — subtle gray (rgba(0,0,0,0.05), color #86868b)
  - Hover: border-color #d1d1d6, box-shadow 0 4px 20px rgba(0,0,0,0.06)

  Hero Card 2 — CTO Orchestrator:
  - Same structure
  - Left accent bar: #f59e0b (amber)
  - Title: "CTO Orchestrator"
  - Description: "Execution leader. Drives the product development lifecycle from feature request to engineering handoff."
  - Badges: "orchestrator" (amber), "premium" (gray)

  6 List Rows (stacked, gap 8px, margin-top 16px):

  Each row:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 8px, padding 12px 16px
  - Layout: flex row, space-between, align-center
  - Left: 6px colored dot + name (Inter 600, 14px, #1d1d1f) + core_bias in parentheses (Inter 400, 12px, #86868b)
  - Right: category label (Inter 400, 12px, #86868b), chevron →
  - Hover: background #fafafa, border-color #d1d1d6

  Row data:
  1. Blue dot (#0071e3) — Catalyst — speed-and-monetization — Perspective
  2. Blue dot (#0071e3) — Sentinel — sustainability-and-trust — Perspective
  3. Blue dot (#0071e3) — Architect — system-durability — Perspective
  4. Blue dot (#0071e3) — Provocateur — truth-seeking — Perspective
  5. Blue dot (#0071e3) — Navigator — positioning-and-timing — Perspective
  6. Blue dot (#0071e3) — Advocate — user-behavior-reality — Perspective

  "View all 13 agents →" link: Inter 500, 14px, #0071e3, margin-top 16px, text-align right

SECTION 6 — Multi-Platform
- Background #f5f5f7, padding 80px 0
- Section heading: "Multi-Platform" — Inter 700, 28px, #1d1d1f, centered
- Subtitle: "Run AOS anywhere you work with AI." — Inter 400, 15px, #424245, centered, margin-top 8px
- 3 cards in a row, gap 16px, margin-top 40px, max-width 1200px centered

  Card 1 — Pi CLI:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
  - Title: "Pi CLI" — Inter 600, 17px, #1d1d1f
  - Description: "Native terminal experience. Run deliberations and executions from your command line with full control over profiles, domains, and output." — Inter 400, 15px, #424245, margin-top 8px
  - Code: JetBrains Mono 13px, margin-top 16px
    $ pi council run strategic-council

  Card 2 — Claude Code:
  - Title: "Claude Code"
  - Description: "Use AOS agents directly inside Claude Code sessions. Slash commands trigger deliberations with full agent orchestration." — Inter 400, 15px, #424245
  - Code: /aos strategic-council

  Card 3 — Gemini CLI:
  - Title: "Gemini CLI"
  - Description: "Run AOS workflows through the Gemini CLI adapter. Same agents, same profiles, different model backend." — Inter 400, 15px, #424245
  - Code: $ gemini-cli aos run strategic-council

SECTION 7 — CTA
- Background #ffffff, padding 80px 0
- Content centered, max-width 600px
- Heading: "Ready to orchestrate?" — Inter 700, 28px, #1d1d1f, centered
- Subtitle: "Install the harness. Write a brief. Let 13 agents debate your hardest question." — Inter 400, 15px, #424245, centered, margin-top 12px
- Button: "Get Started" — centered, margin-top 28px, same primary button style

SECTION 8 — Footer
- Border-top: 1px solid #e8e8ed, padding 32px, text-align center
- "AOS Harness — Agentic Orchestration System" — Inter 13px, #86868b
- "Open source. Config-driven. Multi-platform." — Inter 13px, #86868b, margin-top 4px

=== MOBILE LAYOUT (375px) ===
- Nav: hamburger menu right, slide-down overlay
- Hero: heading 32px, subtitle 16px, CTAs stack vertically full-width, code snippet full-width
- Stats bar: 2x2 grid instead of row
- Orchestration cards: stack vertically, full width
- Agent hero cards: stack vertically, full width
- List rows: same but full width, text may wrap
- Multi-platform cards: stack vertically
- CTA: same, full width button
- Section padding: 48px top/bottom instead of 80px
- Side padding: 16px

=== KEY COMPONENTS ===

1. Hero Code Snippet
   - Background #ffffff, border 1px solid #e8e8ed, border-radius 8px
   - JetBrains Mono 14px, #1d1d1f
   - "$ " prefix in #86868b
   - Copy icon top-right (ghost style)

2. Stat Item
   - Number: Inter 800, 36px, #1d1d1f
   - Label: Inter 500, 13px, #86868b, uppercase, tracking 0.5px
   - Vertically stacked, center-aligned

3. Orchestration Pattern Card
   - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 32px
   - Type badge at top (pill shape, category color at 10% opacity)
   - Flow pipeline as a horizontal sequence of small gray pills connected by → arrows
   - Hover: border-color #d1d1d6

4. Agent Hero Card
   - Left accent bar (4px wide, category color)
   - Flex row layout: accent bar | content
   - Title + description + badge row
   - Hover: subtle shadow

5. Agent List Row
   - 6px colored dot + name + core_bias
   - Category label + chevron on right
   - Compact 12px-16px padding

=== CONTENT ===

Display heading: "Agentic Orchestration System"
Subtitle: "A config-driven framework that assembles specialized AI agents into deliberation councils and execution teams. No code. Just YAML, a brief, and a question worth debating."
Primary CTA: "Get Started"
Secondary CTA: "Explore Agents"
CLI snippet: "aos run strategic-council"
Stats: 13 Agents, 6 Profiles, 5 Domains, 3 Skills
Deliberation description: "A neutral Arbiter frames the question. Specialist agents debate from opposing perspectives. The Provocateur stress-tests consensus. Output: a structured memo with ranked recommendations and documented dissent."
Execution description: "A CTO Orchestrator drives the product lifecycle. Agents produce artifacts in sequence — requirements, architecture, tasks, security review. Each phase feeds the next. Output: a complete execution package ready for engineering handoff."
Featured agents: Arbiter (orchestrator, premium), CTO Orchestrator (orchestrator, premium)
List agents: Catalyst, Sentinel, Architect, Provocateur, Navigator, Advocate
Platforms: Pi CLI, Claude Code, Gemini CLI
CTA heading: "Ready to orchestrate?"
CTA subtitle: "Install the harness. Write a brief. Let 13 agents debate your hardest question."
```
