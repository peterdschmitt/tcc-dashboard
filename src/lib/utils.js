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
  if (!commissionRates || !carrier) return 0;
  const NOISE = new Set(['the','a','an','of','and','or','for','-','–','life','insurance','final','expense']);
  function getWords(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !NOISE.has(w)); }
  function wordOverlap(a, b) {
    const wa = getWords(a), wb = getWords(b);
    if (wa.length === 0 || wb.length === 0) return 0;
    const shared = wa.filter(w => wb.includes(w)).length;
    return shared / Math.min(wa.length, wb.length);
  }

  const policyHasGraded = (product || '').toLowerCase().includes('graded');
  const policyHasRop = (product || '').toLowerCase().includes('rop');
  const carrierWords = getWords(carrier);

  // Score each commission rate entry
  const scored = commissionRates.map(r => {
    // Carrier match: word overlap
    const cOverlap = wordOverlap(carrier, r.carrier);
    if (cOverlap < 0.4) return null; // must share significant carrier words

    // Product match: word overlap between policy product and commission product
    const pOverlap = wordOverlap(product || '', r.product);

    // Bonus: if graded/rop alignment
    const commHasGraded = r.product.toLowerCase().includes('graded');
    const commHasRop = r.product.toLowerCase().includes('rop');
    const commHasImmediate = r.product.toLowerCase().includes('immediate') || r.product.toLowerCase().includes('standard');
    let typeBonus = 0;
    if (policyHasGraded && commHasGraded) typeBonus = 0.3;
    else if (policyHasRop && commHasRop) typeBonus = 0.3;
    else if (!policyHasGraded && !policyHasRop && commHasImmediate) typeBonus = 0.2;
    else if (!policyHasGraded && !policyHasRop && !commHasGraded && !commHasRop) typeBonus = 0.1;
    // Penalty if type mismatch
    if (policyHasGraded && !commHasGraded) typeBonus = -0.5;
    if (!policyHasGraded && !policyHasRop && commHasGraded) typeBonus = -0.3;

    const score = cOverlap * 0.4 + pOverlap * 0.4 + typeBonus * 0.2;

    // Age match
    let ageOk = true;
    if (age && r.ageRange !== 'n/a') {
      const range = r.ageRange.match(/(\d+)\s*-\s*(\d+)/);
      if (range) ageOk = age >= parseInt(range[1]) && age <= parseInt(range[2]);
      else ageOk = false;
    }

    return { rate: r, score, ageOk, cOverlap, pOverlap };
  }).filter(Boolean).filter(s => s.score > 0.15);

  if (scored.length === 0) return 0;

  // Prefer age-matched entries, then by score
  scored.sort((a, b) => {
    if (a.ageOk !== b.ageOk) return a.ageOk ? -1 : 1;
    return b.score - a.score;
  });

  const best = scored[0];
  return premium * best.rate.commissionRate;
}
