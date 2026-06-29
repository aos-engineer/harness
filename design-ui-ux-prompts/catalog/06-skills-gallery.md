# Skills Gallery

Catalog page listing all 3 AOS skills with card layout showing inputs, outputs, and compatible agents.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Skills Gallery (/skills/) ===
Catalog page for all 3 AOS skills. Since there are only 3 items, use a card grid (not hero+list hybrid). Each card shows the skill's name, description, required inputs, output artifacts, and compatible agents as linked badges.

=== DESKTOP LAYOUT (1200px) ===

SECTION 1 — Sticky Navigation
- Standard nav from design system
- "Skills" link in active state: #1d1d1f, font-weight 600

SECTION 2 — Page Header
- Background #f5f5f7, padding 64px 0 48px
- Content max-width 1200px centered
- Title: "Skills" — Inter 800, 48px, -0.5px tracking, #1d1d1f
- Subtitle: "AOS-aware skill definitions that agents can invoke during deliberation or execution. Each skill specifies its inputs, outputs, and which agents are qualified to use it." — Inter 400, 17px, #424245, line-height 1.6, max-width 640px, margin-top 12px

SECTION 3 — Skill Cards
- Background #ffffff, padding 40px 0 80px
- Content max-width 1200px centered
- 3 cards in a row, gap 16px

  CARD 1 — Code Review:
  - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
  - Title: "Code Review" — Inter 600, 17px, #1d1d1f
  - Description: "Reviews code artifacts against quality standards and security best practices" — Inter 400, 15px, #424245, line-height 1.6, margin-top 8px

  - Sub-heading: "REQUIRED INPUTS" — Inter 500, 12px, #86868b, uppercase, tracking 0.5px, margin-top 20px
  - List, margin-top 8px:
    - Each item: 6px dot #e8e8ed + text (Inter 400, 13px, #424245)
    1. "code_artifact" — The code or implementation artifact to review
  - Optional inputs (muted):
    - "standards" — Project-specific coding standards or review criteria
    - "architecture" — Architecture artifact for context on design intent

  - Sub-heading: "OUTPUT ARTIFACTS" — same label style, margin-top 16px
  - List, margin-top 8px:
    - Each item: 6px dot #34c759 + text
    1. "review_report" (markdown) — Structured review report with issues and recommendations

  - Sub-heading: "COMPATIBLE AGENTS" — same label style, margin-top 16px
  - Badge row: flex row wrap, gap 6px, margin-top 8px
    - Each agent as a linked badge pill: background rgba(0,113,227,0.1), color #0071e3, Inter 600 12px, padding 3px 10px, border-radius 12px, cursor pointer
    - Badges: "Sentinel", "Architect", "Operator"

  - Hover: border-color #d1d1d6, box-shadow 0 4px 20px rgba(0,0,0,0.06)

  CARD 2 — Security Scan:
  - Same card structure
  - Title: "Security Scan"
  - Description: "Scans architecture and code for security vulnerabilities, compliance gaps, and risk factors"
  - Required inputs:
    1. "target_artifact" — The architecture or code artifact to scan
  - Optional inputs:
    - "compliance_requirements" — Specific compliance frameworks to check against (SOC2, HIPAA, etc.)
  - Output artifacts:
    1. "security_report" (markdown) — Security assessment with vulnerabilities, severity ratings, and remediation
  - Compatible agents: "Sentinel", "Steward"

  CARD 3 — Task Decomposition:
  - Same card structure
  - Title: "Task Decomposition"
  - Description: "Breaks phases and architecture into concrete engineering tasks with effort estimates"
  - Required inputs:
    1. "phase_plan" — Phase plan with milestones and dependencies
    2. "architecture" — Architecture decision record for context
  - Optional inputs:
    - "team_context" — Team size, skills, and capacity constraints
  - Output artifacts:
    1. "task_breakdown" (structured-data) — Concrete task list with effort estimates, dependencies, and acceptance criteria
  - Compatible agents: "Operator", "Strategist"

SECTION 4 — Footer
- Standard footer from design system

=== MOBILE LAYOUT (375px) ===
- Page header: title 32px, subtitle 15px
- Skill cards: stack vertically, full width
- Compatible agent badges: wrap to multiple rows if needed
- Side padding: 16px
- Section padding: 48px instead of 80px

=== KEY COMPONENTS ===

1. Skill Card
   - Background #ffffff, border 1px solid #e8e8ed, border-radius 12px, padding 24px
   - Title (Inter 600, 17px) + description + input list + output list + compatible agents
   - Sections separated by sub-headings in label style
   - Hover: border-color #d1d1d6, subtle shadow

2. Input Item
   - 6px dot #e8e8ed + input id in Inter 600 13px #1d1d1f + description in Inter 400 13px #86868b
   - Optional inputs displayed below required, slightly indented or in muted style

3. Output Item
   - 6px dot #34c759 (green) + artifact id in Inter 600 13px #1d1d1f + format in parens (Inter 400 12px #86868b) + description

4. Compatible Agent Badge
   - Linked pill: background rgba(0,113,227,0.1), color #0071e3
   - Inter 600 12px, padding 3px 10px, border-radius 12px
   - Hover: background rgba(0,113,227,0.15), cursor pointer
   - Links to /agents/[id]

=== CONTENT ===

Page title: "Skills"
Subtitle: "AOS-aware skill definitions that agents can invoke during deliberation or execution. Each skill specifies its inputs, outputs, and which agents are qualified to use it."

Skill 1 — Code Review:
- Description: "Reviews code artifacts against quality standards and security best practices"
- Required: code_artifact (artifact)
- Optional: standards (text), architecture (artifact)
- Output: review_report (markdown)
- Compatible: Sentinel, Architect, Operator

Skill 2 — Security Scan:
- Description: "Scans architecture and code for security vulnerabilities, compliance gaps, and risk factors"
- Required: target_artifact (artifact)
- Optional: compliance_requirements (text)
- Output: security_report (markdown)
- Compatible: Sentinel, Steward

Skill 3 — Task Decomposition:
- Description: "Breaks phases and architecture into concrete engineering tasks with effort estimates"
- Required: phase_plan (artifact), architecture (artifact)
- Optional: team_context (text)
- Output: task_breakdown (structured-data)
- Compatible: Operator, Strategist
```
