// Per-agent ranked priority lists for the InsightHero "headline picker."
// Sourced from docs/superpowers/research/2026-04-22-section-priorities-draft.md
// after analyzing 10 days of each agent's reports. Editable here for now;
// later moves to a "Section Insight Priorities" sheet tab so non-engineers
// can tune without a deploy.
//
// Item shape:
//   { rank, item, weight, override?, why }
//   - override: true means severity-jumps the queue when present (compliance,
//     data-integrity, CPA spike, zero-volume).

export const INSIGHT_PRIORITIES = {
  funnel_analyzer: [
    { rank: 1, item: 'Top-1 isolated root cause from same-campaign-across-agents split', weight: 1.0, why: 'Isolates execution vs lead quality vs operational — unique to this agent.' },
    { rank: 2, item: '"If I only did 3 things next week" — #1 action with named segment', weight: 0.9, why: 'Already the agent\'s prescriptive headline.' },
    { rank: 3, item: 'High No-Engagement / Other-disposition share for a campaign', weight: 0.8, why: 'Surfaces transfer/connect quality.' },
    { rank: 4, item: 'Disposition-vs-flag data-integrity mismatch', weight: 0.7, override: true, why: 'Operational risk no other section catches.' },
    { rank: 5, item: 'Best-economics campaign flagged for "scale"', weight: 0.6, why: 'Recurring growth lever.' },
    { rank: 6, item: 'Same-agent-across-campaigns mismatch', weight: 0.5, why: 'Pinpoints script/lead-fit gap.' },
    { rank: 7, item: 'Sales-to-Quote collapse on meaningful-sample segment', weight: 0.4, why: 'Late-funnel close failure with sample-size guard.' },
    { rank: 8, item: 'Sample-size warning on yesterday\'s "winner"', weight: 0.3, why: 'Defensive — keeps users from over-rotating on noise.' },
  ],
  lead_quality: [
    { rank: 1, item: 'Dominant ad-confusion / expectation-mismatch theme of the day', weight: 1.0, why: 'Affects creative + scripting. Unique to this agent.' },
    { rank: 2, item: 'Compliance / conduct red flag on a specific call', weight: 0.9, override: true, why: 'High severity even at n=1. Pre-empts all other headlines.' },
    { rank: 3, item: 'New / shifted intent archetype mix this week', weight: 0.8, why: 'Strategic, not tactical.' },
    { rank: 4, item: 'Affordability / budget-cap collision with quoted face amount', weight: 0.7, why: 'Recurring qualifier killer.' },
    { rank: 5, item: 'Health-profile skew driving GI/graded volume', weight: 0.6, why: 'Changes product-positioning expectations.' },
    { rank: 6, item: 'Operational drag on transfers / audio / dead-air', weight: 0.5, why: 'Distinct from V&C — qualitative.' },
    { rank: 7, item: 'SSN / banking / e-sign trust-cliff pattern', weight: 0.4, why: 'Late-funnel break specific to this audience.' },
    { rank: 8, item: 'Campaign-level qualitative grade comparison', weight: 0.3, why: 'Slow-moving comparative read.' },
  ],
  volume_capacity: [
    { rank: 1, item: 'Reached-agent % below threshold (and where the leak concentrates)', weight: 1.0, why: 'Direct lever: staffing/routing.' },
    { rank: 2, item: 'IVR spike pinpointed to a campaign×agent cell', weight: 0.9, why: 'Localized and immediately actionable.' },
    { rank: 3, item: 'AHT inflation on a single campaign — capacity drag', weight: 0.8, why: 'Distinctive — others don\'t track talk-time.' },
    { rank: 4, item: 'Billable-rate gap between two agents on the same campaign', weight: 0.7, why: 'Operational, not skill — points at qualification consistency.' },
    { rank: 5, item: 'Demand concentration risk (>70% of calls in one campaign)', weight: 0.6, why: 'Capacity-planning signal.' },
    { rank: 6, item: 'Total estimated talk-time (proxy for agent-hour load) crossing threshold', weight: 0.5, why: 'Useful trend metric.' },
    { rank: 7, item: 'Zero-volume / data-pipeline alert', weight: 0.4, override: true, why: 'Recurring fallback when call_count=0.' },
    { rank: 8, item: 'Outlier handle-time distorting campaign average', weight: 0.3, why: 'Data-quality nudge.' },
  ],
  sales_execution: [
    { rank: 1, item: 'Per-agent sales-per-billable-call ranking vs company baseline', weight: 1.0, why: 'Top efficiency leaderboard.' },
    { rank: 2, item: 'Spray-and-pray detection (high quote rate + below-baseline sales→quote)', weight: 0.9, why: 'Distinctive coaching pathology.' },
    { rank: 3, item: 'Sandbagging detection (low quote rate + above-baseline sales→quote)', weight: 0.8, why: 'Mirror of #2 — also distinctive.' },
    { rank: 4, item: 'Coaching list — top-priority agent + the one stage they need to fix', weight: 0.7, why: 'Action-ready, name-of-rep-and-skill output.' },
    { rank: 5, item: 'Stage competency drop-off vs baseline for a named agent', weight: 0.6, why: 'Drives where coaching focuses.' },
    { rank: 6, item: 'High-AHT + low-sale-rate inefficiency flag', weight: 0.5, why: 'Combines two dimensions; high-signal when it fires.' },
    { rank: 7, item: 'Same-agent\'s results varying sharply by campaign (lead-fit)', weight: 0.4, why: 'Crosses into mix territory.' },
    { rank: 8, item: 'Single-agent outlier with too-small sample (caution flag)', weight: 0.3, why: 'Prevents over-coaching on noise.' },
  ],
  profitability: [
    { rank: 1, item: 'CPA spike alert on a meaningful-volume campaign×agent cell', weight: 1.0, override: true, why: 'Flagship daily output. Immediately actionable.' },
    { rank: 2, item: 'Sales-per-billable-call above/below baseline', weight: 0.9, why: 'Owned by Profitability. Distinct from raw close rate.' },
    { rank: 3, item: 'CPA driver decomposition: mix shift vs execution shift', weight: 0.8, why: 'Distinctive interpretive lens.' },
    { rank: 4, item: 'Billable-rate drop framed as junk-volume / compliance risk', weight: 0.7, why: 'Economic waste, not just operational drag.' },
    { rank: 5, item: 'CPQ blowout (quote inflation) on a specific campaign×agent', weight: 0.6, why: 'Catches "spending money on quotes that don\'t sell."' },
    { rank: 6, item: '"Wasted quoting" alert (CPQ defined but sales-to-quote = 0)', weight: 0.5, why: 'Sub-pattern of #5 but binary; easy to act on.' },
    { rank: 7, item: 'Mix-driven CPA risk (single campaign carrying all sales)', weight: 0.4, why: 'Strategic warning.' },
    { rank: 8, item: 'Threshold-pass/fail labeling vs CPA target', weight: 0.3, why: 'Becomes real headline once targets are set.' },
  ],
  funnel_health: [
    { rank: 1, item: 'Single biggest stage-to-stage drop (with named stage transition)', weight: 1.0, why: 'Pinpoints exactly where in the funnel to coach.' },
    { rank: 2, item: 'Coaching-focus stage of the week', weight: 0.9, why: 'Prescriptive and follow-up-able.' },
    { rank: 3, item: 'Qualification drift: quote rate jumping while sales→quote stays flat', weight: 0.8, why: 'Distinctive diagnostic frame.' },
    { rank: 4, item: 'Closing drift: sales→quote dropping with steady quote rate', weight: 0.7, why: 'Mirror of #3.' },
    { rank: 5, item: 'Two-different-leak-cause profile (one agent leaks early, another late)', weight: 0.6, why: 'Supports differentiated coaching.' },
    { rank: 6, item: 'Worst leak pocket (specific campaign×agent stage break)', weight: 0.5, why: 'Concrete coaching target.' },
    { rank: 7, item: 'Application → Post-close collapse (finalization break)', weight: 0.4, why: 'Specific late-funnel pattern.' },
    { rank: 8, item: 'Reached-agent → Opening drop (early-call control issue)', weight: 0.3, why: 'Top-of-funnel leak.' },
  ],
  mix_product: [
    { rank: 1, item: 'Product-mix shift risk: volume concentrated in worst-economics campaign', weight: 1.0, why: 'Strategic headline almost every report lands on.' },
    { rank: 2, item: 'Best-fit routing rule recommendation (move volume from X to Y)', weight: 0.9, why: 'Concrete reallocation action.' },
    { rank: 3, item: 'Product-specific close collapse (campaign quotes but doesn\'t convert)', weight: 0.8, why: 'Diagnoses product/process fit, not cost.' },
    { rank: 4, item: 'Intent-mix mismatch with product complexity', weight: 0.7, why: 'Distinctive frame.' },
    { rank: 5, item: 'Agent × campaign fit recommendation', weight: 0.6, why: 'Prescriptive routing angle.' },
    { rank: 6, item: '"Right product, wrong people" diagnosis on campaign that can\'t even quote', weight: 0.5, why: 'Captures upstream-targeting failures.' },
    { rank: 7, item: '"Right people, wrong product" diagnosis (high intent, no application step)', weight: 0.4, why: 'Argues for product/script change rather than source change.' },
    { rank: 8, item: 'Quote-to-sale stability ranking across product lines', weight: 0.3, why: 'Slow-moving baseline metric.' },
  ],
};

export function getPriorities(category) {
  return INSIGHT_PRIORITIES[category] || [];
}
