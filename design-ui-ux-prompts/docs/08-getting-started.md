# Getting Started

Stitch UI prompt for the Getting Started documentation page at /docs/getting-started.

## Stitch Prompt

```
[INCLUDE BASE DESIGN SYSTEM FROM 00-design-system.md]

=== PAGE: Getting Started ===
First documentation page new users see. Guides them from zero to running their first deliberation and execution profile in under 5 minutes. Clean, scannable, step-by-step with real CLI commands and realistic output descriptions.

=== DESKTOP LAYOUT (1200px) ===
- Max content width: 1200px centered
- Left sidebar: 220px wide, sticky (top: 80px), contains section navigation links
- Main content: single column, max-width 720px, left-aligned next to sidebar with 48px gap
- Breadcrumb at top of main content area: "Docs > Getting Started" in Body Small style (#86868b), ">" as separator
- Page header below breadcrumb: 24px top margin
- Sections flow vertically with 48px gap between them
- Code blocks are full-width within the 720px column
- Footer at bottom, full width

Sidebar navigation:
- Title: "On this page" in Label style (12px, 500 weight, uppercase, #86868b)
- Links: 14px Inter 400, #86868b, line-height 2.0
- Active link: #1d1d1f, font-weight 600, with a 2px left border in Signal Blue (#0071e3)
- Links: Prerequisites, Install, Run Your First Deliberation, Run an Execution Profile, Write a Brief, Next Steps
- Sidebar scrolls independently if content overflows

=== MOBILE LAYOUT (375px) ===
- Sidebar collapses into a horizontal scrollable pill bar at top of content (below breadcrumb)
- Pills: 13px Inter 500, #86868b, padding 6px 12px, border-radius 12px, border 1px solid #e8e8ed
- Active pill: background #1d1d1f, color white
- Main content: full width, 16px horizontal padding
- Code blocks: full width with horizontal scroll if needed
- Section gap reduces to 32px

=== KEY COMPONENTS ===

Breadcrumb:
- Body Small (13px, #86868b)
- Format: "Docs > Getting Started"
- "Docs" is a text link (#0071e3), "Getting Started" is plain text

Page header:
- H1: "Getting Started" — 48px desktop / 32px mobile, Inter 800, #1d1d1f
- Subtitle: "Set up AOS Harness in 5 minutes" — Body (15px, #424245), 8px below title

Section headers:
- H2 style: 28px desktop / 22px mobile, Inter 700, #1d1d1f
- 48px top margin, 16px bottom margin
- Thin border-top: 1px solid #e8e8ed, 48px above the heading (acts as section divider)

Code blocks:
- Background: #f5f5f7, border: 1px solid #e8e8ed, border-radius: 8px, padding: 16px
- Font: JetBrains Mono 13px, color #1d1d1f
- Copy button: top-right corner, ghost style, "Copy" label in 12px #86868b
- Language label: top-left inside block, 11px #86868b uppercase (e.g., "BASH", "YAML", "MARKDOWN")
- Line numbers: #86868b, right-aligned in a separate left column

Checklist:
- Each item: flex row, 8px gap
- Green checkmark: 16px circle with white check icon, background #34c759
- Text: Body (15px, #424245)
- Items stacked vertically with 12px gap

Callout box:
- Background: #f5f5f7, border-left: 4px solid #0071e3, border-radius: 0 8px 8px 0, padding: 16px 20px
- Label: "TIP" or "NOTE" in Label style (12px, 600 weight, #0071e3, uppercase)
- Body text: 15px, #424245, 4px below label

=== CONTENT ===

--- Breadcrumb ---
Docs > Getting Started

--- Page Header ---
# Getting Started
Set up AOS Harness in 5 minutes

--- Section: Prerequisites ---
## Prerequisites

Checklist items (green checkmark + text):
- [check] Bun v1.0+ installed (bun.sh)
- [check] An API key for at least one LLM provider (OpenAI, Anthropic, or Google)
- [check] A terminal (macOS, Linux, or WSL on Windows)

--- Section: Install ---
## Install

Clone the repository and install dependencies:

```bash
git clone https://github.com/aos-engineer/aos-harness.git
cd aos-harness
bun install
```

Set your API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export OPENAI_API_KEY="sk-..."
```

Callout box (TIP):
AOS supports multiple providers. Set any combination of ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY. The framework selects the appropriate provider based on each agent's model configuration.

--- Section: Run Your First Deliberation ---
## Run Your First Deliberation

Run the built-in Strategic Council with a sample brief:

```bash
aos run strategic-council --brief briefs/sample-brief.md
```

Body text:
This assembles 11 specialist agents — Catalyst, Sentinel, Architect, Provocateur, Navigator, Advocate, Pathfinder, Strategist, Operator, Steward, and Auditor — under a neutral Arbiter. The agents debate your brief from opposing perspectives. Tension pairs (Catalyst vs. Sentinel, Architect vs. Pathfinder) create productive conflict.

Body text:
The Arbiter synthesizes the discussion into a structured memo with:

Bulleted list:
- Ranked recommendations
- Agent stances and dissent
- Trade-offs and risks
- Concrete next actions

Body text:
Output is saved to:

```
output/memos/2026-03-25-sample-brief-abc123/memo.md
```

--- Section: Run an Execution Profile ---
## Run an Execution Profile

Execution profiles go beyond deliberation — they produce implementation-ready artifacts:

```bash
aos run cto-execution --brief briefs/feature-brief.md
```

Body text:
The CTO Execution profile uses a structured 8-step workflow:

Numbered list:
1. Requirements Analysis — Advocate and Strategist extract requirements from your brief
2. Architecture Design — Architect produces an architecture decision record
3. Review Gate — You approve or send back with feedback
4. Task Breakdown — Operator breaks the plan into concrete engineering tasks
5. Risk Assessment — Sentinel reviews for security, reliability, and maintainability
6. Stress Test — Provocateur challenges the timeline, finds gaps
7. Final Assembly — CTO Orchestrator synthesizes everything
8. Output — Complete execution package saved to disk

Body text:
Output is saved to:

```
output/executions/2026-03-25-feature-brief-abc123/
  executive-summary.md
  architecture-decision-record.md
  task-breakdown.md
  risk-assessment.md
  implementation-checklist.md
```

--- Section: Write a Brief ---
## Write a Brief

A brief is the input document that frames the problem for the agents. The required sections depend on the profile type.

Body text:
**Deliberation brief** (for strategic-council):

```markdown
## Situation
We are a B2B SaaS platform with 2,400 customers and $8M ARR.
Our largest competitor just raised $50M and announced a free tier.

## Stakes
If we respond poorly, we risk losing 15-20% of our SMB segment.
If we respond well, we can capture switchers from their disrupted user base.

## Constraints
- $200K budget for competitive response
- 3-person product team, no new hires until Q3
- Cannot break existing API contracts

## Key Question
Should we launch a free tier to match, or double down on our
premium positioning and invest in switching-cost features?
```

Body text:
**Execution brief** (for cto-execution):

```markdown
## Feature / Vision
Build a real-time collaborative editing system for our
document workspace product.

## Context
Current architecture is a monolithic Rails app with PostgreSQL.
Documents are stored as Markdown blobs. No WebSocket infrastructure exists.
Team has experience with Redis but not with CRDTs or OT.

## Constraints
- Ship MVP in 8 weeks with 2 backend + 1 frontend engineers
- Must support up to 50 concurrent editors per document
- Cannot migrate existing document storage format

## Success Criteria
- Users can see each other's cursors and edits in real time
- No data loss on concurrent edits
- Latency under 200ms for edit propagation
- Graceful degradation when a user loses connection
```

--- Section: Next Steps ---
## Next Steps

Three link cards (horizontal on desktop, stacked on mobile). Each card:
- Background: #ffffff, border: 1px solid #e8e8ed, border-radius: 12px, padding: 20px
- Title: H3 style (17px, Inter 600, #1d1d1f)
- Description: Body Small (13px, #86868b)
- Arrow: right-pointing arrow in #0071e3

Cards:
1. "Creating Agents" — Learn how to define custom agent personas with cognition, heuristics, and tensions. Link: /docs/creating-agents
2. "Creating Profiles" — Assemble agents into deliberation councils or execution teams. Link: /docs/creating-profiles
3. "Creating Domains" — Add industry-specific knowledge overlays to sharpen agent analysis. Link: /docs/creating-domains
```
