import fs from 'node:fs';

const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');

// Straight ASCII quotes become curly pairs, alternating open/close.
let open = true;
s = [...s]
  .map((ch) => {
    if (ch !== '"') return ch;
    const out = open ? '\u201C' : '\u201D';
    open = !open;
    return out;
  })
  .join('');
if (!open) {
  console.log('quote count is odd, refusing');
  process.exit(1);
}

s = s.replace(/PRD 2\.2_gray/g, 'PRD 2.2');
s = s.replace(/range tiga tingkat \(§5\.5\)/g, 'tiga tingkat (PRD 5.5)');
fs.writeFileSync(file, s);
console.log(`rewritten, ${s.length} bytes`);
