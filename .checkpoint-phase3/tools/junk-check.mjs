import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'migrations', '../android/app/src/main', '../docs'];
const SKIP = new Set(['node_modules', 'dist', '.gradle', 'build', '.git']);
const EXT = ['.ts', '.kt', '.kts', '.sql', '.md', '.json', '.mjs', '.xml', '.gradle'];
const NON_LATIN = /[\u0080-\u024f\u0370-\u03ff\u0400-\u052f\u0590-\u06ff\u0900-\u0dff\u0e00-\u0fff\u1e00-\u1fff\u2c60-\u2c7f\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;
const WORDS = ['Pearce', 'bleach', 'watermark', 'ownized', 'serializefield', 'estim', 'prompt', 'ashed', 'ubl', 'firstName', 'markedet'];

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
    const hit = NON_LATIN.test(line) || WORDS.some((word) => line.includes(word));
    if (!hit) return;
    found += 1;
    console.log(relative(process.cwd(), file) + ':' + (index + 1) + ': ' + line.trim().slice(0, 160));
  });
}
console.log('junk-check: ' + found + ' suspect line(s) in ' + files.length + ' file(s)');
process.exit(0);
