const NICKNAMES = {
  'bill': 'william', 'will': 'william', 'mike': 'michael',
  'bob': 'robert', 'rob': 'robert', 'jim': 'james',
  'tom': 'thomas', 'dick': 'richard', 'rick': 'richard',
  'dan': 'daniel', 'joe': 'joseph', 'tony': 'anthony',
  'kari': 'karina',
};

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

// Fuzzy match agent names between call logs and policy tracker
export function fuzzyMatchAgent(callLogName, policyAgents) {
  if (!callLogName) return null;
  const clean = callLogName.trim().toLowerCase();
  const exact = policyAgents.find(a => a.toLowerCase() === clean);
  if (exact) return exact;
  const parts = clean.split(/\s+/);

  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastInitial = parts[parts.length - 1].charAt(0);
    const expandedFirst = NICKNAMES[firstName] || firstName;

    // Exact first name + last initial
    const m1 = policyAgents.find(a => {
      const ap = a.toLowerCase().split(/\s+/);
      return ap.length >= 2 && ap[0] === firstName && ap[ap.length - 1].startsWith(lastInitial);
    });
    if (m1) return m1;

    // Nickname expansion + last initial (Bill P → William Parks)
    const m2 = policyAgents.find(a => {
      const ap = a.toLowerCase().split(/\s+/);
      return ap.length >= 2 && ap[0] === expandedFirst && ap[ap.length - 1].startsWith(lastInitial);
    });
    if (m2) return m2;

    // Approximate first name (edit distance ≤ 1) + last initial — handles "Micheal P" → "Michael Parks"
    const m3 = policyAgents.find(a => {
      const ap = a.toLowerCase().split(/\s+/);
      return ap.length >= 2 && levenshtein(firstName, ap[0]) <= 1 && ap[ap.length - 1].startsWith(lastInitial);
    });
    if (m3) return m3;
  }

  // Single-word name: try first-name matching with nickname expansion
  // Only match if exactly one candidate to avoid false positives
  if (parts.length === 1) {
    const firstName = parts[0];
    const expandedFirst = NICKNAMES[firstName] || firstName;
    const candidates = policyAgents.filter(a => {
      const ap = a.toLowerCase().split(/\s+/);
      return ap[0] === firstName || ap[0] === expandedFirst;
    });
    if (candidates.length === 1) return candidates[0];

    // Approximate (typo tolerance) — only if uniquely resolved
    const approx = policyAgents.filter(a => {
      const ap = a.toLowerCase().split(/\s+/);
      return levenshtein(firstName, ap[0]) <= 1 || levenshtein(expandedFirst, ap[0]) <= 1;
    });
    if (approx.length === 1) return approx[0];
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
