# AOS.engineer — Master Design System

> **Usage:** Paste this entire file at the top of every Google Stitch (or v0/Lovable) prompt. Then append the page-specific prompt below it.

---

## Stitch Base Prompt

```
You are designing pages for AOS.engineer — a developer platform for multi-agent AI orchestration. The site showcases AI agent personas, orchestration profiles, execution workflows, skills, and domain packs.

=== APPLICATION IDENTITY ===

Name: AOS.engineer
Tagline: "Agentic Orchestration System"
Purpose: A config-driven framework that assembles specialized AI agents into deliberation and execution teams. Developers use it to orchestrate multi-agent workflows for strategic decisions and production planning.
Audience: Senior software engineers, AI/ML engineers, platform engineers, technical leaders.

=== DESIGN PHILOSOPHY ===

Inspired by developer.apple.com meets modern developer tools (Linear, Vercel).

- Marketing/hero sections: Apple's spatial breathing — large type, generous whitespace, dramatic but restrained. Every element is deliberate, nothing competes.
- Catalog sections (agents, profiles, skills): Dense, scannable, information-rich. Hero cards for featured items, compact list rows for the rest.
- Documentation sections: Clean reading experience with clear hierarchy, code blocks, and step-by-step structure.
- Overall: Ultra-professional, monochrome base where content provides the color. No decoration for decoration's sake.

=== COLOR SYSTEM ===

Theme: Light mode, monochrome base with signal color used sparingly.

| Role | Hex | Usage |
|------|-----|-------|
| Background | #f5f5f7 | Page background, section fills |
| Surface | #ffffff | Cards, panels, elevated content |
| Border | #e8e8ed | Card borders, dividers, subtle separators |
| Text Primary | #1d1d1f | Headings, primary content |
| Text Secondary | #424245 | Body text, descriptions |
| Text Muted | #86868b | Labels, metadata, helper text |
| Signal Blue | #0071e3 | Primary buttons, links, interactive elements. Used SPARINGLY. |
| Signal Blue Hover | #0077ed | Hover state for signal blue |

Category colors (used only in badges, dots, and accent bars — never as backgrounds):
| Role | Hex | Usage |
|------|-----|-------|
| Orchestrator | #f59e0b | Amber — Arbiter, CTO Orchestrator badges |
| Perspective | #0071e3 | Blue — Catalyst, Sentinel, Architect, etc. badges |
| Operational | #34c759 | Green — Operator, Steward, Auditor badges |
| Execution | #10b981 | Emerald — Execution profile type badges |
| Deliberation | #3b82f6 | Blue — Deliberation profile type badges |
| Danger/Error | #ef4444 | Red — Error states, destructive actions |
| Warning | #f59e0b | Amber — Warning states |

Badge styles:
- Category badges: pill shape, 8px font, 600 weight, colored background at 10% opacity with full-color text. Example: `background: rgba(0,113,227,0.1); color: #0071e3; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;`

=== TYPOGRAPHY ===

Primary font: Inter (Google Fonts)
Code font: JetBrains Mono (Google Fonts)

| Level | Font | Size | Weight | Tracking | Color |
|-------|------|------|--------|----------|-------|
| Display / H1 | Inter | 48px (desktop), 32px (mobile) | 800 | -0.5px | #1d1d1f |
| H2 Section | Inter | 28px (desktop), 22px (mobile) | 700 | -0.3px | #1d1d1f |
| H3 Card Title | Inter | 17px | 600 | normal | #1d1d1f |
| Body | Inter | 15px | 400 | normal | #424245 |
| Body Small | Inter | 13px | 400 | normal | #86868b |
| Label | Inter | 12px | 500 | 0.5px uppercase | #86868b |
| Badge | Inter | 12px | 600 | normal | varies by category |
| Code Inline | JetBrains Mono | 13px | 400 | normal | #1d1d1f on #f5f5f7 |
| Code Block | JetBrains Mono | 13px | 400 | normal | #1d1d1f on #f5f5f7, border: 1px solid #e8e8ed, border-radius: 8px, padding: 16px |

Line heights: Display 1.1, H2 1.2, H3 1.3, Body 1.6, Code 1.5.

=== LAYOUT SYSTEM ===

Max content width: 1200px, centered with auto margins.
Page padding: 64px top, 40px sides (desktop), 24px sides (mobile).

Grid: CSS Grid or Flexbox. No fixed column system — adapt per section:
- Hero sections: single column, centered, max-width 800px for text
- Catalog grids: 2-3 columns on desktop, 1 column on mobile
- List rows: full width within content area
- Documentation: single column, max-width 720px

Spacing scale:
- Section gap: 80px (desktop), 48px (mobile)
- Card gap: 16px
- Inner card padding: 20px-24px
- Component gap: 12px
- Inline gap: 8px

Border radius:
- Cards/panels: 12px
- Buttons: 8px
- Badges: 12px (pill)
- Code blocks: 8px
- Small elements: 6px

Shadows: Minimal. Use borders (#e8e8ed) for elevation, not shadows. Exception: hover states may use `box-shadow: 0 4px 20px rgba(0,0,0,0.06)`.

=== NAVIGATION ===

Desktop (sticky top):
- Height: 52px
- Background: #ffffff with border-bottom: 1px solid #e8e8ed
- Left: "AOS" in Inter 800 black + ".engineer" in #0071e3
- Right: Agents | Profiles | Skills | Domains | Docs | GitHub (external)
- Nav links: 14px, Inter 500, #86868b, hover: #1d1d1f
- Active link: #1d1d1f with font-weight 600

Mobile (hamburger):
- Same sticky top, hamburger icon right
- Slide-down menu with full-width links, 48px touch targets

=== CARD PATTERNS ===

Hero Card (featured items):
- Background: #ffffff
- Border: 1px solid #e8e8ed
- Border-radius: 12px
- Padding: 20px-24px
- Left accent bar: 4px wide, category color, border-radius 2px
- Layout: accent bar left, content right (flex row)
- Content: H3 title, body description (2-3 lines), badge row
- Hover: border-color #d1d1d6, subtle shadow

List Row (compact items):
- Background: #ffffff
- Border: 1px solid #e8e8ed
- Border-radius: 8px
- Padding: 12px 16px
- Layout: flex row, space-between
- Left: 6px colored dot + name (Inter 600, 14px, #1d1d1f)
- Right: metadata (Inter 400, 12px, #86868b) separated by bullets
- Hover: background #fafafa, border-color #d1d1d6

=== BUTTONS ===

Primary: background #0071e3, color white, padding 10px 20px, border-radius 8px, font-size 14px, font-weight 600. Hover: #0077ed.
Secondary: background transparent, border 1px solid #e8e8ed, color #1d1d1f, same padding/radius/size. Hover: background #f5f5f7.
Text link: color #0071e3, no underline, hover: underline.

=== CODE BLOCKS ===

Background: #f5f5f7
Border: 1px solid #e8e8ed
Border-radius: 8px
Padding: 16px
Font: JetBrains Mono, 13px, #1d1d1f
Line numbers: #86868b, right-aligned, separate column
Copy button: top-right, ghost style

=== RESPONSIVE BREAKPOINTS ===

Desktop: 1200px+ (max-width container)
Tablet: 768px-1199px (2 columns → 1 in some grids)
Mobile: 375px-767px (single column, reduced padding, stacked layout)

Minimum touch target: 44px
Safe area padding on mobile: 16px horizontal

=== IMAGERY & ICONS ===

No photos. No illustrations. The design is purely typographic and structural.
Icons: Minimal. Use text symbols, unicode, or simple SVG where needed.
Category identification: Color dots (6px circles) and accent bars (4px wide strips) — not icons.

=== FOOTER ===

Simple, centered:
- Border-top: 1px solid #e8e8ed
- Padding: 32px
- "AOS Harness — Agentic Orchestration System"
- "Open source. Config-driven. Multi-platform."
- Font: Inter 13px, #86868b
```

---

## How to Use

1. Copy the entire code block above
2. Paste it at the top of your Stitch prompt
3. Add the page-specific prompt below it
4. Generate

The design system ensures visual consistency across all pages.
