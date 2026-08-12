// responsive-qa.mjs — the DIFFERENTIAL responsive tier of Reskin QA.
//
// The demo is the living definition of correct responsive behavior for its
// template: the same block type must stack, collapse and scale the same way at
// the same viewport on the dressed client site. So this tool has two modes:
//
//   reference=write    run against the DEMO: extract a responsive signature per
//                      block type (acm-*) and per chrome element at each
//                      viewport, save as the reference.
//   reference=compare  run against the CLIENT: extract the same signatures and
//                      judge them AGAINST the reference — not against absolute
//                      rules. "Weird but the demo does it too" is a property of
//                      the mold, not a defect of the dress.
//
// Signature per block (keyed acmType|viewport):
//   cols       dominant column count of the block's widest visual row
//   navLinks   (chrome) visible top-level nav links; toggler visibility
//   headingPx  first heading's computed font size (fluid-type check)
//   hOverflow  the block itself scrolls horizontally
//   visible    the block renders at all at this viewport
//
// Verdicts on compare: cols mismatch -> FAIL; overflow where the reference has
// none -> FAIL; nav fails to collapse like the reference -> FAIL; heading size
// drift > 25% -> warn; block missing from reference -> info (new block).
//
// Usage: node responsive-qa.mjs <host> <port> <outDir> <p1,p2,...> <write|compare>
import { chromium } from "playwright";
import fs from "node:fs";

const [host, port, outDir, pathsArg, mode] = process.argv.slice(2);
if (!host || !port || !outDir || !pathsArg || !["write", "compare"].includes(mode)) {
  console.error("usage: node responsive-qa.mjs <host> <port> <outDir> <p1,p2> <write|compare>");
  process.exit(2);
}
const paths = pathsArg.split(",").map((p) => p.trim()).filter(Boolean);
// Desktop FIRST on purpose: every smaller viewport is judged against this
// side's own desktop layout, so that baseline must already be collected.
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
fs.mkdirSync(outDir, { recursive: true });
const refPath = `${outDir}/responsive-reference.json`;
const reference = mode === "compare"
  ? JSON.parse(fs.readFileSync(refPath, "utf8"))
  : { blocks: {}, chrome: {}, meta: {} };
if (mode === "compare" && !reference.blocks) {
  console.error("reference file has no blocks — run reference=write against the demo first");
  process.exit(2);
}

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
         `--host-resolver-rules=MAP ${host} 127.0.0.1`],
});

function signaturesInPage() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  // Dominant column count: inside the block, find the container whose visible
  // children form the widest visual row (children grouped by rounded top).
  const colsOf = (root) => {
    let best = 1;
    const containers = [...root.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el);
      return (s.display.includes("grid") || s.display.includes("flex") ||
              /(^|\s)row(\s|$)/.test(el.className)) && el.children.length >= 2;
    });
    containers.push(root);
    for (const c of containers) {
      const cw = c.getBoundingClientRect().width;
      if (cw < 40) continue;
      // A COLUMN is a substantial child, not any child that happens to sit on
      // the same line: an accordion's chevron icon or a badge beside a title
      // is not a second column. 25% of the container's width is the floor —
      // below it, real column layouts do not go.
      // ...and tall enough to be content. Two buttons side by side are a row of
      // actions, not a two-column layout; 80px is above any button, below any
      // real card or media column.
      const kids = [...c.children].filter((k) => {
        if (!visible(k)) return false;
        const r = k.getBoundingClientRect();
        return r.width >= cw * 0.25 && r.height >= 80;
      });
      if (kids.length < 2) continue;
      const rows = new Map();
      for (const k of kids) {
        const top = Math.round(k.getBoundingClientRect().top / 24);
        rows.set(top, (rows.get(top) || 0) + 1);
      }
      const maxInRow = Math.max(...rows.values());
      if (maxInRow > best) best = maxInRow;
    }
    return best;
  };

  const out = { blocks: {}, chrome: {}, hasViewportMeta:
    Boolean(document.querySelector('meta[name="viewport"][content*="width"]')) };

  for (const root of document.querySelectorAll('[class*="acm-"]')) {
    const cls = [...root.classList].find((c) => c.startsWith("acm-"));
    if (!cls || out.blocks[cls]) continue; // first instance speaks for the type
    const vis = visible(root);
    const h = root.querySelector("h1,h2,h3");
    out.blocks[cls] = {
      visible: vis,
      cols: vis ? colsOf(root) : 0,
      headingPx: vis && h ? Math.round(parseFloat(getComputedStyle(h).fontSize)) : null,
      hOverflow: vis ? root.scrollWidth > root.clientWidth + 8 : false,
    };
  }

  const header = document.querySelector("header, #t4-header");
  if (header) {
    const links = [...header.querySelectorAll("nav a, .t4-navbar a")].filter(visible);
    const toggler = [...header.querySelectorAll(
      'button[class*="toggle"], .navbar-toggler, [data-bs-toggle="offcanvas"]')].some(visible);
    out.chrome["header"] = { navLinks: links.length, toggler,
                             hOverflow: header.scrollWidth > header.clientWidth + 8 };
  }
  const footRow = document.querySelector('[class*="footnav"], footer .row, .t4-footnav');
  if (footRow) {
    const cols = new Map();
    for (const k of [...(footRow.parentElement?.children.length > 1 ? footRow.parentElement.children : footRow.children)].filter(visible)) {
      const top = Math.round(k.getBoundingClientRect().top / 24);
      cols.set(top, (cols.get(top) || 0) + 1);
    }
    out.chrome["footer"] = { cols: cols.size ? Math.max(...cols.values()) : 1 };
  }
  return out;
}

const collected = { blocks: {}, chrome: {}, meta: {} };
const findings = [];

const context = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-Proto": "https" } });
for (const vp of viewports) {
  for (const path of paths) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      await page.goto(`http://${host}:${port}${path}`, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(900);
      const sig = await page.evaluate(signaturesInPage);

      if (!sig.hasViewportMeta) {
        findings.push({ path, viewport: vp.name, level: "FAIL",
                        what: "no <meta name=viewport> — the page cannot respond at all" });
      }
      for (const [type, s] of Object.entries(sig.blocks)) {
        const key = `${type}|${vp.name}`;
        // Always collect: compare mode needs this side's own desktop baseline.
        if (!collected.blocks[key]) collected.blocks[key] = s; // first sighting wins
        if (mode === "write") continue;
        const ref = reference.blocks[key];
        if (!ref) {
          findings.push({ path, viewport: vp.name, level: "info", what: `${type}: not in reference` });
          continue;
        }
        if (!s.visible && ref.visible) continue; // deliberate unpublish is mapping's right
        if (s.hOverflow && !ref.hOverflow)
          findings.push({ path, viewport: vp.name, level: "FAIL",
                          what: `${type}: scrolls horizontally, the demo's doesn't` });
        // Column counts are driven by ITEM COUNT (4 real plans vs the demo's 3),
        // so comparing them absolutely is noise. What must match is the COLLAPSE
        // BEHAVIOUR: measured against each side's own desktop baseline, does this
        // viewport stack the same way? A block that keeps several columns at 375px
        // where the demo drops to one is the real defect.
        const refDesk = reference.blocks[`${type}|desktop`]?.cols || ref.cols;
        const ownDesk = collected.blocks[`${type}|desktop`]?.cols || s.cols;
        if (ref.visible && s.visible && vp.name !== "desktop") {
          const refCollapsed = ref.cols <= 1 || ref.cols < refDesk;
          const ownCollapsed = s.cols <= 1 || s.cols < ownDesk;
          if (refCollapsed && !ownCollapsed)
            findings.push({ path, viewport: vp.name, level: "FAIL",
                            what: `${type}: still ${s.cols} columns at ${vp.name}; demo collapses ${refDesk}→${ref.cols}` });
          else if (!refCollapsed && ownCollapsed)
            findings.push({ path, viewport: vp.name, level: "warn",
                            what: `${type}: collapsed to ${s.cols} at ${vp.name}; demo keeps ${ref.cols}` });
        }
        if (ref.headingPx && s.headingPx &&
            Math.abs(s.headingPx - ref.headingPx) / ref.headingPx > 0.25)
          findings.push({ path, viewport: vp.name, level: "warn",
                          what: `${type}: heading ${s.headingPx}px vs demo ${ref.headingPx}px` });
      }
      for (const [what, s] of Object.entries(sig.chrome)) {
        const key = `${what}|${vp.name}`;
        if (mode === "write") {
          if (!collected.chrome[key]) collected.chrome[key] = s;
          continue;
        }
        const ref = reference.chrome[key];
        if (!ref) continue;
        if (what === "header") {
          if (s.hOverflow && !ref.hOverflow)
            findings.push({ path, viewport: vp.name, level: "FAIL",
                            what: "header scrolls horizontally, the demo's doesn't" });
          // The collapse contract: where the demo hides links behind a toggler,
          // the dress must too — a nav that stays expanded at 375px is broken.
          if (ref.toggler && ref.navLinks <= 4 && s.navLinks > ref.navLinks + 4)
            findings.push({ path, viewport: vp.name, level: "FAIL",
                            what: `nav shows ${s.navLinks} links at ${vp.name}; demo collapses to ${ref.navLinks} behind the toggler` });
        }
        if (what === "footer" && s.cols !== ref.cols)
          findings.push({ path, viewport: vp.name, level: "warn",
                          what: `footer: ${s.cols} column(s), demo has ${ref.cols} at ${vp.name}` });
      }
    } catch (e) {
      findings.push({ path, viewport: vp.name, level: "FAIL", what: String(e).slice(0, 140) });
    } finally {
      await page.close();
    }
  }
}
await browser.close();

if (mode === "write") {
  collected.meta = { host, viewports: viewports.map((v) => v.name),
                     blockTypes: [...new Set(Object.keys(collected.blocks).map((k) => k.split("|")[0]))] };
  fs.writeFileSync(refPath, JSON.stringify(collected, null, 1));
  console.log(`responsive-qa: reference written — ${collected.meta.blockTypes.length} block types × ${viewports.length} viewports -> ${refPath}`);
  process.exit(0);
}

fs.writeFileSync(`${outDir}/responsive-qa.json`, JSON.stringify({ host, findings }, null, 1));
const dedup = new Map();
for (const f of findings) dedup.set(`${f.level}|${f.viewport}|${f.what}`, f);
let fails = 0;
for (const f of dedup.values()) {
  if (f.level === "FAIL") fails++;
  console.log(`${f.level === "FAIL" ? "FAIL" : f.level} [${f.viewport}] ${f.what}` +
              (f.path ? `  (${f.path})` : ""));
}
console.log(`responsive-qa: ${fails} fail, ${[...dedup.values()].filter((f) => f.level === "warn").length} warn, ` +
  `${[...dedup.values()].filter((f) => f.level === "info").length} info -> ${outDir}/responsive-qa.json`);
process.exit(fails ? 1 : 0);
