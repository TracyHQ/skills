// browser-qa.mjs — the single browser engine behind every rendered gate in this toolkit.
//
// WHY ONE ENGINE
//
// This was three scripts (visual-qa, layout-qa, responsive-qa), each starting its own
// container, launching its own Chromium and loading the same pages again. A seven-page QA
// loop cost 63 page loads: 21 for visual (3 viewports), 14 for layout (2), 28 for
// responsive (4) — of which 35 were the same URL at the same width, measured three times
// because the measurements lived in three files. Every assertion here reads the DOM; none
// of them changes it. So they can all read the same load.
//
// The same seven pages now cost 28 loads — the union of the viewports the requested tiers
// need — in one container, with one Chromium. The three old command names still exist and
// still take their old flags; they are wrappers that name a tier.
//
// TIERS
//   visual      geometry + behaviour + assets. Horizontal overflow, nav items overlapping,
//               edge bleed, clipped labels, broken images, assets answering 4xx/5xx, JS
//               errors — and it PRESSES the page: a toggler must reveal a menu, an
//               aria-expanded control must flip. A page standing still hides half of this.
//   layout      the box model. Sibling sections stacking on each other, children escaping
//               their parent, sections with content but no height, absurd media, drift.
//   responsive  differential against the DEMO's own reference — the demo is the living
//               definition of correct behaviour for its own template.
//
// Every verdict is made in qa-judge.mjs, which takes numbers and no DOM, so the thresholds
// are reachable from the test suite. This file renders and measures; it decides nothing.
//
// Usage:
//   node browser-qa.mjs --host <h> --port <n> --out <dir> --pages "/a,/b" \
//        [--variant <slug>] [--tiers visual,layout,responsive] \
//        [--crawl N] [--min-height N] [--baseline write|compare] \
//        [--responsive-mode write|compare] [--screenshots on|off]
import { chromium } from "playwright";
import fs from "node:fs";
import {
  VIEWPORTS,
  TIER_VIEWPORTS,
  viewportsFor,
  parseArgs,
  splitList,
  parseTiers,
  judgeVisual,
  judgeLayout,
  judgeResponsive,
  checkReference,
} from "./qa-judge.mjs";

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    defaults: {
      host: "", port: "", out: "", pages: "", variant: "",
      tiers: "visual", crawl: "0", "min-height": "500",
      baseline: "off", "responsive-mode": "compare", screenshots: "on",
    },
    required: ["host", "port", "out", "pages"],
  });
} catch (e) {
  console.error(`browser-qa: ${e.message}`);
  console.error('usage: node browser-qa.mjs --host <h> --port <n> --out <dir> --pages "/a,/b" [--variant s] [--tiers visual,layout,responsive]');
  process.exit(2);
}

const host = args.host;
const port = args.port;
const outDir = args.out;
const variant = args.variant;
const listed = splitList(args.pages);
let tiers;
try {
  tiers = parseTiers(args.tiers);
} catch (e) {
  console.error(`browser-qa: ${e.message}`);
  process.exit(2);
}
const crawlMax = Number(args.crawl) || 0;
const minHeight = Number(args["min-height"]) || 500;
const baselineMode = args.baseline;
const responsiveMode = args["responsive-mode"];
const wantShots = args.screenshots !== "off" && tiers.includes("visual");

if (!listed.length) {
  console.error("browser-qa: --pages listed no paths");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// The reference is read BEFORE a browser is launched. Discovering that the demo was never
// recorded after paying for 28 page renders is the kind of politeness that costs a minute
// every time somebody forgets a step.
const refPath = `${outDir}/responsive-reference.json`;
let reference = { blocks: {}, chrome: {}, meta: {} };
if (tiers.includes("responsive") && responsiveMode === "compare") {
  const exists = fs.existsSync(refPath);
  let parsed = null;
  if (exists) {
    try {
      parsed = JSON.parse(fs.readFileSync(refPath, "utf8"));
    } catch (e) {
      console.error(`browser-qa: the responsive reference at ${refPath} is not readable JSON (${e.message})`);
      process.exit(2);
    }
  }
  const complaint = checkReference(parsed, { host, exists });
  if (complaint) {
    console.error(`browser-qa: ${complaint}`);
    process.exit(2);
  }
  reference = parsed;
}

const baselinePath = `${outDir}/layout-baseline.json`;
const layoutBaseline =
  tiers.includes("layout") && baselineMode === "compare" && fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
    : {};

// ---------------------------------------------------------------------------
// In-page measurement — everything below runs inside the browser
// ---------------------------------------------------------------------------

function measureInPage(wanted) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const out = {};

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const text = (el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const label = (el) =>
    text(el) || el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0].slice(0, 30);
  const inFlow = (el) => !["fixed", "sticky", "absolute"].includes(getComputedStyle(el).position);

  if (wanted.includes("visual")) {
    const v = { overflowX: 0, navOverlap: [], edgeBleed: [], textClip: [], brokenImg: [] };
    v.overflowX = Math.max(0, document.documentElement.scrollWidth - vw);

    // nav-overlap: interactive header items whose boxes intersect. Nested anchors inside an
    // already-counted anchor are skipped — a link inside a link is one item, not two.
    const nested = (el) => Boolean(el.parentElement?.closest("header a, header button, nav a, nav button"));
    const navEls = [...document.querySelectorAll("header a, header button, nav a, nav button")]
      .filter(visible)
      .filter((el) => !nested(el));
    const boxes = navEls.map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // tolerance 4px: adjacent items often kiss; real overlaps eat into each other
        if (ox > 4 && oy > 4 && !boxes[i].el.contains(boxes[j].el) && !boxes[j].el.contains(boxes[i].el))
          v.navOverlap.push({ a: text(boxes[i].el), b: text(boxes[j].el), px: Math.round(Math.min(ox, oy)) });
      }

    for (const el of [...document.querySelectorAll("header *, nav *, .btn, a.btn, button")].filter(visible)) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 8)
        v.edgeBleed.push({ el: text(el) || String(el.className).slice(0, 30), px: Math.round(r.right - vw) });
      // Only a clipping context can clip: with overflow visible the text just renders past
      // the padding box (chevron-shaped breadcrumbs whose arrow padding inflates
      // scrollWidth) and nothing is lost to the eye.
      const ovx = getComputedStyle(el).overflowX;
      if (el.scrollWidth > el.clientWidth + 4 && ["A", "BUTTON"].includes(el.tagName) && ovx !== "visible")
        v.textClip.push({ el: text(el), px: el.scrollWidth - el.clientWidth });
    }
    v.edgeBleed = v.edgeBleed.slice(0, 8);
    v.textClip = v.textClip.slice(0, 8);

    // Tracking beacons are not pictures: an <img> hidden from the accessibility tree and
    // parked under the page is an analytics pixel, and those legitimately return HTML,
    // which reads as naturalWidth 0. Judge only images a visitor could see.
    const beacon = (img) =>
      img.getAttribute("aria-hidden") === "true" && parseInt(getComputedStyle(img).zIndex || "0", 10) < 0;
    for (const img of [...document.images].filter(visible))
      if (img.complete && img.naturalWidth === 0 && !beacon(img))
        v.brokenImg.push(img.getAttribute("src")?.slice(0, 80) || "?");

    // Every CSS background URL a visible element actually resolved. The response listener in
    // node is what judges them; this list is what lets a failure name the element that asked,
    // instead of an anonymous URL.
    v.backgroundUrls = [];
    const seenBg = new Set();
    for (const el of document.body.querySelectorAll("*")) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") continue;
      for (const m of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
        const url = m[2];
        if (!url || url.startsWith("data:") || seenBg.has(url)) continue;
        seenBg.add(url);
        v.backgroundUrls.push({ url, el: label(el) });
      }
    }
    out.visual = v;
  }

  if (wanted.includes("layout")) {
    const L = {
      pageHeight: document.documentElement.scrollHeight,
      pageWidthOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
      overflowCulprits: [], contentMeasure: null,
      sectionCount: 0, overlaps: [], escapes: [], collapsed: [], media: [],
    };

    // Major sections: the page's vertical building blocks.
    const sections = [...document.querySelectorAll("section, .t4-section, [class*='acm-'], main > *, .t4-content > *")]
      .filter((el) => visible(el) && el.getBoundingClientRect().height > 20);
    L.sectionCount = new Set(sections).size;

    // 1. Vertical overlap between in-flow siblings. Fixed and sticky bars overlay by design.
    const byParent = new Map();
    for (const el of sections) {
      if (!inFlow(el)) continue;
      const p = el.parentElement;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(el);
    }
    for (const group of byParent.values())
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i].getBoundingClientRect(), b = group[j].getBoundingClientRect();
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const minH = Math.min(a.height, b.height);
          if (oy > 30 && ox > 30 && oy > minH * 0.4 && !group[i].contains(group[j]) && !group[j].contains(group[i]))
            L.overlaps.push({ a: label(group[i]), b: label(group[j]), px: Math.round(oy) });
        }

    // 2. A child escaping its parent's horizontal box.
    for (const el of sections) {
      if (!inFlow(el) || !el.parentElement) continue;
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      if (p.width < 40) continue;
      const spill = Math.max(r.right - p.right, p.left - r.left);
      if (spill > 32) L.escapes.push({ el: label(el), px: Math.round(spill) });
    }

    // 3. Collapsed containers: a section with real children but no height.
    for (const el of document.querySelectorAll("section, .t4-section, [class*='acm-']")) {
      if (getComputedStyle(el).display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 && r.width > 100 && el.children.length > 0 && (el.textContent || "").trim().length > 20)
        L.collapsed.push(label(el));
    }

    // 4. Media at absurd sizes: the giant-logo class of bug.
    for (const img of [...document.images].filter(visible)) {
      const r = img.getBoundingClientRect();
      const why = r.height > vh * 0.95 ? "taller-than-viewport"
        : r.width > vw + 8 ? "wider-than-viewport"
        : (img.naturalWidth > 40 && r.width > img.naturalWidth * 2.5 && r.width > 320) ? "upscaled"
        : null;
      if (why) L.media.push({ src: (img.getAttribute("src") || "").slice(-60), why, w: Math.round(r.width), h: Math.round(r.height) });
    }
    for (const svg of [...document.querySelectorAll("svg")].filter(visible)) {
      const r = svg.getBoundingClientRect();
      if (r.height > vh * 0.95)
        L.media.push({ src: "inline-svg", why: "taller-than-viewport", w: Math.round(r.width), h: Math.round(r.height) });
    }

    // 5. Content measure: text must be bound by the template's container. Overflow checks
    // are blind to this — a page whose paragraphs span the full 1440px viewport does not
    // scroll sideways, it just reads like a wall.
    if (vw >= 1024) {
      let widest = 0, sample = "";
      for (const el of document.querySelectorAll("p, h1, h2, li")) {
        if (!visible(el) || !inFlow(el)) continue;
        if ((el.textContent || "").trim().length < 40) continue; // skip labels, badges, one-word headings
        const r = el.getBoundingClientRect();
        if (r.width > widest) { widest = r.width; sample = label(el); }
      }
      if (widest) L.contentMeasure = { px: Math.round(widest), pct: Math.round((widest / vw) * 100), sample };
    }

    // 6. Page-width culprits: "overflow 300px" is useless without a who.
    if (L.pageWidthOverflow > 8) {
      const offenders = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (!visible(el)) continue;
        const spill = el.getBoundingClientRect().right - vw;
        if (spill > 8 && (!el.parentElement || el.parentElement.getBoundingClientRect().right - vw < spill - 4))
          offenders.push({ el: label(el), px: Math.round(spill) });
      }
      offenders.sort((a, b) => b.px - a.px);
      L.overflowCulprits = offenders.slice(0, 5);
    }

    for (const k of ["overlaps", "escapes", "collapsed", "media"]) L[k] = L[k].slice(0, 6);

    L.links = [...document.querySelectorAll("a[href^='/']")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h && !h.startsWith("//") && !/\.(png|jpe?g|webp|svg|gif|css|js|ico|xml|pdf)(\?|$)/i.test(h) && !h.includes("#"));
    out.layout = L;
  }

  if (wanted.includes("responsive")) {
    // Dominant column count: inside the block, find the container whose visible children
    // form the widest visual row.
    // A Bootstrap-3 float grid is a container to the eye and nothing to a selector: the
    // wrapper is `display: block`, carries no `row` class, and holds its shape entirely
    // through `col-*` children that float. Counting only flex/grid/.row read it as one column
    // at every viewport — which says "collapsed" on BOTH sides of the comparison, so the gate
    // could not fail, in either direction. Recognise the children instead of the wrapper.
    const floatGrid = (el) =>
      [...el.children].filter((k) =>
        String(k.className || "").split(/\s+/).some((c) => /^col(-|$)/.test(c))
      ).length >= 2;

    const colsOf = (root) => {
      let best = 1;
      const containers = [...root.querySelectorAll("*")].filter((el) => {
        if (el.children.length < 2) return false;
        const s = getComputedStyle(el);
        return s.display.includes("grid") || s.display.includes("flex") ||
          /(^|\s)row(\s|$)/.test(el.className) || floatGrid(el);
      });
      containers.push(root);
      for (const c of containers) {
        const cw = c.getBoundingClientRect().width;
        if (cw < 40) continue;
        // A COLUMN is a substantial child, not any child that happens to sit on the same
        // line: an accordion's chevron or a badge beside a title is not a second column
        // (25% of the container's width is the floor), and two buttons side by side are a
        // row of actions, not a two-column layout (80px is above any button, below any real
        // card or media column). Both numbers came from four false failures.
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

    const R = {
      blocks: {}, chrome: {},
      hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"][content*="width"]')),
    };
    for (const root of document.querySelectorAll('[class*="acm-"]')) {
      const cls = [...root.classList].find((c) => c.startsWith("acm-"));
      if (!cls || R.blocks[cls]) continue; // first instance speaks for the type
      const vis = visible(root);
      const h = root.querySelector("h1,h2,h3");
      R.blocks[cls] = {
        visible: vis,
        cols: vis ? colsOf(root) : 0,
        headingPx: vis && h ? Math.round(parseFloat(getComputedStyle(h).fontSize)) : null,
        hOverflow: vis ? root.scrollWidth > root.clientWidth + 8 : false,
      };
    }
    const header = document.querySelector("header, #t4-header");
    if (header) {
      const links = [...header.querySelectorAll("nav a, .t4-navbar a")].filter(visible);
      const toggler = [...header.querySelectorAll('button[class*="toggle"], .navbar-toggler, [data-bs-toggle="offcanvas"]')].some(visible);
      R.chrome["header"] = { navLinks: links.length, toggler, hOverflow: header.scrollWidth > header.clientWidth + 8 };
    }
    const footRow = document.querySelector('[class*="footnav"], footer .row, .t4-footnav');
    if (footRow) {
      const cols = new Map();
      const kids = footRow.parentElement?.children.length > 1 ? footRow.parentElement.children : footRow.children;
      for (const k of [...kids].filter(visible)) {
        const top = Math.round(k.getBoundingClientRect().top / 24);
        cols.set(top, (cols.get(top) || 0) + 1);
      }
      R.chrome["footer"] = { cols: cols.size ? Math.max(...cols.values()) : 1 };
    }
    out.responsive = R;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    // Resolve the public hostname to loopback inside the browser itself — the clean way to
    // reach a Host-routed vhost without touching DNS or the CDN.
    `--host-resolver-rules=MAP ${host} 127.0.0.1`,
  ],
});

// X-Forwarded-Proto keeps the CMS from https-redirecting the loopback hit. X-Tracy-Variant
// picks the proposal's database the same way the edge worker does from the hostname — the
// header ALL tiers now send. Two of them never did, so a proposal run graded the live site
// and passed; that is the failure this engine exists to make impossible.
const headers = { "X-Forwarded-Proto": "https" };
if (variant) headers["X-Tracy-Variant"] = variant;
const context = await browser.newContext({ extraHTTPHeaders: headers });

const wantedViewports = viewportsFor(tiers);
const queue = listed.map((path) => ({ path, gated: true, tiers }));
const seen = new Set(listed);
let crawled = 0;

const visualFindings = [];
const layoutFindings = [];
const responsiveFindings = [];
const layoutDims = {};
const collected = { blocks: {}, chrome: {}, meta: {} };
// This side's desktop column count per PAGE per block type. `collected` is keyed by type
// alone because that is the shape the reference file must have — the demo's paths and the
// client's do not correspond — but the fold question is per page, and the same block type is
// laid out differently on different ones.
const pageDesktop = {};

/**
 * Wait for the page to stop moving, without paying a fixed toll on every render.
 *
 * This used to be a flat `waitForTimeout(1200)` per page per viewport — 63 seconds of pure
 * sleep in a seven-page loop, whether the page had settled in 200ms or was still loading.
 * The network going quiet is the real signal; the timeout is only the ceiling, and it is
 * deliberately no higher than the old fixed wait, so the worst case never got slower.
 */
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 1200 }).catch(() => {});
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
  await page.waitForTimeout(150);
}

while (queue.length) {
  const item = queue.shift();
  const itemViewports = item.gated ? wantedViewports : viewportsFor(item.tiers);

  for (const vp of itemViewports) {
    // Which tiers actually have something to say at this width.
    const active = item.tiers.filter((t) => TIER_VIEWPORTS[t].includes(vp.name));
    if (!active.length) continue;

    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // A dressed page can throw where the mold never did — a template script expecting a
    // block the mapping dropped, a library the old skin loaded. None of that is in the HTML.
    const jsErrors = [];
    const assetErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 120)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      // Asset failures are the response listener's business now, and it reports them with a
      // status code instead of a generic string; counting them twice buries real exceptions.
      if (/Failed to load resource|net::ERR_/.test(t)) return;
      // Fonts and scripts from someone else's CDN answer to their rules — a dressing can
      // neither cause nor cure a cross-origin refusal.
      if (/blocked by CORS policy|Access to (font|script|stylesheet|image)/i.test(t)) return;
      jsErrors.push(t.slice(0, 120));
    });
    // The witness that closes the background-image hole: <img> checks see only <img>, and
    // the text tier only greps href=/src= out of the HTML, so a hero declared in CSS could
    // 404 with every gate green. Judge this site's own assets only — an off-host 404 is
    // somebody else's server, exactly as with CORS above.
    page.on("response", (r) => {
      if (r.status() < 400) return;
      let sameHost = false;
      try { sameHost = new URL(r.url()).hostname === host; } catch { sameHost = false; }
      if (!sameHost) return;
      const url = r.url().replace(`http://${host}:${port}`, "").slice(0, 80);
      if (!assetErrors.some((a) => a.url === url)) assetErrors.push({ url, status: r.status() });
    });

    try {
      await page.goto(`http://${host}:${port}${item.path}`, { waitUntil: "load", timeout: 45000 });
      await settle(page);

      // The screenshot is taken BEFORE anything is pressed: it is the record of the page as
      // a visitor first meets it, and the input the pixel-diff tier compares run to run.
      if (wantShots && active.includes("visual") && item.gated) {
        const slug = (item.path.replaceAll("/", "_") || "_home") + "-" + vp.name;
        // fullPage: a viewport-only shot hides the footer, which is where the first real
        // miss happened.
        await page.screenshot({ path: `${outDir}/${slug}.png`, fullPage: true });
      }

      const m = await page.evaluate(measureInPage, active);

      if (active.includes("visual")) {
        // Interaction runs LAST: it clicks things, and everything above must describe the
        // page as loaded, not as poked.
        const interaction = await pressThePage(page, vp);
        // Name the element that asked for a dead background, when we can. The suffix match
        // is best-effort — a relative `url(../img/x.jpg)` does not resolve to the response's
        // path — but an EMPTY needle would match every URL and hand every asset failure the
        // first element's name, so the empty case is excluded rather than left to endsWith,
        // which answers true for "".
        for (const a of assetErrors) {
          const owner = (m.visual.backgroundUrls || [])
            .map((b) => ({ el: b.el, needle: b.url.replace(/^https?:\/\/[^/]+/, "") }))
            .find((b) => b.needle && a.url.endsWith(b.needle));
          if (owner) a.url = `${a.url} (background of ${owner.el})`;
        }
        const problems = judgeVisual(m.visual, { interaction, jsErrors: [...new Set(jsErrors)], assetErrors });
        visualFindings.push({
          path: item.path, viewport: vp.name, ok: !problems.length, problems,
          interaction, jsErrors: [...new Set(jsErrors)], assetErrors, ...m.visual,
        });
      }

      if (active.includes("layout")) {
        const key = `${item.path}|${vp.name}`;
        layoutDims[key] = { pageHeight: m.layout.pageHeight, sectionCount: m.layout.sectionCount };
        const problems = judgeLayout(m.layout, { minHeight, baseline: layoutBaseline[key] || null });
        layoutFindings.push({ path: item.path, viewport: vp.name, gated: item.gated, ok: !problems.length, problems });

        // Crawled pages are measured and REPORTED, never gated: they may still wear the old
        // skin by design.
        if (item.gated && crawlMax > 0 && vp.name === "desktop") {
          for (const h of m.layout.links) {
            if (crawled >= crawlMax) break;
            if (seen.has(h)) continue;
            seen.add(h);
            crawled++;
            queue.push({ path: h, gated: false, tiers: ["layout"] });
          }
        }
      }

      if (active.includes("responsive")) {
        // Always collect, in both modes: compare needs THIS side's own desktop baseline to
        // judge fold rhythm against.
        for (const [type, s] of Object.entries(m.responsive.blocks)) {
          const key = `${type}|${vp.name}`;
          if (!collected.blocks[key]) collected.blocks[key] = s;
          // Desktop runs first within every page, so this is always populated before any
          // narrower viewport of the same page asks for it.
          if (vp.name === "desktop") pageDesktop[`${item.path}|${type}`] = s.cols;
        }
        for (const [what, s] of Object.entries(m.responsive.chrome)) {
          const key = `${what}|${vp.name}`;
          if (!collected.chrome[key]) collected.chrome[key] = s;
        }
        if (responsiveMode === "compare")
          responsiveFindings.push(
            ...judgeResponsive({ sig: m.responsive, reference, collected, pageDesktop, viewport: vp.name, path: item.path })
          );
      }
    } catch (e) {
      const msg = String(e).slice(0, 160);
      if (active.includes("visual"))
        visualFindings.push({ path: item.path, viewport: vp.name, ok: false, problems: [msg], error: msg });
      if (active.includes("layout"))
        layoutFindings.push({ path: item.path, viewport: vp.name, gated: item.gated, ok: false, problems: [msg] });
      if (active.includes("responsive") && responsiveMode === "compare")
        responsiveFindings.push({ path: item.path, viewport: vp.name, level: "FAIL", what: msg });
    } finally {
      await page.close();
    }
  }
}

async function pressThePage(page, vp) {
  const interaction = [];
  // Count EVERY visible link, never links inside a container we guessed: one template calls
  // its drawer `.t3-off-canvas`, another `offcanvas`, another `mobile-menu`, and a selector
  // that misses it reports a working menu as broken (it did: 0 → 177 links, "menu did not
  // open").
  const countNavLinks = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("a")].filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 1 && r.height > 1;
      }).length
    );

  if (vp.name === "mobile") {
    // The toggler is the whole navigation on a phone: if pressing it reveals nothing, the
    // dressed site has no menu at all.
    const toggler = page
      .locator('.navbar-toggler:visible, [data-bs-toggle="offcanvas"]:visible, button[class*="toggle"]:visible')
      .first();
    if ((await toggler.count()) > 0) {
      const before = await countNavLinks();
      await toggler.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
      const after = await countNavLinks();
      if (after <= before) interaction.push(`nav toggler opens nothing (${before} links before, ${after} after)`);
    }
  }

  if (vp.name === "desktop") {
    // Only judged where the template states the contract itself: an element carrying
    // aria-expanded promises to flip it. No promise, no verdict.
    const trigger = page.locator('[aria-expanded]:visible[data-bs-toggle], .accordion-button:visible').first();
    if ((await trigger.count()) > 0) {
      const before = await trigger.getAttribute("aria-expanded");
      await trigger.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      const after = await trigger.getAttribute("aria-expanded");
      if (before !== null && before === after) interaction.push(`accordion does not expand (aria-expanded stayed ${after})`);
    }
  }
  return interaction;
}

await context.close();
await browser.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const generated = new Date().toISOString();
// `variant` is written into every report on purpose. A run that graded the wrong database
// used to be indistinguishable from a correct one after the fact, because only the host was
// recorded — and the host is the same for the site and every proposal of it.
const stamp = { host, variant: variant || null, generated };
let exitCode = 0;

if (tiers.includes("visual")) {
  fs.writeFileSync(`${outDir}/visual-qa.json`, JSON.stringify({ ...stamp, findings: visualFindings }, null, 1));
  const failed = visualFindings.filter((f) => !f.ok);
  for (const f of failed) console.log(`FAIL ${f.path} [${f.viewport}] ${f.problems.join(" | ")}`);
  console.log(`visual-qa: ${visualFindings.length - failed.length}/${visualFindings.length} pass -> ${outDir}/visual-qa.json`);
  if (failed.length) exitCode = 1;
}

if (tiers.includes("layout")) {
  if (baselineMode === "write") fs.writeFileSync(baselinePath, JSON.stringify(layoutDims, null, 1));
  fs.writeFileSync(`${outDir}/layout-qa.json`, JSON.stringify({ ...stamp, findings: layoutFindings }, null, 1));
  let gateFails = 0;
  for (const f of layoutFindings.filter((x) => !x.ok)) {
    if (f.gated) gateFails++;
    console.log(`${f.gated ? "FAIL" : "info"} ${f.path} [${f.viewport}]`);
    for (const p of f.problems) console.log("   -", p);
  }
  const gatedCount = layoutFindings.filter((f) => f.gated).length;
  const crawledCount = layoutFindings.filter((f) => !f.gated).length;
  console.log(
    `layout-qa: ${gatedCount - gateFails}/${gatedCount} gated pass, ${crawledCount} crawled checks (report-only)` +
      (crawlMax > 0 && crawled >= crawlMax ? ` — crawl stopped at the --crawl ${crawlMax} cap, more pages exist` : "") +
      (baselineMode === "write" ? ", baseline written" : "")
  );
  if (gateFails) exitCode = 1;
}

if (tiers.includes("responsive")) {
  if (responsiveMode === "write") {
    collected.meta = {
      host, generated,
      viewports: wantedViewports.map((v) => v.name),
      blockTypes: [...new Set(Object.keys(collected.blocks).map((k) => k.split("|")[0]))],
    };
    fs.writeFileSync(refPath, JSON.stringify(collected, null, 1));
    console.log(
      `responsive-qa: reference written from ${host} — ${collected.meta.blockTypes.length} block types ` +
        `× ${collected.meta.viewports.length} viewports -> ${refPath}`
    );
  } else {
    fs.writeFileSync(`${outDir}/responsive-qa.json`, JSON.stringify({ ...stamp, reference: reference.meta?.host || null, findings: responsiveFindings }, null, 1));
    const dedup = new Map();
    for (const f of responsiveFindings) dedup.set(`${f.level}|${f.viewport}|${f.what}`, f);
    const rows = [...dedup.values()];
    for (const f of rows) console.log(`${f.level} [${f.viewport}] ${f.what}` + (f.path ? `  (${f.path})` : ""));
    const fails = rows.filter((f) => f.level === "FAIL").length;
    console.log(
      `responsive-qa: ${fails} fail, ${rows.filter((f) => f.level === "warn").length} warn, ` +
        `${rows.filter((f) => f.level === "info").length} info (vs reference from ${reference.meta?.host || "?"}) -> ${outDir}/responsive-qa.json`
    );
    if (fails) exitCode = 1;
  }
}

fs.writeFileSync(
  `${outDir}/browser-qa.json`,
  JSON.stringify({ ...stamp, tiers, viewports: wantedViewports.map((v) => v.name), pages: listed, crawled, exitCode }, null, 1)
);
process.exit(exitCode);
