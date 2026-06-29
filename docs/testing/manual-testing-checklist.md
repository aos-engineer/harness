# AOS Harness — Manual Testing Checklist

**Date:** 2026-04-15
**Tester:** _______________
**Vendor CLI Under Test:** Claude Code / Codex / Gemini / Pi (circle one)
**Vendor CLI Version:** _______________
**Adapter Package Version:** _______________
**Auth Mode:** Subscription / Vendor login / API key env var (circle one)

---

## 1. Prerequisites (no API calls)

| # | Test | Command | Expected | Severity |
|---|------|---------|----------|----------|
| 1.1 | Vendor CLI installed | `which <vendor-cli> && <vendor-cli> --version` | Path and version printed | Critical |
| 1.2 | Bun installed | `bun --version` | Version printed (1.x+) | Critical |
| 1.3 | Vendor auth configured | Run the vendor CLI's own auth/status command | Vendor CLI reports ready or authenticated | Critical |
| 1.4 | Runtime deps installed | `cd runtime && bun install` | No errors | Critical |
| 1.5 | Adapter package deps installed | `cd adapters/<adapter> && bun install` | No errors | Critical |
| 1.6 | Runtime tests pass | `cd runtime && bun test` | 65+ tests pass, 0 fail | Critical |
| 1.7 | Config validation passes | `bun run tests/integration/validate-config.ts` | 22 passed, 0 failed | Critical |

- [ ] 1.1 Pass
- [ ] 1.2 Pass
- [ ] 1.3 Pass
- [ ] 1.4 Pass
- [ ] 1.5 Pass
- [ ] 1.6 Pass — Tests: ___/___
- [ ] 1.7 Pass — Checks: ___/___

---

## 2. CLI Commands (no API calls)

All commands run from project root: `cd /path/to/aos-harness`

| # | Test | Command | Expected | Severity |
|---|------|---------|----------|----------|
| 2.1 | Help | `bun run cli/src/index.ts --help` | Shows all 7 commands with descriptions | Important |
| 2.2 | List agents | `bun run cli/src/index.ts list` | Shows 12 agents in 3 categories + 4 profiles + 4 domains | Important |
| 2.3 | Validate | `bun run cli/src/index.ts validate` | All checks pass (may show expected failures for briefs vs non-strategic-council profiles) | Important |
| 2.4 | Create agent | `bun run cli/src/index.ts create agent test-check` | Files created at core/agents/custom/test-check/ | Important |
| 2.5 | Create profile | `bun run cli/src/index.ts create profile test-check` | Files created at core/profiles/test-check/ | Important |
| 2.6 | Create domain | `bun run cli/src/index.ts create domain test-check` | Files created at core/domains/test-check/ | Important |
| 2.7 | Init | `bun run cli/src/index.ts init` | `.aos/config.yaml`, `.aos/memory.yaml`, and `.aos/scan.json` created | Important |
| 2.8 | Scan-only init | `bun run cli/src/index.ts init --non-interactive` | `.aos/scan.json` updated, exits 0 | Important |
| 2.9 | Cleanup | `rm -r core/agents/custom/test-check core/profiles/test-check core/domains/test-check .aos/ 2>/dev/null` | Test artifacts removed | — |

- [ ] 2.1 Pass
- [ ] 2.2 Pass — Agents: ___ Profiles: ___ Domains: ___
- [ ] 2.3 Pass
- [ ] 2.4 Pass
- [ ] 2.5 Pass
- [ ] 2.6 Pass
- [ ] 2.7 Pass
- [ ] 2.8 Pass
- [ ] 2.9 Cleaned

---

## 3. Pi Runtime Adapter Load (skip if validating a non-Pi adapter)

This section remains Pi-specific because the Pi adapter exposes the richest local TUI workflow today. For Claude Code, Codex, and Gemini, validate the adapter through `aos init`, `aos run`, and the adapter's own readiness checks instead.

| # | Test | Command | Expected | Failure Indicator | Severity |
|---|------|---------|----------|-------------------|----------|
| 3.1 | Extension loads | `cd adapters/pi && pi -e src/index.ts` | Startup notification with profile/agent counts | Stack trace or "cannot find module" | Critical |
| 3.2 | Theme applied | Observe TUI | Theme applied (if configured) | No theme or broken rendering | Minor |
| 3.3 | Status line | Observe footer | Status shows agent/profile info | Missing status | Minor |
| 3.4 | /aos-run available | Type `/aos-run` | Profile selection prompt appears | "Unknown command" | Critical |

- [ ] 3.1 Pass
- [ ] 3.2 Pass
- [ ] 3.3 Pass
- [ ] 3.4 Pass

**If 3.1 fails:** Capture the full error output and report. Common issues: missing peer deps, import path resolution, TypeScript compilation errors.

---

## 4. Strategic Council Deliberation (Pi path example, estimated cost: $3-10)

Launch: `cd adapters/pi && pi -e src/index.ts` then `/aos-run`

| # | Test | What to observe | Expected | Severity |
|---|------|----------------|----------|----------|
| 4.1 | Profile selection | `/aos-run` | List of 4 profiles shown | Critical |
| 4.2 | Select strategic-council | Pick "strategic-council" | Proceeds to brief selection | Critical |
| 4.3 | Brief selection | Brief list shown | "sample-product-decision" appears | Critical |
| 4.4 | Brief validation | Select the sample brief | Validation passes, session starts | Critical |
| 4.5 | Session notification | After brief selected | "Session started" notification with session ID, agent list | Important |
| 4.6 | Arbiter frames question | First agent turn | Arbiter reads brief and calls `delegate("all", ...)` | Critical |
| 4.7 | Agent subprocesses | After delegate call | Multiple Pi subprocesses spawn | Critical |
| 4.8 | Streaming responses | During agent responses | Live streaming widget shows each agent's response progressively | Important |
| 4.9 | Differentiated responses | Read agent responses | Each agent has a distinct perspective matching their bias (Catalyst = revenue-focused, Sentinel = trust-focused, etc.) | Important |
| 4.10 | Provocateur speaks last | In broadcast rounds | Provocateur response appears after all others | Important |
| 4.11 | Constraint gauges | After each round | TIME, BUDGET, ROUNDS gauges display with progress bars | Important |
| 4.12 | Constraint state in tool result | After delegate returns | Shows elapsed time, budget spent, round count | Important |
| 4.13 | Targeted follow-ups | Rounds 2+ | Arbiter addresses specific agents or tension pairs | Important |
| 4.14 | End deliberation | When constraints met | Arbiter calls `end()` | Critical |
| 4.15 | Final statements | After end() | All agents give closing statements | Important |
| 4.16 | Memo produced | After final statements | Memo file written with correct content | Critical |
| 4.17 | Memo frontmatter | Read memo file | YAML frontmatter with date, duration, budget_used, participants | Important |
| 4.18 | Memo sections | Read memo file | Ranked recommendations, agent stances table, dissent, next actions | Important |
| 4.19 | Transcript written | Check .aos/sessions/ | JSONL file with session_start, delegation, response, session_end events | Important |
| 4.20 | Editor opens | After memo written | Configured editor opens the memo file | Minor |
| 4.21 | Input unblocked | After memo | User can type commands again | Important |

- [ ] 4.1 Pass
- [ ] 4.2 Pass
- [ ] 4.3 Pass
- [ ] 4.4 Pass
- [ ] 4.5 Pass
- [ ] 4.6 Pass
- [ ] 4.7 Pass
- [ ] 4.8 Pass
- [ ] 4.9 Pass — Note differentiation quality: ___________
- [ ] 4.10 Pass
- [ ] 4.11 Pass
- [ ] 4.12 Pass
- [ ] 4.13 Pass
- [ ] 4.14 Pass
- [ ] 4.15 Pass
- [ ] 4.16 Pass — Memo path: ___________
- [ ] 4.17 Pass
- [ ] 4.18 Pass
- [ ] 4.19 Pass — Transcript path: ___________
- [ ] 4.20 Pass
- [ ] 4.21 Pass

---

## 5. Additional Profiles (Pi path example, estimated cost: $3-8 each)

For each profile, create an appropriate brief first.

### 5.1 Security Review

Create brief at `core/briefs/test-security/brief.md`:
```markdown
# Brief: API Security Assessment

## System Description
A REST API serving 50K daily active users with JWT authentication,
PostgreSQL database, and Redis caching layer. Deployed on AWS ECS.

## Known Threats
Recent penetration test flagged 3 medium-severity XSS vulnerabilities
in the admin dashboard. No critical findings.

## Compliance Requirements
SOC 2 Type II certification needed by Q3. GDPR compliance for EU users.

## Key Question
What are our highest-priority security improvements before the SOC 2 audit?
```

| # | Test | Expected | Severity |
|---|------|----------|----------|
| 5.1.1 | Profile loads | security-review selected, 6 agents (architect, sentinel, provocateur, steward + optional) | Important |
| 5.1.2 | Output format | Report format (not memo) with vulnerability_assessment, risk_matrix | Important |
| 5.1.3 | Agent focus | Agents discuss security concerns, not business strategy | Important |

- [ ] 5.1.1 Pass
- [ ] 5.1.2 Pass
- [ ] 5.1.3 Pass

### 5.2 Delivery Ops

Create brief at `core/briefs/test-delivery/brief.md`:
```markdown
# Brief: Q2 Feature Delivery Plan

## Deliverable
Launch self-service onboarding flow with SSO integration and usage-based billing.

## Current State
Backend API 80% complete. Frontend designs approved. SSO library selected (Auth0).
Billing integration not started. 3 engineers available.

## Resources
3 engineers (2 backend, 1 frontend), $15K monthly infrastructure budget,
12 weeks until Q2 end.

## Key Question
What is the optimal delivery sequence to ship all three components by Q2 end?
```

- [ ] 5.2.1 Profile loads with correct agents
- [ ] 5.2.2 Output includes delivery_plan, sequence_and_dependencies
- [ ] 5.2.3 Agents discuss execution feasibility

### 5.3 Architecture Review

Create brief at `core/briefs/test-architecture/brief.md`:
```markdown
# Brief: Monolith to Microservices Migration

## Architecture
Monolithic Django application (120K lines) serving 200K users.
PostgreSQL, Celery task queue, Redis cache. Single deployment unit.

## Scale Requirements
3x user growth expected in 12 months. Current deployment takes 45 minutes.
Peak load causes 2-3 second response times.

## Constraints
Team of 8 engineers. Cannot afford more than 2 weeks of reduced velocity
during migration. Must maintain backward compatibility.

## Key Question
Should we decompose into microservices now, or optimize the monolith first?
```

- [ ] 5.3.1 Profile loads with correct agents
- [ ] 5.3.2 Output includes architecture_assessment, scalability_analysis
- [ ] 5.3.3 Architect and Pathfinder provide contrasting views

---

## 6. Domain Application (estimated cost: $3-10)

| # | Test | Command | Expected | Severity |
|---|------|---------|----------|----------|
| 6.1 | SaaS domain | Run strategic-council with saas domain | Agents reference ARR, MRR, churn, NRR | Important |
| 6.2 | Healthcare domain | Run strategic-council with healthcare domain (with appropriate brief) | Agents reference patient safety, HIPAA, clinical evidence | Important |
| 6.3 | Fintech domain | Run with fintech domain | Agents reference PCI-DSS, AML, fraud rates | Important |

- [ ] 6.1 Pass — SaaS terms referenced: ___________
- [ ] 6.2 Pass — Healthcare terms referenced: ___________
- [ ] 6.3 Pass — Fintech terms referenced: ___________

---

## 7. User Controls (test during any deliberation)

| # | Test | Action | Expected | Severity |
|---|------|--------|----------|----------|
| 7.1 | Input blocked | Type random text during deliberation | "Session in progress" notification | Important |
| 7.2 | Halt | Type "halt" during deliberation | Session stops immediately, transcript saved | Critical |
| 7.3 | Wrap | Type "wrap" during deliberation | Arbiter steered to call end(), final statements collected | Important |

- [ ] 7.1 Pass
- [ ] 7.2 Pass
- [ ] 7.3 Pass

---

## 8. Error Handling

| # | Test | Setup | Expected | Severity |
|---|------|-------|----------|----------|
| 8.1 | No briefs | Temporarily rename core/briefs/ | "No briefs found" message | Important |
| 8.2 | Missing sections | Create brief with only `## Situation` | Error listing missing sections | Important |
| 8.3 | Invalid profile ref | N/A (test via validate command) | Clear error message | Minor |

- [ ] 8.1 Pass
- [ ] 8.2 Pass
- [ ] 8.3 Pass

---

## 9. Claude Code Adapter (no API calls)

| # | Test | Command | Expected | Severity |
|---|------|---------|----------|----------|
| 9.1 | Generate | `cd adapters/claude-code && bun run src/generate.ts --profile strategic-council --output /tmp/test-cc` | Files generated | Important |
| 9.2 | Agent files | `ls /tmp/test-cc/agents/` | 12 agent .md files with YAML frontmatter | Important |
| 9.3 | Command file | `cat /tmp/test-cc/commands/aos-strategic-council.md` | Arbiter instructions, agent roster, delegation syntax | Important |
| 9.4 | CLAUDE.md | `cat /tmp/test-cc/CLAUDE-aos.md` | Agent table, available commands | Important |
| 9.5 | With domain | `bun run src/generate.ts --profile strategic-council --domain saas --output /tmp/test-cc-saas` | Domain overlays applied to agent prompts | Minor |
| 9.6 | Cleanup | `rm -rf /tmp/test-cc /tmp/test-cc-saas` | Cleaned | — |

- [ ] 9.1 Pass
- [ ] 9.2 Pass — File count: ___
- [ ] 9.3 Pass
- [ ] 9.4 Pass
- [ ] 9.5 Pass
- [ ] 9.6 Cleaned

---

## 10. Post-Test Cleanup

```bash
# Remove session data
rm -rf .aos/

# Remove test briefs
rm -rf core/briefs/test-security core/briefs/test-delivery core/briefs/test-architecture

# Remove any scaffolded test artifacts
rm -rf core/agents/custom/test-check core/profiles/test-check core/domains/test-check
```

- [ ] Cleanup complete

---

## Results Summary

| Section | Pass | Fail | Skip | Notes |
|---------|------|------|------|-------|
| 1. Prerequisites | /7 | | | |
| 2. CLI Commands | /8 | | | |
| 3. Pi Extension Load | /4 | | | |
| 4. Strategic Council | /21 | | | |
| 5. Additional Profiles | /9 | | | |
| 6. Domain Application | /3 | | | |
| 7. User Controls | /3 | | | |
| 8. Error Handling | /3 | | | |
| 9. Claude Code Adapter | /6 | | | |
| **Total** | **/64** | | | |

**Estimated total API cost for full test run:** $15-40 (depending on constraint settings and number of profiles tested)

**Tester sign-off:** _______________  **Date:** _______________
