# Healthcare & Life Sciences Domain Pack

The Healthcare domain pack injects clinical decision support, patient safety, and regulatory compliance context into the Strategic Council deliberation. Apply it when the brief concerns clinical operations, life sciences product development, health technology, or any decision that affects patient care.

## What it adds

**Shared lexicon** — all agents share consistent definitions for patient outcomes, readmission rates, adverse event rates, clinical trial enrollment, time-to-diagnosis, care pathway adherence, mortality rates, and infection rates. Frameworks cover evidence-based medicine, clinical decision support, value-based care, and population health management. Stages map the lifecycle from pre-clinical through standard-of-care.

**Agent overlays** — seven agents receive additional lens instructions and evidence standards that sharpen their analysis for healthcare context:

| Agent | Overlay focus |
|---|---|
| `catalyst` | Clinical urgency assessment; time-to-patient-impact |
| `sentinel` | Patient safety as primary red line; adverse event prevention |
| `architect` | HIPAA-compliant architecture; HL7/FHIR interoperability |
| `provocateur` | Clinical trial failure base rates; regulatory rejection patterns |
| `steward` | HIPAA/FDA/IRB compliance matrix; informed consent requirements |
| `advocate` | Patient experience; health equity impact; health literacy |
| `operator` | Clinical workflow integration; staff training burden |

**Additional input section** — briefs submitted with this domain should include a `## Clinical Context` section covering patient population, current standard of care, clinical evidence level, and regulatory pathway status.

**Additional output section** — the memo's clinical impact section projects the effect of each recommendation on patient outcomes, safety metrics, and regulatory timeline, with clinical evidence levels stated.

**Guardrails** — three hard rules enforced during deliberation:
1. Patient safety must be assessed for every recommendation
2. Regulatory pathway must be identified before implementation planning
3. Clinical evidence level must be stated for every claim

## Usage

```bash
aos run --profile strategic-council --domain healthcare --brief path/to/brief.md
```
