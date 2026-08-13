// layout-qa.mjs — the page-dimension tier of Reskin QA. visual-qa asserts nav
// geometry; THIS file asserts the page's box model: sections that overlap
// vertically, children escaping their parent, collapsed containers, media
// rendered at absurd sizes, suspiciously short pages, and dimension drift
// against a saved baseline. Layout breaks are dimension breaks first.
//
// Usage: node layout-qa.mjs <host> <port> <outDir> <p1,p2,...> <crawlMax> <minHeight> <baselineMode>
//   crawlMax     extra internal pages discovered from listed pages (0 = off).
//                Crawled pages REPORT findings but do not fail the gate —
//                they may still wear the old skin by design.
//   baselineMode "write" saves dimensions; "compare" flags drift; "off"
import { chromium } from "playwright";
import fs from "node:fs";

const [host, port, outDir, pathsArg, crawlArg, minHArg, baselineMode] = process.argv.slice(2);
if (!host || !port || !outDir || !pathsArg) {
  console.error("usage: node layout-qa.mjs <host> <port> <outDir> <p1,p2> [crawlMax] [minHeight] [write|compare|off]");
  process.exit(2);
}
const listed = pathsArg.split(",").map((p) => p.trim()).filter(Boolean);
const crawlMax = Number(crawlArg || 0);
const minHeight = Number(minHArg || 500);
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
fs.mkdirSync(outDir, { recursive: true });
const baselinePath = `${outDir}/layout-baseline.json`;
const baseline = baselineMode === "compare" && fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {};

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
         `--host-resolver-rules=MAP ${host} 127.0.0.1`],
});

function measureInPage() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const out = { pageHeight: document.documentElement.scrollHeight,
                pageWidthOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
                overflowCulprits: [], contentMeasure: null,
                sectionCount: 0, overlaps: [], escapes: [], collapsed: [], media: [] };
  const label = (el) => {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return t || el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0].slice(0, 30);
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const inFlow = (el) => !["fixed", "sticky", "absolute"].includes(getComputedStyle(el).position);

  // Major sections: the page's vertical building blocks.
  const sections = [...document.querySelectorAll(
    "section, .t4-section, [class*='acm-'], main > *, .t4-content > *"
  )].filter((el) => visible(el) && el.getBoundingClientRect().height > 20);
  out.sectionCount = new Set(sections).size;

  // 1. Vertical overlap between in-flow siblings (broken stacking). Fixed and
  // sticky bars overlay by design and are excluded.
  const byParent = new Map();
  for (const el of sections) {
    if (!inFlow(el)) continue;
    const p = el.parentElement;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(el);
  }
  for (const group of byParent.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i].getBoundingClientRect(), b = group[j].getBoundingClientRect();
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const minH = Math.min(a.height, b.height);
        if (oy > 30 && ox > 30 && oy > minH * 0.4 &&
            !group[i].contains(group[j]) && !group[j].contains(group[i])) {
          out.overlaps.push({ a: label(group[i]), b: label(group[j]), px: Math.round(oy) });
        }
      }
  }

  // 2. A child escaping its parent's horizontal box (broken widths).
  for (const el of sections) {
    if (!inFlow(el) || !el.parentElement) continue;
    const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
    if (p.width < 40) continue;
    const spill = Math.max(r.right - p.right, p.left - r.left);
    if (spill > 32) out.escapes.push({ el: label(el), px: Math.round(spill) });
  }

  // 3. Collapsed containers: a section with real children but no height.
  for (const el of document.querySelectorAll("section, .t4-section, [class*='acm-']")) {
    const s = getComputedStyle(el);
    if (s.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.height < 8 && r.width > 100 && el.children.length > 0 &&
        (el.textContent || "").trim().length > 20) {
      out.collapsed.push(label(el));
    }
  }

  // 4. Media at absurd sizes: taller than the viewport, wider than the page,
  // or upscaled far past natural resolution (the giant-logo class of bug).
  for (const img of [...document.images].filter(visible)) {
    const r = img.getBoundingClientRect();
    const why = r.height > vh * 0.95 ? "taller-than-viewport"
      : r.width > vw + 8 ? "wider-than-viewport"
      : (img.naturalWidth > 40 && r.width > img.naturalWidth * 2.5 && r.width > 320) ? "upscaled"
      : null;
    if (why) out.media.push({ src: (img.getAttribute("src") || "").slice(-60), why,
                              w: Math.round(r.width), h: Math.round(r.height) });
  }
  for (const svg of [...document.querySelectorAll("svg")].filter(visible)) {
    const r = svg.getBoundingClientRect();
    if (r.height > vh * 0.95) out.media.push({ src: "inline-svg", why: "taller-than-viewport",
                                               w: Math.round(r.width), h: Math.round(r.height) });
  }
  // 5. Content measure: text must be bound by the template's container.
  // Overflow checks are blind to this — a page whose paragraphs span the full
  // 1440px viewport does not scroll sideways, it just reads like a wall. Every
  // real template constrains its text; content at ~full width means the layout
  // that wraps it went missing (a stripped template override, a lost container).
  // Only judged on wide viewports, where a container must exist.
  if (vw >= 1024) {
    let widest = 0, sample = "";
    for (const el of document.querySelectorAll("p, h1, h2, li")) {
      if (!visible(el) || !inFlow(el)) continue;
      const t = (el.textContent || "").trim();
      if (t.length < 40) continue; // skip labels, badges, one-word headings
      const r = el.getBoundingClientRect();
      if (r.width > widest) { widest = r.width; sample = label(el); }
    }
    if (widest) {
      out.contentMeasure = { px: Math.round(widest), pct: Math.round((widest / vw) * 100), sample };
    }
  }

  // 6. Page-width culprits: when the page scrolls sideways, walk the WHOLE DOM
  // and name the widest offenders — "overflow 300px" is useless without a who.
  if (out.pageWidthOverflow > 8) {
    const offenders = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const spill = r.right - vw;
      if (spill > 8 && (!el.parentElement ||
          el.parentElement.getBoundingClientRect().right - vw < spill - 4)) {
        offenders.push({ el: label(el), px: Math.round(spill) });
      }
    }
    offenders.sort((a, b) => b.px - a.px);
    out.overflowCulprits = offenders.slice(0, 5);
  }

  for (const k of ["overlaps", "escapes", "collapsed", "media"]) out[k] = out[k].slice(0, 6);

  out.links = [...document.querySelectorAll("a[href^='/']")]
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && !h.startsWith("//") && !/\.(png|jpe?g|webp|svg|gif|css|js|ico|xml|pdf)(\?|$)/i.test(h) && !h.includes("#"));
  return out;
}

const queue = listed.map((p) => ({ path: p, gated: true }));
const seen = new Set(listed);
const findings = [];
const dims = {};

const context = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-Proto": "https" } });
while (queue.length) {
  const { path, gated } = queue.shift();
  for (const vp of viewports) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      await page.goto(`http://${host}:${port}${path}`, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(900);
      const m = await page.evaluate(measureInPage);

      const problems = [];
      if (m.pageWidthOverflow > 8)
        problems.push(`page-width overflow=${m.pageWidthOverflow}px, culprits: ` +
          m.overflowCulprits.map((c) => `${c.el}(+${c.px}px)`).join("; "));
      // 97%, not 92%: full-bleed portfolio/landing layouts legitimately run to
      // ~93% of the viewport (measured on the live origin), and a gate that
      // fails the real site is a gate nobody trusts. Only text that nothing
      // constrains at all — effectively the whole viewport — is the defect.
      if (m.contentMeasure && m.contentMeasure.pct >= 97)
        problems.push(`content-measure=${m.contentMeasure.pct}% of viewport (${m.contentMeasure.px}px, "${m.contentMeasure.sample}") — text is not inside any container`);
      if (m.pageHeight < minHeight) problems.push(`page-height=${m.pageHeight}px (< ${minHeight}: shell?)`);
      if (m.overlaps.length) problems.push("section-overlap: " + m.overlaps.map((o) => `${o.a}×${o.b}(${o.px}px)`).join("; "));
      if (m.escapes.length) problems.push("parent-escape: " + m.escapes.map((e) => `${e.el}(+${e.px}px)`).join("; "));
      if (m.collapsed.length) problems.push("collapsed-section: " + m.collapsed.join("; "));
      if (m.media.length) problems.push("media-size: " + m.media.map((x) => `${x.src} ${x.why} ${x.w}x${x.h}`).join("; "));

      const key = `${path}|${vp.name}`;
      dims[key] = { pageHeight: m.pageHeight, sectionCount: m.sectionCount };
      const base = baseline[key];
      if (base) {
        const dh = Math.abs(m.pageHeight - base.pageHeight) / Math.max(base.pageHeight, 1);
        if (dh > 0.25) problems.push(`height-drift ${base.pageHeight}→${m.pageHeight}px (${Math.round(dh * 100)}%)`);
        if (m.sectionCount !== base.sectionCount)
          problems.push(`section-drift ${base.sectionCount}→${m.sectionCount}`);
      }

      findings.push({ path, viewport: vp.name, gated, ok: !problems.length, problems });
      if (gated && crawlMax > 0 && vp.name === "desktop") {
        for (const h of m.links) {
          if (seen.size - listed.length >= crawlMax) break;
          if (!seen.has(h)) { seen.add(h); queue.push({ path: h, gated: false }); }
        }
      }
    } catch (e) {
      findings.push({ path, viewport: vp.name, gated, ok: false, problems: [String(e).slice(0, 140)] });
    } finally {
      await page.close();
    }
  }
}
await browser.close();

if (baselineMode === "write") fs.writeFileSync(baselinePath, JSON.stringify(dims, null, 1));
fs.writeFileSync(`${outDir}/layout-qa.json`, JSON.stringify({ host, findings }, null, 1));

let gateFails = 0;
for (const f of findings.filter((x) => !x.ok)) {
  const tag = f.gated ? "FAIL" : "info";
  if (f.gated) gateFails++;
  console.log(`${tag} ${f.path} [${f.viewport}]`);
  for (const p of f.problems) console.log("   -", p);
}
const gatedCount = findings.filter((f) => f.gated).length;
console.log(`layout-qa: ${gatedCount - gateFails}/${gatedCount} gated pass, ` +
  `${findings.filter((f) => !f.gated).length} crawled checks (report-only)` +
  (baselineMode === "write" ? ", baseline written" : ""));
process.exit(gateFails ? 1 : 0);
