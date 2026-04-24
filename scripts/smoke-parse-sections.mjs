import { parseSections } from '../src/lib/parse-sections.js';

const input = `# Section One

Some content.

## Section Two

More.

**BOLD HEADING**

Content.

3) Numbered Section

Stuff.`;

const out = parseSections(input);
console.log(JSON.stringify(out, null, 2));

const titles = out.map(s => s.title);
const expected = ['Section One', 'Section Two', 'BOLD HEADING', 'Numbered Section'];
const ok = expected.every(t => titles.includes(t));
if (!ok) {
  console.error('FAIL — missing titles. Got:', titles);
  process.exit(1);
}
console.log('PASS');
