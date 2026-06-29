# Season 1 Post Cards

These cards are compact inputs you can feed into the master drafting prompt.

## 1A

- Title: What AOS Harness Is and Why I Am Writing About It in Public
- Audience: curious builders new to AI orchestration
- Core lesson: AOS Harness is an Agentic Orchestration System for structured deliberation and execution
- Repo concept: root README and the two orchestration modes
- Practical example: deliberation memo vs execution package
- Takeaway: AI gets more useful when the system around it is designed
- Tiny action: identify the two orchestration patterns in the README
- Next teaser: why one AI agent is not enough

## 1B

- Title: Why One AI Agent Is Not Enough for Serious Work
- Audience: people already using single-agent AI tools
- Core lesson: structured disagreement produces better outcomes than one polished answer
- Repo concept: agent roster and cognitive diversity
- Practical example: compare Catalyst, Sentinel, and Architect
- Takeaway: quality can come from designed tension
- Tiny action: pick the three roles you would want in a decision council
- Next teaser: meet the agents in more detail

## 2A

- Title: Meet the AOS Agents: Bias by Design
- Audience: engineers and technical readers
- Core lesson: agent differences are engineered intentionally through role, bias, heuristics, and evidence standards
- Repo concept: agent schema and agent roster
- Practical example: Catalyst vs Sentinel
- Takeaway: more agents only help when their thinking is meaningfully different
- Tiny action: draft one agent bias you would want in your own stack
- Next teaser: profiles

## 2B

- Title: Profiles: The Real Unit of Reuse in AOS
- Audience: builders thinking about repeatability
- Core lesson: profiles make orchestration reusable by defining assemblies, delegation, and output patterns
- Repo concept: strategic-council and cto-execution
- Practical example: compare profile purposes and outputs
- Takeaway: reuse comes from designed assemblies, not repeated prompting
- Tiny action: compare the two profiles
- Next teaser: deliberation vs execution

## 3A

- Title: Deliberation vs Execution: Two Different Ways to Use AI Teams
- Audience: technical leaders and builders
- Core lesson: different goals require different orchestration patterns
- Repo concept: memo output vs execution package output
- Practical example: strategic-council vs cto-execution
- Takeaway: choose the system shape that matches the problem
- Tiny action: decide whether your next problem is a deliberation problem or execution problem
- Next teaser: the role of the brief

## 3B

- Title: A Better Brief Produces Better AI Work
- Audience: anyone using AOS or structured AI workflows
- Core lesson: structure at the input stage determines output quality
- Repo concept: sample CTO execution brief and brief generator prompt
- Practical example: context, constraints, and success criteria
- Takeaway: the brief is a control surface
- Tiny action: draft a four-section brief
- Next teaser: domains

## 4A

- Title: Domains: How AOS Learns the Language of an Industry
- Audience: builders working in specific industries
- Core lesson: domain packs inject specialized context without rewriting the whole system
- Repo concept: domain overlays and lexicon
- Practical example: fintech or SaaS domain
- Takeaway: separate core reasoning from domain specificity
- Tiny action: inspect one domain pack
- Next teaser: domain enforcement

## 4B

- Title: Domain Enforcement: Real Boundaries, Not Prompt Theater
- Audience: engineers concerned with safety and control
- Core lesson: AOS applies actual file and tool constraints at the adapter layer
- Repo concept: domain enforcement docs
- Practical example: path rules and tool allowlists
- Takeaway: AI needs real boundaries to be trustworthy
- Tiny action: sketch a safe worker access policy
- Next teaser: skills

## 5A

- Title: Skills: What Happens When Agents Need More Than Conversation
- Audience: intermediate builders
- Core lesson: skills formalize specialized actions and capabilities
- Repo concept: core skills and skill-aware execution
- Practical example: task decomposition or memory skills
- Takeaway: capability design matters as much as prompt design
- Tiny action: choose one skill you would add first
- Next teaser: adapters

## 5B

- Title: Adapters: Why AOS Works Across Codex, Claude, Gemini, and Pi
- Audience: cross-platform AI tool users
- Core lesson: the adapter contract separates orchestration logic from runtime execution
- Repo concept: 4-layer adapter contract
- Practical example: same orchestration, different runtime
- Takeaway: portability comes from architecture
- Tiny action: identify your current runtime and the adapter you would need
- Next teaser: workflows

## 6A

- Title: Workflows: Turning AI Collaboration into Repeatable Delivery
- Audience: engineering and ops readers
- Core lesson: workflows create repeatable execution through explicit steps and artifacts
- Repo concept: workflow schema and cto-execution workflow
- Practical example: step outputs and review gates
- Takeaway: repeatability needs structure
- Tiny action: inspect one workflow step and its output
- Next teaser: the execution package

## 6B

- Title: Inside the CTO Execution Package
- Audience: technical leads
- Core lesson: useful AI output is reviewable and structured
- Repo concept: cto-execution profile output
- Practical example: requirements, ADR, phase plan, task breakdown
- Takeaway: AI output should be ready for handoff, not admiration
- Tiny action: review the sample execution brief
- Next teaser: dev execution

## 7A

- Title: Dev Execution: From Brief to Working Code
- Audience: hands-on engineers
- Core lesson: AOS can move from planning artifacts to implementation
- Repo concept: dev-execution docs
- Practical example: nine-step flow and approval gates
- Takeaway: execution requires explicit phases
- Tiny action: note the four approval gates in dev execution
- Next teaser: hierarchical delegation

## 7B

- Title: Hierarchical Delegation: How One Agent Becomes a Team Lead
- Audience: readers interested in multi-agent systems
- Core lesson: delegation works when depth, scope, and permissions are controlled
- Repo concept: hierarchical delegation docs
- Practical example: engineering lead spawning workers
- Takeaway: delegation is a systems problem, not just an intelligence problem
- Tiny action: sketch a three-role delegation tree
- Next teaser: observability

## 8A

- Title: Observability for AI Work: Why Transcript Events Matter
- Audience: technical leads and systems thinkers
- Core lesson: runs should be inspectable, not opaque
- Repo concept: transcripts and event summarization
- Practical example: session events and reviewability
- Takeaway: if you cannot inspect AI work, you cannot improve it well
- Tiny action: list the three most important events for your use case
- Next teaser: replay

## 8B

- Title: Replay, Summaries, and Learning from Past Sessions
- Audience: teams trying to build repeatable systems
- Core lesson: replay and summarization turn sessions into reusable learning assets
- Repo concept: replay and event summarization docs
- Practical example: summarized events instead of raw logs
- Takeaway: good systems remember operationally, not just narratively
- Tiny action: identify which event types matter most to humans
- Next teaser: memory

## 9A

- Title: Memory in AOS: Why Context Should Survive the Session
- Audience: readers thinking beyond single-run prompts
- Core lesson: memory makes AI collaboration cumulative
- Repo concept: memory provider and `.aos/memory.yaml`
- Practical example: wake context and orchestrator-gated recall
- Takeaway: persistent systems need selective memory
- Tiny action: define what your system should remember
- Next teaser: MemPalace

## 9B

- Title: MemPalace and Institutional Memory for Agentic Systems
- Audience: more advanced readers
- Core lesson: semantic recall is stronger when memory is curated and scoped
- Repo concept: persistent expertise docs
- Practical example: wing, room, hall, drawer
- Takeaway: memory quality depends on design, not storage alone
- Tiny action: map the memory model to your own work
- Next teaser: session resumption

## 10A

- Title: Session Resumption: Continuing Work Without Starting Over
- Audience: builders with long-running workflows
- Core lesson: resumption lets agent work continue across pauses with controlled context restoration
- Repo concept: session resumption docs
- Practical example: transcript tails and expertise snapshots
- Takeaway: continuity should be designed into AI work
- Tiny action: identify one workflow in your life that needs pause-resume support
- Next teaser: durable collaboration

## 10B

- Title: Durable AI Collaboration Is More Than a Better Prompt
- Audience: broad mixed audience
- Core lesson: the real leap comes from combining briefs, workflows, memory, replay, and resumption
- Repo concept: system-level AOS architecture
- Practical example: continuity across sessions and outputs
- Takeaway: AI value compounds when the system compounds
- Tiny action: identify the missing layer in your current process
- Next teaser: creating your own agents

## 11A

- Title: Creating Your Own Agents
- Audience: intermediate and advanced builders
- Core lesson: custom agents come from sharp roles and explicit reasoning frames
- Repo concept: creating agents docs and agent schema
- Practical example: objective function, evidence standard, red lines
- Takeaway: better agents come from better role design
- Tiny action: draft one custom agent
- Next teaser: profiles and domains

## 11B

- Title: Creating Your Own Profiles and Domains
- Audience: people ready to tailor AOS
- Core lesson: orchestration becomes reusable when profiles and domains match your context
- Repo concept: creating profiles and creating domains docs
- Practical example: one domain overlay and one custom profile
- Takeaway: adaptation is where orchestration becomes operational
- Tiny action: choose your first domain or profile customization
- Next teaser: registry and ecosystem

## 12A

- Title: Extensibility: Registry, Community, and the Shape of an AOS Ecosystem
- Audience: advanced builders and community-minded readers
- Core lesson: standard building blocks make sharing and collaboration possible
- Repo concept: registry docs
- Practical example: adding an agent, profile, or domain
- Takeaway: systems become ecosystems when components are portable
- Tiny action: imagine your first community contribution
- Next teaser: final season reflection

## 12B

- Title: What This Series Taught Me About Building with AI
- Audience: the full audience
- Core lesson: AI becomes more useful when treated as architecture, not magic
- Repo concept: cross-series synthesis
- Practical example: from single-agent curiosity to structured orchestration
- Takeaway: readers should leave with a durable mental model
- Tiny action: implement one idea from the series this week
- Next teaser: season 2 or deeper case studies
