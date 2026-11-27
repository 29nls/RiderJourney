// Gradle's connectedDebugAndroidTest exits 0 when no device is attached and
// nothing runs, so the report itself has to prove an executed, clean suite.
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? "android/app/build/outputs/androidTest-results/connected";

if (!fs.existsSync(root)) {
  console.error(`::error::${root} does not exist; connectedDebugAndroidTest reported nothing`);
  process.exit(1);
}
// ponytail: non-recursive glob, drop the pattern once nested report dirs appear
const xmlFiles = fs.globSync("*.xml", { cwd: root }).map((p) => path.join(root, p));
// runner writes the plain-text skeleton with an empty result dir when it finds no device
if (xmlFiles.length === 0) {
  console.error(`::error::no XML report under ${root}`);
  process.exit(1);
}

// Gradle writes one <testsuite> per test class per device, so counting
// <testcase> elements beats summing the testsuite attributes.
const cases = [];
for (const file of xmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  const suite = (text.match(/<testsuite\b[^>]*\sname="([^"]*)"/) || [])[1] ?? path.basename(file);
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of text.matchAll(re)) {
    const attrs = m[1];
    const name = (attrs.match(/\bname="([^"]*)"/) || [])[1] ?? "(unnamed)";
    const cls = (attrs.match(/\bclassname="([^"]*)"/) || [])[1] ?? suite;
    const body = m[2] ?? "";
    cases.push({
      id: `${cls}.${name}`,
      failed: /<(failure|error)\b/.test(body),
    });
  }
}

if (cases.length < 1) {
  console.error(`::error::0 test cases in the connected report under ${root}; the emulator ran nothing`);
  process.exit(1);
}

const failed = cases.filter((c) => c.failed);
for (const c of cases) console.log(`${c.failed ? "FAIL" : "PASS"} ${c.id}`);
console.log(`${cases.length} executed cases, ${failed.length} failures+errors`);

if (failed.length > 0) {
  console.error(`::error::${failed.length} of ${cases.length} connected test cases failed`);
  process.exit(1);
}
