# AOS Harness Core Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the complete core configuration layer — 12 agent personas (YAML + markdown prompts), the strategic-council orchestration profile, the saas domain pack, JSON Schema files for validation, and a sample brief with context file.

**Architecture:** Each agent is defined as `agent.yaml` (metadata) + `prompt.md` (system prompt with `{{VARIABLE}}` placeholders). Agents are organized by role: orchestrators/, perspectives/, operational/. The strategic-council profile assembles all 12 agents. The saas domain provides optional SaaS-specific overlays.

**Tech Stack:** YAML, Markdown, JSON Schema. No runtime code — this is pure configuration that the runtime (Plan 1, complete) consumes.

**Spec:** `docs/specs/2026-03-23-aos-harness-design.md` (Sections 3, 4, 5, 6.12, 6.13, 6.15)

---

## File Structure

```
aos-harness/
├── core/
│   ├── schema/
│   │   ├── agent.schema.json
│   │   ├── profile.schema.json
│   │   └── domain.schema.json
│   ├── agents/
│   │   ├── orchestrators/
│   │   │   └── arbiter/
│   │   │       ├── agent.yaml
│   │   │       └── prompt.md
│   │   ├── perspectives/
│   │   │   ├── catalyst/
│   │   │   ├── sentinel/
│   │   │   ├── architect/
│   │   │   ├── provocateur/
│   │   │   ├── navigator/
│   │   │   ├── advocate/
│   │   │   ├── pathfinder/
│   │   │   └── strategist/
│   │   └── operational/
│   │       ├── operator/
│   │       ├── steward/
│   │       └── auditor/
│   ├── profiles/
│   │   └── strategic-council/
│   │       ├── profile.yaml
│   │       └── README.md
│   ├── domains/
│   │   └── saas/
│   │       ├── domain.yaml
│   │       └── README.md
│   └── briefs/
│       └── sample-product-decision/
│           ├── brief.md
│           └── product-overview.md
```

---

### Task 1: JSON Schema Files

**Files:**
- Create: `core/schema/agent.schema.json`
- Create: `core/schema/profile.schema.json`
- Create: `core/schema/domain.schema.json`

- [ ] **Step 1: Create core/schema/ directory**

```bash
mkdir -p core/schema
```

- [ ] **Step 2: Create agent.schema.json**

Create `core/schema/agent.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "aos/agent/v1",
  "title": "AOS Agent Definition",
  "type": "object",
  "required": ["schema", "id", "name", "role", "cognition", "persona", "model"],
  "properties": {
    "schema": { "const": "aos/agent/v1" },
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "name": { "type": "string" },
    "role": { "type": "string" },
    "cognition": {
      "type": "object",
      "required": ["objective_function", "time_horizon", "core_bias", "risk_tolerance", "default_stance"],
      "properties": {
        "objective_function": { "type": "string" },
        "time_horizon": {
          "type": "object",
          "required": ["primary", "secondary", "peripheral"],
          "properties": {
            "primary": { "type": "string" },
            "secondary": { "type": "string" },
            "peripheral": { "type": "string" }
          }
        },
        "core_bias": { "type": "string" },
        "risk_tolerance": { "enum": ["very-low", "low", "moderate", "high", "very-high"] },
        "default_stance": { "type": "string" }
      }
    },
    "persona": {
      "type": "object",
      "required": ["temperament", "thinking_patterns", "heuristics", "evidence_standard", "red_lines"],
      "properties": {
        "temperament": { "type": "array", "items": { "type": "string" } },
        "thinking_patterns": { "type": "array", "items": { "type": "string" } },
        "heuristics": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "rule"],
            "properties": {
              "name": { "type": "string" },
              "rule": { "type": "string" }
            }
          }
        },
        "evidence_standard": {
          "type": "object",
          "required": ["convinced_by", "not_convinced_by"],
          "properties": {
            "convinced_by": { "type": "array", "items": { "type": "string" } },
            "not_convinced_by": { "type": "array", "items": { "type": "string" } }
          }
        },
        "red_lines": { "type": "array", "items": { "type": "string" } }
      }
    },
    "tensions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["agent", "dynamic"],
        "properties": {
          "agent": { "type": "string" },
          "dynamic": { "type": "string" }
        }
      }
    },
    "report": {
      "type": "object",
      "required": ["structure"],
      "properties": {
        "structure": { "type": "string" }
      }
    },
    "tools": {
      "oneOf": [
        { "type": "null" },
        { "type": "array", "items": { "type": "string" } }
      ]
    },
    "skills": { "type": "array", "items": { "type": "string" } },
    "expertise": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "mode", "use_when"],
        "properties": {
          "path": { "type": "string" },
          "mode": { "enum": ["read-only", "read-write"] },
          "use_when": { "type": "string" }
        }
      }
    },
    "model": {
      "type": "object",
      "required": ["tier", "thinking"],
      "properties": {
        "tier": { "enum": ["economy", "standard", "premium"] },
        "thinking": { "enum": ["off", "on", "extended"] }
      }
    }
  }
}
```

- [ ] **Step 3: Create profile.schema.json**

Create `core/schema/profile.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "aos/profile/v1",
  "title": "AOS Orchestration Profile",
  "type": "object",
  "required": ["schema", "id", "name", "assembly", "constraints", "input", "output"],
  "properties": {
    "schema": { "const": "aos/profile/v1" },
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "version": { "type": "string" },
    "assembly": {
      "type": "object",
      "required": ["orchestrator", "perspectives"],
      "properties": {
        "orchestrator": { "type": "string" },
        "perspectives": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["agent", "required"],
            "properties": {
              "agent": { "type": "string" },
              "required": { "type": "boolean" },
              "structural_advantage": { "enum": ["speaks-last"] }
            }
          }
        }
      }
    },
    "delegation": {
      "type": "object",
      "properties": {
        "default": { "enum": ["broadcast", "round-robin", "targeted"] },
        "opening_rounds": { "type": "integer", "minimum": 0 },
        "tension_pairs": {
          "type": "array",
          "items": { "type": "array", "items": { "type": "string" }, "minItems": 2, "maxItems": 2 }
        },
        "bias_limit": { "type": "integer", "minimum": 1 }
      }
    },
    "constraints": {
      "type": "object",
      "required": ["time", "rounds"],
      "properties": {
        "time": {
          "type": "object",
          "required": ["min_minutes", "max_minutes"],
          "properties": {
            "min_minutes": { "type": "number", "minimum": 0 },
            "max_minutes": { "type": "number", "minimum": 0 }
          }
        },
        "budget": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object",
              "required": ["min", "max", "currency"],
              "properties": {
                "min": { "type": "number", "minimum": 0 },
                "max": { "type": "number", "minimum": 0 },
                "currency": { "type": "string" }
              }
            }
          ]
        },
        "rounds": {
          "type": "object",
          "required": ["min", "max"],
          "properties": {
            "min": { "type": "integer", "minimum": 1 },
            "max": { "type": "integer", "minimum": 1 }
          }
        }
      }
    },
    "input": {
      "type": "object",
      "required": ["format", "required_sections"],
      "properties": {
        "format": { "enum": ["brief", "question", "document", "freeform"] },
        "required_sections": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["heading", "guidance"],
            "properties": {
              "heading": { "type": "string" },
              "guidance": { "type": "string" }
            }
          }
        },
        "context_files": { "type": "boolean" }
      }
    },
    "output": {
      "type": "object",
      "required": ["format", "path_template"],
      "properties": {
        "format": { "type": "string" },
        "path_template": { "type": "string" },
        "sections": { "type": "array", "items": { "type": "string" } },
        "artifacts": { "type": "array", "items": { "type": "object" } },
        "frontmatter": { "type": "array", "items": { "type": "string" } }
      }
    },
    "error_handling": {
      "type": "object",
      "properties": {
        "agent_timeout_seconds": { "type": "integer", "minimum": 1 },
        "retry_policy": {
          "type": "object",
          "properties": {
            "max_retries": { "type": "integer", "minimum": 0 },
            "backoff": { "enum": ["exponential", "linear"] }
          }
        },
        "on_agent_failure": { "enum": ["skip", "abort_round", "abort_session"] },
        "on_orchestrator_failure": { "const": "save_transcript_and_exit" },
        "partial_results": { "const": "include_with_status_flag" }
      }
    },
    "budget_estimation": {
      "type": "object",
      "properties": {
        "strategy": { "enum": ["rolling_average", "fixed_estimate"] },
        "fixed_estimate_tokens": { "type": "integer", "minimum": 0 },
        "safety_margin": { "type": "number", "minimum": 0, "maximum": 1 },
        "on_estimate_exceeded": { "enum": ["drop_optional", "warn_arbiter", "block_round"] }
      }
    },
    "expertise": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "path_template": { "type": "string" },
        "mode": { "enum": ["per-agent", "shared", "none"] }
      }
    },
    "controls": {
      "type": "object",
      "properties": {
        "halt": { "type": "boolean" },
        "wrap": { "type": "boolean" },
        "interject": { "type": "boolean" }
      }
    }
  }
}
```

- [ ] **Step 4: Create domain.schema.json**

Create `core/schema/domain.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "aos/domain/v1",
  "title": "AOS Domain Template",
  "type": "object",
  "required": ["schema", "id", "name", "description"],
  "properties": {
    "schema": { "const": "aos/domain/v1" },
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "lexicon": {
      "type": "object",
      "properties": {
        "metrics": { "type": "array", "items": { "type": "string" } },
        "frameworks": { "type": "array", "items": { "type": "string" } },
        "stages": { "type": "array", "items": { "type": "string" } }
      }
    },
    "overlays": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "thinking_patterns": { "type": "array", "items": { "type": "string" } },
          "heuristics": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "rule"],
              "properties": {
                "name": { "type": "string" },
                "rule": { "type": "string" }
              }
            }
          },
          "red_lines": { "type": "array", "items": { "type": "string" } },
          "temperament": { "type": "array", "items": { "type": "string" } },
          "evidence_standard": {
            "type": "object",
            "properties": {
              "convinced_by": { "type": "array", "items": { "type": "string" } },
              "not_convinced_by": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    },
    "additional_input_sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["heading", "guidance"],
        "properties": {
          "heading": { "type": "string" },
          "guidance": { "type": "string" },
          "required": { "type": "boolean" }
        }
      }
    },
    "additional_output_sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["section", "description"],
        "properties": {
          "section": { "type": "string" },
          "description": { "type": "string" }
        }
      }
    },
    "guardrails": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add core/schema/
git commit -m "feat(core): add JSON Schema files for agent, profile, and domain validation"
```

---

### Task 2: Arbiter Agent (Orchestrator)

**Files:**
- Create: `core/agents/orchestrators/arbiter/agent.yaml`
- Create: `core/agents/orchestrators/arbiter/prompt.md`

The Arbiter is the most important agent — it drives the entire deliberation. Its prompt must follow the skeleton defined in spec Section 6.15.

- [ ] **Step 1: Create directories**

```bash
mkdir -p core/agents/orchestrators/arbiter
```

- [ ] **Step 2: Create agent.yaml**

Create `core/agents/orchestrators/arbiter/agent.yaml` — the Arbiter: neutral decision synthesizer. Use `tier: premium`, `thinking: on`. No tensions (it is the tension resolver). Expertise: scratch pad for tracking convergence/divergence.

Key cognition values:
- objective_function: "Synthesize competing perspectives into actionable, ranked recommendations with documented dissent"
- core_bias: neutrality
- risk_tolerance: moderate
- default_stance: "I integrate — I do not advocate."

- [ ] **Step 3: Create prompt.md**

Create `core/agents/orchestrators/arbiter/prompt.md` — the full Arbiter system prompt following spec Section 6.15 skeleton:

1. Identity & Role — neutral synthesizer, no personal bias
2. Deliberation Protocol — broadcast opening, targeted follow-ups, tension pairs
3. Constraint Awareness — read constraint status block, act on it (can_end, approaching, hit_maximum, bias_blocked)
4. Delegation Syntax — delegate("all"), delegate(["a","b"]), end("message")
5. Synthesis Instructions — ranked recommendations, agent stance table, dissent, trade-offs, next actions, summary
6. Expertise — scratch pad usage instructions

Template variables: `{{session_id}}`, `{{participants}}`, `{{constraints}}`, `{{brief}}`, `{{output_path}}`, `{{deliberation_dir}}`, `{{expertise_block}}`

Write a thorough, high-quality prompt (~150-200 lines). This is the single most important prompt in the system.

- [ ] **Step 4: Commit**

```bash
git add core/agents/orchestrators/arbiter/
git commit -m "feat(core): add Arbiter agent — neutral decision synthesizer and orchestrator"
```

---

### Task 3: Core Perspective Agents (Catalyst, Sentinel, Architect, Provocateur)

**Files:**
- Create: `core/agents/perspectives/catalyst/agent.yaml` + `prompt.md`
- Create: `core/agents/perspectives/sentinel/agent.yaml` + `prompt.md`
- Create: `core/agents/perspectives/architect/agent.yaml` + `prompt.md`
- Create: `core/agents/perspectives/provocateur/agent.yaml` + `prompt.md`

Each agent needs a complete `agent.yaml` matching the `aos/agent/v1` schema and a `prompt.md` system prompt (~80-120 lines each).

- [ ] **Step 1: Create directories**

```bash
mkdir -p core/agents/perspectives/{catalyst,sentinel,architect,provocateur}
```

- [ ] **Step 2: Create Catalyst**

**Catalyst** — Acceleration and monetization.
- cognition: objective_function: "Maximize momentum and commercial velocity. Ship, sell, collect." | time_horizon: 30-90 days / this quarter / next quarter | core_bias: speed-and-monetization | risk_tolerance: moderate | default_stance: "I want a version customers will pay for in 90 days."
- tensions: sentinel ("ship now vs protect long-term"), pathfinder ("proven revenue vs speculative bets")
- model: tier: standard, thinking: off
- prompt.md: Temperament (impatient, monetization-focused), thinking patterns (revenue test, willingness-to-pay), heuristics (Ship-It, Payback Period, Distribution Before Product), evidence standard, red lines, report structure

- [ ] **Step 3: Create Sentinel**

**Sentinel** — Protection and durability.
- cognition: objective_function: "Maximize long-term value, trust, and retention while preventing irreversible damage" | time_horizon: 6-24 months / 2-5 years / this quarter (damage prevention) | core_bias: sustainability-and-trust | risk_tolerance: low | default_stance: "I want a version customers still trust in 12 months."
- tensions: catalyst ("short-term extraction vs long-term trust")
- model: tier: standard, thinking: off
- prompt.md: Patient, user-empathy, protective of trust. Thinks in compounding loops. Heuristics (Regret Audit, Trust Accounting, Churn Autopsy, Compound Test). Red lines: no dark patterns, no churn-inducing shortcuts.

- [ ] **Step 4: Create Architect**

**Architect** — Feasibility and systems thinking.
- cognition: objective_function: "Maximize technical leverage and system reliability while minimizing operational complexity" | time_horizon: 6-18 months / this sprint / 3-5 years | core_bias: system-durability | risk_tolerance: low | default_stance: "I want the version that survives contact with production reality."
- tensions: pathfinder ("feasible vs 10x")
- model: tier: standard, thinking: off
- prompt.md: Grounding force. Systems thinking. Heuristics (10x Load Test, Ops Burden Ratio, Reversibility Check). Red lines: no architecture decisions without scale analysis.

- [ ] **Step 5: Create Provocateur**

**Provocateur** — Assumption-breaking and stress-testing. Speaks last (code-enforced).
- cognition: objective_function: "Minimize the probability of catastrophic error and unexamined assumptions" | time_horizon: variable (matches the decision's horizon) / second-order 6-24 months | core_bias: truth-seeking | risk_tolerance: very-low | default_stance: "I want the room to prove it is not fooling itself."
- tensions: all agents (stress-tests every position)
- model: tier: standard, thinking: off
- prompt.md: Skeptical but constructive. Pre-mortem, inversion test, assumption inventory, base rate check, survivorship bias filter, second-order consequences. Instructs to read the full conversation log, identify assumptions, attack the weakest ones. Report structure: name assumptions first, then attack.

IMPORTANT: Each prompt.md must include these template variables for runtime context:
```
# {{agent_name}}

## Session: {{session_id}}
## Agent: {{agent_id}}
## Participants: {{participants}}
## Constraints: {{constraints}}

## Expertise
{{expertise_block}}

## Deliberation Directory: {{deliberation_dir}}
## Transcript: {{transcript_path}}

## Brief
{{brief}}
```

- [ ] **Step 6: Commit**

```bash
git add core/agents/perspectives/catalyst/ core/agents/perspectives/sentinel/ core/agents/perspectives/architect/ core/agents/perspectives/provocateur/
git commit -m "feat(core): add core perspective agents — Catalyst, Sentinel, Architect, Provocateur"
```

---

### Task 4: Extended Perspective Agents (Navigator, Advocate, Pathfinder, Strategist)

**Files:**
- Create: `core/agents/perspectives/navigator/agent.yaml` + `prompt.md`
- Create: `core/agents/perspectives/advocate/agent.yaml` + `prompt.md`
- Create: `core/agents/perspectives/pathfinder/agent.yaml` + `prompt.md`
- Create: `core/agents/perspectives/strategist/agent.yaml` + `prompt.md`

- [ ] **Step 1: Create directories**

```bash
mkdir -p core/agents/perspectives/{navigator,advocate,pathfinder,strategist}
```

- [ ] **Step 2: Create Navigator**

**Navigator** — Market positioning, competitive timing, distribution strategy.
- cognition: objective_function: "Maximize market awareness, positioning clarity, and distribution efficiency" | time_horizon: this quarter / 6-12 months / 2-3 years | core_bias: positioning-and-timing | risk_tolerance: moderate-high | default_stance: "I want the version the market can understand and buy quickly."
- tensions: advocate ("market timing vs user needs now")
- Heuristics: Category Design, Timing Window, Distribution Advantage, Competitive Response

- [ ] **Step 3: Create Advocate**

**Advocate** — User voice and behavior reality.
- cognition: objective_function: "Maximize product-market fit by ensuring decisions align with real user behavior, pain, and willingness to pay" | time_horizon: user's next session / 6 months / market adoption curves | core_bias: user-behavior-reality | risk_tolerance: moderate | default_stance: "I want the version real users actually adopt in their existing workflow."
- tensions: navigator ("user needs now vs market timing")
- Heuristics: Adoption Friction Test, Workflow Integration, Behavior-Stated Gap, Session Reality

- [ ] **Step 4: Create Pathfinder**

**Pathfinder** — Asymmetric opportunities and 10x thinking.
- cognition: objective_function: "Maximize the probability of a step-function outcome — a single move that changes trajectory by an order of magnitude" | time_horizon: 1-3 years / 6 months / 5+ years | core_bias: asymmetric-upside | risk_tolerance: very-high | default_stance: "I want the room to avoid cowardly incrementalism."
- tensions: architect ("feasible vs 10x"), catalyst ("proven revenue vs speculative bets")
- Heuristics: 10x Question, Asymmetric Bet Filter, Adjacent Possible, Disruption Lens

- [ ] **Step 5: Create Strategist**

**Strategist** — Problem selection and sequencing.
- cognition: objective_function: "Maximize strategic impact per unit of build effort by selecting the right problems in the right order" | time_horizon: this quarter / 6-12 months / 2-year vision | core_bias: impact-per-effort | risk_tolerance: moderate | default_stance: "I want the narrowest wedge with the strongest strategic pull."
- tensions: operator ("ideal sequence vs execution reality")
- Heuristics: Painkiller vs Vitamin, Smallest Biggest Move, Roadmap Coherence, Opportunity Cost Framing

- [ ] **Step 6: Commit**

```bash
git add core/agents/perspectives/navigator/ core/agents/perspectives/advocate/ core/agents/perspectives/pathfinder/ core/agents/perspectives/strategist/
git commit -m "feat(core): add extended perspective agents — Navigator, Advocate, Pathfinder, Strategist"
```

---

### Task 5: Operational Agents (Operator, Steward, Auditor)

**Files:**
- Create: `core/agents/operational/operator/agent.yaml` + `prompt.md`
- Create: `core/agents/operational/steward/agent.yaml` + `prompt.md`
- Create: `core/agents/operational/auditor/agent.yaml` + `prompt.md`

- [ ] **Step 1: Create directories**

```bash
mkdir -p core/agents/operational/{operator,steward,auditor}
```

- [ ] **Step 2: Create Operator**

**Operator** — Execution reality. Team capacity, dependencies, delivery risk.
- cognition: objective_function: "Maximize execution certainty by grounding every plan in operational reality" | time_horizon: this sprint / this quarter / next quarter | core_bias: execution-reality | risk_tolerance: low-moderate | default_stance: "I want the version we can actually deliver with the team we have."
- tensions: strategist ("ideal sequence vs execution reality")
- Heuristics: Capacity Reality Check, Dependency Mapping, Delivery Risk Radar, Scope-Team Fit

- [ ] **Step 3: Create Steward**

**Steward** — Ethics, compliance, governance.
- cognition: objective_function: "Prevent decisions that create legal, regulatory, or reputational exposure" | time_horizon: variable (matches regulatory timeline) / 1-3 years / ongoing | core_bias: compliance-and-ethics | risk_tolerance: very-low | default_stance: "I want the version that doesn't create exposure we haven't explicitly accepted."
- tensions: none explicit (checks all agents for compliance risk)
- Heuristics: Regulatory Surface Scan, Reputational Risk Test, Data Governance Check, Consent Audit

- [ ] **Step 4: Create Auditor**

**Auditor** — Retrospective analysis. Institutional memory.
- cognition: objective_function: "Maximize organizational learning by tracking what worked, what didn't, and why" | time_horizon: past decisions / current decision / future pattern recognition | core_bias: learning-from-history | risk_tolerance: moderate | default_stance: "I want the room to learn from what it has already decided."
- tensions: none explicit (provides historical context to all)
- Heuristics: Pattern Recognition, Decision Autopsy, Recurrence Detection, Assumption Archaeology

- [ ] **Step 5: Commit**

```bash
git add core/agents/operational/
git commit -m "feat(core): add operational agents — Operator, Steward, Auditor"
```

---

### Task 6: Strategic Council Profile

**Files:**
- Create: `core/profiles/strategic-council/profile.yaml`
- Create: `core/profiles/strategic-council/README.md`

- [ ] **Step 1: Create directory**

```bash
mkdir -p core/profiles/strategic-council
```

- [ ] **Step 2: Create profile.yaml**

Create `core/profiles/strategic-council/profile.yaml`:

```yaml
schema: aos/profile/v1
id: strategic-council
name: Strategic Council
description: "Multi-perspective strategic deliberation. Submit a brief describing a strategic problem. A neutral Arbiter orchestrates 11 specialist agents who debate, challenge, and stress-test from opposing perspectives. Output is a structured memo with ranked recommendations, documented dissent, and next actions."
version: 1.0.0

assembly:
  orchestrator: arbiter
  perspectives:
    # Core (essential tensions — always active)
    - agent: catalyst
      required: true
    - agent: sentinel
      required: true
    - agent: architect
      required: true
    - agent: provocateur
      required: true
      structural_advantage: speaks-last
    # Extended (domain depth — active by default, can be deactivated)
    - agent: navigator
      required: false
    - agent: advocate
      required: false
    - agent: pathfinder
      required: false
    - agent: strategist
      required: false
    # Operational (execution grounding)
    - agent: operator
      required: false
    - agent: steward
      required: false
    - agent: auditor
      required: false

delegation:
  default: broadcast
  opening_rounds: 1
  tension_pairs:
    - [catalyst, sentinel]
    - [architect, pathfinder]
    - [advocate, navigator]
    - [catalyst, pathfinder]
    - [strategist, operator]
  bias_limit: 5

constraints:
  time:
    min_minutes: 2
    max_minutes: 10
  budget:
    min: 1.00
    max: 10.00
    currency: USD
  rounds:
    min: 2
    max: 8

error_handling:
  agent_timeout_seconds: 120
  retry_policy:
    max_retries: 2
    backoff: exponential
  on_agent_failure: skip
  on_orchestrator_failure: save_transcript_and_exit
  partial_results: include_with_status_flag

budget_estimation:
  strategy: rolling_average
  fixed_estimate_tokens: 2000
  safety_margin: 0.15
  on_estimate_exceeded: drop_optional

input:
  format: brief
  required_sections:
    - heading: "## Situation"
      guidance: "What is happening right now? State the facts. No opinion, no spin."
    - heading: "## Stakes"
      guidance: "What's at risk? Upside if we get it right, downside if we get it wrong."
    - heading: "## Constraints"
      guidance: "Budget, timeline, team capacity, technical, regulatory boundaries."
    - heading: "## Key Question"
      guidance: "The single most important question you want the council to answer. Be specific."
  context_files: true

output:
  format: memo
  path_template: "output/memos/{{date}}-{{brief_slug}}-{{session_id}}/memo.md"
  sections:
    - ranked_recommendations
    - agent_stances
    - dissent_and_tensions
    - tradeoffs_and_risks
    - next_actions
    - deliberation_summary
  artifacts:
    - type: diagram
  frontmatter:
    - date
    - duration
    - budget_used
    - participants
    - brief_path
    - transcript_path

expertise:
  enabled: true
  path_template: "expertise/{{agent_id}}-notes.md"
  mode: per-agent

controls:
  halt: true
  wrap: true
  interject: false
```

- [ ] **Step 3: Create README.md**

Create `core/profiles/strategic-council/README.md` — brief description of the profile, what it does, how to use it, what agents are included, what input format is required.

- [ ] **Step 4: Commit**

```bash
git add core/profiles/strategic-council/
git commit -m "feat(core): add strategic-council profile — 12-agent deliberation assembly"
```

---

### Task 7: SaaS Domain Pack

**Files:**
- Create: `core/domains/saas/domain.yaml`
- Create: `core/domains/saas/README.md`

- [ ] **Step 1: Create directory**

```bash
mkdir -p core/domains/saas
```

- [ ] **Step 2: Create domain.yaml**

Create `core/domains/saas/domain.yaml` — SaaS business context domain. Include:
- lexicon: metrics (ARR, MRR, NRR, CAC, LTV, churn rate, expansion revenue, payback period), frameworks (PLG, sales-led, hybrid motion, land-and-expand), stages (pre-seed, seed, series-a, growth, scale)
- overlays for catalyst (SaaS revenue test, payback obsession), sentinel (NRR focus, switching costs), architect (multi-tenant scale, ops burden per customer), provocateur (SaaS base rate check, competitor counterfactual), navigator (SaaS category positioning, distribution channel efficiency), advocate (SaaS onboarding friction, activation metrics), strategist (SaaS wedge-to-platform sequencing)
- additional_input_sections: Metrics section (ARR, MRR, churn, NRR, CAC, LTV with trends)
- additional_output_sections: financial_impact (projected impact on ARR, churn, unit economics)
- guardrails: revenue projections must state assumptions, churn impact must be assessed

- [ ] **Step 3: Create README.md**

Brief description of the SaaS domain pack and what it adds.

- [ ] **Step 4: Commit**

```bash
git add core/domains/saas/
git commit -m "feat(core): add SaaS domain pack with overlays for 7 agents"
```

---

### Task 8: Sample Brief + Validation Test

**Files:**
- Create: `core/briefs/sample-product-decision/brief.md`
- Create: `core/briefs/sample-product-decision/product-overview.md`

- [ ] **Step 1: Create directory**

```bash
mkdir -p core/briefs/sample-product-decision
```

- [ ] **Step 2: Create brief.md**

Create a realistic sample brief about a product decision — e.g., whether to build an API platform vs. continue as a SaaS product. Must include all 4 required sections: Situation, Stakes, Constraints, Key Question.

- [ ] **Step 3: Create product-overview.md**

A context file with fictional product details (name, ARR, team size, tech stack, market position). This demonstrates the context_files feature.

- [ ] **Step 4: Validate all config loads correctly**

Run a quick validation by creating a one-off script. Create `runtime/validate-core.ts`:

```typescript
import { loadAgent, loadProfile, loadDomain } from "./src/config-loader";
import { join } from "node:path";

const coreDir = join(import.meta.dir, "..", "core");

// Load all 12 agents
const agentDirs = [
  'agents/orchestrators/arbiter',
  'agents/perspectives/catalyst',
  'agents/perspectives/sentinel',
  'agents/perspectives/architect',
  'agents/perspectives/provocateur',
  'agents/perspectives/navigator',
  'agents/perspectives/advocate',
  'agents/perspectives/pathfinder',
  'agents/perspectives/strategist',
  'agents/operational/operator',
  'agents/operational/steward',
  'agents/operational/auditor',
];

let passed = 0;
for (const dir of agentDirs) {
  try {
    const agent = loadAgent(join(coreDir, dir));
    console.log('✓', agent.id, '-', agent.name);
    passed++;
  } catch (e) {
    console.log('✗', dir, '-', e.message);
  }
}

// Load profile
try {
  const profile = loadProfile(join(coreDir, 'profiles/strategic-council'));
  console.log('✓ Profile:', profile.id, '-', profile.assembly.perspectives.length, 'perspectives');
  passed++;
} catch (e) {
  console.log('✗ Profile -', e.message);
}

// Load domain
try {
  const domain = loadDomain(join(coreDir, 'domains/saas'));
  console.log('✓ Domain:', domain.id, '-', Object.keys(domain.overlays).length, 'overlays');
  passed++;
} catch (e) {
  console.log('✗ Domain -', e.message);
}

console.log('\n' + passed + '/14 configs loaded successfully');
```

Then run: `cd runtime && bun run validate-core.ts`

Expected: All 14 configs load successfully (12 agents + 1 profile + 1 domain). Delete `validate-core.ts` after.

- [ ] **Step 5: Commit**

```bash
git add core/briefs/
git commit -m "feat(core): add sample brief with product-overview context file"
```

---

### Task 9: Final Validation

- [ ] **Step 1: Verify all files exist**

```bash
find core -type f | sort
```

Expected: 30+ files (3 schemas, 24 agent files, 2 profile files, 2 domain files, 2 brief files)

- [ ] **Step 2: Run the full runtime test suite**

```bash
cd runtime && bun test
```

Expected: All 65+ tests still pass (no regressions)

- [ ] **Step 3: Verify git log**

```bash
cd aos-harness && git log --oneline
```

Expected: 8 new commits on top of the runtime commits

- [ ] **Step 4: Final commit tag**

```bash
git tag v0.1.0-core
```
