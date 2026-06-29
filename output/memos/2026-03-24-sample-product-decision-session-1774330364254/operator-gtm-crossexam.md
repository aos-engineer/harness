# Operator — GTM Cross-Examination Response
## Meridian Analytics Council | API Platform vs. SaaS Depth
### Session: 2026-03-24 | Round: Cross-Examination

---

## Scratch Pad (Operational Reality Check)

**The private beta — what does it operationally require? Let me break it down by account:**

FOR THE 2 AT-RISK CUSTOMERS:
- CSM engagement: ~2-3 hrs/week per customer during beta = 4-6 hrs/week total.
  We have 4 CS staff. This is manageable without adding headcount.
- Technical provisioning: API key generation, tenant config, documentation walkthrough.
  Estimated: 4-8 hrs per customer one-time setup.
- Support during beta: async Slack/email channel. Estimate 3-5 hrs/week per customer 
  during active integration phase (first 3-4 weeks). After integration settles, drops 
  to ~1-2 hrs/week.
- Total CS burden for 2 at-risk customers through the beta: ~80-100 hrs over 8 weeks.
  That is approximately one-half of one CS FTE for 8 weeks.
- Verdict: operationally manageable with current CS team. This is not an enterprise 
  support motion. This is an elevated CSM engagement for 2 named accounts.

FOR THE 3 DECLINED PROSPECTS:
- Re-engagement call: 1 AE, 1 PM or founding team member. 1-2 hrs per prospect.
- Technical scoping (the part that requires a non-AE): 2-4 hrs per prospect to confirm 
  endpoint requirements, data model compatibility, rate limit needs, EU residency 
  handling. This requires PM or engineer time.
- Security/compliance documentation request: likely to arrive before or during the call.
  We do not have API-specific security docs. Creating them: ~1 week of PM time.
  (This is a one-time cost, not per-prospect.)
- If any prospect moves to active evaluation: POC support. Estimate 8-12 hrs/prospect 
  of PM/engineering time over 2-3 weeks.
- Total for 3 prospects (if all three engage seriously): ~50-70 hrs of PM/engineering 
  time over 6-8 weeks.

AGGREGATE PRIVATE BETA OPERATIONAL COST:
- CS: 80-100 hrs (2 at-risk customers)
- PM/engineering: 60-90 hrs (3 prospects + security documentation)
- AE: 20-30 hrs (re-engagement calls + follow-up for 3 prospects)
- Total: ~160-220 hrs over 8 weeks.
- At fully-loaded rates: $30K-$45K in operational cost.
- This is NOT the $400K-$600K GTM investment of a full enterprise motion.

**My original claim vs. reality:**
- I stated that without enterprise AE and SE, the API is "infrastructure we cannot sell."
- That claim is accurate for the full enterprise GTM motion. 
- It is NOT accurate for a private beta to 5 named, pre-qualified accounts.
- I need to own that distinction.

**Support burden after GA — where the real operational risk lives:**
- If the private beta succeeds and we launch GA without enterprise AE/SE, the 
  support queue opens to any enterprise buyer who discovers the API.
- An enterprise buyer doing technical evaluation typically generates 3-5x the 
  support volume of a self-serve customer during the first 90 days.
- Our current support infrastructure is sized for 187 self-serve/mid-market customers.
- Each enterprise account in production generates approximately the support burden 
  of 5-8 mid-market accounts. If we add 5-10 enterprise accounts post-GA without 
  support scaling, we degrade quality of service for the existing 187.
- This is the operational risk I am most focused on. It is not about the private beta.
  It is about what happens at GA if we are not ready.

---

## My Original Position, Corrected

I called the GTM mismatch a hard veto. The Strategist has already walked back "hard veto" 
to "conditional proceed." I will do the same, and I will be specific about why.

My job on this council is to translate strategic decisions into operational reality. 
When I said we cannot sell the API without enterprise AE and SE, I was modeling the 
full enterprise acquisition and support motion — the one that runs in parallel with 
GA launch and ongoing enterprise growth. For that motion, I stand by every word.

For the private beta — 5 named accounts, pre-qualified, with existing relationships on 
2 of the 5 — I was applying the wrong operational model. Let me apply the right one.

---

## What the Private Beta Actually Requires Operationally

### The At-Risk Customers: This Is a CS Motion, Not a Sales Motion

I want to be unambiguous: retaining 2 existing customers who have asked for a specific 
feature is a customer success problem. We solve it with our CS team. We have 4 CS staff. 
This does not require an enterprise AE or SE.

Here is what it requires:
- A discovery call to confirm that the API endpoints in Stage 2 cover their minimum 
  use case. (1 CS + 1 PM, ~2 hrs. This should happen before engineering starts, not after.)
- A provisioning workflow when Stage 2 ships. (1 engineer, ~4 hrs to build the 
  key provisioning UX. This is in scope for Stage 2 anyway.)
- An integration support period of 3-4 weeks. (CS-led, async, estimated 5-6 hrs/week.)
- A renewal conversation. (Account manager or CS, standard motion.)

The only gap I see is the discovery call before engineering starts. If we do not do that 
call in week 1 of Stage 1, we risk building Stage 2 endpoints that do not match what 
these customers actually need. That is an operational risk in Catalyst's plan — not 
because of GTM, but because of requirements validation. I am flagging it here. It 
must happen in the first week.

### The Declined Prospects: This Is a Warm Re-Engagement, Not Cold Outbound

The three declined prospects require a different but still manageable operational play. 
Here is what I see:

**Week 1-2 (before any product is built):** Re-engagement calls. AE + PM. Objective: 
confirm whether these prospects are still in-market, restate that we are building what 
they asked for, and collect their specific technical requirements for our API. This is 
requirements-gathering disguised as a sales call. It costs us 6-10 hrs of AE + PM time 
and it directly informs what we build in Stage 2. We should do this regardless of 
the outcome — we need this information to validate Catalyst's plan.

**Week 8-12 (Stage 2 ships):** Demo and early-access provisioning. PM-led technical 
walk-through, AE on the commercial side. If any prospect moves to active evaluation, 
they will ask for a POC — 2-3 weeks, ~10 hrs PM/engineering support. This is the 
workload that a solutions engineer would normally carry. We do not have one. The 
allocation must come from PM or a designated engineering resource. That needs to be 
planned, not assumed.

**If any prospect moves to contract:** Standard AE close process, elevated to ~$60K 
ACV. Legal review, data processing agreement (GDPR-relevant for EU customers), 
standard MSA. Our legal team has handled the DPA before for EU customers. The 
contract terms are new territory for an AE closing $60K vs. $18K, but the motion is 
not structurally alien. One thing I want flagged: multi-stakeholder procurement is a 
real risk. A $60K API contract that involves a CTO, VP Engineering, and procurement 
team has a longer close cycle than our AEs are used to. We should set an internal 
expectation of 60-90 days from re-engagement to signed contract, not 30 days.

---

## The Operational Risk I Am Not Backing Away From

None of the above changes my core concern about post-GA operations. It just relocates 
when that concern becomes critical.

**The support burden is the operational tripwire for this plan.**

Here is what the council needs to understand about what happens when an API product 
goes live — not in private beta, but in GA:

An analytics API is not a SaaS UI. When a user misunderstands a dashboard feature, 
they click around and figure it out. When a developer misunderstands an API response, 
they file a support ticket, escalate it to their engineering team, and then re-escalate 
it to us when their integration breaks in production at 2am on a Tuesday. API support 
is technically demanding, time-sensitive, and deeply unpleasant to handle without a 
solutions engineer who understands both the customer's data model and ours.

Every enterprise API customer in production is, operationally, worth approximately 
6-8 mid-market SaaS customers in support load. If we add 5 enterprise accounts 
post-GA without adding support capacity, our existing 187-customer base absorbs the 
cost through degraded response times and CS burnout.

I am not saying do not go to GA. I am saying: do not go to GA without a support 
operations plan. Specifically:

**Minimum viable enterprise support model for GA (must be in place before Stage 3 ships):**
1. An API-specific support tier with defined SLAs (response time, escalation path).
2. At minimum, one CS staff member upskilled or designated as "API support owner" — 
   this person has deep product and technical familiarity with the API, handles 
   first-line escalations, and routes to engineering when needed. This is a 3-4 week 
   training investment, not a hire.
3. A documented escalation path from API support → PM → engineering, with agreed 
   response SLAs. Without this, API support becomes ad hoc, which is the fastest 
   way to burn CS staff and degrade enterprise customer experience simultaneously.
4. API status page and basic observability (incident communication). This is a 2-3 
   day engineering task that must not be skipped.

These are not expensive. They are unglamorous. They are the difference between an 
API launch that builds enterprise confidence and one that generates a first-page 
negative review on G2 from an enterprise customer whose production integration went 
down and got a 48-hour response.

---

## My Revised Position in Full

**Private beta (Stages 1-2): Support with operational conditions.**

The private beta does not require enterprise AE or SE for the 2 at-risk customers. 
It requires customer success, which we have. It requires requirements validation 
calls before engineering starts, which costs one week. It requires PM time for 
technical pre-sales support with the 3 prospects, which must be explicitly allocated.

None of this is a veto. All of it is plannable. My original "hard veto" framing 
was wrong for this scope.

**General availability (Stage 3): Conditional on operational readiness.**

I will veto Stage 3 launch unless the following are in place before the switch flips:
1. API support tier with designated owner and SLAs.
2. Escalation path documented and staffed.
3. API observability and status communication live.
4. Board-approved or in-process enterprise AE headcount request (even if not yet filled).

These are reasonable, achievable conditions. None requires net-new hires before GA. 
All are within the execution capacity of the current team if started in Stage 2.

**Post-GA scaling: Still requires GTM infrastructure.**

If the private beta validates enterprise demand and we launch GA, the GTM constraint 
becomes acute in the 3-6 months following. At that point — if the pipeline is real — 
we need an enterprise AE and SE. The board needs to understand this is the consequence 
of success, not a surprise when it arrives.

---

## What I Am Asking Catalyst to Acknowledge

Three things I need Catalyst to include in any revised plan:

**1. Requirements validation before engineering starts.** Call the 2 at-risk customers 
in week 1. Confirm that Stage 2 endpoints will satisfy their minimum requirements. 
If they cannot confirm, we have an information problem that invalidates the whole 
private beta thesis before we spend a dollar on engineering.

**2. Explicit PM allocation for technical pre-sales.** The 3 declined prospects will 
ask questions an AE cannot answer. Someone technical has to be in those calls. 
That person's availability must be planned, not assumed.

**3. GA support readiness as a hard gate.** Stage 3 does not ship without the 
operational minimum I have described above. Not as a preference — as a condition.

Those three asks are not a veto. They are the operational minimum for this to not 
become a cautionary tale.

---

*Operator | Meridian Analytics Council | March 24, 2026 | Round: Cross-Examination*
