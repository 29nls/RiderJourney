import fs from 'node:fs';
import path from 'node:path';

const OPEN = String.fromCharCode(0x201c);
const CLOSE = String.fromCharCode(0x201d);
const PRD = fs.readFileSync('PRD_RiderJourney.md', 'utf8').split(/\r?\n/);
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

let problems = 0;
let quotes = 0;
for (const [i, line] of lines.entries()) {
  let start = -1;
  const found = [];
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === OPEN) {
      if (start !== -1) problems += 1;
      start = j;
    } else if (ch === CLOSE) {
      if (start < 0) problems += 1;
      else { found.push({ quote: line.slice(start + 1, j), start }); start = -1; }
    }
  }
  if (start !== -1) problems += 1;
  for (const f of found) {
    quotes++;
    const at = PRD.findIndex((p) => p.includes(f.quote));
    const before = line.slice(Math.max(0, f.start - 40), f.start);
    const bpos = before.indexOf('PRD');
    const blabel = bpos === -1 ? '' : before.slice(bpos).replace(/[^A-Za-z0-9. ]/g, '');
    if (at < 0) {
      problems += 1;
      console.log(`MISS l.${i + 1} hit=${at} blabel=${blabel} :: ${f.quote}`);
    } else {
      console.log(`OK l.${i + 1} hit=${at} blabel=${blabel}`);
    }
  }

}
