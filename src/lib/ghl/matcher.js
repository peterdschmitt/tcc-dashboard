// src/lib/ghl/matcher.js
/**
 * Tiered matching ladder. Returns { tier: 1|2|3, contact: object|null }.
 * @param row Call Log row
 * @param deps.searchByPhone async fn(phone) -> contact|null
 * @param deps.searchByNameAndState async fn(first, last, state) -> contact|null
 */
export async function matchContact(row, { searchByPhone, searchByNameAndState }) {
  const phone = (row['Phone'] ?? '').trim();
  const first = (row['First'] ?? '').trim();
  const last  = (row['Last']  ?? '').trim();
  const state = (row['State'] ?? '').trim();

  if (phone) {
    const t1 = await searchByPhone(phone);
    if (t1) return { tier: 1, contact: t1 };
  }

  if (first && last && state) {
    const t2 = await searchByNameAndState(first, last, state);
    if (t2) return { tier: 2, contact: t2 };
  }

  return { tier: 3, contact: null };
}
