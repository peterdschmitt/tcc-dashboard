import { extractMarkdownTables } from '../src/lib/extract-markdown-tables.js';

const sample = `# Sample Report

Some prose here.

## Campaign Performance

| Campaign | Calls | Sales |
|---|---:|---:|
| HIW | 45 | 3 |
| HT FEX | 2 | 0 |

More prose.

Disposition Distribution (campaign-level)

| Disposition | Count | % |
|---|---:|---:|
| Sale | 3 | 6.67% |
| Quote Only | 9 | 20.00% |
| Bad Transfer | 9 | 20.00% |

Final prose paragraph.
`;

const tables = extractMarkdownTables(sample);
console.log(JSON.stringify(tables, null, 2));

if (tables.length !== 2) {
  console.error(`FAIL — expected 2 tables, got ${tables.length}`);
  process.exit(1);
}
if (!tables[0].markdown.includes('| HIW | 45 | 3 |')) {
  console.error('FAIL — first table missing HIW row verbatim');
  process.exit(1);
}
if (!tables[1].markdown.includes('| Bad Transfer | 9 | 20.00% |')) {
  console.error('FAIL — second table missing Bad Transfer row verbatim');
  process.exit(1);
}
if (tables[0].title !== 'Campaign Performance') {
  console.error(`FAIL — first table title expected "Campaign Performance", got "${tables[0].title}"`);
  process.exit(1);
}
if (tables[1].title !== 'Disposition Distribution (campaign-level)') {
  console.error(`FAIL — second table title expected "Disposition Distribution (campaign-level)", got "${tables[1].title}"`);
  process.exit(1);
}
console.log('PASS');
