import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'migrations', '../android/app/src/main'];
const SKIP = new Set(['node_modules', 'dist', '.gradle', 'build', '.git']);
const EXT = ['.ts', '.kt', '.kts', '.sql', '.md', '.mjs', '.xml', '.gradle', '.json'];

// Ranges that should never appear in source we author: accented Latin beyond
// Western European names is fine, but Cyrillic, Arabic, Devanagari, Thai text,
// CJK, fullwidth forms, and Hangul are all signs of a corrupted write.
const SUSPECT = [
  [0x0370, 0x052f],
  [0x0590, 0x06ff],
  [0x0900, 0x0fff],
  [0x1e00, 0x1fff],
  [0x3000, 0x303f],
  [0x3040, 0x9fff],
  [0xac00, 0xd7af],
  [0xff00, 0xffef],
];
const WORDS = ['Pearce', 'serializefield', 'ownized', 'estim', 'markedet'];

function suspect(line) {
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) continue;
    if (SUSPECT.some(([from, to]) => code >= from && code <= to)) return char;
  }
  return WORDS.find((word) => line.includes(word)) ?? null;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) await walk(path, out);
    } else if (EXT.some((ext) => entry.name.endsWith(ext)) && entry.name !== 'junk-check.mjs') {
      out.push(path);
    }
  }
}

const files = [];
for (const root of ROOTS) await walk(root, files);
let found = 0;
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    const hit = suspect(line);
    if (hit === null) return;
    found += 1;
    console.log(relative(process.cwd(), file) + ':' + (index + 1) + ': [' + hit + '] ' + line.trim().slice(0, 150));
  });
}
console.log('junk-check: ' + found + ' suspect line(s) in ' + files.length + ' file(s)');
process.exit(found === 0 ? 0 : 1);
