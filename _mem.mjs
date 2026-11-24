import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const ROOT = process.cwd();
const DIR = path.join(ROOT, "_mem");
function out(p) {
  const q = path.resolve(ROOT, p);
  if (!q.startsWith(ROOT + path.sep)) throw new Error("outside workspace: " + p);
  return q;
}
function read(p) {
  const q = out(p);
  return fs.existsSync(q) ? fs.readFileSync(q, "utf8") : null;
}
const cmd = process.argv[2];
if (cmd === "save") {
  const p = process.argv[3];
  const buf = fs.readFileSync(0);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(out(p), buf);
  process.stdout.write(`saved ${p} ${buf.length}B sha ${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)}\n`);
  process.exit(0);
}
if (cmd === "show") {
  const p = process.argv[3];
  const a = process.argv[4];
  const b = process.argv[5];
  const s = read(p);
  if (s === null) { process.stdout.write("MISSING " + p + "\n"); process.exit(1); }
  const lines = s.split("\n");
  const from = a ? Math.max(1, parseInt(a, 10)) : 1;
  const to = b ? Math.min(lines.length, parseInt(b, 10)) : lines.length;
  const parts = [];
  for (let i = from; i <= to; i++) parts.push(`${i}: ${lines[i - 1]}`);
  process.stdout.write(parts.join("\n") + `\n[lines 1-${lines.length}, ${s.length}B]\n`);
  process.exit(0);
}
if (cmd === "list") {
  const s = read(process.argv[3]) || "";
  const re = /[^\n]*/g;
  let m, n = 0;
  const lines = s.split("\n");
  for (let i = 1; i <= lines.length; i++) {
    if (lines[i - 1].trim()) { process.stdout.write(`${i}: ${lines[i - 1]}\n`); n++; }
  }
  process.stdout.write(`[${n} non-empty of ${lines.length}]\n`);
  process.exit(0);
}
if (cmd === "copy") {
  const from = process.argv[3];
  const to = process.argv[4];
  fs.mkdirSync(path.dirname(out(to)), { recursive: true });
  fs.copyFileSync(out(from), out(to));
  process.stdout.write(`copied ${from} -> ${to}\n`);
  process.exit(0);
}
process.stderr.write("usage: _mem.mjs save|show|list|copy\n");
process.exit(1);
