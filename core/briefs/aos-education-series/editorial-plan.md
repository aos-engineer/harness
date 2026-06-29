# AOS Educational Series Editorial Plan

## Purpose

This plan turns the AOS educational brief into a concrete publishing sequence for LinkedIn plus a longer-form newsletter or blog. The structure is designed to make the series cumulative, practical, and easy to convert into prompts later.

## Recommended Positioning

**Series promise:** Learn AI orchestration by following a real system in the open.

**Core message:** AOS Harness is not "more AI for the sake of AI." It is a way to structure intelligence so different agent roles, constraints, workflows, and memory systems work together deliberately.

**What makes the series worth following:**

- It is grounded in a real repo and real architecture.
- It teaches concepts in sequence instead of dropping isolated tips.
- It gives readers small actions so they can build confidence as they go.
- It shows AI as a system design discipline, not only as prompting.

## Audience

1. Builders who already use AI tools but want more reliable and structured results.
2. Engineers who want to understand multi-agent architecture without starting from theory alone.
3. Technical leaders exploring how AI can support planning, review, and execution work.
4. Curious learners who want a guided, motivating path into agentic systems.

## Publishing Cadence

- Recommended cadence: 2 posts per week
- Format:
  - Post A: concept, architecture, or philosophy
  - Post B: practical use, walkthrough, or system connection
- Primary channel: LinkedIn
- Secondary channel: newsletter or blog archive

## Recurring Post Structure

Use this structure for nearly every post:

1. Hook
2. One concept explained clearly
3. Why it matters in AOS Harness
4. One concrete example from the repo or workflow
5. One takeaway
6. One tiny action for the reader
7. One teaser for the next post

## Tone Guide

- Clear, practical, confident
- Educational without sounding academic
- Motivating without sounding inflated
- Open about lessons, tradeoffs, and design choices
- More "here is how this works" than "look how impressive this is"

## Calls To Action

Rotate soft calls to action instead of repeating the same one.

- Follow the series for the next building block.
- Try the command and compare the output.
- Read the next post before you customize your own setup.
- Fork the idea, even if you do not use this exact repo.
- Think about where this pattern applies in your own workflow.

## Season 1 Outline

### Week 1

**Post 1A**
- Title: What AOS Harness Is and Why I Am Writing About It in Public
- Core lesson: AOS Harness is an Agentic Orchestration System for structured deliberation and execution, not just a wrapper around a model.
- Reader takeaway: AI becomes more useful when roles, constraints, and outputs are designed intentionally.
- Tiny action: Read the repo README and identify the two orchestration modes: deliberation and execution.
- Next teaser: Next I will explain why AOS uses multiple agents instead of one smart assistant.

**Post 1B**
- Title: Why One AI Agent Is Not Enough for Serious Work
- Core lesson: AOS creates cognitive diversity through specialist agents with distinct biases, risk tolerances, and reasoning styles.
- Reader takeaway: Better outcomes often come from structured disagreement, not a single polished answer.
- Tiny action: Review the agent roster and pick the three roles you would want in a decision meeting.
- Next teaser: Next I will break down how agents are assembled into profiles.

### Week 2

**Post 2A**
- Title: Meet the AOS Agents: Bias by Design
- Core lesson: Agents such as Catalyst, Sentinel, Architect, and Provocateur are designed to create productive tension.
- Reader takeaway: Multi-agent quality depends on meaningful role design, not simply multiplying model calls.
- Tiny action: Compare Catalyst and Sentinel and write one sentence on why both are needed.
- Next teaser: Next I will show how these agents become repeatable systems through profiles.

**Post 2B**
- Title: Profiles: The Real Unit of Reuse in AOS
- Core lesson: Profiles define who participates, how they interact, and what kind of output gets produced.
- Reader takeaway: Reusability in orchestration comes from repeatable assemblies, not ad hoc prompting.
- Tiny action: Compare `strategic-council` and `cto-execution` and list what changes between them.
- Next teaser: Next I will show how the same system shifts from debate into execution.

### Week 3

**Post 3A**
- Title: Deliberation vs Execution: Two Different Ways to Use AI Teams
- Core lesson: AOS supports both debate-oriented sessions and workflow-driven execution packages.
- Reader takeaway: The right orchestration pattern depends on whether you need judgment, production, or both.
- Tiny action: Read the output expectations for a memo versus an execution package.
- Next teaser: Next I will show why the brief matters more than most people think.

**Post 3B**
- Title: A Better Brief Produces Better AI Work
- Core lesson: AOS uses structured briefs so sessions begin with clear intent, context, constraints, and success criteria.
- Reader takeaway: The brief is not paperwork; it is the contract that shapes the run.
- Tiny action: Draft a four-section brief for a problem you care about.
- Next teaser: Next I will explain how domains make the same agents smarter in different industries.

### Week 4

**Post 4A**
- Title: Domains: How AOS Learns the Language of an Industry
- Core lesson: Domains are append-only overlays that inject industry-specific language, heuristics, and context into the same base system.
- Reader takeaway: Good orchestration separates general reasoning from domain-specific context.
- Tiny action: Review one existing domain pack and note what it changes.
- Next teaser: Next I will show that domains are not only knowledge overlays, they are also safety boundaries.

**Post 4B**
- Title: Domain Enforcement: Real Boundaries, Not Prompt Theater
- Core lesson: AOS enforces file and tool permissions at the adapter layer, not only in text instructions.
- Reader takeaway: Reliable AI systems need actual boundaries, not just polite reminders.
- Tiny action: Read the domain enforcement docs and sketch the minimum file access a worker should have in your own repo.
- Next teaser: Next I will move from boundaries to capabilities: skills and tools.

### Week 5

**Post 5A**
- Title: Skills: What Happens When Agents Need More Than Conversation
- Core lesson: Skills let agents invoke specialized capabilities such as review, decomposition, or memory tooling in a structured way.
- Reader takeaway: Orchestration gets stronger when capabilities are explicit and scoped.
- Tiny action: Inspect the existing skills and decide which one you would want first in your own workflow.
- Next teaser: Next I will explain how all of this stays portable across different AI runtimes.

**Post 5B**
- Title: Adapters: Why AOS Works Across Codex, Claude, Gemini, and Pi
- Core lesson: AOS separates orchestration logic from runtime-specific integration through a 4-layer adapter contract.
- Reader takeaway: Portability comes from clear boundaries between system design and platform execution.
- Tiny action: Identify which adapter matches the CLI you already use.
- Next teaser: Next I will connect adapters to workflows and show how the system turns intent into deliverables.

### Week 6

**Post 6A**
- Title: Workflows: Turning AI Collaboration into Repeatable Delivery
- Core lesson: Workflows define ordered steps, review gates, and artifact handoffs so complex work can be repeated consistently.
- Reader takeaway: The jump from "chatting with AI" to "shipping with AI" happens through workflow design.
- Tiny action: Read the `cto-execution` workflow summary and identify its review gates.
- Next teaser: Next I will open up the execution package and show what useful output actually looks like.

**Post 6B**
- Title: Inside the CTO Execution Package
- Core lesson: AOS can generate requirements, architecture, planning, risk review, and implementation checklists in one orchestrated run.
- Reader takeaway: Good AI output is structured, reviewable, and ready for handoff.
- Tiny action: Review the sample brief and imagine how you would reuse the output in your own team.
- Next teaser: Next I will move from planning to implementation with dev execution.

### Week 7

**Post 7A**
- Title: Dev Execution: From Brief to Working Code
- Core lesson: Dev Execution combines planning, worker coordination, review, and test verification in one session.
- Reader takeaway: Orchestrated AI can move from thinking to doing if each phase is explicit.
- Tiny action: Read the dev-execution docs and note the four approval gates.
- Next teaser: Next I will show how the engineering lead and worker model actually works under the hood.

**Post 7B**
- Title: Hierarchical Delegation: How One Agent Becomes a Team Lead
- Core lesson: AOS supports lead agents that spawn scoped child agents under depth and permission limits.
- Reader takeaway: Delegation is powerful when authority, scope, and communication paths are controlled.
- Tiny action: Sketch a three-role worker tree for a feature in your own codebase.
- Next teaser: Next I will show how to observe all this activity instead of treating AI work as a black box.

### Week 8

**Post 8A**
- Title: Observability for AI Work: Why Transcript Events Matter
- Core lesson: AOS emits structured transcript events so sessions can be reviewed, replayed, and understood.
- Reader takeaway: If AI work cannot be inspected, it cannot be trusted or improved systematically.
- Tiny action: List the three session events you would most want to see in a dashboard.
- Next teaser: Next I will show how replay and summarized events turn runs into learning assets.

**Post 8B**
- Title: Replay, Summaries, and Learning from Past Sessions
- Core lesson: AOS supports replay and event summarization so sessions can be revisited without rereading raw logs.
- Reader takeaway: AI systems improve faster when runs become inspectable learning records.
- Tiny action: Read the event summarization docs and note which events are most meaningful to humans.
- Next teaser: Next I will move from observability into memory.

### Week 9

**Post 9A**
- Title: Memory in AOS: Why Context Should Survive the Session
- Core lesson: AOS supports pluggable memory so useful insights can carry across runs instead of resetting every time.
- Reader takeaway: Persistent AI systems need selective memory, not endless transcript stuffing.
- Tiny action: Read `.aos/memory.yaml` guidance and identify what you would want remembered from your own sessions.
- Next teaser: Next I will explain why MemPalace is recommended and how it fits into the system.

**Post 9B**
- Title: MemPalace and Institutional Memory for Agentic Systems
- Core lesson: MemPalace provides high-fidelity semantic recall while the orchestrator gates what gets remembered and recalled.
- Reader takeaway: Memory quality depends on curation and retrieval design, not only storage.
- Tiny action: Map the MemPalace concepts of wing, room, hall, and drawer to your own work.
- Next teaser: Next I will show how long-running work resumes without losing the thread.

### Week 10

**Post 10A**
- Title: Session Resumption: Continuing Work Without Starting Over
- Core lesson: AOS checkpoints sessions and rehydrates agents with filtered transcript tails and expertise snapshots.
- Reader takeaway: Long AI workflows need pause-and-resume mechanics just like human work does.
- Tiny action: Think about one AI workflow in your life that breaks because it cannot resume cleanly.
- Next teaser: Next I will connect memory and resumption into a bigger idea: durable AI collaboration.

**Post 10B**
- Title: Durable AI Collaboration Is More Than a Better Prompt
- Core lesson: The combination of briefs, workflows, memory, replay, and resumption creates continuity.
- Reader takeaway: Real AI systems need operating structure, not isolated tricks.
- Tiny action: Write down which layer you are missing today: role design, constraints, memory, or observability.
- Next teaser: Next I will show how to start customizing AOS for your own use case.

### Week 11

**Post 11A**
- Title: Creating Your Own Agents
- Core lesson: AOS agents are defined through schema, persona, heuristics, evidence standards, tensions, and prompts.
- Reader takeaway: Strong agent design is a product of sharp role boundaries and useful disagreement.
- Tiny action: Draft one custom agent with a name, bias, risk tolerance, and red line.
- Next teaser: Next I will show how to turn agents into profiles and domains that fit your world.

**Post 11B**
- Title: Creating Your Own Profiles and Domains
- Core lesson: Profiles and domains let you turn one-off experiments into repeatable systems for your context.
- Reader takeaway: The real leverage comes when your orchestration becomes reusable.
- Tiny action: Choose one industry or team context and outline the first domain overlay you would need.
- Next teaser: Next I will close the season by looking at community, extensibility, and where this can go next.

### Week 12

**Post 12A**
- Title: Extensibility: Registry, Community, and the Shape of an AOS Ecosystem
- Core lesson: AOS is structured so agents, profiles, and domains can be shared and validated consistently.
- Reader takeaway: A system becomes an ecosystem when its building blocks are portable and inspectable.
- Tiny action: Review the registry docs and imagine the first community contribution you would make.
- Next teaser: Next I will wrap the season with the biggest lessons from building and teaching AOS in public.

**Post 12B**
- Title: What This Series Taught Me About Building with AI
- Core lesson: The deeper lesson of AOS is that AI gets more useful when you treat it as architecture, not magic.
- Reader takeaway: Readers should leave the season with a mental model for structured AI work.
- Tiny action: Pick one idea from the season and implement it in your own process this week.
- Next teaser: Season 2 can move into advanced build diaries, case studies, and domain-specific orchestration.

## Reusable Prompt Inputs

When you later turn this plan into prompt inputs, keep these fields for every post:

- audience
- channel
- post title
- core lesson
- problem it solves
- repo concept to reference
- practical example
- takeaway
- tiny action
- teaser for next post
- tone notes

## Recommendation

Start with Season 1 exactly as a guided on-ramp:

- Weeks 1 to 3: orient the audience
- Weeks 4 to 7: explain the machinery
- Weeks 8 to 10: explain reliability and continuity
- Weeks 11 to 12: show customization and long-term vision

That sequencing gives readers early clarity, mid-series excitement, and a credible reason to keep following the work.
