# Fintech & Financial Services Domain Pack

The Fintech domain pack injects financial services, payments, lending, and investment platform context into the Strategic Council deliberation. Apply it when the brief concerns money movement, financial product design, lending decisions, or any decision involving customer funds and financial regulatory compliance.

## What it adds

**Shared lexicon** — all agents share consistent definitions for AUM, transaction volume, default rate, approval rate, fraud rate, cost-per-transaction, net interest margin, and regulatory capital ratio. Frameworks cover embedded finance, open banking, DeFi integration, regtech, and core banking modernization. Stages map the lifecycle from sandbox through scale.

**Agent overlays** — seven agents receive additional lens instructions and evidence standards that sharpen their analysis for fintech context:

| Agent | Overlay focus |
|---|---|
| `catalyst` | Revenue per transaction; payment volume growth |
| `sentinel` | Fraud prevention; customer funds protection |
| `architect` | PCI-DSS compliance architecture; real-time transaction processing |
| `provocateur` | Fraud vector analysis; regulatory enforcement precedents |
| `steward` | PCI-DSS/SOX/AML/KYC compliance; fiduciary duty |
| `navigator` | Fintech market positioning; regulatory arbitrage assessment |
| `strategist` | Payments wedge strategy; platform vs product sequencing |

**Additional input section** — briefs submitted with this domain should include a `## Financial Context` section covering transaction volume, revenue per transaction, fraud and chargeback rates, regulatory status, and capital position.

**Additional output section** — the memo's financial risk impact section projects the effect of each recommendation on transaction economics, fraud exposure, regulatory compliance, and customer funds safety.

**Guardrails** — three hard rules enforced during deliberation:
1. Regulatory compliance status must be explicitly stated for every recommendation
2. Customer funds protection must be assessed for money-touching changes
3. Fraud impact analysis is required for any customer-facing change

## Usage

```bash
aos run --profile strategic-council --domain fintech --brief path/to/brief.md
```
