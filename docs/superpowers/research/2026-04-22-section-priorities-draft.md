# Section Headline-Insight Priority Lists — Draft

**Date:** 2026-04-22
**Source:** Last 10 `result_message` payloads per agent from `https://daa.converselyai.com/api/external/agents/{id}/results`
**Purpose:** Seed each Conversely agent's daily "headline insight" picker with a ranked, weighted list of candidate insight types. Weights start at 1.0 for #1 and step down 0.1; Peter will retune in the Goals sheet.

For each agent below: (1) a short read on what the agent typically reports, (2) a ranked candidate list. Items were picked to be **distinct between agents** wherever possible — the picker should rarely surface the same metric in two sections on the same day.

---

## Agent 25 — Final Expense Funnel Analyzer (`funnel_analyzer`)

**What it typically reports.** The most structured of the seven — every report follows a fixed 10-section template (row-count check, executive summary, overall metrics, ranked campaigns, ranked agents, root-cause isolation, Top 3 Problems, Top 3 Opportunities, "If I Only Did 3 Things Next Week," Follow-Up Data Needed) with sample-size labels on every segment. Distinctively, it surfaces **disposition-bucket distributions** (Sale / Quoted / Not Interested / No Answer / Bad Transfer / Other-No-Engagement) and flags **data-integrity mismatches** like disposition="Sale" but `is_sale=0`.

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | Top-1 isolated root cause from same-campaign-across-agents split | 1.0 | This is the agent's most defensible insight type — it isolates "agent execution vs lead quality vs operational" in a way no other agent does. The example repeats every day (HIW × Michael vs HIW × Kari). |
| 2 | "If I only did 3 things next week" — #1 action with named segment | 0.9 | Already the agent's prescriptive headline. High signal, action-ready. |
| 3 | High No-Engagement / Other-disposition share for a campaign | 0.8 | Distinctive to this agent (others don't decompose "Other"). Surfaces transfer/connect quality rather than close skill. |
| 4 | Disposition-vs-flag data-integrity mismatch | 0.7 | Unique to this agent. Operational risk that other sections won't catch (`is_sale` vs disposition string). |
| 5 | Best-economics campaign (lowest CPA + healthy quote rate) flagged for "scale" | 0.6 | Recurring "Top 3 Opportunities" item — directional growth lever. |
| 6 | Same-agent-across-campaigns mismatch (one rep good elsewhere, broken on one campaign) | 0.5 | Pinpoints script/lead-fit gap. Distinct from "agent has a close-rate problem" headline. |
| 7 | Sales-to-Quote collapse on a meaningful-sample segment | 0.4 | Late-funnel close failure with sample-size guard built in. |
| 8 | Sample-size warning on yesterday's "winner" (caution against over-reading) | 0.3 | Defensive — keeps users from over-rotating on Very-Small-Sample wins. Useful but rarely the lead. |

---

## Agent 27 — Campaign Lead Quality (`lead_quality`)

**What it typically reports.** The only **qualitative / transcript-driven** agent in the seven — reports run 11–13K chars and read like a sales-floor QA review. They synthesize lead intent into recurring archetypes (true FE shoppers, "$25k / Social Security / government benefit" ad-confused seekers, replacement/price-comparison shoppers, logistically constrained buyers) and surface dominant disqualifiers: **affordability caps**, **impaired-risk health forcing graded/GI**, **trust-and-transaction blockers** (SSN refusal, e-sign friction), **operational drag** (dead-air transfers, list hygiene). Crucially, it catches things no metric-driven agent can — e.g., a single compliance incident on one INU call.

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | Dominant ad-confusion / expectation-mismatch theme of the day | 1.0 | The recurring #1 lead-quality finding ("$25k benefit" misframing). Affects creative + scripting. Nothing else surfaces it. |
| 2 | Compliance / conduct red flag on a specific call | 0.9 | High-severity even when n=1. Only this agent will catch it. Should pre-empt other headlines when present. |
| 3 | New / shifted intent archetype mix this week | 0.8 | "More replacement shoppers today" or "fewer logistically-ready buyers" — strategic, not tactical. |
| 4 | Affordability / budget-cap collision with quoted face amount | 0.7 | Recurring qualifier killer; argues for budget-gate routing. |
| 5 | Health-profile skew driving GI/graded volume | 0.6 | Changes product-positioning expectations; recurring driver of "price shock." |
| 6 | Operational drag on transfers / audio / dead-air | 0.5 | Often presented as "calls that look like bad leads but aren't." Distinct from Volume & Capacity's IVR signal because it's qualitative. |
| 7 | SSN / banking / e-sign trust-cliff pattern | 0.4 | Late-funnel break specific to this audience; informs scripting. |
| 8 | Campaign-level qualitative grade (HIW vs INU vs HT FEX cleanliness) | 0.3 | Slow-moving comparative read; useful as a footer rather than a headline most days. |

---

## Agent 5 — Volume & Capacity (`volume_capacity`)

**What it typically reports.** Operational throughput only — no economics, no intent. Sections: company volume (calls, billable count, IVR loss, reached-agent), campaign and agent breakdowns, campaign×agent pinpoint, and a "capacity utilization proxy" (avg duration × call_count → total talk time, since agent-hours aren't available). Recurring signals: **reached-agent dips**, **IVR spikes**, **AHT inflation**, and **billable-rate gaps between agents on the same campaign**.

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | Reached-agent % below threshold (and where the leak concentrates) | 1.0 | The agent's headline operational risk almost every day. Direct lever: staffing/routing. |
| 2 | IVR spike pinpointed to a campaign×agent cell | 0.9 | When it appears, it is usually localized and immediately actionable (queue config / coverage gap). |
| 3 | AHT (avg duration) inflation on a single campaign — capacity drag | 0.8 | Distinctive — others don't track talk-time. Throughput-relevant even when sales metrics look fine. |
| 4 | Billable-rate gap between two agents on the same campaign | 0.7 | Operational, not skill — usually points at qualification/disposition consistency. |
| 5 | Demand concentration risk (>70% of calls in one campaign) | 0.6 | Capacity-planning signal; flags single-source dependency. |
| 6 | Total estimated talk-time (proxy for agent-hour load) crossing a threshold | 0.5 | Useful trend metric; not a daily lead unless it spikes. |
| 7 | Zero-volume / data-pipeline alert | 0.4 | Recurring fallback when call_count=0; should bubble up only when it's the actual story. |
| 8 | Outlier handle-time (single call) distorting the campaign average | 0.3 | Data-quality nudge; rarely a headline but worth surfacing periodically. |

---

## Agent 12 — Sales Execution / Agent Performance (`sales_execution`)

**What it typically reports.** Frames everything as "Are agents executing the process well?" against a daily company baseline. Recurring sections: per-agent goal checks (sales-per-billable, sales→quote, quote rate "healthy band," stage competency), efficiency + quality leaderboards, and a "3 agents × 1 skill each" coaching list. Signature interpretive frame is the **quote-rate "healthy band"** — flagging both **spray-and-pray** (high quote, low close) and **sandbagging** (low quote, high close) as execution failures.

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | Per-agent sales-per-billable-call ranking vs company baseline | 1.0 | The agent's top efficiency leaderboard metric. Direct accountability lens. |
| 2 | Spray-and-pray detection (high quote rate + below-baseline sales→quote) | 0.9 | Distinctive interpretive frame to this agent. Identifies a specific coaching pathology. |
| 3 | Sandbagging detection (low quote rate + above-baseline sales→quote) | 0.8 | Mirror image of #2. Also distinctive — most other agents don't flag "too low quote rate" as bad. |
| 4 | Coaching list — top-priority agent + the one stage they need to fix | 0.7 | Action-ready, name-of-rep-and-skill output. The agent always tries to produce this. |
| 5 | Stage competency drop-off vs baseline for a named agent | 0.6 | E.g., "Agent X opening 47% vs baseline 65%." Drives where coaching focuses. |
| 6 | High-AHT + low-sale-rate inefficiency flag | 0.5 | Combines two dimensions; less common but high-signal when it fires. |
| 7 | Same-agent's results varying sharply by campaign (lead-fit) | 0.4 | Crosses into mix territory — useful but overlaps with Agent 13 and Agent 25. |
| 8 | Single-agent outlier with too-small sample (caution flag) | 0.3 | Rarely a lead; prevents over-coaching on noise. |

---

## Agent 4 — Profitability (`profitability`)

**What it typically reports.** The economics agent. Every report covers company CPA/CPQ/sale-rate/quote-rate/billable-rate, then **CPA spike alerts** by campaign×agent, then **billable-rate drop alerts** (framed as junk-volume / compliance risk), then **sales per billable call** (its preferred productivity unit), then a **CPA driver decomposition** (mix shift vs execution shift). Distinctive emphasis: the worst CPA cell, with meaningful volume.

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | CPA spike alert on a meaningful-volume campaign×agent cell | 1.0 | The agent's flagship daily output. Immediately actionable (route/coach/pause). |
| 2 | Sales-per-billable-call (the agent's preferred productivity unit) above/below baseline | 0.9 | This metric is essentially owned by Agent 4. Distinct from raw close rate. |
| 3 | CPA driver decomposition: mix shift vs execution shift | 0.8 | Distinctive interpretive lens — explains *why* CPA moved, not just *that* it did. |
| 4 | Billable-rate drop framed as junk-volume / compliance risk | 0.7 | Specifically framed as economic waste, not just operational drag (cf. Agent 5). |
| 5 | CPQ blowout (quote inflation) on a specific campaign×agent | 0.6 | Catches "spending money on quotes that don't sell" — distinct from CPA. |
| 6 | "Wasted quoting" alert (CPQ defined but sales-to-quote = 0) | 0.5 | Sub-pattern of #5 but binary; easy to act on. |
| 7 | Mix-driven CPA risk (single campaign carrying all sales) | 0.4 | Strategic warning; argues for diversifying spend before HIW falters. |
| 8 | Threshold-pass/fail labeling once CPA target is supplied | 0.3 | Recurring offer in the report. Once Peter sets targets in the sheet this becomes a real headline. |

---

## Agent 6 — Funnel Health (`funnel_health`)

**What it typically reports.** Answers "Where are we leaking conversions?" through the five-stage funnel (Reached-agent → Opening → Framing → Plan Details → Application → Post-close), quantifying the **largest stage-to-stage drop** in percentage points and picking ONE coaching focus stage for the week. Distinguishes two daily drift signals: **(A) quote rate jumps with flat sales→quote** = qualification drift, vs **(B) sales→quote drops with steady quote rate** = closing/script drift. Repeatedly identifies "Plan Details → Application" as the company-wide commitment-step leak.

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | Single biggest stage-to-stage drop (with named stage transition) | 1.0 | The agent's defining output. Pinpoints exactly where in the funnel to coach. |
| 2 | Coaching-focus stage of the week | 0.9 | Always produced; prescriptive and follow-up-able. |
| 3 | Qualification drift: quote rate jumping while sales→quote stays flat | 0.8 | The agent's distinctive diagnostic frame. Different from "close rate dropped." |
| 4 | Closing drift: sales→quote dropping with steady quote rate | 0.7 | Mirror of #3. Equally distinctive. |
| 5 | Two-different-leak-cause profile (one agent leaks early, another leaks late) | 0.6 | Insightful contrast; supports differentiated coaching. |
| 6 | Worst leak pocket (specific campaign×agent stage break) | 0.5 | Concrete coaching target; complements #1. |
| 7 | Application → Post-close collapse (finalization break) | 0.4 | Specific late-funnel pattern — distinct from "Plan → Application." |
| 8 | Reached-agent → Opening drop (early-call control issue) | 0.3 | Top-of-funnel leak; usually overlaps with Agent 5 territory but worth flagging when severe. |

---

## Agent 13 — Mix & Product Strategy (`mix_product`)

**What it typically reports.** Frames every report around "Are we selling the right products to the right people?" — treating each campaign as a proxy for a product line. Recurring sections: per-campaign CPA / sales-to-quote / quote rate / intent-mix table, **quote-to-sale stability by product**, **intent-quality alignment** ("don't sell complex products to low-intent sources"), **agent×product fit**, mix-shift risk (volume concentration), and concrete **routing-rule recommendations** (move HIW to Agent X, restrict INU to high-intent only).

| Rank | Item | Weight | Why this matters |
|---|---|---|---|
| 1 | Product-mix shift risk: volume concentrated in worst-economics campaign | 1.0 | The strategic headline almost every report lands on (e.g., "70% of calls on HIW which has worst CPA"). |
| 2 | Best-fit routing rule recommendation (move volume from X to Y) | 0.9 | Concrete reallocation action — this agent's defining prescriptive output. |
| 3 | Product-specific close collapse (campaign quotes but doesn't convert) | 0.8 | Different from CPA spike (Agent 4) — diagnoses product/process fit, not cost. |
| 4 | Intent-mix mismatch with product complexity | 0.7 | Distinctive frame ("INU has 28% high/med intent — don't push complex products there"). |
| 5 | Agent × campaign fit recommendation (which rep should own which lead-flow) | 0.6 | Prescriptive; complements Agent 12's coaching list with a routing angle. |
| 6 | "Right product, wrong people" diagnosis on a campaign that can't even quote | 0.5 | Captures upstream-targeting failures (e.g., HT FEX = 0% quote rate). |
| 7 | "Right people, wrong product" diagnosis (high intent, no application step) | 0.4 | Mirror of #6 — argues for product/script change rather than source change. |
| 8 | Quote-to-sale stability ranking across product lines | 0.3 | Slow-moving baseline metric; useful as a footer or weekly callout. |

---

## Cross-cutting notes for the picker

**Ownership of recurring metrics** (avoiding cross-section collisions):
- **CPA** → Agent 4 only. Agent 13 frames *mix-driven* CPA risk; Agent 25 wraps CPA in sample-size labels.
- **Close rate / sales-to-quote** appears in Agents 6, 12, 25 — but with distinct frames (closing drift / spray-vs-sandbag / isolated root cause).
- **Reached-agent, IVR, AHT** → Agent 5.
- **Stage drop-offs** → Agent 6.
- **Disposition buckets and data-integrity mismatches** → Agent 25.
- **Lead intent, ad-confusion, compliance, trust-cliff** → Agent 27.
- **Routing-rule prescriptions** → Agent 13.
- **Named-rep coaching list** → Agent 12.

**Severity overrides.** A few low-frequency items are high enough severity to jump the queue when they fire — flag them in the sheet:
- Agent 27 #2 (compliance / conduct red flag)
- Agent 25 #4 (disposition-vs-flag mismatch — finance truth issue)
- Agent 5 #7 (zero-volume / pipeline alert)
- Agent 4 #1 (CPA spike on meaningful volume)

**Sample-size guard.** Down-weight any candidate whose underlying segment has fewer than ~5 billable calls. Agent 25 already emits sample-size labels in machine-readable form; the others can be approximated from `call_count`.

**Zero-volume days.** On days where company `call_count = 0`, every quantitative agent (4, 5, 6, 12, 13, 25) collapses into a "no data" message. The picker should detect this and surface a single shared headline ("No call activity today — pipeline check needed") rather than picking from each section.
