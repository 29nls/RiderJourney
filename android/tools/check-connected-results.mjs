// Strict gate for connected (instrumented) Android tests.
//
// connectedDebugAndroidTest exits 0 when no device is attached, and an XML with
// zero <testcase> elements is indistinguishable from "all good" to a naive
// reader. This gate reads the JUnit XML, compares it with an explicit manifest
// of mandatory tests, and fails unless every mandatory test actually ran and
// passed. It also checks the manifest against the checked-in sources so the
// list cannot drift from the tests that exist.
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const resultsDir = arg("results", "android/app/build/outputs/androidTest-results/connected");
const manifestPath = arg("manifest", "android/tools/required-connected-tests.txt");
const sourcesDir = arg("sources", "android/app/src/androidTest");
const apiLevel = arg("api", "unknown");
const boot = arg("boot", "unknown");
const summaryPath = arg("summary", "");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

// ---- manifest -------------------------------------------------------------
if (!fs.existsSync(manifestPath)) fail(`manifest ${manifestPath} is missing`);
const manifest = fs
  .readFileSync(manifestPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (manifest.length === 0) fail(`${manifestPath} lists no mandatory tests`);

for (const id of manifest) {
  const [cls, method] = id.split("#");
  if (!cls || !method) fail(`manifest entry "${id}" is not Class#method`);
  const simple = cls.split(".").pop();
  const files = fs.globSync(`**/${simple}.kt`, { cwd: sourcesDir });
  if (files.length === 0) fail(`manifest entry ${id} has no ${simple}.kt under ${sourcesDir}`);
  const source = files.map((f) => fs.readFileSync(path.join(sourcesDir, f), "utf8")).join("\n");
  if (!new RegExp(`fun\\s+${method}\\s*\\(`).test(source)) {
    fail(`manifest entry ${id} has no @Test fun ${method}() in ${simple}.kt`);
  }
}

// ---- reports --------------------------------------------------------------
if (!fs.existsSync(resultsDir)) {
  fail(`${resultsDir} does not exist; connectedDebugAndroidTest reported nothing`);
}
// Gradle nests the report under a device/ABI directory ({connected}/debug), so
// the glob has to recurse or a perfectly good run looks like an empty one.
const xmlFiles = fs.globSync("**/*.xml", { cwd: resultsDir }).map((p) => path.join(resultsDir, p));
if (xmlFiles.length === 0) fail(`no XML report under ${resultsDir}`);

/** id -> "passed" | "failed" | "error" | "skipped" */
const executed = new Map();
for (const file of xmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of text.matchAll(re)) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const name = (attrs.match(/\bname="([^"]*)"/) || [])[1];
    const cls = (attrs.match(/\bclassname="([^"]*)"/) || [])[1];
    if (!name || !cls) continue;
    const status = /<skipped\b/.test(body)
      ? "skipped"
      : /<failure\b/.test(body)
        ? "failed"
        : /<error\b/.test(body)
          ? "error"
          : "passed";
    // A test may appear twice when a retry runs; worst status wins.
    const previous = executed.get(`${cls}#${name}`);
    if (previous && previous !== "passed") continue;
    executed.set(`${cls}#${name}`, status);
  }
}

if (executed.size === 0) {
  fail(`0 test cases in ${resultsDir}; the emulator ran nothing`);
}

const missing = manifest.filter((id) => !executed.has(id));
const bad = manifest.filter((id) => executed.has(id) && executed.get(id) !== "passed");
const counts = { passed: 0, failed: 0, error: 0, skipped: 0 };
for (const status of executed.values()) counts[status] += 1;

const classesPresent = [...new Set([...executed.keys()].map((id) => id.split("#")[0]))].sort();
for (const id of manifest) {
  const status = executed.get(id) ?? "MISSING";
  console.log(`${status === "passed" ? "PASS" : "FAIL"} ${id} (${status})`);
}
console.log(
  `api=${apiLevel} boot=${boot} executed=${executed.size} passed=${counts.passed} ` +
    `failed=${counts.failed} errors=${counts.error} skipped=${counts.skipped} ` +
    `mandatory=${manifest.length} missing=${missing.length}`,
);

const summary = {
  apiLevel,
  emulatorBoot: boot,
  resultsDir,
  xmlFiles: xmlFiles.length,
  executedTotal: executed.size,
  passed: counts.passed,
  failed: counts.failed,
  errors: counts.error,
  skipped: counts.skipped,
  classes: classesPresent,
  mandatory: {
    total: manifest.length,
    missing,
    notPassed: bad.map((id) => `${id}:${executed.get(id)}`),
  },
  status: missing.length === 0 && bad.length === 0 && counts.failed === 0 && counts.error === 0 ? "PASS" : "FAIL",
};
if (summaryPath) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(`${summaryPath}.md`, renderMarkdown(summary));
}

function renderMarkdown(s) {
  const rows = [
    `| API level | ${s.apiLevel} |`,
    `| Emulator boot | ${s.emulatorBoot} |`,
    `| XML reports | ${s.xmlFiles} |`,
    `| Executed | ${s.executedTotal} |`,
    `| Passed | ${s.passed} |`,
    `| Failed | ${s.failed} |`,
    `| Errors | ${s.errors} |`,
    `| Skipped | ${s.skipped} |`,
    `| Mandatory tests | ${s.mandatory.total} |`,
    `| Missing mandatory | ${s.mandatory.missing.length ? s.mandatory.missing.join(", ") : "none"} |`,
    `| Mandatory not passed | ${s.mandatory.notPassed.length ? s.mandatory.notPassed.join(", ") : "none"} |`,
    `| Status | **${s.status}** |`,
  ];
  return `## Connected test summary (API ${s.apiLevel})\n\n| Field | Value |\n| --- | --- |\n${rows.join("\n")}\n`;
}

if (missing.length > 0) fail(`mandatory tests did not run: ${missing.join(", ")}`);
if (bad.length > 0) fail(`mandatory tests did not pass: ${bad.map((id) => `${id}:${executed.get(id)}`).join(", ")}`);
if (counts.failed > 0 || counts.error > 0) fail(`${counts.failed} failed and ${counts.error} errored test cases`);
