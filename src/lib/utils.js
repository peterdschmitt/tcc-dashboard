// Fuzzy match agent names between call logs and policy tracker
export function fuzzyMatchAgent(callLogName, policyAgents) {
  if (!callLogName) return null;
  const clean = callLogName.trim().toLowerCase();
  const exact = policyAgents.find(a => a.toLowerCase() === clean);
  if (exact) return exact;
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastPart = parts.slice(1).join(' ');
    const match = policyAgents.find(a => {
      const aParts = a.toLowerCase().split(/\s+/);
      if (aParts.length < 2) return false;
      return aParts[0] === firstName && aParts[aParts.length - 1].startsWith(lastPart.charAt(0));
    });
    if (match) return match;
    const nicknames = {
      'bill': 'william', 'will': 'william', 'mike': 'michael',
      'bob': 'robert', 'rob': 'robert', 'jim': 'james',
      'tom': 'thomas', 'dick': 'richard', 'rick': 'richard',
      'dan': 'daniel', 'joe': 'joseph', 'tony': 'anthony',
    };
    const expandedFirst = nicknames[firstName] || firstName;
    const match2 = policyAgents.find(a => {
      const aParts = a.toLowerCase().split(/\s+/);
      if (aParts.length < 2) return false;
      return aParts[0] === expandedFirst && aParts[aParts.length - 1].startsWith(lastPart.charAt(0));
    });
    if (match2) return match2;
  }
  return callLogName.trim();
}

export function normalizeCampaign(rawCampaign) {
  if (!rawCampaign) return '';
  let c = rawCampaign.trim();
  c = c.replace(/\s*\([^)]*\)\s*/g, '').trim();
  c = c.replace(/\s+\d+$/, '').trim();
  return c;
}

export function parseFlexDate(raw) {
  if (!raw) return null;
  const dateOnly = raw.split(/\s+/)[0] || raw;
  const match = dateOnly.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  if (match) {
    const m = match[1], d = match[2], y = match[3];
    return y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
  }
  const iso = dateOnly.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + iso[2].padStart(2, '0') + '-' + iso[3].padStart(2, '0');
  return null;
}

export function normalizePlacedStatus(raw) {
  if (!raw) return 'Submitted - Pending';
  const lower = raw.toLowerCase().trim();
  if (!lower || lower === 'n/a' || lower === 'na') return 'Unknown';
  if (lower.includes('advance released') || lower.includes('advance')) return 'Advance Released';
  if (lower.includes('active') || lower.includes('in force')) return 'Active - In Force';
  if (lower.includes('declined') || lower.includes('denied')) return 'Declined';
  if (lower.includes('not paid') || lower.includes('not yet')) return 'Not Yet Paid';
  if (lower.includes('lapsed') || lower.includes('lapse')) return 'Lapsed';
  if (lower.includes('cancelled') || lower.includes('canceled')) return 'Cancelled';
  if (lower.includes('yes') || lower.includes('placed') || lower.includes('approved')) return 'Active - In Force';
  if (/^\d{1,2}\/\d{1,2}/.test(raw)) return 'Active - In Force';
  return 'Submitted - Pending';
}

export function parseDuration(raw) {
  if (!raw) return 0;
  const match = raw.match(/(\d+):(\d+):(\d+)/);
  if (match) return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
  return 0;
}

export function calcCommission(premium, carrier, product, age, commissionRates) {
  if (!commissionRates || !carrier || !product) return 0;
  const matches = commissionRates.filter(r => {
    const carrierMatch = carrier.toLowerCase().includes(r.carrier.toLowerCase()) ||
                          r.carrier.toLowerCase().includes(carrier.toLowerCase());
    const productMatch = product.toLowerCase().includes(r.product.toLowerCase()) ||
                          r.product.toLowerCase().includes(product.toLowerCase());
    return carrierMatch && productMatch;
  });
  if (matches.length === 0) return 0;
  if (age && matches.some(m => m.ageRange !== 'n/a')) {
    const ageMatch = matches.find(m => {
      if (m.ageRange === 'n/a') return false;
      const range = m.ageRange.match(/(\d+)\s*-\s*(\d+)/);
      if (range) return age >= parseInt(range[1]) && age <= parseInt(range[2]);
      return false;
    });
    if (ageMatch) return premium * ageMatch.commissionRate;
  }
  return premium * matches[0].commissionRate;
}
