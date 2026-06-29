# Artifact Generation Workflow Design

**Date:** 2026-04-18
**Author:** Segun Kolade
**Status:** Draft
**Spec ID:** AOS-SPEC-007

---

## 1. Overview

This spec introduces **artifact generation** as a third orchestration pattern in AOS, alongside deliberation and execution. Artifact generation profiles produce rendered HTML outputs — design variation galleries, platform-specific content previews, and interactive explainers — that users view in a browser.

The pattern spans three layers:

| Layer | Name | Output | Serve Required | Channels Required |
|-------|------|--------|----------------|-------------------|
| 1 | Static Artifacts | Self-contained HTML/CSS files | No | No |
| 2 | Interactive Artifacts | HTML with embedded JS (feedback capture, export-to-JSON) | Yes | No |
| 3 | Channel Artifacts | HTML with WebSocket bidirectional messaging | Yes | Yes |

Layer 1 and 2 are implemented in v1. Layer 3 is designed, reserved, and documented for future implementation.

### 1.1 Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope framing | Hybrid: Layer 1 skills are cross-cutting, Layer 2/3 get their own orchestration pattern | Static artifact rendering is a capability any profile can use; interactive/channel workflows have a different lifecycle |
| Adapter portability | Claude-Code-gated for Layer 3, portable for Layer 1/2 | Ships fast; adapter capability flags allow future unlock without schema changes |
| MemPalace role | Content-historian agent (not schema-level artifact storage) | Clean composable agent, no schema coupling to in-flight MemPalace integration |
| Artifact delivery | Filesystem-first + optional `--serve` | Layer 1 stays scriptable/CI-friendly; `--serve` is opt-in for Layer 2/3 |
| Implementation order | design-variations -> content-calendar -> interactive-explainer | Each step adds one new capability on a proven pipeline |
| Agent composition | Multi-agent for content-calendar, single-renderer for design-variations/explainer | Content creation benefits from separate copywriter/visual roles; design/explainer don't |

---

## 2. Schema Extensions

### 2.1 `artifact.schema.json`

Extend the `format` enum:

```
Current: ["markdown", "code", "structured-data", "diagram"]
Add:     ["html-static", "html-interactive", "html-live"]
```

- **`html-static`** — Self-contained HTML/CSS file. Layer 1. No JS required. Opened directly in any browser.
- **`html-interactive`** — HTML with embedded JS for feedback capture and export-to-JSON. Layer 2. Requires `--serve` for hot-reload and feedback endpoint.
- **`html-live`** — HTML that connects to a WebSocket channel for bidirectional messaging. Layer 3. Reserved for future implementation.

New optional fields on the artifact object:

| Field | Type | Description |
|-------|------|-------------|
| `platform` | `enum: [linkedin, twitter, tiktok, instagram, generic]` | Tags which platform the artifact was rendered for. Content-calendar profiles only. |
| `variation_index` | `integer` | For multi-variation runs (e.g., design-variations). 1-indexed. |
| `channel_id` | `string` | WebSocket channel identifier. Only for `html-live` artifacts. Layer 3. |

### 2.2 `profile.schema.json`

Extend the `output.format` enum:

```
Current: ["memo", "report", "checklist", "execution-package", "freeform"]
Add:     ["artifact-gallery"]
```

- **`artifact-gallery`** — The profile's output is a collection of rendered HTML artifacts with an auto-generated `index.html` gallery page.

New top-level optional field on the profile object:

```json
"runtime_requirements": {
  "type": "object",
  "properties": {
    "serve": { "type": "boolean", "default": false },
    "channels": { "type": "boolean", "default": false },
    "mempalace": { "type": "boolean", "default": false }
  },
  "description": "Declares what the runtime needs beyond the base adapter. Validated pre-flight against adapter capabilities."
}
```

### 2.3 `agent.schema.json`

Extend the `capabilities.output_types` enum:

```
Current: ["text", "markdown", "code", "diagram", "structured-data"]
Add:     ["html"]
```

New capability flag:

```json
"can_serve_artifacts": {
  "type": "boolean",
  "default": false,
  "description": "Agent's output can be served via the preview server (Layer 2/3 agents)."
}
```

---

## 3. New Agents

### 3.1 Orchestrator

#### `content-director`

**Type:** Orchestrator (peer to `cto-orchestrator`, `arbiter`)

**Role:** Strategy owner for content-calendar profiles. Decides what to produce, which platforms, which angle, based on brief + content-historian's recall of prior posts.

**Cognition:**
- Objective function: maximize content impact while maintaining brand consistency
- Core bias: strategy-first — angle and audience before copy
- Risk tolerance: moderate
- Default stance: "what story are we telling and why now?"

**Delegation style:** targeted (knows who to call for what)

**Output:** Delegation plan -> copywriter(s) -> visual-designer -> platform-reviewer -> final artifact(s)

### 3.2 Perspective Agents

#### `content-historian`

**Role:** Queries MemPalace for prior artifacts of a given platform/topic. Summarizes patterns (frequency, themes, tone drift), flags gaps ("no product updates this quarter").

**Cognition:**
- Objective function: surface relevant history without cherry-picking
- Core bias: recency-weighted but flags long-term patterns
- Risk tolerance: low (accuracy over speculation)
- Default stance: "here's what we've done, here's the gap"

**Skills:** `mempalace-read-write` (read-only access)

**Reusability:** Any profile can include this agent, not just content-calendar. Execution profiles can use it for "what have we shipped in this area before?"

**Tool access:** Uses `aos_request_recall` (structured request to orchestrator, who mediates MemPalace access). Does NOT get direct MCP access.

#### `copywriter`

**Role:** Drafts text content — post copy, thread text, video script, caption. Platform-aware (hook style, length limits, hashtag conventions).

**Cognition:**
- Objective function: maximize engagement for the given platform while staying on-brand
- Core bias: voice consistency over novelty
- Risk tolerance: moderate
- Default stance: "does this sound like us?"

**Tensions:** Paired with `platform-reviewer` (written quality vs. rendered fit)

#### `visual-designer`

**Role:** Produces HTML/CSS. Consumes copywriter's text + a "reference match" asset (screenshot or URL of the target platform's UI) and renders a platform-accurate preview.

**Capabilities:**
- `output_types: [html]`
- `can_serve_artifacts: true`
- `can_produce_files: true`

**Used by:** Content-calendar profiles (as specialist alongside copywriter), interactive-explainer (as primary renderer when visual fidelity is critical).

#### `platform-reviewer`

**Role:** Final check against platform conventions — character counts, image aspect ratios, tone fit, compliance constraints (e.g., LinkedIn's professional bar, TikTok's trend cadence). Flags issues before the artifact is delivered.

**Cognition:**
- Objective function: ensure content meets platform-specific requirements
- Evidence standard: concrete platform rules, not generic "best practices"
- Red lines: violating platform TOS or guidelines
- Risk tolerance: very-low
- Default stance: "does this actually work on this platform?"

#### `artifact-renderer`

**Role:** Single-agent renderer for `design-variations` and `interactive-explainer` profiles. Takes a spec + reference material, emits a self-contained HTML artifact.

**Capabilities:**
- `output_types: [html]`
- `can_serve_artifacts: true`
- `can_produce_files: true`

**Distinction from visual-designer:** `visual-designer` collaborates inside multi-agent profiles (takes text from copywriter). `artifact-renderer` works solo for profiles where splitting copywriter/designer doesn't add value. Different cognitive profiles — renderer is autonomous and holistic, designer is a specialist who takes inputs.

---

## 4. New Profiles

### 4.1 `design-variations` (Layer 1)

**Purpose:** Generate N visual variations of a component/screen/artifact in a single HTML gallery.

```yaml
schema: aos/profile/v1
id: design-variations
name: Design Variations Generator
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    - agent: artifact-renderer
      required: true
      role_override: "Generate N distinct visual variations of the target component as self-contained HTML files"
    - agent: sentinel
      required: false
      role_override: "Review rendered variations for accessibility and contrast issues"
    - agent: provocateur
      required: false
      structural_advantage: speaks-last
      role_override: "What's missing from these variations? What design axis was unexplored?"

delegation:
  default: targeted
  opening_rounds: 0
  bias_limit: 3

constraints:
  time:
    min_minutes: 3
    max_minutes: 15
  budget: null
  rounds:
    min: 2
    max: 6

input:
  format: brief
  required_sections:
    - heading: "## Target Component"
      guidance: "What component, screen, or artifact to generate variations of. Include screenshots or URLs."
    - heading: "## Variation Axis"
      guidance: "What to vary: theme (light/dark), density (compact/spacious), tone (playful/professional), or custom."
    - heading: "## Count"
      guidance: "Number of variations to generate. Default: 10."
  context_files: true

output:
  format: artifact-gallery
  path_template: "output/artifacts/{{date}}-design-variations-{{session_id}}/"
  artifacts:
    - type: html_gallery

runtime_requirements:
  serve: false
  channels: false
  mempalace: false

workflow: design-variations-workflow
```

### 4.2 Content-Calendar Family (Layer 1)

Four sibling profiles sharing the same workflow shape. Each differs in: `platform-reviewer` role_override, default tension pairs, and reference-match assets.

**Profile IDs:** `linkedin-post`, `twitter-thread`, `tiktok-script`, `instagram-post`

Representative profile (`linkedin-post`):

```yaml
schema: aos/profile/v1
id: linkedin-post
name: LinkedIn Post Generator
version: 1.0.0

assembly:
  orchestrator: content-director
  perspectives:
    - agent: content-historian
      required: true
      role_override: "Recall prior LinkedIn posts. Summarize posting patterns, topic gaps, and engagement trends."
    - agent: copywriter
      required: true
      role_override: "Draft LinkedIn post copy. Professional tone, hook-first, 1300 char sweet spot."
    - agent: visual-designer
      required: true
      role_override: "Render post variants in LinkedIn feed UI chrome with accurate typography and layout."
    - agent: platform-reviewer
      required: true
      role_override: "Validate against LinkedIn conventions: character limits, hashtag count (3-5), professional tone, CTA placement."
    - agent: provocateur
      required: false
      structural_advantage: speaks-last
      role_override: "Is this just echo chamber content? Challenge the angle."

delegation:
  default: targeted
  opening_rounds: 0
  tension_pairs:
    - [copywriter, platform-reviewer]
  bias_limit: 3

constraints:
  time:
    min_minutes: 5
    max_minutes: 20
  budget: null
  rounds:
    min: 4
    max: 10

input:
  format: brief
  required_sections:
    - heading: "## Topic"
      guidance: "What is this post about? Provide context, key message, and target audience."
    - heading: "## Angle"
      guidance: "Optional: specific angle (behind-the-scenes, thought-leadership, product update, personal story). Leave blank for content-director to decide based on history."
    - heading: "## Tone"
      guidance: "Optional: override default brand tone (e.g., more casual, more technical)."
  context_files: true

output:
  format: artifact-gallery
  path_template: "output/artifacts/{{date}}-linkedin-post-{{session_id}}/"
  artifacts:
    - type: html_gallery
  frontmatter: [date, platform, topic, angle, participants]

runtime_requirements:
  serve: false
  channels: false
  mempalace: true

workflow: content-calendar-workflow
```

The three sibling profiles (`twitter-thread`, `tiktok-script`, `instagram-post`) follow the same structure with platform-specific overrides:

| Profile | Copywriter Override | Platform-Reviewer Override |
|---------|-------------------|--------------------------|
| `twitter-thread` | "Draft as a thread. Hook tweet under 280 chars. Thread length 3-10 tweets." | "Validate tweet lengths, thread coherence, quote-tweet hooks." |
| `tiktok-script` | "Draft as a spoken script. 30-60 seconds. Hook in first 3 seconds." | "Validate script timing, trend alignment, sound/visual cue markers." |
| `instagram-post` | "Draft caption. Front-load value. 2200 char max. CTA before the fold." | "Validate caption length, hashtag strategy (20-30), carousel slide count if applicable." |

### 4.3 `interactive-explainer` (Layer 2)

**Purpose:** Explain a concept as an interactive artifact with tabbed depth levels, embedded diagrams/animations, and feedback capture.

```yaml
schema: aos/profile/v1
id: interactive-explainer
name: Interactive Concept Explainer
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    - agent: artifact-renderer
      required: true
      role_override: "Build an interactive HTML artifact with Beginner/Developer/Advanced tabs, embedded diagrams, and feedback capture widget."
    - agent: architect
      required: true
      role_override: "Ensure Developer and Advanced tabs are technically accurate and properly sequenced."
    - agent: sentinel
      required: false
      role_override: "Review technical accuracy of all tabs. Flag misconceptions."
    - agent: advocate
      required: false
      role_override: "Ensure the Beginner tab is genuinely accessible. No jargon without explanation."

delegation:
  default: targeted
  opening_rounds: 0
  tension_pairs:
    - [architect, advocate]
  bias_limit: 3

constraints:
  time:
    min_minutes: 5
    max_minutes: 25
  budget: null
  rounds:
    min: 3
    max: 8

input:
  format: brief
  required_sections:
    - heading: "## Concept"
      guidance: "What concept to explain (e.g., Row Level Security, Connection Pooling, Event Sourcing)."
    - heading: "## Audience"
      guidance: "Who is the primary audience? This calibrates the depth of each tab."
    - heading: "## Interaction Type"
      guidance: "Optional: preferred interaction (diagram, simulator, quiz, step-through animation). Leave blank for artifact-renderer to decide."
  context_files: true

output:
  format: artifact-gallery
  path_template: "output/artifacts/{{date}}-explainer-{{brief_slug}}-{{session_id}}/"
  artifacts:
    - type: html_interactive

runtime_requirements:
  serve: true
  channels: false
  mempalace: false

workflow: interactive-explainer-workflow
```

### 4.4 Layer 3 Profiles (Reserved)

The following profile IDs are reserved for future implementation when adapter `supportsLiveChannels` capability is available:

- **`live-dashboard`** — Real-time data dashboard with MCP integrations (Stripe, PostHog, Airtable). Renders as `html-live` artifact with bidirectional WebSocket messaging.
- **`agentic-data-monitor`** — Dashboard with pinned comment → agent query → auto-re-render loop.

**Portability goal:** Layer 3 profiles are gated on `supportsLiveChannels` to ship fast with Claude Code. However, all schema, profile, workflow, and agent definitions are adapter-agnostic. When Pi, Codex, or Gemini adapters implement `openChannel` and `sendToArtifact`, Layer 3 profiles unlock without any changes to core definitions. The AOS runtime provides a reference WebSocket implementation in `runtime/src/channels/` that adapters can wrap rather than build from scratch.

---

## 5. Workflows

### 5.1 `design-variations.workflow.yaml`

```yaml
schema: aos/workflow/v1
id: design-variations-workflow
name: Design Variations Gallery
description: >
  Generate N visual variations of a component and render as an HTML gallery.

steps:
  - id: brief-expansion
    name: Brief Expansion
    action: targeted-delegation
    agents: [artifact-renderer]
    prompt: |
      Analyze the target component and variation axis from the brief.
      Produce a specification for each variation: what changes (color,
      layout, density, typography) and what stays constant. Output as
      structured JSON array.
    output: variation_specs
    review_gate: true

  - id: render-gallery
    name: Render Gallery
    action: targeted-delegation
    agents: [artifact-renderer]
    input: [variation_specs]
    prompt: |
      Render each variation spec as a self-contained HTML/CSS file.
      Each file must be viewable standalone. Also generate an index.html
      gallery page that embeds all variations side-by-side with labels.
    output: artifact_gallery

  - id: accessibility-review
    name: Accessibility Review
    action: targeted-delegation
    agents: [sentinel]
    input: [artifact_gallery]
    prompt: |
      Scan all rendered variations for:
      - Color contrast (WCAG AA minimum)
      - Font size accessibility
      - Keyboard navigability (if interactive elements exist)
      Flag issues per-variation with severity.
    output: a11y_report
    review_gate: false

gates:
  - after: brief-expansion
    type: user-approval
    prompt: "Do these variation specs cover the design space you want? Any axis to add or remove?"
    on_rejection: retry_with_feedback
```

### 5.2 `content-calendar.workflow.yaml`

Shared by all four content-calendar profiles (`linkedin-post`, `twitter-thread`, `tiktok-script`, `instagram-post`). Platform differences are handled via profile-level `role_override` on each agent. The workflow references agents by ID (e.g., `agents: [copywriter]`); the profile's assembly-level `role_override` for that agent is injected into the agent's system prompt at delegation time. This is standard AOS behavior — no workflow-level branching is needed for platform differences.

```yaml
schema: aos/workflow/v1
id: content-calendar-workflow
name: Content Calendar Pipeline
description: >
  Full content creation pipeline: recall prior posts, draft copy,
  render platform-accurate preview, review, and stage MemPalace writeback.

steps:
  - id: historian-recall
    name: Content History Recall
    action: targeted-delegation
    agents: [content-historian]
    prompt: |
      Query MemPalace for prior artifacts on this platform and topic.
      Summarize:
      - What we've posted recently (last 4 weeks)
      - Topic/angle patterns (what's overrepresented, what's missing)
      - Engagement notes from prior annotations (if any)
      - Recommended angle based on gaps
    output: prior_content_summary

  - id: strategy
    name: Content Strategy
    action: orchestrator-synthesis
    input: [prior_content_summary]
    prompt: |
      Based on the brief and content history, decide:
      - Angle for this post
      - Tone calibration
      - Number of variants to produce (1-3)
      - Key message and CTA
    output: content_strategy
    review_gate: true

  - id: copy-draft
    name: Copy Drafting
    action: targeted-delegation
    agents: [copywriter]
    input: [content_strategy]
    prompt: |
      Draft text content for each variant defined in the content strategy.
      Follow platform conventions from your role_override.
      Output each variant as a separate section with clear labels.
    output: copy_variants

  - id: platform-render
    name: Platform Rendering
    action: targeted-delegation
    agents: [visual-designer]
    input: [copy_variants, content_strategy]
    prompt: |
      Render each copy variant as platform-accurate HTML. Use the
      target platform's actual UI chrome (feed card, profile header,
      engagement buttons). Each variant is a separate HTML file.
      Generate an index.html gallery showing all variants.
    output: rendered_variants
    review_gate: true

  - id: platform-review
    name: Platform Convention Review
    action: targeted-delegation
    agents: [platform-reviewer]
    input: [rendered_variants, copy_variants]
    prompt: |
      Review all rendered variants against platform conventions
      from your role_override. Check:
      - Character/length limits
      - Visual layout accuracy
      - Tone and compliance fit
      - CTA effectiveness
      Flag issues per-variant with severity and suggested fix.
    output: platform_review_findings

  - id: stress-test
    name: Content Stress Test
    action: targeted-delegation
    agents: [provocateur]
    input: [content_strategy, copy_variants, platform_review_findings]
    structural_advantage: speaks-last
    prompt: |
      Challenge the content strategy and copy:
      - Is this genuinely valuable or just noise?
      - Are we saying something our audience hasn't heard?
      - Would you engage with this if you saw it in your feed?
    output: stress_test_findings
    review_gate: false

  - id: synthesize
    name: Final Assembly
    action: orchestrator-synthesis
    input: [rendered_variants, platform_review_findings, stress_test_findings]
    prompt: |
      Apply review findings. Produce the final artifact gallery.
      Stage a mempalace-writeback.json with entries for each
      produced artifact (platform, topic, angle, artifact_path,
      brief_summary, posted_at: null). The orchestrator will
      flush this to MemPalace at session end.
    output: artifact_gallery

gates:
  - after: strategy
    type: user-approval
    prompt: "Does this angle and variant plan match what you want to post?"
    on_rejection: retry_with_feedback

  - after: platform-render
    type: user-approval
    prompt: "Review the rendered previews. Do they look right before platform review?"
    on_rejection: retry_with_feedback
```

### 5.3 `interactive-explainer.workflow.yaml`

```yaml
schema: aos/workflow/v1
id: interactive-explainer-workflow
name: Interactive Concept Explainer
description: >
  Build an interactive artifact that explains a concept across
  multiple depth levels with embedded diagrams and feedback capture.

steps:
  - id: scope
    name: Scope Definition
    action: targeted-delegation
    agents: [architect, advocate]
    prompt: |
      Define what each tab covers for this concept:
      - Beginner: what mental model, what analogies
      - Developer: what technical details, what code examples
      - Advanced: what internals, what edge cases, what tradeoffs
      Advocate: ensure Beginner is genuinely accessible.
      Architect: ensure Developer/Advanced are technically rigorous.
    output: explainer_scope
    review_gate: true

  - id: content-draft
    name: Content Drafting
    action: targeted-delegation
    agents: [artifact-renderer]
    input: [explainer_scope]
    prompt: |
      Draft the textual content for each tab. Include:
      - Prose explanations
      - Code snippets (Developer/Advanced)
      - Diagram descriptions (what to visualize)
      - Interactive element specs (what the user can click/toggle)
    output: tab_content

  - id: render
    name: Interactive Rendering
    action: targeted-delegation
    agents: [artifact-renderer]
    input: [tab_content, explainer_scope]
    prompt: |
      Render the explainer as a single html-interactive artifact:
      - Tab navigation (Beginner / Developer / Advanced)
      - Embedded diagrams or animations per the content draft
      - Feedback capture widget: click to annotate, export-to-JSON button
      - The artifact must be self-contained (no external dependencies)
      Write a feedback-schema.json describing the JSON export shape.
    output: interactive_artifact
    review_gate: true

  - id: accuracy-review
    name: Technical Accuracy Review
    action: targeted-delegation
    agents: [sentinel]
    input: [interactive_artifact, explainer_scope]
    prompt: |
      Review the Developer and Advanced tabs for:
      - Technical accuracy
      - Misleading simplifications
      - Missing caveats or edge cases
      Flag issues with severity and suggested corrections.
    output: accuracy_findings
    review_gate: false

  - id: revise-from-feedback
    name: Feedback-Driven Revision
    action: targeted-delegation
    agents: [artifact-renderer]
    input: [interactive_artifact, accuracy_findings]
    condition: "accuracy_findings.has_issues || session.is_continue"
    prompt: |
      Apply accuracy findings. If this is a --continue invocation
      with user feedback JSON in the brief, apply those revisions too.
      Re-render the artifact with revision counter incremented.
    output: revised_artifact
    review_gate: false

gates:
  - after: scope
    type: user-approval
    prompt: "Do these depth targets match your audience?"
    on_rejection: retry_with_feedback

  - after: render
    type: user-approval
    prompt: "Open the artifact in your browser and confirm it looks right."
    on_rejection: retry_with_feedback
```

---

## 6. Artifact Delivery Pipeline

### 6.1 Output Directory Structure

All artifact-generation profiles write to `output/artifacts/`:

```
output/artifacts/
  2026-04-18-design-variations-a1b2c3/
    index.html                    # auto-generated gallery
    variation-01.html
    variation-02.html
    ...
    manifest.json

  2026-04-18-linkedin-post-d4e5f6/
    index.html                    # gallery showing variants in LinkedIn UI chrome
    variant-01.html
    variant-02.html
    manifest.json
    mempalace-writeback.json      # staged memory payload

  2026-04-18-explainer-rls-g7h8i9/
    index.html                    # the interactive artifact IS the index
    feedback-schema.json          # describes the export-to-JSON shape
    manifest.json
```

### 6.2 `manifest.json`

Machine-readable bridge between filesystem output and MemPalace / `--continue` re-invocations:

```json
{
  "schema": "aos/manifest/v1",
  "session_id": "a1b2c3",
  "profile": "design-variations",
  "created_at": "2026-04-18T14:30:00Z",
  "brief_hash": "sha256:...",
  "agents": ["artifact-renderer", "sentinel"],
  "artifacts": [
    {
      "id": "variation_01",
      "format": "html-static",
      "path": "variation-01.html",
      "variation_index": 1,
      "revision": 1
    }
  ],
  "mempalace_writeback": null
}
```

For content-calendar profiles, `mempalace_writeback` points to the staged writeback file path.

### 6.3 The `--serve` Flag

Invoked as `aos run <profile> --serve` or auto-appended for profiles with `runtime_requirements.serve: true`.

**Behavior:**

1. Runtime starts a Bun dev server on `localhost:<port>` (port auto-selected, logged to stdout).
2. Server watches the run's output directory for file changes.
3. On artifact creation/update, hot-reloads the browser tab.
4. For `html-interactive` artifacts, the server mounts a `/feedback` POST endpoint that accepts exported JSON and writes to `output/artifacts/<run>/feedback/<timestamp>.json`.
5. Server stays alive until user kills it (`ctrl-c`) or `--serve-timeout <seconds>` expires.

**Auto-serve behavior:** Profiles with `runtime_requirements.serve: true` auto-append `--serve` if the user omits it, with a log warning: `"Profile 'interactive-explainer' requires --serve. Starting preview server."`. Profiles with `serve: false` ignore the flag.

### 6.4 The `--continue` Re-Entry Path

For Layer 2 feedback loops:

```bash
aos run interactive-explainer \
  --continue 2026-04-18-explainer-rls-g7h8i9 \
  --brief feedback.json
```

**Runtime behavior:**

1. Loads `manifest.json` from the prior run's output directory.
2. Injects manifest + feedback payload as inputs to the `revise-from-feedback` workflow step.
3. The conditional step fires, re-rendering the artifact with revisions.
4. Updated artifact replaces the original in the same output directory. Revision counter incremented in manifest.

### 6.5 Layer 3 Channel Lifecycle (Reserved)

Documented for future implementation. Not built in v1.

- `--serve --channels` flag activates a WebSocket server alongside the HTTP server.
- Artifact HTML connects to `ws://localhost:<port>/channel/<channel_id>`.
- Pinned comments or UI interactions in the artifact send messages through the channel to the active agent session.
- Agent processes the message, optionally queries MCP servers, and sends a response payload back through the channel.
- Artifact listens for inbound messages and re-renders without manual page refresh.

---

## 7. MemPalace Integration

### 7.1 Memory Topology

Following existing MemPalace conventions (wing = project, room = agent):

```
Wing: <project-name>
  Room: content-historian
    Drawer: linkedin-history
    Drawer: twitter-history
    Drawer: tiktok-history
    Drawer: instagram-history
    Drawer: content-strategy       # cross-platform patterns, brand voice, campaigns
```

### 7.2 Drawer Entry Schema

Each drawer stores structured entries:

```yaml
- posted_at: 2026-04-15           # null until user confirms post went live
  platform: linkedin
  topic: "product launch update"
  angle: "behind-the-scenes engineering story"
  artifact_path: "output/artifacts/2026-04-15-linkedin-post-x1y2z3/"
  brief_summary: "3-paragraph post about migration tooling, technical audience"
  engagement_notes: null           # user adds via --annotate
```

### 7.3 Read Path (historian-recall step)

1. Content-director delegates to content-historian with platform + topic from the brief.
2. Content-historian uses `aos_request_recall` tool (structured request to orchestrator).
3. Orchestrator forwards the recall request to MemPalace, scoped to the relevant platform drawer.
4. Content-historian receives prior entries, summarizes patterns, and produces `prior_content_summary` artifact.

The historian does **not** get direct MCP access — it goes through the orchestrator gatekeeper, consistent with the existing memory integration design.

### 7.4 Write Path (synthesize step)

1. The `synthesize` workflow step produces a `mempalace-writeback.json` alongside rendered artifacts.
2. This payload contains new drawer entries for each artifact produced in the run.
3. At session end, the orchestrator reads the writeback file and persists to MemPalace via its `remember` tool.
4. If MemPalace is unavailable (MCP crash), the writeback file remains on disk as a recovery artifact. Next run detects and replays unflushed writebacks.

### 7.5 `--annotate` Post-Hoc Enrichment

After a post goes live, the user enriches memory:

```bash
aos annotate 2026-04-15-linkedin-post-x1y2z3 \
  --notes "Got 2.4k impressions, strong engagement from DevOps audience"
```

This updates the entry in MemPalace's drawer without re-running the profile. The content-historian surfaces these annotations in future recall responses.

### 7.6 Wake Token Budget

Per existing MemPalace design constraints:

- `maxWakeTokens: 1200` — historian's recall response is capped to stay within context budget.
- `maxDrawerTokens: 500` — individual drawer entries are compact (the structured format above fits within this).
- If a platform drawer grows large (heavy poster), MemPalace's spatial decay handles eviction — recent entries stay, older ones compress or drop.

### 7.7 Profiles Without MemPalace

`design-variations` and `interactive-explainer` declare `runtime_requirements.mempalace: false`. They function identically whether MemPalace is configured or not. The runtime skips memory initialization for these profiles.

---

## 8. Adapter Capability Contract

### 8.1 Capability Flags

Extend the adapter interface with three new capability declarations:

```yaml
capabilities:
  # existing
  canExecuteCode: true
  canInvokeSkills: true
  canProduceFiles: true

  # new for artifact-generation
  canRenderArtifacts: true        # can write HTML files to output/
  canServeArtifacts: true         # can start/manage a local preview server
  supportsLiveChannels: false     # can open WebSocket channels (Layer 3)
```

### 8.2 Capability Matrix

| Adapter | canRenderArtifacts | canServeArtifacts | supportsLiveChannels |
|---------|-------------------|-------------------|---------------------|
| Claude Code | yes | yes | future (v1: no) |
| Pi | yes | yes (Bun available) | future |
| Codex | yes | no (sandboxed) | no |
| Gemini | yes | yes (Bun available) | future |

### 8.3 Runtime Pre-Flight Validation

Before starting a run, the engine validates profile requirements against adapter capabilities:

```
if profile.runtime_requirements.serve && !adapter.capabilities.canServeArtifacts:
  -> error: "Profile '{id}' requires --serve but adapter '{adapter}' does not support artifact serving"

if profile.runtime_requirements.channels && !adapter.capabilities.supportsLiveChannels:
  -> error: "Profile '{id}' requires live channels but adapter '{adapter}' does not support them"

if profile.runtime_requirements.mempalace && !mempalace.isConfigured():
  -> error: "Profile '{id}' requires MemPalace but no memory backend is configured"
```

Fails early with a clear message. Users see what's missing and what to install/configure.

### 8.4 Adapter Interface Additions

Two new methods on the adapter contract:

**`serveArtifacts(outputDir: string, options: ServeOptions): ServeHandle`**
- Starts a Bun dev server pointing at the output directory.
- Returns `{ port: number, url: string, stop(): void }`.
- `ServeOptions`: `{ hotReload: boolean, feedbackEndpoint: boolean, timeout?: number }`.

**`openChannel(name: string): ChannelHandle`** (Layer 3, reserved)
- Opens a named WebSocket channel.
- Returns `{ channelId: string, send(payload): void, onMessage(callback): void, close(): void }`.
- Not implemented in v1. Adapters return `NotImplementedError` until they opt in.

### 8.5 Portability Commitment

Layer 3 profiles are gated on `supportsLiveChannels` to ship fast with Claude Code. However, all schema, profile, workflow, and agent definitions are adapter-agnostic. When Pi, Codex, or Gemini adapters implement `openChannel` and `sendToArtifact`, Layer 3 profiles unlock without any changes to core definitions. The AOS runtime provides a reference WebSocket implementation in `runtime/src/channels/` that adapters can wrap rather than build from scratch.

---

## 9. Implementation Order

All three profile families are in this spec. Implementation is sequenced so each step adds one new capability on a proven pipeline:

| Phase | What | Exercises | Depends On |
|-------|------|-----------|------------|
| A | `design-variations` profile + workflow + artifact-renderer agent | Core pipeline: new profile type -> adapter renders HTML -> lands in `output/artifacts/` | Schema extensions (Section 2) |
| B | Content-calendar family (4 profiles) + content-director + copywriter + visual-designer + content-historian + platform-reviewer | Multi-agent delegation, MemPalace integration, platform-specific rendering | Phase A pipeline + MemPalace integration |
| C | `interactive-explainer` profile + workflow | `--serve` flag, feedback capture, `--continue` re-entry path | Phase A pipeline + `serveArtifacts` adapter method |
| D (future) | Layer 3 profiles (`live-dashboard`, `agentic-data-monitor`) | `--channels`, WebSocket lifecycle, bidirectional messaging | Phase C + `openChannel` adapter method |

---

## 10. Open Questions

1. **Gallery template:** The auto-generated `index.html` gallery uses a static template shipped with AOS (`runtime/src/templates/artifact-gallery.html`) with CSS variables that the renderer populates per-run (title, variant count, theme). This avoids wasting agent tokens on boilerplate HTML.

2. **Cross-platform runs:** Should a user be able to invoke `aos run content-calendar --platforms linkedin,twitter` to produce artifacts for multiple platforms in a single session? Recommendation: defer to v2. Individual `aos run linkedin-post` keeps the run focused and MemPalace writes clean.

3. **Engagement tracking depth:** The `--annotate` feature stages manual engagement notes. Should AOS integrate with platform APIs (LinkedIn API, Twitter API) to auto-pull engagement data? Recommendation: out of scope for this spec. Manual annotation is sufficient for v1.
