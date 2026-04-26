// src/lib/ghl/filter.js
import { rowHash } from './row-hash.js';

/**
 * Decide whether a Call Log row should be processed.
 * @param row Call Log row object (keyed by header name)
 * @param excludedCampaigns array of { Campaign, Subcampaign } rules
 * @param syncedHashes Set<string> of row hashes already in Sync Log
 */
export function shouldProcessRow(row, excludedCampaigns, syncedHashes) {
  const phone = (row['Phone'] ?? '').trim();
  if (!phone) return { ok: false, reason: 'missing_phone' };

  const campaign = (row['Campaign'] ?? '').trim();
  const subcampaign = (row['Subcampaign'] ?? '').trim();
  for (const rule of excludedCampaigns ?? []) {
    const ruleCampaign = (rule.Campaign ?? '').trim();
    const ruleSubcampaign = (rule.Subcampaign ?? '').trim();
    if (!ruleCampaign) continue;
    if (campaign !== ruleCampaign) continue;
    // Subcampaign-scoped rule: must match. Empty rule subcampaign = applies to whole campaign.
    if (ruleSubcampaign && ruleSubcampaign !== subcampaign) continue;
    return { ok: false, reason: 'excluded_campaign' };
  }

  const hash = rowHash(row);
  if (syncedHashes && syncedHashes.has(hash)) {
    return { ok: false, reason: 'already_synced' };
  }

  return { ok: true };
}
