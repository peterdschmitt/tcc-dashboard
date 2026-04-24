// Detect and extract markdown tables from a string, preserving byte-exact content.
// A "table" is a line starting with `|`, followed immediately by a separator
// line (e.g., |---|---|), followed by one or more data rows starting with `|`.

const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

function lineStartsTableRow(line) {
  return line.trim().startsWith('|');
}

function findTitleBackFrom(lines, start) {
  // Walk backwards up to 5 non-empty lines looking for a plausible title.
  // Accepts: markdown heading (# / ##), bold (**...**), or a short capitalized
  // standalone line. Stops at the first non-empty, non-title line.
  let stepsBack = 0;
  for (let i = start - 1; i >= 0 && stepsBack < 5; i--) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    stepsBack++;

    const mdMatch = t.match(/^#{1,4}\s+(.+)$/);
    if (mdMatch) return mdMatch[1].trim();

    const boldMatch = t.match(/^\*\*(.+?)\*\*$/);
    if (boldMatch) return boldMatch[1].trim();

    if (t.length < 120 && /^[A-Z(]/.test(t) && !t.includes('|') && !t.endsWith('.')) {
      return t.replace(/[:.]+$/, '').trim();
    }
    // First non-empty, non-title line → stop searching.
    return null;
  }
  return null;
}

export function extractMarkdownTables(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];
  const lines = markdown.split('\n');
  const tables = [];
  let i = 0;

  while (i < lines.length) {
    if (!lineStartsTableRow(lines[i])) {
      i++;
      continue;
    }
    const sepIdx = i + 1;
    if (sepIdx >= lines.length || !SEP_RE.test(lines[sepIdx])) {
      i++;
      continue;
    }

    let end = sepIdx + 1;
    while (end < lines.length && lineStartsTableRow(lines[end])) end++;

    if (end - sepIdx < 2) {
      i++;
      continue;
    }

    const title = findTitleBackFrom(lines, i);
    const tableMarkdown = lines.slice(i, end).join('\n');
    tables.push({ title, markdown: tableMarkdown });
    i = end;
  }

  return tables;
}
