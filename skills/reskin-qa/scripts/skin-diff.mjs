// skin-diff.mjs — the eyes tier, made into a tool.
//
// Both QA skills used to end with "then finish with your own eyes on the screenshots". That
// step has no command, no artifact and no exit code, so in practice it is the step that gets
// skipped — while trap 28 says plainly that the agent's eye on a full-page screenshot is the
// ONLY thing that has ever caught "arranged validly but wrong": a block still wearing demo
// content, a logo dwarfing its column, a teaser whose copy never got replaced.
//
// This gives that step something to run. Two halves:
//
//   MACHINE  the parts of a dressing that content cannot legitimately change — the demo's
//            palette, its typeface, the container bands its layout is built on. A page that
//            lost its stylesheet, fell back to a default serif, or lost its wrapper fails
//            here, and those are the failures a geometry gate passes with a clean sheet.
//
//   EYES     a contact sheet per viewport: the demo on the left, the dressed page on the
//            right, at the same width, in one image. Looking at twenty-one separate PNGs is
//            what nobody does; looking at one paired image is what people actually do.
//
// Two runs, same shape as the responsive tier:
//   1. --mode reference --host <DEMO host>   --port <demo port>   --pages "/,/features"
//   2. --mode compare   --host <CLIENT host> --port <client port> --pages "/,/what-we-do" [--variant slug]
//
// Pages pair BY POSITION in the two --pages lists, because only the mapping knows that the
// demo's /features became /what-we-do. Every pair is printed.
//
// Usage: node skin-diff.mjs --host <h> --port <n> --out <dir> --pages "/a,/b" \
//                           --mode reference|compare [--variant <slug>] [--sheet on|off]
import { chromium } from "playwright";
import fs from "node:fs";
import { judgeSkin, pairPages } from "./skin-judge.mjs";

// png.mjs lives with design-qa, whose rendering engine this skill already depends on. The
// container mounts it at QA_LIB; outside a container the sibling checkout is the default.
const LIB = process.env.QA_LIB || new URL("../../design-qa/scripts/", import.meta.url).href;
const { decodePNG, encodePNG } = await import(new URL("png.mjs", LIB).href);
const { parseArgs, splitList, VIEWPORTS } = await import(new URL("qa-judge.mjs", LIB).href);

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    defaults: { host: "", port: "", out: "", pages: "", mode: "", variant: "", sheet: "on" },
    required: ["host", "port", "out", "pages", "mode"],
  });
} catch (e) {
  console.error(`skin-diff: ${e.message}`);
  process.exit(2);
}
if (!["reference", "compare"].includes(args.mode)) {
  console.error(`skin-diff: --mode must be reference or compare, got ${args.mode}`);
  process.exit(2);
}

const { host, port, out: outDir, variant, mode } = args;
const paths = splitList(args.pages);
const wantSheet = args.sheet !== "off";
// Desktop and mobile only. The skin question — palette, type, container bands — is answered
// at the two widths that differ in kind; laptop and tablet add renders and no new answer.
const viewports = [VIEWPORTS.desktop, VIEWPORTS.mobile];
const refPath = `${outDir}/skin-reference.json`;
const shotDir = `${outDir}/${mode === "reference" ? "demo" : "dressed"}`;
fs.mkdirSync(shotDir, { recursive: true });

let reference = null;
if (mode === "compare") {
  if (!fs.existsSync(refPath)) {
    console.error(`skin-diff: no skin reference at ${refPath} — run --mode reference against the DEMO first`);
    process.exit(2);
  }
  reference = JSON.parse(fs.readFileSync(refPath, "utf8"));
  if (reference.meta?.host === host) {
    console.error(
      `skin-diff: the reference was recorded against ${host}, the host being judged — ` +
      `comparing a site to itself always passes. Re-record it against the DEMO.`
    );
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// In-page measurement
// ---------------------------------------------------------------------------

function skinSignatureInPage() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const parseRGB = (str) => {
    const m = String(str).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (alpha < 0.5) return null; // barely-there overlays are not the page's colour
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  };

  // Palette weighted by PAINTED AREA, not by how many rules mention a colour: a brand accent
  // used on one button is not the page's colour, and a stylesheet declaring forty unused
  // shades should not outvote the background actually on screen.
  const area = new Map();
  const bump = (rgb, px) => {
    if (!rgb || !isFinite(px) || px <= 0) return;
    // 8-level quantisation per channel: a gradient painting 200 near-identical greys is one
    // colour to an eye and would otherwise flood the top of the palette.
    const key = rgb.map((n) => Math.round(n / 32) * 32).join(",");
    area.set(key, (area.get(key) || 0) + px);
  };
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const px = Math.max(0, Math.min(r.width, vw)) * Math.max(0, r.height);
    bump(parseRGB(s.backgroundColor), px);
    // Text is counted by its line box, not its element box: a paragraph inside a full-width
    // section does not paint that section's area in its own colour.
    const t = (el.textContent || "").trim();
    if (t.length > 2 && el.children.length === 0)
      bump(parseRGB(s.color), Math.min(r.width, vw) * parseFloat(s.fontSize || "16"));
  }
  const total = [...area.values()].reduce((a, b) => a + b, 0) || 1;
  const palette = [...area.entries()]
    .map(([k, v]) => ({ rgb: k.split(",").map(Number), share: v / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 8);

  // The body typeface, taken from the most-painted text rather than from <body>'s computed
  // style: a template that sets its font on an inner wrapper is common, and body often still
  // says the browser default.
  const fonts = new Map();
  let bodyPx = 0, bodyWeight = 0;
  for (const el of document.querySelectorAll("p, li, td, span, div")) {
    if (!visible(el) || el.children.length) continue;
    const t = (el.textContent || "").trim();
    if (t.length < 20) continue;
    const s = getComputedStyle(el);
    const w = t.length;
    const fam = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    fonts.set(fam, (fonts.get(fam) || 0) + w);
    bodyPx += parseFloat(s.fontSize || "16") * w;
    bodyWeight += w;
  }
  const fontFamily = [...fonts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const bodySize = bodyWeight ? bodyPx / bodyWeight : null;
  const h1 = [...document.querySelectorAll("h1, h2")].filter(visible)[0];
  const headingSize = h1 ? parseFloat(getComputedStyle(h1).fontSize) : null;
  const headingRatio = headingSize && bodySize ? Math.round((headingSize / bodySize) * 100) / 100 : null;

  // Container bands: the widths the template's own sections are laid out on, as a percentage
  // of the viewport, rounded to 2%. A page that kept its wrapper reports something like
  // [65, 100]; a page that lost it reports [100] alone.
  const bandSet = new Set();
  for (const el of document.querySelectorAll("section, .t4-section, [class*='acm-'], main > *")) {
    if (!visible(el)) continue;
    const inner = [...el.children].filter(visible);
    for (const kid of inner.length ? inner : [el]) {
      const r = kid.getBoundingClientRect();
      if (r.width < vw * 0.2) continue; // a sidebar is not a container band
      bandSet.add(Math.round((r.width / vw) * 50) * 2);
    }
  }

  return { palette, fontFamily, bodySize, headingRatio, bands: [...bandSet].sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------
// Contact sheet
// ---------------------------------------------------------------------------

// A full-page screenshot of a long landing page can run past 10,000px; two of them side by
// side is a picture nothing opens comfortably. Cropping is honest as long as the run SAYS it
// cropped — silently truncating is how a contact sheet stops showing the footer, which is
// where the first real miss happened.
const SHEET_MAX_HEIGHT = 9000;

/** Place two RGBA images side by side on white, no resampling — both are already the same width. */
function contactSheet(left, right, gap = 24) {
  const height = Math.min(Math.max(left.height, right.height), SHEET_MAX_HEIGHT);
  const width = left.width + gap + right.width;
  const data = Buffer.alloc(width * height * 4, 0xff);
  const blit = (img, xOff) => {
    const rows = Math.min(img.height, height);
    for (let y = 0; y < rows; y++) {
      const src = y * img.width * 4;
      const dst = (y * width + xOff) * 4;
      img.data.copy(data, dst, src, src + img.width * 4);
    }
  };
  blit(left, 0);
  blit(right, left.width + gap);
  return { image: { width, height, data }, cropped: Math.max(left.height, right.height) > height };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--host-resolver-rules=MAP ${host} 127.0.0.1`],
});
const headers = { "X-Forwarded-Proto": "https" };
if (variant) headers["X-Tracy-Variant"] = variant;
const context = await browser.newContext({ extraHTTPHeaders: headers });

const slugOf = (p, vp) => (p.replaceAll("/", "_") || "_home") + "-" + vp;
const collected = { pages: {}, meta: {} };
const errors = [];

for (const path of paths) {
  for (const vp of viewports) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      await page.goto(`http://${host}:${port}${path}`, { waitUntil: "load", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 1200 }).catch(() => {});
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
      await page.waitForTimeout(150);
      collected.pages[`${path}|${vp.name}`] = await page.evaluate(skinSignatureInPage);
      if (wantSheet)
        await page.screenshot({ path: `${shotDir}/${slugOf(path, vp.name)}.png`, fullPage: true });
    } catch (e) {
      errors.push({ path, viewport: vp.name, what: String(e).slice(0, 140) });
    } finally {
      await page.close();
    }
  }
}
await context.close();
await browser.close();

if (mode === "reference") {
  collected.meta = { host, generated: new Date().toISOString(), paths, viewports: viewports.map((v) => v.name) };
  fs.writeFileSync(refPath, JSON.stringify(collected, null, 1));
  for (const e of errors) console.log(`WARN  ${e.path} [${e.viewport}] ${e.what}`);
  console.log(
    `skin-diff: reference written from ${host} — ${paths.length} page(s) × ${viewports.length} viewports -> ${refPath}` +
    (wantSheet ? `\n  demo screenshots -> ${shotDir}/` : "")
  );
  process.exit(errors.length ? 1 : 0);
}

// ---- compare ----
const { pairs, unpaired } = pairPages(reference.meta?.paths || [], paths);
console.log("skin-diff: pages paired by position —");
for (const p of pairs) console.log(`  demo ${p.ref}  ↔  dressed ${p.own}`);
for (const u of unpaired) console.log(`  UNPAIRED (${u.side}) ${u.path} — no counterpart in the other list`);

const findings = [...errors.map((e) => ({ ...e, level: "FAIL" }))];
const sheets = [];
for (const pair of pairs) {
  for (const vp of viewports) {
    const ref = reference.pages[`${pair.ref}|${vp.name}`];
    const sig = collected.pages[`${pair.own}|${vp.name}`];
    if (!ref || !sig) continue;
    findings.push(...judgeSkin({ sig, ref, viewport: vp.name, path: pair.own }));

    if (!wantSheet) continue;
    const a = `${outDir}/demo/${slugOf(pair.ref, vp.name)}.png`;
    const b = `${shotDir}/${slugOf(pair.own, vp.name)}.png`;
    if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
    try {
      const sheet = contactSheet(decodePNG(fs.readFileSync(a)), decodePNG(fs.readFileSync(b)));
      const name = `sheet-${slugOf(pair.own, vp.name)}.png`;
      fs.writeFileSync(`${outDir}/${name}`, encodePNG(sheet.image));
      sheets.push({ name, cropped: sheet.cropped });
    } catch (e) {
      findings.push({ path: pair.own, viewport: vp.name, level: "warn", what: `contact sheet failed: ${e.message}` });
    }
  }
}

fs.writeFileSync(
  `${outDir}/skin-diff.json`,
  JSON.stringify({ host, variant: variant || null, reference: reference.meta?.host || null, generated: new Date().toISOString(), pairs, unpaired, findings, sheets }, null, 1)
);

for (const f of findings) console.log(`${f.level} [${f.viewport}] ${f.what}  (${f.path})`);
const fails = findings.filter((f) => f.level === "FAIL").length;
console.log(
  `skin-diff: ${fails} fail, ${findings.filter((f) => f.level === "warn").length} warn ` +
  `(vs the demo at ${reference.meta?.host || "?"}) -> ${outDir}/skin-diff.json`
);
if (sheets.length) {
  const cropped = sheets.filter((s) => s.cropped).length;
  console.log(
    `  ${sheets.length} contact sheet(s) -> ${outDir}/sheet-*.png — demo on the left, dressed on the right.` +
    (cropped ? `\n  ${cropped} sheet(s) cropped at ${SHEET_MAX_HEIGHT}px; open the raw screenshots for the full page.` : "")
  );
  console.log("  LOOK AT THEM. No machine here can see a block still wearing demo content.");
}
process.exit(fails ? 1 : 0);
