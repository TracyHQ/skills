// visual-qa.mjs — deterministic layout assertions over rendered pages (tier 1
// of the Reskin visual QA). Runs inside the Playwright docker image on the
// fleet host; reaches the site over loopback with a Host-header rewrite, so
// nothing is installed on the client site and no SSO session is needed.
//
// Checks per page × viewport:
//   overflow-x   — page scrolls horizontally (broken layout smell #1)
//   nav-overlap  — two header/nav links whose boxes intersect (the broken-menu case)
//   edge-bleed   — visible elements protruding past the right edge
//   text-clip    — nav/button labels wider than their box
//   broken-img   — <img> that loaded with naturalWidth 0
// Screenshots are saved for the (later) vision tier and for human eyes.
//
// Usage: node visual-qa.mjs <host> <port> <outDir> <path1,path2,...>
import { chromium } from "playwright";
import fs from "node:fs";

const [host, port, outDir, pathsArg] = process.argv.slice(2);
if (!host || !port || !outDir || !pathsArg) {
  console.error("usage: node visual-qa.mjs <host> <port> <outDir> <p1,p2,...>");
  process.exit(2);
}
const paths = pathsArg.split(",").map((p) => p.trim()).filter(Boolean);
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
fs.mkdirSync(outDir, { recursive: true });

// Resolve the public hostname to loopback inside the browser itself — the
// clean way to hit a Host-routed vhost without touching DNS or Cloudflare.
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--host-resolver-rules=MAP ${host} 127.0.0.1`,
  ],
});

const findings = [];
for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    // X-Forwarded-Proto keeps Joomla from https-redirecting the loopback hit.
    extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
  });

  for (const path of paths) {
    const page = await context.newPage();
    const url = `http://${host}:${port}${path}`;
    try {
      await page.goto(url, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(1200); // let fonts/late CSS settle
      const slug = (path.replaceAll("/", "_") || "_home") + "-" + vp.name;
      // fullPage: the vision tier (agent eyes) reviews these — a viewport-only
      // shot hides the footer, which is where the first real miss happened.
      await page.screenshot({ path: `${outDir}/${slug}.png`, fullPage: true });

      const result = await page.evaluate(() => {
        const out = { overflowX: 0, navOverlap: [], edgeBleed: [], textClip: [], brokenImg: [] };
        const vw = document.documentElement.clientWidth;
        out.overflowX = Math.max(0, document.documentElement.scrollWidth - vw);

        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
        };
        const label = (el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);

        // nav-overlap: interactive header items whose boxes intersect.
        const navEls = [...document.querySelectorAll("header a, header button, nav a, nav button")]
          .filter(visible)
          .filter((el) => !navEls_hasAncestorIn(el));
        function navEls_hasAncestorIn(el) {
          // skip nested anchors inside an already-counted anchor/button
          const p = el.parentElement?.closest("header a, header button, nav a, nav button");
          return Boolean(p);
        }
        const boxes = navEls.map((el) => ({ el, r: el.getBoundingClientRect() }));
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].r, b = boxes[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            // tolerance 4px: adjacent items often kiss; real overlaps eat into each other
            if (ox > 4 && oy > 4 && !boxes[i].el.contains(boxes[j].el) && !boxes[j].el.contains(boxes[i].el)) {
              out.navOverlap.push({ a: label(boxes[i].el), b: label(boxes[j].el), px: Math.round(Math.min(ox, oy)) });
            }
          }

        // edge-bleed + text-clip over nav/buttons and top-level sections
        for (const el of [...document.querySelectorAll("header *, nav *, .btn, a.btn, button")].filter(visible)) {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 8) out.edgeBleed.push({ el: label(el) || el.className.toString().slice(0, 30), px: Math.round(r.right - vw) });
          if (el.scrollWidth > el.clientWidth + 4 && ["A", "BUTTON"].includes(el.tagName))
            out.textClip.push({ el: label(el), px: el.scrollWidth - el.clientWidth });
        }
        out.edgeBleed = out.edgeBleed.slice(0, 8);
        out.textClip = out.textClip.slice(0, 8);

        // Tracking beacons are not pictures: an <img> hidden from the
        // accessibility tree and parked under the page (negative z-index) is a
        // analytics pixel, and analytics pixels legitimately return HTML, which
        // reads as naturalWidth 0. Judge only images a visitor could see.
        const beacon = (img) =>
          img.getAttribute("aria-hidden") === "true" &&
          parseInt(getComputedStyle(img).zIndex || "0", 10) < 0;
        for (const img of [...document.images].filter(visible))
          if (img.complete && img.naturalWidth === 0 && !beacon(img))
            out.brokenImg.push(img.getAttribute("src")?.slice(0, 80) || "?");
        return out;
      });

      const bad = result.overflowX > 8 || result.navOverlap.length || result.edgeBleed.length || result.textClip.length || result.brokenImg.length;
      findings.push({ path, viewport: vp.name, ok: !bad, ...result });
    } catch (e) {
      findings.push({ path, viewport: vp.name, ok: false, error: String(e).slice(0, 160) });
    } finally {
      await page.close();
    }
  }
  await context.close();
}
await browser.close();

fs.writeFileSync(`${outDir}/visual-qa.json`, JSON.stringify({ host, generated: null, findings }, null, 1));
const failed = findings.filter((f) => !f.ok);
for (const f of failed) {
  const parts = [];
  if (f.error) parts.push(`error=${f.error}`);
  if (f.overflowX > 8) parts.push(`overflow-x=${f.overflowX}px`);
  if (f.navOverlap?.length) parts.push(`nav-overlap=${f.navOverlap.map((o) => `${o.a}×${o.b}(${o.px}px)`).join(", ")}`);
  if (f.edgeBleed?.length) parts.push(`edge-bleed=${f.edgeBleed.length}`);
  if (f.textClip?.length) parts.push(`text-clip=${f.textClip.length}`);
  if (f.brokenImg?.length) parts.push(`broken-img=${f.brokenImg.length}`);
  console.log(`FAIL ${f.path} [${f.viewport}] ${parts.join(" | ")}`);
}
console.log(`visual-qa: ${findings.length - failed.length}/${findings.length} pass -> ${outDir}/visual-qa.json`);
process.exit(failed.length ? 1 : 0);
