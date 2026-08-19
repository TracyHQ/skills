// pixel-diff.mjs — the visual-regression gate: the SAME page, before and after a change.
//
// The geometry tiers answer "are the boxes sane?". They cannot answer "did anything move
// that nobody meant to move?" — and that is the question every CSS tweak, content edit and
// extension update actually raises. A rule that has to be written in advance cannot catch a
// regression nobody predicted; a picture of last week's page can.
//
// This compares two directories of screenshots by filename, which is exactly the shape
// `visual-qa` already writes (`_pricing-desktop.png`, `_home-mobile.png`, …). So the loop is:
//
//   visual-qa.sh --out out/visual          # renders today's pages
//   pixel-diff.sh --before out/baseline --after out/visual --out out/pixel
//   # look at out/pixel/diff-*.png, then, if the changes were intended:
//   pixel-diff.sh --before out/baseline --after out/visual --out out/pixel --accept yes
//
// A page missing from the AFTER side is a FAIL, not a skip: the commonest reason a
// screenshot stops existing is that the page stopped rendering.
//
// Usage:
//   node pixel-diff.mjs --before <dir> --after <dir> --out <dir> [--threshold 0.5] [--accept yes]
import fs from "node:fs";
import path from "node:path";
import { decodePNG, encodePNG, diffImages } from "./png.mjs";
import { parseArgs, judgePixelDiff, PIXEL_DIFF_THRESHOLD_PCT } from "./qa-judge.mjs";

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    defaults: { before: "", after: "", out: "", threshold: String(PIXEL_DIFF_THRESHOLD_PCT), accept: "" },
    required: ["before", "after", "out"],
  });
} catch (e) {
  console.error(`pixel-diff: ${e.message}`);
  console.error("usage: node pixel-diff.mjs --before <dir> --after <dir> --out <dir> [--threshold 0.5] [--accept yes]");
  process.exit(2);
}

const threshold = Number(args.threshold);
if (!Number.isFinite(threshold) || threshold < 0) {
  console.error(`pixel-diff: --threshold must be a non-negative number, got ${args.threshold}`);
  process.exit(2);
}

const shots = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png") && !f.startsWith("diff-")).sort() : null;

const beforeList = shots(args.before);
const afterList = shots(args.after);
if (beforeList === null) {
  // The first run has no baseline and that is not a failure — but it is also not a pass, and
  // saying "0 differences" would be a lie of the most convincing kind.
  console.error(`pixel-diff: no baseline at ${args.before}.`);
  console.error(`  This tier compares against a previous render. Take one first:`);
  console.error(`    cp ${args.after}/*.png ${args.before}/    # after you have looked at them`);
  process.exit(2);
}
if (afterList === null) {
  console.error(`pixel-diff: nothing to judge — ${args.after} does not exist. Run visual-qa first.`);
  process.exit(2);
}

fs.mkdirSync(args.out, { recursive: true });

const beforeSet = new Set(beforeList);
const afterSet = new Set(afterList);
const results = [];
let failed = 0;

for (const name of beforeList) {
  if (!afterSet.has(name)) {
    // Loud on purpose. A screenshot that used to exist and now does not almost always means
    // the page threw, timed out, or was dropped from the run — never "nothing changed".
    results.push({ name, ok: false, what: "page is missing from this run — it rendered last time" });
    failed++;
    continue;
  }
  let a, b;
  try {
    b = decodePNG(fs.readFileSync(path.join(args.before, name)));
    a = decodePNG(fs.readFileSync(path.join(args.after, name)));
  } catch (e) {
    results.push({ name, ok: false, what: `could not read the pair: ${e.message}` });
    failed++;
    continue;
  }

  const dimsChanged = b.width !== a.width || b.height !== a.height;
  let changed = 0, total = b.width * b.height;
  if (!dimsChanged) {
    const d = diffImages(b, a);
    changed = d.changed;
    total = d.total;
    fs.writeFileSync(path.join(args.out, `diff-${name}`), encodePNG(d.image));
  }
  const verdict = judgePixelDiff(
    { changed, total, dimsChanged, before: { width: b.width, height: b.height }, after: { width: a.width, height: a.height } },
    threshold
  );
  results.push({ name, ...verdict });
  if (!verdict.ok) failed++;
}

const added = afterList.filter((n) => !beforeSet.has(n));
for (const name of added) results.push({ name, ok: true, added: true, what: "new page — no baseline to compare against" });

fs.writeFileSync(
  path.join(args.out, "pixel-diff.json"),
  JSON.stringify(
    { before: args.before, after: args.after, threshold, generated: new Date().toISOString(), results },
    null, 1
  )
);

for (const r of results) {
  if (r.added) console.log(`info ${r.name}: ${r.what}`);
  else console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.what}`);
}
const compared = results.filter((r) => !r.added).length;
console.log(
  `pixel-diff: ${compared - failed}/${compared} pass, ${added.length} new` +
    ` (threshold ${threshold}%) -> ${path.join(args.out, "pixel-diff.json")}`
);
if (failed) console.log(`  look at ${args.out}/diff-*.png — red is what moved, grey is what did not`);

// --accept promotes the current render to the new baseline. It runs AFTER the report is
// printed and only when asked, so accepting is always a second, deliberate act: the failure
// list you are accepting is on screen when you do it.
if (args.accept === "yes") {
  for (const name of afterList) fs.copyFileSync(path.join(args.after, name), path.join(args.before, name));
  for (const name of beforeList) if (!afterSet.has(name)) fs.rmSync(path.join(args.before, name));
  console.log(`pixel-diff: baseline updated from ${args.after} (${afterList.length} images)`);
  process.exit(0);
}
process.exit(failed ? 1 : 0);
