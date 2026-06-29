# AOS Brief Generator Prompt

> **Since 0.9.0:** the recommended way to author a brief is `aos create brief`
> (CLI Q&A) or the `/aos-create-brief` skill inside Claude Code, Codex, or
> Gemini — both validate against the schema and write the file for you.
> See [creating-briefs-cli.md](./creating-briefs-cli.md) for the new flow.
> The prompt below remains useful when you're working in a different host
> agent that doesn't have the AOS plugin installed.

Use this prompt in any AI conversation to turn a raw idea, event, or initiative into a structured brief for AOS deliberation or execution.

---

## The Prompt

> I'm going to describe something I need to think through — it could be a strategic decision, a product feature, an operational initiative, a technical architecture decision, or an event/initiative I'm planning. Your job is to turn my description into a well-structured AOS brief that I can feed into my AOS Harness for multi-agent deliberation or execution.
>
> **Output the brief in this exact format:**
>
> ```markdown
> # Brief: [Concise title]
>
> ## Situation
> A clear narrative of where things stand today. What exists, what's happening, what triggered this brief. Include relevant numbers, timelines, and actors. Write this so an agent with zero prior context can understand the landscape.
>
> ## Stakes
> What's at stake if we act vs. don't act. Structure as **upside if we act**, **downside if we act**, **upside if we don't act**, **downside if we don't act**. If there are multiple options, do this for each option. Be specific — name dollar amounts, user counts, timelines, competitive dynamics.
>
> ## Constraints
> Hard boundaries the deliberation must respect. Include: budget, timeline, team capacity, technical limitations, regulatory/compliance requirements, dependencies on other work, and any non-negotiables. Use bullet points.
>
> ## Options (if applicable)
> If I describe multiple paths, formalize each as a named option with a 1-2 sentence description and rough cost/timeline. If I only describe one path, omit this section — the agents will generate alternatives during deliberation.
>
> ## Key Question
> One clear question that the deliberation should answer. This is the decision the council will debate. Frame it as a genuine dilemma, not a leading question.
>
> ## Context Files (optional)
> If I reference any documents, repos, or data sources, list them here as `**Context files:** file1.md, file2.md` so the AOS orchestrator can inject them.
>
> ## Success Criteria (for execution briefs only)
> If this brief is meant for an execution profile (building something, not just deciding), add concrete success criteria as a bulleted checklist. Each item should be verifiable — something you can test or demo.
> ```
>
> **Rules:**
> 1. Never water down the stakes. If losing a customer is on the table, say it. If there's a $500K risk, name it. Agents deliberate better with real tension.
> 2. Constraints must be hard constraints, not preferences. If something is a "nice to have," leave it out — agents will surface tradeoffs themselves.
> 3. The Key Question must be a genuine dilemma. If the answer is obvious, the brief isn't ready for deliberation.
> 4. Keep the brief under 500 words for deliberation profiles, under 300 words for execution profiles. Agents work better with dense, high-signal input.
> 5. Don't prescribe the solution. The brief sets the stage — the agents provide the analysis.
> 6. If I give you vague input, ask clarifying questions before writing the brief. Specifically ask about: stakes (what's at risk?), constraints (what can't change?), and timeline (when does this need to be decided/delivered?).
>
> **Here's what I'm thinking about:**
> [Describe your situation here in whatever format is natural — bullet points, stream of consciousness, voice transcript, etc.]

---

## Profile Routing Guide

Once you have the brief, feed it to the appropriate AOS profile:

| Decision Type | Profile | Mode |
|---|---|---|
| Strategic / business decisions | `strategic-council` | Deliberation |
| Architecture / technical design | `architecture-review` | Deliberation |
| Security concerns | `security-review` | Deliberation |
| Build a feature or system | `cto-execution` | Execution |
| Incident or crisis response | `incident-response` | Deliberation + Action |
| Delivery / operational planning | `delivery-ops` | Execution |

## Brief Variants

**Deliberation briefs** emphasize Situation, Stakes, and Key Question. The agents debate options and produce a recommendation memo with ranked options, documented dissent, and next actions.

**Execution briefs** emphasize Context, Constraints, and Success Criteria. The Stakes section can be omitted if the "why" is self-evident. The agents break down the work, delegate tasks, review output, and deliver an execution package.

## Examples

See the sample briefs in the repo:
- [`core/briefs/sample-product-decision/brief.md`](https://github.com/aos-engineer/aos-harness/core/briefs/sample-product-decision/brief.md) — Deliberation brief example
- [`core/briefs/sample-cto-execution/brief.md`](https://github.com/aos-engineer/aos-harness/core/briefs/sample-cto-execution/brief.md) — Execution brief example
