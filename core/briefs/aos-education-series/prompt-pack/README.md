# AOS Education Prompt Pack

## What This Pack Is For

This prompt pack is designed for two related workflows:

1. **AOS-first planning**
   Use AOS Harness to analyze the educational brief, validate the strategy, stress-test the series structure, and improve the editorial plan.

2. **NotebookLM-assisted content production**
   Use NotebookLM as a source-grounded research and drafting companion after the brief, plan, and supporting AOS documentation have been loaded into a notebook.

The pack is written so the same materials can be used in both systems without rework.

## Recommended Usage Order

### AOS workflow

1. Use the run-ready deliberation brief [00-strategic-council-run-brief.md](./00-strategic-council-run-brief.md)
2. Use [02-aos-brief-validation.md](./02-aos-brief-validation.md) to check gaps and ambiguity
3. Use [03-season-architecture-prompt.md](./03-season-architecture-prompt.md) to refine the season structure
4. Use [06-post-card-template.md](./06-post-card-template.md) or [07-season-1-post-cards.md](./07-season-1-post-cards.md) to generate individual post plans
5. Use [04-post-drafting-master-prompt.md](./04-post-drafting-master-prompt.md) to draft each post
6. Use [05-channel-adaptation-prompts.md](./05-channel-adaptation-prompts.md) to create LinkedIn and newsletter variants

Suggested command:

```bash
aos run strategic-council --brief core/briefs/aos-education-series/prompt-pack/00-strategic-council-run-brief.md --dry-run
```

Do not pass [01-aos-series-strategy-analysis.md](./01-aos-series-strategy-analysis.md) as `--brief`. It is an instruction prompt, not a council brief.

Also do not pass `--workflow-dir ./core/workflows/strategic-council/`. That path does not exist in this repo, and `strategic-council` does not use a workflow directory here.

### NotebookLM workflow

1. Follow [08-notebooklm-source-map.md](./08-notebooklm-source-map.md)
2. Add the brief, editorial plan, and listed repo sources into a dedicated notebook
3. Use [09-notebooklm-query-pack.md](./09-notebooklm-query-pack.md) to query the notebook for grounded synthesis
4. Use [10-notebooklm-artifact-prompts.md](./10-notebooklm-artifact-prompts.md) to generate reports, study materials, or draft support outputs

## Core Source Files

- [../brief.md](../brief.md)
- [../editorial-plan.md](../editorial-plan.md)
- [README.md](README.md)
- [docs/getting-started/README.md](docs/getting-started/README.md)
- [docs/domain-enforcement/README.md](docs/domain-enforcement/README.md)
- [docs/hierarchical-delegation/README.md](docs/hierarchical-delegation/README.md)
- [docs/session-resumption/README.md](docs/session-resumption/README.md)
- [docs/persistent-expertise/README.md](docs/persistent-expertise/README.md)
- [docs/dev-execution/README.md](docs/dev-execution/README.md)
- [core/profiles/strategic-council/README.md](core/profiles/strategic-council/README.md)
- [core/profiles/cto-execution/README.md](core/profiles/cto-execution/README.md)

## Output Principle

Every generated output should be:

- grounded in the real AOS Harness architecture
- educational before promotional
- motivating without hype
- cumulative from post to post
- practical enough that readers can do something small after reading
