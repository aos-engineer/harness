# CTO Execution Profile

The CTO Execution profile orchestrates the full product development lifecycle. Instead of producing a deliberation memo, it generates a complete **execution package** -- architecture decisions, phased plans, task breakdowns, and risk assessments -- ready for engineering handoff.

## Workflow

The profile runs an 8-step targeted workflow:

| Step | Agent(s) | Output |
|------|----------|--------|
| 1. Requirements Analysis | Advocate + Strategist | User stories, acceptance criteria, prioritized requirements |
| 2. Architecture & Design | Architect | Architecture decision records, system design, Mermaid diagrams |
| 3. Architecture Review | Architect vs Operator | Feasibility check -- ideal design confronts build reality |
| 4. Phase Planning | Strategist + Operator | Sequenced phases with dependency mapping |
| 5. Task Breakdown | Operator | Concrete engineering tasks with effort estimates |
| 6. Security & Risk Review | Sentinel | Security, reliability, and maintainability risk assessment |
| 7. Stress Test | Provocateur | Gaps, timeline challenges, overlooked failure modes |
| 8. Final Assembly | CTO Orchestrator | Synthesized execution package |

## Review Gates

You will be asked to approve at **3 review gates** before the workflow continues:

1. **After Requirements** (Step 1) -- Confirm the requirements capture your intent before architecture begins.
2. **After Architecture** (Step 3) -- Approve the system design before planning starts.
3. **After Planning** (Step 5) -- Sign off on the phase plan and task breakdown before risk review.

If you reject at any gate, the relevant agents revise their output based on your feedback.

## Brief Format

Your brief must include four sections:

- **Feature / Vision** -- What you are building. Describe the feature, product change, or initiative.
- **Context** -- Current system state, relevant codebase areas, existing infrastructure.
- **Constraints** -- Timeline, team capacity, tech debt, dependencies, budget.
- **Success Criteria** -- How you know it is done. What does good look like.

You can also attach context files (PRDs, existing specs, codebase docs) by referencing them in the brief header.

## Output

The profile produces an `execution-package` output containing:

- Executive summary
- Requirements analysis
- Architecture decision record (with Mermaid diagrams)
- Phase plan
- Task breakdown (structured task list)
- Risk assessment
- Stress test findings
- Implementation checklist

Output is saved to `output/executions/<date>-<brief-slug>-<session-id>/`.

## Usage

```bash
aos run cto-execution --brief path/to/brief.md
```

Example with the included sample brief:

```bash
aos run cto-execution --brief core/briefs/sample-cto-execution/brief.md
```

Use `--dry-run` to validate configuration without making API calls:

```bash
aos run cto-execution --brief path/to/brief.md --dry-run
```
