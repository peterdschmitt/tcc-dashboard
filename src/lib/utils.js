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

  // Debug: log matching attempts for GIWL
  const isGIWLDebug = (carrier + ' ' + (product || '')).toLowerCase().includes('giwl');
  if (isGIWLDebug) {
    console.log(`[calcCommission] GIWL input: carrier="${carrier}" product="${product}" age=${age}`);
    console.log(`[calcCommission] GIWL carrier words:`, getWords(carrier));
    console.log(`[calcCommission] GIWL product words:`, getWords(product || ''));
    console.log(`[calcCommission] GIWL scored matches:`, scored.map(s => `${s.rate.carrier}/${s.rate.product} score=${s.score.toFixed(3)} cO=${s.cOverlap.toFixed(2)} pO=${s.pOverlap.toFixed(2)} ageOk=${s.ageOk}`));
  }

  if (scored.length === 0) return 0;

  // Prefer age-matched entries, then by score
  scored.sort((a, b) => {
    if (a.ageOk !== b.ageOk) return a.ageOk ? -1 : 1;
    return b.score - a.score;
  });

  const best = scored[0];
  if (isGIWLDebug) {
    console.log(`[calcCommission] GIWL best match: ${best.rate.carrier}/${best.rate.product} rate=${best.rate.commissionRate} result=${(premium * best.rate.commissionRate).toFixed(2)}`);
  }
  return premium * best.rate.commissionRate;
}

// ── Carrier → Sales sheet status mapping ──────────────────────────
// Maps carrier status values to the Placed? values the dashboard checks
// for placed economics: ['Advance Released', 'Active - In Force', 'Submitted - Pending']
export function mapCarrierStatusToPlaced(carrierStatus) {
  const s = (carrierStatus || '').trim().toLowerCase();
  if (s === 'active')      return 'Active - In Force';
  if (s === 'pending')     return 'Submitted - Pending';
  if (s === 'reinstated')  return 'Active - In Force';
  if (['canceled', 'cancelled', 'terminated', 'lapsed'].includes(s)) return 'Declined';
  if (['declined', 'not taken', 'rejected'].includes(s)) return 'Declined';
  return 'Submitted - Pending'; // safe default
}

// ── Fuzzy match carrier record to Sales sheet row ──────────────────
// Three-tier matching: policy number → name+agent → null
export function fuzzyMatchPolicyholder(carrierRecord, salesRows) {
  const crPolicyNo = (carrierRecord['Policy No.'] || '').trim();
  const crInsured = (carrierRecord['Insured'] || '').trim();
  const crAgent = (carrierRecord['Agent'] || '').trim();

  // Tier 1: Exact policy number match
  if (crPolicyNo) {
    const pnMatch = salesRows.find(r => (r['Policy #'] || '').trim() === crPolicyNo);
    if (pnMatch) return { row: pnMatch, matchType: 'policy_number', confidence: 1.0 };
  }

  // Tier 2: Name + Agent fuzzy match
  if (!crInsured) return null;

  // Parse carrier "Last,First" or "First Last" format
  let crFirst = '', crLast = '';
  if (crInsured.includes(',')) {
    const parts = crInsured.split(',').map(s => s.trim());
    crLast = parts[0].toLowerCase();
    crFirst = (parts[1] || '').split(/\s+/)[0].toLowerCase();
  } else {
    const parts = crInsured.toLowerCase().split(/\s+/);
    crFirst = parts[0] || '';
    crLast = parts[parts.length - 1] || '';
  }

  const crAgentLower = crAgent.toLowerCase();
  const crAgentFirst = crAgentLower.split(/\s+/)[0] || '';
  const crAgentExpanded = NICKNAMES[crAgentFirst] || crAgentFirst;

  const candidates = [];

  for (const sr of salesRows) {
    const sFirst = (sr['First Name'] || '').trim().toLowerCase();
    const sLast = (sr['Last Name'] || '').trim().toLowerCase();
    const sAgent = (sr['Agent'] || '').trim().toLowerCase();

    if (!sLast || !sFirst) continue;

    // Last name must match (exact or edit distance ≤ 1)
    const lastExact = sLast === crLast;
    const lastClose = !lastExact && levenshtein(sLast, crLast) <= 1;
    if (!lastExact && !lastClose) continue;

    // First name match (exact, starts-with, nickname, or edit distance)
    const firstExact = sFirst === crFirst;
    const firstStartsWith = crFirst.length >= 3 && (sFirst.startsWith(crFirst) || crFirst.startsWith(sFirst));
    const expandedFirst = NICKNAMES[crFirst] || crFirst;
    const firstNickname = sFirst === expandedFirst || (NICKNAMES[sFirst] || sFirst) === expandedFirst;
    const firstClose = !firstExact && levenshtein(sFirst, crFirst) <= 1;
    if (!firstExact && !firstStartsWith && !firstNickname && !firstClose) continue;

    // Agent match (optional but boosts confidence)
    const sAgentFirst = sAgent.split(/\s+/)[0] || '';
    const sAgentExpanded = NICKNAMES[sAgentFirst] || sAgentFirst;
    const agentMatch = sAgent === crAgentLower ||
      sAgentFirst === crAgentFirst ||
      sAgentFirst === crAgentExpanded ||
      sAgentExpanded === crAgentExpanded;

    // Score
    let score = 0;
    score += lastExact ? 40 : 25;
    score += firstExact ? 30 : firstNickname ? 25 : firstStartsWith ? 20 : 15;
    score += agentMatch ? 20 : 0;

    candidates.push({ row: sr, score, agentMatch });
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, pick best
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const confidence = best.score / 90; // max possible = 90

  // Require minimum confidence
  if (confidence < 0.55) return null;

  return {
    row: best.row,
    matchType: 'name_agent',
    confidence: Math.min(confidence, 1.0),
    agentMatch: best.agentMatch,
  };
}
