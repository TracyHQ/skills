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

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/**
 * Find Playwright wherever a reasonable person put it.
 *
 * A bare `import("playwright")` resolves from THIS FILE's directory upward, which is the skill's
 * own folder — so a person who installs Playwright in the directory they are working in, the
 * obvious place, watches the skill insist it is missing. Measured the hard way: it took a symlink
 * into the skill folder to make the first run work, and nobody installing a skill is going to
 * think of that.
 *
 * So three places are tried, in the order someone would actually have used: beside the skill,
 * where the person is standing, and installed globally. The one that answers is reported, because
 * "which Preview am I running" is the first question when a browser misbehaves.
 */
async function loadPlaywright() {
  const attempts = [];

  try {
    return { mod: await import("playwright"), from: "beside the skill" };
  } catch (e) {
    attempts.push(`beside the skill: ${e.code ?? "not found"}`);
  }

  const fromDir = async (dir, label) => {
    try {
      const require = createRequire(pathToFileURL(path.join(dir, "resolve-from-here.js")));
      const entry = require.resolve("playwright");
      return { mod: await import(pathToFileURL(entry).href), from: label };
    } catch (e) {
      attempts.push(`${label}: ${e.code ?? "not found"}`);
      return null;
    }
  };

  const here = await fromDir(process.cwd(), `the current directory (${process.cwd()})`);
  if (here) return here;

  // Where THIS node keeps its global packages, worked out from the binary that is already running:
  // `/…/v24.15.0/bin/node` → `/…/v24.15.0/lib/node_modules`. No subprocess, and nothing on PATH.
  //
  // Asking `npm root -g` came first and was wrong in the one environment that matters. An agent
  // inside Tracy Desk runs with the app's PATH, which has no npm on it, so the lookup answered
  // "npm did not answer" and the script reported Playwright missing — on a machine where it was
  // installed and working. Measured 21/08: five and a half minutes of surveying, thrown away, and
  // the customer handed two install commands they did not need.
  // `lib/`, not the version root: a global install lands in `<prefix>/lib/node_modules`, and a
  // require anchored one level higher looks in `<prefix>/node_modules`, which does not exist.
  const beside = await fromDir(path.join(path.dirname(process.execPath), "..", "lib"), "installed beside node");
  if (beside) return beside;

  // Kept as a second try for a node that keeps its globals somewhere else entirely.
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const global = await fromDir(path.join(globalRoot, ".."), "installed globally");
    if (global) return global;
  } catch {
    attempts.push("installed globally: npm is not on PATH");
  }

  return { mod: null, attempts };
}

const found = await loadPlaywright();
// A package resolved by path comes back as its CommonJS entry, where the exports sit under
// `default` instead of being named. Reading `chromium` straight off it yields undefined and the
// failure surfaces two hundred lines later as "cannot read properties of undefined" — which is
// how the first version of this got shipped and immediately broke on the very instruction it
// prints.
const chromium = found.mod?.chromium ?? found.mod?.default?.chromium;
if (!chromium) {
  // Said plainly and once. A skill that dies on a stack trace teaches nobody what to do next.
  process.stderr.write(
    "This step needs Playwright to open the pages, and it is not installed.\n\n" +
      "Run these two, from the directory you are working in:\n" +
      "  npm install playwright\n" +
      "  npx playwright install chromium\n\n" +
      "The first downloads the library, the second the browser it drives. Both are one-time.\n" +
      `Looked in: ${(found.attempts ?? ["found, but it exported no chromium"]).join(" · ")}\n`
  );
  process.exit(3);
}
process.stderr.write(`playwright: ${found.from}\n`);

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

  /**
   * An address that survives the page being loaded again.
   *
   * The block ids above live only inside this one measurement — they are stamped onto the DOM in
   * this pass and gone the moment the page reloads. That is fine for drawing a box on a saved
   * screenshot, and useless for anything that wants to point at the same element on the live page
   * later: highlighting it in an editor, re-checking whether a fix landed, telling a second
   * reviewer where to look.
   *
   * So every element also gets a css path. Ids are preferred when they look authored rather than
   * generated — WordPress writes `post-482` and `menu-item-91`, which are as stable as the content
   * itself, while React writes `:r7:` and a build hash changes every deploy. Failing an id, the
   * path is a chain of `tag:nth-of-type`, which survives text edits and css changes and breaks only
   * when the page is genuinely rearranged. Breaking then is correct: the thing being pointed at
   * really did move.
   */
  const AUTHORED_ID = /^[A-Za-z][\w-]{1,40}$/;
  const GENERATED_ID = /^(:|r[0-9]|[a-f0-9]{8,})|[a-f0-9]{12,}/i;
  const stableId = (el) => {
    const id = el.id;
    if (!id || !AUTHORED_ID.test(id) || GENERATED_ID.test(id)) return null;
    return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1 ? id : null;
  };

  const cssPath = (el) => {
    const parts = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const id = stableId(node);
      if (id) {
        parts.unshift(`#${CSS.escape(id)}`);
        return parts.join(" > ");
      }
      const tagName = node.tagName.toLowerCase();
      const siblings = [...(node.parentElement?.children ?? [])].filter((c) => c.tagName === node.tagName);
      parts.unshift(siblings.length > 1 ? `${tagName}:nth-of-type(${siblings.indexOf(node) + 1})` : tagName);
      if (parts.length > 12) break;
    }
    return parts.join(" > ");
  };

  /** A few words of what the element said, so whoever follows the path can tell it is the same thing. */
  const hint = (el) => trim(el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || "", 40);

  /** Everything a finding needs to point at this element, now and on a later page load. */
  const addr = (el) => ({ id: tag(el), selector: cssPath(el), textHint: hint(el), rect: rect(el) });

  // Sections: the arrangement a reader perceives as "parts of the page". Anything shorter than a
  // line of text is furniture, not a part.
  const sectionEls = [...document.querySelectorAll("section, main > div, main > section, .elementor-section, .vc_row, .row, header, footer, article, aside")]
    .filter((el) => seen(el) && el.getBoundingClientRect().height >= 24);
  const sections = sectionEls.slice(0, 60).map((el) => ({
    ...addr(el),
    tag: el.tagName.toLowerCase(),
    className: trim(el.className?.toString?.() ?? "", 120),
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
    ...addr(el),
    src: el.currentSrc || el.src,
    alt: el.getAttribute("alt"),
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    objectFit: getComputedStyle(el).objectFit,
    loaded: el.complete && el.naturalWidth > 0
  }));

  const actions = [...document.querySelectorAll("a[href], button, input[type=submit]")]
    .filter(seen)
    .slice(0, 120)
    .map((el) => ({
      ...addr(el),
      kind: el.tagName.toLowerCase(),
      text: trim(el.innerText || el.value || el.getAttribute("aria-label") || "", 60),
      href: el.getAttribute("href")
    }));

  // Text that a model cannot judge from a screenshot without squinting: the actual pixel size.
  const textBits = [...document.querySelectorAll("p, li, span, td, h1, h2, h3, h4, h5, h6, a, button, label")]
    .filter((el) => seen(el) && el.children.length === 0 && words(el.innerText) > 0);
  const sizes = new Map();
  const tiny = [];
  for (const el of textBits) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize));
    sizes.set(px, (sizes.get(px) ?? 0) + 1);
    if (px < 14 && tiny.length < 20) tiny.push({ ...addr(el), px, text: trim(el.innerText, 60) });
  }

  // Text escaping the box that holds it — the thing a reader sees as a word sticking out of a
  // button. Measured, not guessed, because a screenshot makes near-misses look identical.
  const overflowing = [];
  for (const el of [...document.querySelectorAll("a, button, h1, h2, h3, .btn, [class*=button]")].filter(seen)) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && overflowing.length < 20) {
      overflowing.push({ ...addr(el), text: trim(el.innerText, 60), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
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

// The parameter that reaches the page inside a Preview's frame is plumbing, not identity: leaving
// it in would name every screenshot `...-tracy-frame-1--desktop.png` and make one page read on two
// addresses look like two different pages.
const slug = (url) =>
  url.replace(/[?&]__tracy_frame=1\b/, "").replace(/\?$/, "")
    .replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() ||
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
