# Platform Engineering Domain Pack

The Platform Engineering domain pack injects internal developer platform, infrastructure, and SRE context into the Strategic Council deliberation. Apply it when the brief concerns developer tooling, infrastructure investment, platform team strategy, or any decision affecting developer experience and operational excellence.

## What it adds

**Shared lexicon** — all agents share consistent definitions for DORA metrics (deployment frequency, lead time for changes, MTTR, change failure rate), developer satisfaction, platform adoption rate, and infrastructure cost per developer. Frameworks cover platform-as-a-product, golden paths, self-service infrastructure, GitOps, and SRE practices. Stages map the lifecycle from proof-of-concept through sunset.

**Agent overlays** — seven agents receive additional lens instructions and evidence standards that sharpen their analysis for platform engineering context:

| Agent | Overlay focus |
|---|---|
| `catalyst` | Developer velocity impact; time-to-first-deployment |
| `sentinel` | Platform reliability; SLA protection; change failure rate |
| `architect` | Platform architecture; blast radius analysis; multi-tenancy |
| `provocateur` | Platform adoption failure modes; golden path escape analysis |
| `operator` | Toil reduction; incident response; on-call burden |
| `advocate` | Developer experience; cognitive load; documentation quality |
| `pathfinder` | Platform-as-product vision; self-service infrastructure bets |

**Additional input section** — briefs submitted with this domain should include a `## Platform Context` section covering current DORA metrics, platform adoption rate, supported teams and services, infrastructure cost per developer, and recent incident history.

**Additional output section** — the memo's platform impact section projects the effect of each recommendation on DORA metrics, platform adoption, developer experience, and infrastructure cost efficiency.

**Guardrails** — three hard rules enforced during deliberation:
1. Blast radius must be assessed for every infrastructure change
2. Developer experience impact must be evaluated for every platform decision
3. SLA implications must be documented for every platform change

## Usage

```bash
aos run --profile strategic-council --domain platform-engineering --brief path/to/brief.md
```
