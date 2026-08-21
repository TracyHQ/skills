// Render each page and write down both what it looks like and what it measures.
//
// The reviewer that reads this output is a model with eyes, so a screenshot alone would almost
// work — but a model looking at a picture guesses at sizes, and a guess dressed as a measurement
// is the worst kind of finding. So every page produces two things that travel together: the
// image, and the numbers behind it. The model judges from the picture and quotes from the numbers.
//
// The numbers are also what makes the report able to point. Each block carries the rectangle it
// occupied, so when the model says "this section is empty" the report can draw a box over the
// screenshot at those coordinates. The model never has to know where anything is on screen.
//
// Usage: node capture.mjs --pages <survey.json|url,url> --out <dir> [--viewports desktop,mobile]

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const OUT = arg("out", "review-capture");
const PAGES_ARG = arg("pages");
const WANT = (arg("viewports", "desktop,tablet,mobile") ?? "").split(",").map((v) => v.trim()).filter(Boolean);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 }
};

/** A full-page shot of a very long page is mostly repetition and costs a model real attention. */
const MAX_SHOT_HEIGHT = 6000;

if (!PAGES_ARG) {
  process.stderr.write("usage: capture.mjs --pages <survey.json|url,url> --out <dir>\n");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  // Said plainly and once. A skill that dies on a stack trace teaches nobody what to do next.
  process.stderr.write(
    "This step needs Playwright to open the pages.\n" +
      "Install it with:  npm i -D playwright && npx playwright install chromium\n"
  );
  process.exit(3);
}

const pages = existsSync(PAGES_ARG)
  ? JSON.parse(readFileSync(PAGES_ARG, "utf8")).pagesToReview ?? []
  : PAGES_ARG.split(",").map((u) => u.trim()).filter(Boolean);

if (pages.length === 0) {
  process.stderr.write("nothing to capture: the survey listed no pages\n");
  process.exit(2);
}

/**
 * Everything measured inside the page, in one pass.
 *
 * It runs in the browser, so it cannot close over anything out here. What it returns is shaped for
 * a reader rather than for completeness: a thousand element records would drown the model that has
 * to read them, so each list is capped and each entry keeps only what a judgement needs.
 */
function measure() {
  const seen = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x + scrollX),
      y: Math.round(r.y + scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height)
    };
  };
  const words = (s) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
  const trim = (s, n) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };

  let nextId = 0;
  const tag = (el) => {
    if (!el.dataset.reviewId) el.dataset.reviewId = `b${nextId++}`;
    return el.dataset.reviewId;
  };

  // Sections: the arrangement a reader perceives as "parts of the page". Anything shorter than a
  // line of text is furniture, not a part.
  const sectionEls = [...document.querySelectorAll("section, main > div, main > section, .elementor-section, .vc_row, .row, header, footer, article, aside")]
    .filter((el) => seen(el) && el.getBoundingClientRect().height >= 24);
  const sections = sectionEls.slice(0, 60).map((el) => ({
    id: tag(el),
    tag: el.tagName.toLowerCase(),
    className: trim(el.className?.toString?.() ?? "", 120),
    rect: rect(el),
    words: words(el.innerText),
    images: el.querySelectorAll("img").length,
    links: el.querySelectorAll("a[href]").length,
    text: trim(el.innerText, 240)
  }));

  // `objectFit` decides whether a shape mismatch means anything. A picture shown in a square box
  // is squashed only when the browser is told to stretch it; under `cover` the browser crops
  // instead, and the result looks perfectly proportioned. Without this field the naive comparison
  // of displayed shape against natural shape calls every cropped thumbnail distorted — measured on
  // juneflower, where it flagged all seven category tiles on a page with nothing wrong with it.
  const images = [...document.querySelectorAll("img")].filter(seen).slice(0, 60).map((el) => ({
    id: tag(el),
    src: el.currentSrc || el.src,
    alt: el.getAttribute("alt"),
    rect: rect(el),
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    objectFit: getComputedStyle(el).objectFit,
    loaded: el.complete && el.naturalWidth > 0
  }));

  const actions = [...document.querySelectorAll("a[href], button, input[type=submit]")]
    .filter(seen)
    .slice(0, 120)
    .map((el) => ({
      id: tag(el),
      kind: el.tagName.toLowerCase(),
      text: trim(el.innerText || el.value || el.getAttribute("aria-label") || "", 60),
      href: el.getAttribute("href"),
      rect: rect(el)
    }));

  // Text that a model cannot judge from a screenshot without squinting: the actual pixel size.
  const textBits = [...document.querySelectorAll("p, li, span, td, h1, h2, h3, h4, h5, h6, a, button, label")]
    .filter((el) => seen(el) && el.children.length === 0 && words(el.innerText) > 0);
  const sizes = new Map();
  const tiny = [];
  for (const el of textBits) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize));
    sizes.set(px, (sizes.get(px) ?? 0) + 1);
    if (px < 14 && tiny.length < 20) tiny.push({ id: tag(el), px, text: trim(el.innerText, 60), rect: rect(el) });
  }

  // Text escaping the box that holds it — the thing a reader sees as a word sticking out of a
  // button. Measured, not guessed, because a screenshot makes near-misses look identical.
  const overflowing = [];
  for (const el of [...document.querySelectorAll("a, button, h1, h2, h3, .btn, [class*=button]")].filter(seen)) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && overflowing.length < 20) {
      overflowing.push({ id: tag(el), text: trim(el.innerText, 60), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, rect: rect(el) });
    }
  }

  return {
    title: document.title,
    lang: document.documentElement.getAttribute("lang"),
    bodyClass: trim(document.body.className, 300),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    pageHeight: Math.round(document.documentElement.scrollHeight),
    sections,
    images,
    actions,
    fontSizes: [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([px, count]) => ({ px, count })),
    tinyText: tiny,
    overflowingText: overflowing,
    visibleText: trim(document.body.innerText, 12000)
  };
}

const slug = (url) =>
  url.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() ||
  "page";

async function main() {
  mkdirSync(path.join(OUT, "shots"), { recursive: true });
  mkdirSync(path.join(OUT, "pages"), { recursive: true });
  const browser = await chromium.launch();
  const captured = [];

  for (const url of pages) {
    const record = { url, slug: slug(url), viewports: {} };
    for (const name of WANT) {
      const size = VIEWPORTS[name];
      if (!size) continue;
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error" && consoleErrors.length < 10) consoleErrors.push(m.text().slice(0, 200));
      });
      try {
        const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
        // Lazy-loaded sections stay blank until something scrolls past them, and a blank section
        // is exactly the finding this skill is looking for — so the page is scrolled first, or
        // every long page would be reported as half empty.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(400);
        const data = await page.evaluate(measure);
        const shot = path.join("shots", `${record.slug}--${name}.png`);
        await page.screenshot({
          path: path.join(OUT, shot),
          fullPage: true,
          clip: data.pageHeight > MAX_SHOT_HEIGHT
            ? { x: 0, y: 0, width: size.width, height: MAX_SHOT_HEIGHT }
            : undefined
        });
        record.viewports[name] = {
          status: response?.status() ?? 0,
          screenshot: shot,
          screenshotTruncated: data.pageHeight > MAX_SHOT_HEIGHT,
          consoleErrors,
          ...data
        };
        process.stderr.write(`  ${name.padEnd(7)} ${url}\n`);
      } catch (error) {
        record.viewports[name] = { error: String(error).slice(0, 200) };
        process.stderr.write(`  ${name.padEnd(7)} ${url} — FAILED\n`);
      }
      await context.close();
    }
    // One file per page, because the reader is a model working through pages one at a time. A
    // single combined file reached a megabyte at twenty pages, and loading nineteen pages of
    // measurements to judge the twentieth is attention spent on nothing.
    writeFileSync(path.join(OUT, "pages", `${record.slug}.json`), JSON.stringify(record, null, 2));
    captured.push({
      url: record.url,
      slug: record.slug,
      measurements: path.join("pages", `${record.slug}.json`),
      shots: Object.fromEntries(Object.entries(record.viewports).map(([k, v]) => [k, v.screenshot ?? null]))
    });
  }

  await browser.close();
  writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify({ capturedAt: new Date().toISOString(), viewports: WANT, pages: captured }, null, 2)
  );
  process.stdout.write(JSON.stringify({ out: OUT, pages: captured.length, viewports: WANT }) + "\n");
}

main().catch((e) => {
  process.stderr.write(`capture failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
