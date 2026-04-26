// src/lib/ghl/levenshtein.js
/**
 * Case-insensitive Levenshtein edit distance.
 * Returns the minimum number of single-character edits (insertions,
 * deletions, substitutions) required to change `a` into `b`.
 * undefined/null inputs are treated as empty strings.
 */
export function levenshtein(a, b) {
  const s = (a ?? '').toLowerCase();
  const t = (b ?? '').toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = new Array(t.length + 1);
  const curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return prev[t.length];
}
